import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claude, claudeArgs } from './claude.js';
import type { AgentEvent, AgentRun } from '../types.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-claude-steer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Claude Code with `--input-format stream-json --replay-user-messages`: each turn takes the
// messages waiting on stdin, runs one tool, takes what arrived meanwhile (unless FAKE_NO_LATE),
// and answers with what it heard. More waiting input starts another turn; EOF while idle exits.
const fake = join(dir, 'fake-claude.mjs');
writeFileSync(
  fake,
  `import readline from 'node:readline';
const queue = [];
let busy = false, closed = false, turn = 0;
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin })
  .on('line', (line) => { queue.push(JSON.parse(line)); if (!busy) void run(); })
  .on('close', () => { closed = true; if (!busy) process.exit(0); });
async function run() {
  busy = true;
  turn++;
  const heard = [];
  const take = () => {
    while (queue.length) {
      const message = queue.shift();
      out({ ...message, isReplay: true, session_id: 's-1' });
      heard.push(message.message.content[0].text);
    }
  };
  take();
  out({ type: 'assistant', session_id: 's-1', message: { content: [{ type: 'tool_use', id: 't' + turn, name: 'Bash', input: {} }] } });
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_TOOL_MS ?? 200)));
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't' + turn, content: 'ok' }] } });
  if (!process.env.FAKE_NO_LATE) take();
  const text = 'heard: ' + heard.join(' | ');
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: text });
  busy = false;
  if (queue.length) void run();
  else if (closed) process.exit(0);
}
`,
);
const bin = join(dir, 'claude');
writeFileSync(bin, `#!${process.execPath}\nimport(${JSON.stringify(fake)});\n`, { mode: 0o755 });

/** Runs a task and calls `onToolStart` at its first tool call. */
async function runWith(env: Record<string, string>, onToolStart: (run: AgentRun) => void) {
  const run = claude({ command: bin }).run({ prompt: 'build it', cwd: dir, env: { ...process.env, ...env } });
  const events: AgentEvent[] = [];
  let first = true;
  for await (const event of run) {
    events.push(event);
    if (event.type === 'tool-start' && first) {
      first = false;
      onToolStart(run);
    }
  }
  return { run, events, result: await run.result };
}

describe('claude() steering', () => {
  it('writes the prompt as stream-json and declares steering', () => {
    expect(claude().capabilities.steer).toBe(true);
    expect(claude({ steer: false }).capabilities.steer).toBeUndefined();
    const args = claudeArgs({ prompt: 'fix it', cwd: '.' }, {}, undefined, undefined, true);
    expect(args).toContain('--replay-user-messages');
    expect(args.slice(args.indexOf('--input-format'), args.indexOf('--input-format') + 2)).toEqual([
      '--input-format',
      'stream-json',
    ]);
    expect(args).not.toContain('fix it');
  });

  it('hands a steer to the running turn', async () => {
    let steered: Promise<void> | undefined;
    const { result, events } = await runWith({}, (run) => (steered = run.steer!('also add tests')));
    await expect(steered).resolves.toBeUndefined();
    expect(result).toMatchObject({ ok: true, text: 'heard: build it | also add tests' });
    expect(events.filter((event) => event.type === 'tool-start')).toHaveLength(1);
  });

  it('runs a steer that came too late for its turn as one more turn, then ends', async () => {
    let steered: Promise<void> | undefined;
    const { result, events } = await runWith({ FAKE_NO_LATE: '1' }, (run) => (steered = run.steer!('and docs')));
    await expect(steered).resolves.toBeUndefined();
    expect(result).toMatchObject({ ok: true, text: 'heard: and docs' });
    expect(events.filter((event) => event.type === 'tool-start')).toHaveLength(2);
  });

  it('refuses input once the task ended', async () => {
    const { run, result } = await runWith({}, () => {});
    expect(result.ok).toBe(true);
    await expect(run.steer!('too late')).rejects.toThrow(/not accepting input/);
  });

  it('rejects a steer the agent never took when the task is stopped', async () => {
    let steered: Promise<void> | undefined;
    const { result } = await runWith({ FAKE_NO_LATE: '1', FAKE_TOOL_MS: '5000' }, (run) => {
      steered = run.steer!('never mind');
      steered.catch(() => {});
      setTimeout(() => run.abort(), 50);
    });
    expect(result.status).toBe('aborted');
    await expect(steered).rejects.toThrow(/ended before it took the input/);
  });
});
