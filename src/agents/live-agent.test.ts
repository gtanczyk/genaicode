import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { codexLive } from './drivers/codex-live.js';
import { museLive } from './drivers/muse-live.js';
import { uuidv7 } from './live-agent.js';
import type { AgentEvent, AgentRun } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-live-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A stand-in JSON-RPC server. argv: 'app-server' behaves like Codex, 'serve' like Muse.
// FAKE_MODE: 'basic' | 'approval' | 'steer' | 'exit-early' | 'flood' (12 MiB of messages, then waits for a steer).
const server = join(dir, 'fake-server.mjs');
writeFileSync(
  server,
  `import { createInterface } from 'node:readline';
const codex = process.argv.includes('app-server');
const mode = process.env.FAKE_MODE ?? 'basic';
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
const note = (method, params) => send({ method, params: codex ? { threadId: 'th-1', ...params } : { sessionId: 'se-1', ...params } });
let started = {};
const finishTurn = (text) => {
  if (codex) {
    note('item/completed', { item: { id: 'm1', type: 'agentMessage', text } });
    note('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 5, outputTokens: 2 } } });
    note('turn/completed', { turn: { id: 'tu-1', status: 'completed' } });
  } else {
    note('item/completed', { item: { id: 'm1', type: 'agentMessage', text } });
    note('turn/completed', { turnId: 'tu-1', terminal: 'completed' });
  }
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === 99) return finishTurn('decision:' + JSON.stringify(msg.result ?? msg.error?.code));
  if (msg.method === 'initialize') return send({ id: msg.id, result: {} });
  if (msg.method === 'thread/start') { started = msg.params; return send({ id: msg.id, result: { thread: { id: 'th-1' } } }); }
  if (msg.method === 'session/start') { started = msg.params; return send({ id: msg.id, result: { session: { sessionId: 'se-1' } } }); }
  if (msg.method === 'turn/start') {
    send({ id: msg.id, result: codex ? { turn: { id: 'tu-1' } } : { turnId: 'tu-1' } });
    // Another thread's completion must not end this task.
    send({ method: 'turn/completed', params: { threadId: 'other', sessionId: 'other', turn: { id: 'x', status: 'failed' }, terminal: 'failed' } });
    note('item/started', { item: { id: 'c1', type: 'commandExecution', command: 'ls' } });
    if (mode === 'exit-early') process.exit(0);
    if (mode === 'flood') for (let i = 0; i < 12; i++) note('item/completed', { item: { id: 'f' + i, type: 'agentMessage', text: 'x'.repeat(1024 * 1024) } });
    if (mode === 'approval') {
      if (codex) send({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'th-1', itemId: 'c1', approvalId: 'c1-a2', command: 'rm -rf build' } });
      else send({ id: 99, method: 'approval/request', params: { sessionId: 'se-1', id: 'ap-1' } });
      return;
    }
    if (mode === 'basic') finishTurn('started with ' + JSON.stringify(started.approvalPolicy ?? started.approvalMode));
    return;
  }
  if (msg.method === 'turn/steer') {
    send({ id: msg.id, result: { turnId: 'tu-1' } });
    finishTurn('steered:' + msg.params.input[0].text);
  }
});
`,
);

function env(mode: string) {
  return { ...process.env, FAKE_MODE: mode };
}

function bin(name: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}\nimport(${JSON.stringify(server)});\n`, { mode: 0o755 });
  return path;
}
const codexBin = bin('codex');
const museBin = bin('muse');

async function collect(run: AgentRun, onEvent?: (event: AgentEvent) => void) {
  const events: AgentEvent[] = [];
  for await (const event of run) {
    events.push(event);
    onEvent?.(event);
  }
  return events;
}

describe('codexLive', () => {
  it('runs one turn and folds its events', async () => {
    const run = codexLive({ command: codexBin }).run({ prompt: 'go', cwd: dir, env: env('basic') });
    const events = await collect(run);
    const result = await run.result;
    expect(result).toMatchObject({ status: 'completed', sessionId: 'th-1', text: 'started with "never"' });
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    expect(events.map((event) => event.type)).toEqual(['session', 'tool-start', 'message', 'usage', 'done']);
  });

  it('routes approvals to onApproval', async () => {
    const seen: unknown[] = [];
    const run = codexLive({ command: codexBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('approval'),
      onApproval: (request) => {
        seen.push(request);
        return 'approve';
      },
    });
    const events = await collect(run);
    expect(seen).toMatchObject([{ id: 'c1-a2', kind: 'command', summary: 'rm -rf build' }]);
    expect(events).toContainEqual({ type: 'approval-resolved', id: 'c1-a2', decision: 'approve' });
    expect((await run.result).text).toBe('decision:{"decision":"accept"}');
  });

  it('declines approvals when onApproval throws', async () => {
    const run = codexLive({ command: codexBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('approval'),
      onApproval: () => {
        throw new Error('no');
      },
    });
    expect((await run.result).text).toBe('decision:{"decision":"decline"}');
  });

  it('steers a running turn', async () => {
    const run = codexLive({ command: codexBin }).run({ prompt: 'go', cwd: dir, env: env('steer') });
    await collect(run, (event) => {
      if (event.type === 'tool-start') void run.steer!('also add tests');
    });
    const result = await run.result;
    expect(result).toMatchObject({ ok: true, text: 'steered:also add tests' });
    await expect(run.steer!('late')).rejects.toThrow(/not accepting input/);
  });

  it('steers from inside a slow loop while the agent is paused', async () => {
    const run = codexLive({ command: codexBin }).run({ prompt: 'go', cwd: dir, env: env('flood') });
    let count = 0;
    for await (const event of run) {
      count++;
      if (event.type === 'message' && count === 4) await run.steer!('done flooding');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(count).toBeGreaterThan(12);
    expect(await run.result).toMatchObject({ ok: true, text: 'steered:done flooding' });
  });

  it('fails when the server exits before the turn ends', async () => {
    const result = await codexLive({ command: codexBin }).run({ prompt: 'go', cwd: dir, env: env('exit-early') })
      .result;
    expect(result).toMatchObject({ status: 'failed', exitCode: 0 });
    expect(result.error).toMatch(/exited before the task finished/);
  });

  it('aborts a waiting turn', async () => {
    const run = codexLive({ command: codexBin }).run({ prompt: 'go', cwd: dir, env: env('steer') });
    setTimeout(() => run.abort(), 200);
    await expect(run.result).resolves.toMatchObject({ status: 'aborted' });
  });
});

describe('museLive', () => {
  it('runs and steers a turn', async () => {
    const run = museLive({ command: museBin }).run({ prompt: 'go', cwd: dir, env: env('steer') });
    await collect(run, (event) => {
      if (event.type === 'tool-start') void run.steer!('more');
    });
    expect(await run.result).toMatchObject({ ok: true, sessionId: 'se-1', text: 'steered:more' });
  });

  it('reports approval requests and declines them', async () => {
    const run = museLive({ command: museBin }).run({ prompt: 'go', cwd: dir, env: env('approval') });
    const events = await collect(run);
    expect(events).toContainEqual({
      type: 'approval-request',
      request: { id: 'ap-1', kind: 'other', detail: { sessionId: 'se-1', id: 'ap-1' } },
    });
    expect((await run.result).text).toBe('decision:-32601');
  });
});

describe('uuidv7', () => {
  it('encodes version, variant and time order', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
