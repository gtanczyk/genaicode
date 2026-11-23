import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { startQuestionChannel } from './ask-user.js';
import { codexLive } from './drivers/codex-live.js';
import { museLive } from './drivers/muse-live.js';
import { decideApproval, questionAnswers, reportReply, uuidv7 } from './live-agent.js';
import type { AgentEvent, AgentRun, ApprovalRequest } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-live-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A stand-in JSON-RPC server. argv: 'app-server' behaves like Codex, 'serve' like Muse.
// FAKE_MODE: 'basic' | 'approval' | 'approval-stages' (Muse only) | 'steer' | 'exit-early' |
// 'flood' (12 MiB of messages, then waits for a steer).
const server = join(dir, 'fake-server.mjs');
writeFileSync(
  server,
  `import { createInterface } from 'node:readline';
const codex = process.argv.includes('app-server');
const mode = process.env.FAKE_MODE ?? 'basic';
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
const note = (method, params) => send({ method, params: codex ? { threadId: 'th-1', ...params } : { sessionId: 'se-1', ...params } });
let initParams = {};
let started = {};
let turnParams = {};
let receipt;
const decisions = [];
let decidedAll = false;
// The turn ends once the approval is decided and the server request has its receipt.
const museFinish = () => {
  if (decidedAll && receipt !== undefined) finishTurn('decided:' + decisions.join(',') + ' receipt:' + JSON.stringify(receipt));
};
const museChoices = [
  { choiceId: 'allow-session', decision: 'approvedForSession', scope: 'session', label: 'Always' },
  { choiceId: 'allow-once', decision: 'approved', scope: 'once', label: 'Allow' },
  { choiceId: 'deny-once', decision: 'denied', scope: 'once', label: 'Deny' },
].filter((choice) => process.env.FAKE_CHOICES !== 'session-only' || choice.choiceId !== 'allow-once');
const museApproval = {
  sessionId: 'se-1',
  approvalId: 'ap-1',
  itemId: 'c1',
  toolName: 'shell',
  subject: { kind: 'shell', command: 'rm -rf build' },
  currentRequirementId: { approvalId: 'ap-1', sourceIndex: 0 },
  availableChoices: museChoices,
};
const finishTurn = (text) => {
  if (codex) {
    note('item/completed', { item: { id: 'm1', type: 'agentMessage', text } });
    note('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 5, outputTokens: 2 } } });
    // Account-wide, so without a threadId.
    if (process.env.FAKE_RATE_LIMITS) send({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 90, windowDurationMins: 300 } } } });
    note('turn/completed', { turn: { id: 'tu-1', status: 'completed' } });
  } else {
    note('item/completed', { item: { id: 'm1', type: 'agentMessage', text } });
    note('turn/completed', { turnId: 'tu-1', terminal: 'completed' });
  }
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === 99 && codex) return finishTurn('decision:' + JSON.stringify(msg.result ?? msg.error?.code));
  if (msg.id === 99) { receipt = msg.result ?? msg.error; return museFinish(); }
  if (msg.method === 'approval/decide') {
    decisions.push(msg.params.choiceId + '@' + msg.params.requirementId.sourceIndex);
    const more = mode === 'approval-stages' && decisions.length === 1;
    send({ id: msg.id, result: { approvalId: 'ap-1', commandId: msg.params.commandId, status: 'accepted', terminal: !more } });
    if (more) return note('approval/updated', { approvalId: 'ap-1', change: { kind: 'stageResolved' }, availableChoices: museApproval.availableChoices, currentRequirementId: { approvalId: 'ap-1', sourceIndex: 1 }, subject: { kind: 'shell', command: 'git push' } });
    decidedAll = true;
    return museFinish();
  }
  if (msg.method === 'initialize') { initParams = msg.params ?? {}; return send({ id: msg.id, result: {} }); }
  if (msg.method === 'thread/start') {
    started = msg.params;
    return send({ id: msg.id, result: { thread: { id: 'th-1' }, model: 'gpt-5', reasoningEffort: 'medium' } });
  }
  if (msg.method === 'thread/resume') {
    started = { ...msg.params, resumed: msg.params.threadId };
    if (mode === 'usage-replay') note('thread/tokenUsage/updated', { turnId: 'old', tokenUsage: { total: { inputTokens: 1000, outputTokens: 80, cachedInputTokens: 500 } } });
    const collab = process.env.FAKE_COLLAB_MODE
      ? { mode: process.env.FAKE_COLLAB_MODE, settings: { model: 'gpt-5', reasoning_effort: 'medium', developer_instructions: '' } }
      : null;
    return send({ id: msg.id, result: { thread: { id: 'th-1', status: { type: mode === 'busy' ? 'active' : 'idle' } }, model: 'gpt-5', reasoningEffort: 'medium', collaborationMode: collab } });
  }
  if (msg.method === 'session/start') { started = msg.params; return send({ id: msg.id, result: { session: { sessionId: 'se-1' } } }); }
  if (msg.method === 'session/resume') { started = { resumed: msg.params.sessionId, excludeItems: msg.params.excludeItems }; return send({ id: msg.id, result: { session: { sessionId: 'se-1' }, history: { mode: 'none' }, pendingRequests: [] } }); }
  if (msg.method === 'turn/start') {
    turnParams = msg.params ?? {};
    if (mode === 'usage-replay' || mode === 'usage-last') {
      const update = (input, output, cached, last) => note('thread/tokenUsage/updated', { turnId: 'tu-1', tokenUsage: {
        total: { inputTokens: input, outputTokens: output, cachedInputTokens: cached }, last,
      } });
      update(1010, 82, 508, { inputTokens: 10, outputTokens: 2, cachedInputTokens: 8 });
      send({ id: msg.id, result: { turn: { id: 'tu-1' } } });
      update(1015, 85, 510, { inputTokens: 5, outputTokens: 3, cachedInputTokens: 2 });
      update(1015, 85, 510, { inputTokens: 5, outputTokens: 3, cachedInputTokens: 2 });
      note('turn/completed', { turn: { id: 'tu-1', status: 'completed' } });
      return;
    }
    if (codex && started.resumed && (msg.params.threadId !== started.resumed || !started.excludeTurns)) return send({ id: msg.id, error: { code: -32602, message: 'Invalid resumed turn' } });
    send({ id: msg.id, result: codex ? { turn: { id: 'tu-1' } } : { turnId: 'tu-1' } });
    // Another thread's completion must not end this task.
    send({ method: 'turn/completed', params: { threadId: 'other', sessionId: 'other', turn: { id: 'x', status: 'failed' }, terminal: 'failed' } });
    note('item/started', { item: { id: 'c1', type: 'commandExecution', command: 'ls' } });
    if (mode === 'exit-early') process.exit(0);
    if (mode === 'flood') for (let i = 0; i < 12; i++) note('item/completed', { item: { id: 'f' + i, type: 'agentMessage', text: 'x'.repeat(1024 * 1024) } });
    if (mode === 'permissions' && codex) {
      send({ id: 99, method: 'item/permissions/requestApproval', params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'p1', reason: null, permissions: { network: { enabled: true }, fileSystem: null } } });
      return;
    }
    if (mode === 'approval-exit' && codex) {
      send({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'c1', command: 'rm -rf build' } });
      return setTimeout(() => process.exit(0), 50);
    }
    if (mode === 'approval' && codex) {
      send({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'th-1', itemId: 'c1', approvalId: 'c1-a2', command: 'rm -rf build' } });
      return;
    }
    if (mode === 'approval' || mode === 'approval-stages') {
      // Both forms of one approval: the view notification and the server request.
      note('approval/requested', museApproval);
      send({ id: 99, method: 'approval/request', params: museApproval });
      return;
    }
    if (mode === 'basic') finishTurn(started.resumed ? 'resumed ' + started.resumed + ' excludeItems:' + started.excludeItems : 'started with ' + JSON.stringify(started.approvalPolicy ?? started.approvalMode));
    if (mode === 'policy') finishTurn(JSON.stringify({ approvalPolicy: started.approvalPolicy, approvalMode: started.approvalMode, sandbox: started.sandbox }));
    if (mode === 'plan-echo' && codex) {
      note('item/plan/delta', { itemId: 'p1', delta: 'Step 1. ' });
      note('item/completed', { item: { id: 'p1', type: 'plan', text: JSON.stringify({ init: initParams.capabilities, collaborationMode: turnParams.collaborationMode, effort: turnParams.effort }) } });
      note('turn/completed', { turn: { id: 'tu-1', status: 'completed' } });
    }
    if (mode === 'question-secret' && codex) {
      send({ id: 99, method: 'item/tool/requestUserInput', params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'call_sec', isBlocking: true, autoResolutionMs: null, questions: [{ id: 'tok', header: 'Token', question: 'Enter token', isOther: false, isSecret: true, options: null }] } });
      return;
    }
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
  it.each(['usage-replay', 'usage-last'])('charges only the resumed turn to its token budget (%s)', async (mode) => {
    const run = codexLive({ command: codexBin }).run({
      prompt: 'continue',
      cwd: dir,
      resume: 'th-1',
      env: env(mode),
      budget: { maxTokens: 25 },
    });
    const events = await collect(run);
    const samples = events.flatMap((event) => (event.type === 'usage' ? [event.usage] : []));
    expect(samples.map((usage) => usage.totalTokens)).toEqual([12, 20, 20]);
    expect(await run.result).toMatchObject({
      ok: true,
      usage: { inputTokens: 15, outputTokens: 5, cachedInputTokens: 10, totalTokens: 20 },
    });
  });
  it('resumes the reviewed thread with its saved policies and routes its approvals to the operator', async () => {
    const agent = codexLive({ command: codexBin });
    const task = { prompt: 'go', cwd: dir, resume: 'th-1' };
    const saved = await agent.run({ ...task, env: env('policy') }).result;
    expect(saved).toMatchObject({ ok: true, sessionId: 'th-1', text: '{}' });
    const asked = await agent.run({ ...task, env: env('approval'), onApproval: () => 'deny' }).result;
    expect(asked).toMatchObject({ ok: true, text: 'decision:{"decision":"decline"}' });
    const explicit = await agent.run({
      ...task,
      env: env('policy'),
      permissions: { sandbox: 'read-only', approval: 'ask' },
      onApproval: () => 'deny',
    }).result;
    expect(JSON.parse(explicit.text!)).toEqual({ sandbox: 'read-only', approvalPolicy: 'on-request' });
    expect(await agent.run({ ...task, resume: 'another', env: env('basic') }).result).toMatchObject({
      ok: false,
      error: expect.stringContaining('different thread'),
    });
    expect(await agent.run({ ...task, env: env('busy') }).result).toMatchObject({
      ok: false,
      error: expect.stringContaining('active turn'),
    });
  });
  it('runs one turn and folds its events', async () => {
    const run = codexLive({ command: codexBin }).run({ prompt: 'go', cwd: dir, env: env('basic') });
    const events = await collect(run);
    const result = await run.result;
    expect(result).toMatchObject({ status: 'completed', sessionId: 'th-1', text: 'started with "never"' });
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    expect(events.map((event) => event.type)).toEqual(['session', 'tool-start', 'message', 'usage', 'done']);
  });

  it('reports account rate limits, which carry no threadId', async () => {
    const run = codexLive({ command: codexBin }).run({
      prompt: 'go',
      cwd: dir,
      env: { ...env('basic'), FAKE_RATE_LIMITS: '1' },
    });
    const events = await collect(run);
    expect(events).toContainEqual({ type: 'rate-limit', limit: { window: '5h', status: 'warning', usedPercent: 90 } });
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

  it('grants a permission profile for the turn', async () => {
    const seen: unknown[] = [];
    const run = codexLive({ command: codexBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('permissions'),
      onApproval: (request) => {
        seen.push(request);
        return 'approve';
      },
    });
    expect((await run.result).text).toBe('decision:{"permissions":{"network":{"enabled":true}},"scope":"turn"}');
    expect(seen).toMatchObject([{ id: 'p1', kind: 'other', scope: 'turn' }]);
  });

  it('withdraws an open question when the agent exits', async () => {
    let signal: AbortSignal | undefined;
    const run = codexLive({ command: codexBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('approval-exit'),
      onApproval: (_, given) => {
        signal = given;
        return new Promise(() => {});
      },
    });
    const events = await collect(run);
    expect((await run.result).status).toBe('failed');
    expect(signal?.aborted).toBe(true);
    expect(events).toContainEqual({ type: 'approval-resolved', id: 'c1', decision: 'deny' });
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

  it('sends collaborationMode for Plan mode, re-sends on resume only when changed, and reads plan items', async () => {
    const ask = async (
      task: Parameters<ReturnType<typeof codexLive>['run']>[0],
      options: Parameters<typeof codexLive>[0] = {},
    ) => {
      const run = codexLive({ command: codexBin, ...options }).run(task);
      const events = await collect(run);
      const result = await run.result;
      expect(result.ok).toBe(true);
      expect(events).toContainEqual({ type: 'text-delta', text: 'Step 1. ' });
      return JSON.parse(result.text!) as Record<string, unknown>;
    };

    // Normal fresh turn: neither experimentalApi nor collaborationMode is sent.
    expect(await ask({ prompt: 'go', cwd: dir, env: env('plan-echo') })).toEqual({});

    // Fresh turn in Plan mode via task.mode: opts into experimentalApi and sends collaborationMode.
    expect(await ask({ prompt: 'plan', cwd: dir, mode: 'plan', env: env('plan-echo') })).toEqual({
      init: { experimentalApi: true },
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-5', reasoning_effort: 'medium', developer_instructions: null },
      },
    });

    // Driver option collaborationMode, with explicit model and effort.
    expect(
      await ask(
        { prompt: 'plan', cwd: dir, model: 'o3', effort: 'low', env: env('plan-echo') },
        { collaborationMode: 'plan' },
      ),
    ).toEqual({
      init: { experimentalApi: true },
      effort: 'low',
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'o3', reasoning_effort: 'low', developer_instructions: null },
      },
    });

    // Resuming a thread already in Plan mode with mode: 'plan' does NOT re-send collaborationMode.
    expect(
      await ask({
        prompt: 'refine',
        cwd: dir,
        resume: 'th-1',
        mode: 'plan',
        env: { ...env('plan-echo'), FAKE_COLLAB_MODE: 'plan' },
      }),
    ).toEqual({ init: { experimentalApi: true } });

    // Resuming a thread in default mode with mode: 'plan' enters Plan mode.
    expect(
      await ask({
        prompt: 'plan now',
        cwd: dir,
        resume: 'th-1',
        mode: 'plan',
        env: { ...env('plan-echo'), FAKE_COLLAB_MODE: 'default' },
      }),
    ).toEqual({
      init: { experimentalApi: true },
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-5', reasoning_effort: 'medium', developer_instructions: null },
      },
    });

    // Resuming a thread in Plan mode with mode: 'default' switches back to default.
    expect(
      await ask({
        prompt: 'implement',
        cwd: dir,
        resume: 'th-1',
        mode: 'default',
        env: { ...env('plan-echo'), FAKE_COLLAB_MODE: 'plan' },
      }),
    ).toEqual({
      init: { experimentalApi: true },
      collaborationMode: {
        mode: 'default',
        settings: { model: 'gpt-5', reasoning_effort: 'medium', developer_instructions: null },
      },
    });

    // Resuming a thread already in default mode with mode: 'default' does NOT re-send collaborationMode.
    expect(
      await ask({
        prompt: 'keep going',
        cwd: dir,
        resume: 'th-1',
        mode: 'default',
        env: { ...env('plan-echo'), FAKE_COLLAB_MODE: 'default' },
      }),
    ).toEqual({ init: { experimentalApi: true } });

    // Resuming a thread in Plan mode with mode omitted inherits Plan mode without sending collaborationMode,
    // and reports mode: 'plan' on the session event so AgentSession keeps state in sync.
    const inheritedRun = codexLive({ command: codexBin }).run({
      prompt: 'keep planning',
      cwd: dir,
      resume: 'th-1',
      env: { ...env('plan-echo'), FAKE_COLLAB_MODE: 'plan' },
    });
    const inheritedEvents = await collect(inheritedRun);
    expect(inheritedEvents).toContainEqual({ type: 'session', sessionId: 'th-1', mode: 'plan' });
    expect(JSON.parse((await inheritedRun.result).text!)).toEqual({});
  });

  it('masks secret requestUserInput answers in events while sending the real value to Codex', async () => {
    const run = codexLive({ command: codexBin }).run({
      prompt: 'ask secret',
      cwd: dir,
      mode: 'plan',
      env: env('question-secret'),
      onQuestion: () => ({ tok: ['s3cret-token-value'] }),
    });
    const events = await collect(run);
    expect(events).toContainEqual({
      type: 'approval-resolved',
      id: 'call_sec',
      decision: 'approve',
      answers: { tok: ['••••'] },
    });
    expect(JSON.stringify(events.filter((event) => event.type !== 'message' && event.type !== 'done'))).not.toContain(
      's3cret-token-value',
    );
    expect((await run.result).text).toBe('decision:{"answers":{"tok":{"answers":["s3cret-token-value"]}}}');
  });

  it('routes native requestUserInput to a directly bound startQuestionChannel handler without task.onQuestion', async () => {
    const channel = await startQuestionChannel({ name: 'choices' });
    channel.bind(() => ({ tok: ['bound-answer'] }));
    try {
      const run = codexLive({ command: codexBin }).run({
        prompt: 'ask',
        cwd: dir,
        mode: 'plan',
        env: env('question-secret'),
        mcpServers: [channel.mcpServer],
      });
      expect((await run.result).text).toBe('decision:{"answers":{"tok":{"answers":["bound-answer"]}}}');
    } finally {
      await channel.close();
    }
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

  it('resumes a saved session with session/resume instead of starting one', async () => {
    const run = museLive({ command: museBin }).run({ prompt: 'go', cwd: dir, env: env('basic'), resume: 'se-0' });
    expect(await run.result).toMatchObject({ ok: true, text: 'resumed se-0 excludeItems:true' });
    const fresh = await museLive({ command: museBin }).run({ prompt: 'go', cwd: dir, env: env('basic') }).result;
    expect(fresh.text).toBe('started with "onRequest"');
  });

  it('routes approvals to onApproval and decides through approval/decide', async () => {
    const seen: unknown[] = [];
    const run = museLive({ command: museBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('approval'),
      onApproval: (request) => {
        seen.push(request);
        return 'approve';
      },
    });
    const events = await collect(run);
    expect(seen).toMatchObject([{ id: 'ap-1', kind: 'command', summary: 'rm -rf build' }]);
    expect(events).toContainEqual({ type: 'approval-resolved', id: 'ap-1', decision: 'approve' });
    // Decided once although both forms arrived; the server request got an empty receipt.
    expect((await run.result).text).toBe('decided:allow-once@0 receipt:{}');
  });

  it('denies approvals without onApproval', async () => {
    const run = museLive({ command: museBin }).run({ prompt: 'go', cwd: dir, env: env('approval') });
    const events = await collect(run);
    expect(events).toContainEqual({ type: 'approval-resolved', id: 'ap-1', decision: 'deny' });
    expect((await run.result).text).toBe('decided:deny-once@0 receipt:{}');
  });

  it('denies rather than approving for the whole session', async () => {
    const run = museLive({ command: museBin }).run({
      prompt: 'go',
      cwd: dir,
      env: { ...env('approval'), FAKE_CHOICES: 'session-only' },
      onApproval: () => 'approve',
    });
    const events = await collect(run);
    expect(events).toContainEqual({
      type: 'error',
      message: 'Muse offered no one-time approval for ap-1; denying it.',
    });
    expect((await run.result).text).toBe('decided:deny-once@0 receipt:{}');
  });

  it('decides each stage of a multi-stage approval', async () => {
    const seen: string[] = [];
    const run = museLive({ command: museBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('approval-stages'),
      onApproval: (request) => {
        seen.push(`${request.id}:${request.summary}`);
        return seen.length === 1 ? 'approve' : 'deny';
      },
    });
    expect((await run.result).text).toBe('decided:allow-once@0,deny-once@1 receipt:{}');
    expect(seen).toEqual(['ap-1:rm -rf build', 'ap-1/2:git push']);
  });
});

describe('live agents with task.permissions', () => {
  const policy = async (run: AgentRun) => {
    const result = await run.result;
    expect(result.status).toBe('completed');
    return JSON.parse(result.text!) as Record<string, unknown>;
  };

  it('maps Codex approval and sandbox to thread/start', async () => {
    const agent = codexLive({ command: codexBin });
    const task = { prompt: 'go', cwd: dir, env: env('policy') };
    expect(await policy(agent.run({ ...task, permissions: 'yolo' }))).toEqual({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    expect(
      await policy(
        agent.run({ ...task, permissions: { approval: 'ask', sandbox: 'read-only' }, onApproval: () => 'deny' }),
      ),
    ).toEqual({ approvalPolicy: 'on-request', sandbox: 'read-only' });
    // An explicit `deny` wins over an onApproval handler.
    expect(
      await policy(agent.run({ ...task, permissions: { approval: 'deny' }, onApproval: () => 'approve' })),
    ).toEqual({ approvalPolicy: 'never', sandbox: 'workspace-write' });
  });

  it('refuses what it cannot honor before starting', async () => {
    const ask = await codexLive({ command: codexBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('policy'),
      permissions: { approval: 'ask' },
    }).result;
    expect(ask).toMatchObject({ status: 'failed', error: "permissions.approval 'ask' needs task.onApproval." });
    const both = await codexLive({ command: codexBin, sandbox: 'read-only' }).run({
      prompt: 'go',
      cwd: dir,
      permissions: { sandbox: 'unrestricted' },
    }).result;
    expect(both.error).toBe('codex: set either the sandbox option or task.permissions.sandbox, not both.');
    const sandbox = await museLive({ command: museBin }).run({
      prompt: 'go',
      cwd: dir,
      permissions: { sandbox: 'workspace-write' },
    }).result;
    expect(sandbox.error).toBe("muse cannot run with permissions.sandbox 'workspace-write' (supported: unrestricted).");
  });

  it('auto-approves Muse requests once, with automatic events', async () => {
    const run = museLive({ command: museBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('approval'),
      permissions: 'yolo',
    });
    const events = await collect(run);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'approval-request', request: expect.objectContaining({ id: 'ap-1' }) }),
    );
    expect(events).toContainEqual({ type: 'approval-resolved', id: 'ap-1', decision: 'approve', automatic: true });
    expect((await run.result).text).toBe('decided:allow-once@0 receipt:{}');
  });

  it('uses denyUnmatched for Muse deny', async () => {
    const run = museLive({ command: museBin }).run({
      prompt: 'go',
      cwd: dir,
      env: env('policy'),
      permissions: { approval: 'deny' },
    });
    expect(await policy(run)).toEqual({ approvalMode: 'denyUnmatched' });
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

describe('questions', () => {
  const request: ApprovalRequest = {
    id: 'q',
    kind: 'question',
    questions: [
      { id: 'one', question: 'One?', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'many', question: 'Many?', options: [{ label: 'A' }, { label: 'B' }], multiple: true },
      { id: 'key', question: 'Key?', options: [], freeText: true, secret: true },
    ],
  };
  const open = new AbortController().signal;

  it('keeps only answers to the questions asked', () => {
    expect(questionAnswers(request, { one: ['A', 'B'], many: ['A', 'B', 'own', 'more'], key: 'k', x: ['y'] })).toEqual({
      one: ['A'],
      many: ['A', 'B', 'own'],
      key: ['k'],
    });
    expect(questionAnswers(request, { one: [1, '', ' '], many: null })).toEqual({});
    expect(questionAnswers(request, 'A')).toEqual({});
  });

  it('asks onQuestion even under auto-approve, and declines without one or under deny', async () => {
    const onQuestion = () => ({ one: ['B'] });
    const auto = { approval: 'auto-approve' as const };
    expect(await decideApproval({ onQuestion, permissions: auto }, request, open)).toEqual({
      decision: 'approve',
      answers: { one: ['B'] },
      automatic: false,
    });
    expect(await decideApproval({ onApproval: () => 'approve', permissions: auto }, request, open)).toEqual({
      decision: 'deny',
      automatic: true,
    });
    expect(await decideApproval({ onQuestion, permissions: { approval: 'deny' } }, request, open)).toEqual({
      decision: 'deny',
      automatic: true,
    });
    expect(await decideApproval({ onQuestion: () => undefined }, request, open)).toEqual({
      decision: 'deny',
      automatic: false,
    });
  });

  it('reports the answers without the secret ones', async () => {
    const events: AgentEvent[] = [];
    const outcome = await reportReply(
      (event) => events.push(event),
      request,
      open,
      async () => ({
        decision: 'approve',
        answers: { one: ['A'], key: ['hunter2'] },
        automatic: false,
      }),
    );
    expect(outcome.answers).toEqual({ one: ['A'], key: ['hunter2'] });
    expect(events.at(-1)).toEqual({
      type: 'approval-resolved',
      id: 'q',
      decision: 'approve',
      answers: { one: ['A'], key: ['••••'] },
    });
  });
});
