import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cliAgent, type CliAgentDefinition } from './cli-agent.js';
import { claude } from './drivers/claude.js';
import type { AgentEvent } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-agent-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Prints FAKE_LINES (a JSON array) to stdout, FAKE_STDERR to stderr, then exits with FAKE_EXIT.
const script = join(dir, 'fake-agent.mjs');
writeFileSync(
  script,
  `const lines = JSON.parse(process.env.FAKE_LINES ?? '[]');
for (const line of lines) process.stdout.write((typeof line === 'string' ? line : JSON.stringify(line)) + '\\n');
if (process.env.FAKE_STDERR) process.stderr.write(process.env.FAKE_STDERR);
if (process.env.FAKE_ARGS) process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
if (process.env.FAKE_HANG) setInterval(() => {}, 1000);
else process.exitCode = Number(process.env.FAKE_EXIT ?? 0);
`,
);

// Writes FAKE_BULK lines of 1 MiB of plain text, then a final message.
const bulk = join(dir, 'bulk-agent.mjs');
writeFileSync(
  bulk,
  `const line = 'x'.repeat(1024 * 1024) + '\\n';
for (let i = 0; i < Number(process.env.FAKE_BULK); i++) process.stdout.write(line);
process.stdout.write(JSON.stringify({ say: 'end' }) + '\\n');
`,
);

function fakeAgent(overrides: Partial<CliAgentDefinition> = {}) {
  return cliAgent({
    name: 'fake',
    command: process.execPath,
    args: (task) => [script, task.prompt],
    createParser: () => ({
      event: (value) =>
        typeof value === 'object' && value && 'say' in value ? [{ type: 'message', text: String(value.say) }] : [],
    }),
    ...overrides,
  });
}

function env(values: Record<string, string>) {
  return { ...process.env, ...values };
}

async function collect(run: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

describe('cliAgent', () => {
  it('settles when a background child keeps the output pipes open', async () => {
    const leftover = join(dir, 'leftover-agent.mjs');
    writeFileSync(
      leftover,
      `import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();
console.log(JSON.stringify({ say: 'bye' }));
`,
    );
    const started = Date.now();
    const result = await fakeAgent({ args: () => [leftover] }).run({ prompt: 'hi', cwd: dir }).result;
    expect(result).toMatchObject({ ok: true, text: 'bye' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('keeps only the latest events for a run awaited through result alone', async () => {
    const lines = Array.from({ length: 1500 }, (_, index) => ({ say: String(index) }));
    const run = fakeAgent().run({ prompt: 'hi', cwd: dir, env: env({ FAKE_LINES: JSON.stringify(lines) }) });
    const result = await run.result;
    const events = await collect(run);

    expect(result).toMatchObject({ ok: true, text: '1499' });
    expect(events).toHaveLength(1000);
    expect(events.at(-1)?.type).toBe('done');
    expect(events.at(-2)).toEqual({ type: 'message', text: '1499' });
  });

  it('bounds the bytes kept for a run awaited through result alone', async () => {
    const run = fakeAgent({ args: () => [bulk] }).run({ prompt: 'hi', cwd: dir, env: env({ FAKE_BULK: '24' }) });
    const result = await run.result;
    const events = await collect(run);

    expect(result).toMatchObject({ ok: true, text: 'end' });
    expect(events.filter((event) => event.type === 'raw').length).toBeLessThanOrEqual(8);
    expect(events.slice(-2).map((event) => event.type)).toEqual(['message', 'done']);
  });

  it('pauses the agent for a slow consumer without losing output', async () => {
    const run = fakeAgent({ args: () => [bulk] }).run({ prompt: 'hi', cwd: dir, env: env({ FAKE_BULK: '24' }) });
    const events: AgentEvent[] = [];
    let readWhenSettled = -1;
    void run.result.then(() => (readWhenSettled = events.length));
    for await (const event of run) {
      events.push(event);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(events.filter((event) => event.type === 'raw')).toHaveLength(24);
    // The agent could not finish while more than the high-water mark sat unread.
    expect(readWhenSettled).toBeGreaterThanOrEqual(14);
    expect(events.slice(-2).map((event) => event.type)).toEqual(['message', 'done']);
    expect(await run.result).toMatchObject({ ok: true, text: 'end' });
  });

  it('streams parsed events and folds them into the result', async () => {
    const run = fakeAgent().run({
      prompt: 'hi',
      cwd: dir,
      env: env({ FAKE_LINES: JSON.stringify([{ say: 'one' }, 'plain text', { say: 'two' }]) }),
    });
    const events = await collect(run);
    const result = await run.result;

    expect(events.map((event) => event.type)).toEqual(['message', 'raw', 'message', 'done']);
    expect(events[1]).toEqual({ type: 'raw', line: 'plain text' });
    expect(result).toMatchObject({ status: 'completed', ok: true, exitCode: 0, text: 'two' });
    expect(events.at(-1)).toEqual({ type: 'done', result });
  });

  it('settles the result without iteration and passes cwd and args', async () => {
    const run = fakeAgent({
      createParser: () => ({ event: (value) => [{ type: 'raw', line: JSON.stringify(value) }] }),
    }).run({ prompt: '-dash', cwd: dir, env: env({ FAKE_ARGS: '1' }) });
    const result = await run.result;
    expect(result.ok).toBe(true);
    const events = await collect(run);
    const echoed = JSON.parse((events[0] as { line: string }).line);
    expect(echoed.args).toEqual(['-dash']);
  });

  it('reports a non-zero exit with the stderr tail', async () => {
    const result = await fakeAgent().run({
      prompt: 'x',
      cwd: dir,
      env: env({ FAKE_EXIT: '3', FAKE_STDERR: 'boom\n' }),
    }).result;
    expect(result).toMatchObject({ status: 'failed', ok: false, exitCode: 3, error: 'boom' });
  });

  it('lets the driver outcome fail a zero exit', async () => {
    const result = await fakeAgent({
      createParser: () => ({ event: () => [], outcome: () => ({ ok: false, error: 'agent said no' }) }),
    }).run({ prompt: 'x', cwd: dir, env: env({}) }).result;
    expect(result).toMatchObject({ status: 'failed', exitCode: 0, error: 'agent said no' });
  });

  it('aborts through the signal and through abort()', async () => {
    const controller = new AbortController();
    const signalled = fakeAgent().run({
      prompt: 'x',
      cwd: dir,
      env: env({ FAKE_HANG: '1' }),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(signalled.result).resolves.toMatchObject({ status: 'aborted', ok: false });

    const direct = fakeAgent().run({ prompt: 'x', cwd: dir, env: env({ FAKE_HANG: '1' }) });
    setTimeout(() => direct.abort(), 100);
    await expect(direct.result).resolves.toMatchObject({ status: 'aborted' });
  });

  it('times out', async () => {
    const result = await fakeAgent().run({ prompt: 'x', cwd: dir, env: env({ FAKE_HANG: '1' }), timeoutMs: 100 })
      .result;
    expect(result).toMatchObject({ status: 'timeout', error: 'fake timed out.' });
  });

  it('fails cleanly on a missing command or cwd', async () => {
    const missing = await fakeAgent({ command: join(dir, 'no-such-agent') }).run({ prompt: 'x', cwd: dir }).result;
    expect(missing.status).toBe('failed');
    expect(missing.error).toMatch(/was not found/);

    const run = fakeAgent().run({ prompt: 'x', cwd: join(dir, 'nope') });
    expect((await run.result).error).toMatch(/Working directory does not exist/);
    expect((await collect(run)).map((event) => event.type)).toEqual(['done']);
  });

  it('can be iterated only once', async () => {
    const run = fakeAgent().run({ prompt: 'x', cwd: dir, env: env({}) });
    await collect(run);
    await expect(collect(run)).rejects.toThrow(/only once/);
  });

  it('runs a real driver against a stand-in executable', async () => {
    const bin = join(dir, 'claude');
    writeFileSync(bin, `#!${process.execPath}\nimport(${JSON.stringify(script)});\n`, { mode: 0o755 });
    const lines = [
      { type: 'system', subtype: 'init', session_id: 's-1', model: 'm' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    ];
    const result = await claude({ command: bin }).run({
      prompt: 'x',
      cwd: dir,
      env: env({ FAKE_LINES: JSON.stringify(lines) }),
    }).result;
    expect(result).toMatchObject({ ok: true, sessionId: 's-1', text: 'done', usage: { totalTokens: 3 } });
  });
});
