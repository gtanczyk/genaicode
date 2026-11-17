import { describe, expect, it } from 'vitest';
import {
  isManagedSettled,
  managedAgent,
  type ManagedProvider,
  type ManagedSnapshot,
  type ManagedStart,
  type ManagedUpdate,
} from './managed.js';
import { withFallback } from './failover.js';
import type { AgentEvent, CodingAgent } from './types.js';

/** A provider that serves snapshots from a script and records every call. */
function fake(snapshots: ManagedSnapshot[], extra: Partial<ManagedProvider> = {}) {
  const calls: string[] = [];
  const starts: ManagedStart[] = [];
  const provider: ManagedProvider = {
    name: 'cloud',
    capabilities: { mcp: true, resume: true, usage: true, budget: ['usd'] },
    async start(request) {
      starts.push(request);
      calls.push('start');
      return { id: 's-1', state: 'queued', release: ['vault-1'] };
    },
    async get(id) {
      calls.push(`get:${id}`);
      return snapshots.shift() ?? { id, state: 'running' };
    },
    async interrupt(id) {
      calls.push(`interrupt:${id}`);
      return { enforced: true };
    },
    async release(snapshot) {
      calls.push(`release:${snapshot.release?.join(',')}`);
    },
    async delete(id) {
      calls.push(`delete:${id}`);
    },
    ...extra,
  };
  return { provider, calls, starts };
}

async function drain(run: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

describe('isManagedSettled', () => {
  it('treats an idle turn as settled, unless an approval is open', () => {
    expect(isManagedSettled({ state: 'running' })).toBe(false);
    expect(isManagedSettled({ state: 'idle', stopReason: 'end-turn' })).toBe(true);
    expect(isManagedSettled({ state: 'idle', stopReason: 'requires-action' })).toBe(false);
    expect(isManagedSettled({ state: 'failed' })).toBe(true);
  });
});

describe('managedAgent', () => {
  it('polls to the end of the turn, reports usage once per change and releases the session', async () => {
    const usage = { inputTokens: 10, outputTokens: 5, details: { thought: 3 } };
    const { provider, calls, starts } = fake([
      { id: 's-1', state: 'running', usage, costUsd: 0.01 },
      { id: 's-1', state: 'running', usage, costUsd: 0.01 },
      { id: 's-1', state: 'idle', stopReason: 'end-turn', text: 'done', release: ['vault-1'] },
    ]);
    const run = managedAgent(provider, { pollIntervalMs: 1, start: { system: 'be brief' } }).run({
      prompt: 'build it',
      cwd: 'env-7',
      model: 'm',
      timeoutMs: 90_500,
      env: { SECRET: 'x' },
    });
    const events = await drain(run);
    expect(await run.result).toMatchObject({ status: 'completed', sessionId: 's-1', text: 'done', costUsd: 0.01 });
    expect(events.map((event) => event.type)).toEqual(['session', 'usage', 'message', 'done']);
    expect(events[1]).toEqual({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.01 });
    expect(starts[0]).toEqual({
      system: 'be brief',
      prompt: 'build it',
      workspace: 'env-7',
      model: 'm',
      maxDurationSeconds: 91,
    });
    expect(calls).toEqual(['start', 'get:s-1', 'get:s-1', 'get:s-1', 'release:vault-1']);
  });

  it('follows a live stream and answers approvals through onApproval', async () => {
    const answers: string[] = [];
    const stream: ManagedUpdate[] = [
      { snapshot: { id: 's-1', state: 'running' }, events: [{ type: 'tool-start', name: 'bash' }] },
      {
        snapshot: { id: 's-1', state: 'idle', stopReason: 'requires-action' },
        events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command', summary: 'rm -rf build' } }],
      },
      { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' }, events: [{ type: 'message', text: 'ok' }] },
    ];
    const { provider } = fake([], {
      capabilities: { permissions: { approval: ['ask', 'auto-approve', 'deny'] } },
      async *watch() {
        for (const update of stream) {
          yield update;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      },
      async answer(_id, approvalId, decision) {
        answers.push(`${approvalId}:${decision}`);
      },
    });
    const agent = managedAgent(provider);
    expect(agent.capabilities.approvals).toBe(true);
    const run = agent.run({
      prompt: 'p',
      cwd: '.',
      permissions: { approval: 'ask' },
      onApproval: (request) => (request.summary?.startsWith('rm') ? 'deny' : 'approve'),
    });
    const events = await drain(run);
    expect(answers).toEqual(['a-1:deny']);
    expect(events.map((event) => event.type)).toEqual([
      'session',
      'tool-start',
      'approval-request',
      'approval-resolved',
      'message',
      'done',
    ]);
    expect(await run.result).toMatchObject({ status: 'completed', text: 'ok' });
  });

  it('refuses ask without answer, local MCP servers and resume it cannot do', async () => {
    const { provider, calls } = fake([], { capabilities: { mcp: true, permissions: { approval: ['ask'] } } });
    const agent = managedAgent(provider, { pollIntervalMs: 1 });
    const ask = await agent.run({
      prompt: 'p',
      cwd: '.',
      permissions: { approval: 'ask' },
      onApproval: () => 'approve',
    }).result;
    expect(ask.error).toBe("cloud cannot run with permissions.approval 'ask'.");
    const local = await agent.run({ prompt: 'p', cwd: '.', mcpServers: [{ name: 'game', command: 'node' }] }).result;
    expect(local.error).toBe("cloud reaches only remote MCP servers; 'game' is a local command.");
    const resume = await agent.run({ prompt: 'p', cwd: '.', resume: 's-0' }).result;
    expect(resume.error).toBe('cloud cannot resume a session.');
    expect(calls).toEqual([]);
  });

  it('fails as over budget when the platform stops at its cap', async () => {
    const { provider } = fake([
      { id: 's-1', state: 'idle', stopReason: 'budget', costUsd: 3.2, error: 'cloud reached $3 budget' },
    ]);
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({
      prompt: 'p',
      cwd: '.',
      budget: { maxCostUsd: 3 },
    }).result;
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'budget' } });
  });

  it('reports quota failures for failover and passes vendor errors through', async () => {
    const { provider } = fake([
      { id: 's-1', state: 'failed', error: 'rate limited', failure: { kind: 'quota', resetsAt: 1_900_000_000_000 } },
    ]);
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({
      status: 'failed',
      error: 'rate limited',
      failure: { kind: 'quota', resetsAt: 1_900_000_000_000 },
    });
  });

  it('fails and interrupts the session when an approval answer cannot be sent', async () => {
    const { provider, calls } = fake([], {
      capabilities: { permissions: { approval: ['auto-approve'] } },
      async *watch() {
        yield {
          snapshot: { id: 's-1', state: 'idle', stopReason: 'requires-action' },
          events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command' } }],
        };
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      async answer() {
        throw new Error('409 conflict');
      },
    });
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({
      prompt: 'p',
      cwd: '.',
      permissions: { approval: 'auto-approve' },
    }).result;
    expect(result).toMatchObject({ status: 'failed', error: 'Answering cloud approval a-1 failed: 409 conflict' });
    expect(calls).toContain('interrupt:s-1');
  });

  it('drops open approval questions when the platform settles the turn', async () => {
    const answers: string[] = [];
    let aborted = false;
    const { provider } = fake([], {
      capabilities: { permissions: { approval: ['ask'] } },
      async *watch() {
        yield {
          snapshot: { id: 's-1', state: 'idle', stopReason: 'requires-action' },
          events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command' } }],
        };
        yield { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' }, events: [] };
      },
      async answer(_id, approvalId) {
        answers.push(approvalId);
      },
    });
    const result = await managedAgent(provider).run({
      prompt: 'p',
      cwd: '.',
      permissions: { approval: 'ask' },
      onApproval: (_request, signal) =>
        new Promise((resolve) =>
          signal?.addEventListener('abort', () => {
            aborted = true;
            resolve('approve');
          }),
        ),
    }).result;
    expect(result.status).toBe('completed');
    expect(aborted).toBe(true);
    expect(answers).toEqual([]);
  });

  it('withdraws a question the platform resolved on its own', async () => {
    const answers: string[] = [];
    let withdrawn = false;
    const { provider } = fake([], {
      capabilities: { permissions: { approval: ['ask'] } },
      async *watch() {
        yield {
          snapshot: { id: 's-1', state: 'running' },
          events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command' } }],
        };
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield {
          snapshot: { id: 's-1', state: 'running' },
          events: [{ type: 'approval-resolved', id: 'a-1', decision: 'approve' }],
        };
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(withdrawn).toBe(true);
        yield { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' }, events: [] };
      },
      async answer(_id, approvalId) {
        answers.push(approvalId);
      },
    });
    const result = await managedAgent(provider).run({
      prompt: 'p',
      cwd: '.',
      permissions: { approval: 'ask' },
      onApproval: (_request, signal) =>
        new Promise((resolve) =>
          signal?.addEventListener('abort', () => {
            withdrawn = true;
            resolve('approve');
          }),
        ),
    }).result;
    expect(result.status).toBe('completed');
    expect(answers).toEqual([]);
  });

  it('aborts without waiting for an answer that never returns', async () => {
    const { provider, calls } = fake([], {
      capabilities: { permissions: { approval: ['auto-approve'] } },
      async *watch() {
        yield {
          snapshot: { id: 's-1', state: 'idle', stopReason: 'requires-action' },
          events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command' } }],
        };
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      },
      answer: () => new Promise<void>(() => undefined),
    });
    const run = managedAgent(provider).run({ prompt: 'p', cwd: '.', permissions: { approval: 'auto-approve' } });
    setTimeout(() => run.abort(), 10);
    expect(await run.result).toMatchObject({ status: 'aborted' });
    expect(calls).toContain('interrupt:s-1');
  });

  it('keeps token totals when a later snapshot reports only cost', async () => {
    const { provider } = fake([
      { id: 's-1', state: 'running', usage: { inputTokens: 10, outputTokens: 5 } },
      { id: 's-1', state: 'idle', stopReason: 'end-turn', costUsd: 0.02 },
    ]);
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.02 });
  });

  it('reads status at once and treats a cancelled budget stop as over budget', async () => {
    const { provider } = fake([{ id: 's-1', state: 'idle', stopReason: 'end-turn', text: 'done' }]);
    const quick = await managedAgent(provider, { pollIntervalMs: 60_000 }).run({
      prompt: 'p',
      cwd: '.',
      timeoutMs: 1_000,
    }).result;
    expect(quick).toMatchObject({ status: 'completed', text: 'done' });
    const { provider: capped } = fake([{ id: 's-1', state: 'cancelled', stopReason: 'budget' }]);
    const budget = await managedAgent(capped, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(budget).toMatchObject({ status: 'failed', failure: { kind: 'budget' } });
  });

  it('reads status as soon as a stream closes and applies default permissions locally', async () => {
    const answers: string[] = [];
    const { provider } = fake([{ id: 's-1', state: 'idle', stopReason: 'end-turn', text: 'done' }], {
      capabilities: { permissions: { approval: ['auto-approve'] } },
      async *watch() {
        yield { events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command' } }] };
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      async answer(_id, approvalId, decision) {
        answers.push(`${approvalId}:${decision}`);
      },
    });
    const result = await managedAgent(provider, {
      pollIntervalMs: 60_000,
      start: { permissions: { approval: 'auto-approve' } },
    }).run({ prompt: 'p', cwd: '.', timeoutMs: 1_000 }).result;
    expect(result).toMatchObject({ status: 'completed', text: 'done' });
    expect(answers).toEqual(['a-1:approve']);
  });

  it('keeps text a running snapshot reported when the final one omits it', async () => {
    const { provider } = fake([
      { id: 's-1', state: 'running', text: 'answer' },
      { id: 's-1', state: 'idle', stopReason: 'end-turn' },
    ]);
    const run = managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' });
    const events = await drain(run);
    expect(await run.result).toMatchObject({ status: 'completed', text: 'answer' });
    expect(events.filter((event) => event.type === 'message')).toHaveLength(1);
  });

  it('passes unavailable and crash failures through for failover', async () => {
    for (const kind of ['unavailable', 'crash'] as const) {
      const { provider } = fake([{ id: 's-1', state: 'failed', error: 'down', failure: { kind } }]);
      const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
      expect(result).toMatchObject({ status: 'failed', error: 'down', failure: { kind } });
    }
  });

  it('interrupts on abort, releases, and deletes the session when asked', async () => {
    const { provider, calls } = fake([]);
    const run = managedAgent(provider, { pollIntervalMs: 2, deleteSession: true }).run({ prompt: 'p', cwd: '.' });
    setTimeout(() => run.abort(), 15);
    expect(await run.result).toMatchObject({ status: 'aborted' });
    expect(calls.slice(-3)).toEqual(['interrupt:s-1', 'release:vault-1', 'delete:s-1']);
  });

  it('steers through send while running and fails when the session disappears', async () => {
    const sent: string[] = [];
    let reads = 0;
    const { provider } = fake([], {
      async get(id) {
        return ++reads === 1 ? { id, state: 'running' } : null;
      },
      async send(_id, text) {
        sent.push(text);
      },
    });
    const run = managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' });
    for await (const event of run) if (event.type === 'session') await run.steer!('also add tests');
    expect(sent).toEqual(['also add tests']);
    expect(await run.result).toMatchObject({ status: 'failed', error: 'cloud session is gone.' });
    await expect(run.steer!('late')).rejects.toThrow('cloud is not accepting input.');
  });
});

describe('managedAgent after review', () => {
  const backup: CodingAgent = {
    name: 'backup',
    command: 'backup',
    capabilities: {},
    run: () =>
      managedAgent(fake([{ id: 'b-1', state: 'idle', stopReason: 'end-turn', text: 'backup' }]).provider, {
        pollIntervalMs: 1,
      }).run({ prompt: 'p', cwd: '.' }),
  };

  it('classifies a cloud outage at start or mid-stream so withFallback moves on', async () => {
    const down = fake([], {
      async start() {
        throw Object.assign(new Error('Service Unavailable'), { status: 503 });
      },
    }).provider;
    const first = await withFallback([managedAgent(down), backup]).run({ prompt: 'p', cwd: '.' }).result;
    expect(first).toMatchObject({ status: 'completed', text: 'backup' });

    const dropped = fake([], {
      // eslint-disable-next-line require-yield
      async *watch() {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      },
    }).provider;
    const alone = await managedAgent(dropped).run({ prompt: 'p', cwd: '.' }).result;
    expect(alone).toMatchObject({ status: 'failed', failure: { kind: 'unavailable' } });
    const auth = await managedAgent(
      fake([], {
        async start() {
          throw Object.assign(new Error('forbidden'), { statusCode: 403 });
        },
      }).provider,
    ).run({ prompt: 'p', cwd: '.' }).result;
    expect(auth.failure).toEqual({ kind: 'auth' });
  });

  it('reports a resumed run as its own share of the session', async () => {
    const snapshots: ManagedSnapshot[] = [
      { id: 's-0', state: 'running', text: 'old', costUsd: 0.85, usage: { inputTokens: 110, outputTokens: 55 } },
      {
        id: 's-0',
        state: 'idle',
        stopReason: 'end-turn',
        text: 'new',
        costUsd: 0.9,
        usage: { inputTokens: 120, outputTokens: 60 },
      },
    ];
    const { provider, starts } = fake([], {
      async start(request) {
        starts.push(request);
        return { id: 's-0', state: 'queued', text: 'old' };
      },
      async get(id) {
        if (!starts.length)
          return {
            id,
            state: 'idle',
            stopReason: 'end-turn',
            text: 'old',
            costUsd: 0.8,
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        return snapshots.shift() ?? null;
      },
    });
    const run = managedAgent(provider, { pollIntervalMs: 1 }).run({
      prompt: 'p',
      cwd: '.',
      resume: 's-0',
      budget: { maxCostUsd: 0.7 },
    });
    const events = await drain(run);
    const result = await run.result;
    expect(result).toMatchObject({ status: 'completed', text: 'new', usage: { inputTokens: 20, outputTokens: 10 } });
    expect(result.costUsd).toBeCloseTo(0.1);
    expect(events.filter((event) => event.type === 'message')).toEqual([{ type: 'message', text: 'new' }]);
    expect(starts[0]!.budget!.maxCostUsd).toBeCloseTo(1.5);
  });

  it('reports each approval resolved once, even when the platform echoes it', async () => {
    const { provider } = fake([], {
      capabilities: { permissions: { approval: ['auto-approve'] } },
      async *watch() {
        yield { events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command' } }] };
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield {
          snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' },
          events: [{ type: 'approval-resolved', id: 'a-1', decision: 'approve' }],
        };
      },
      async answer() {},
    });
    const run = managedAgent(provider).run({ prompt: 'p', cwd: '.', permissions: { approval: 'auto-approve' } });
    const events = await drain(run);
    expect(events.filter((event) => event.type === 'approval-resolved')).toHaveLength(1);
  });

  it('fails at once when the session waits for an approval nobody can answer', async () => {
    const { provider, calls } = fake([{ id: 's-1', state: 'idle', stopReason: 'requires-action' }]);
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({
      status: 'failed',
      error: 'cloud paused for an approval, and it has no way to answer one.',
    });
    expect(calls).toContain('interrupt:s-1');
  });

  it('reads every event page, also the ones after a settled state', async () => {
    const pages = [
      { events: [{ type: 'tool-start', name: 'bash' }] as AgentEvent[], cursor: '1', hasMore: true },
      { events: [] as AgentEvent[], cursor: '2' },
      { events: [{ type: 'message', text: 'late' }] as AgentEvent[], cursor: '3' },
    ];
    const cursors: (string | undefined)[] = [];
    const { provider } = fake([{ id: 's-1', state: 'idle', stopReason: 'end-turn' }], {
      async events(_id, cursor) {
        cursors.push(cursor);
        return pages.shift() ?? { events: [] };
      },
    });
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({ status: 'completed', text: 'late' });
    expect(cursors).toEqual([undefined, '1', '2']);
  });

  it('reconnects a stream after its last cursor', async () => {
    const cursors: (string | undefined)[] = [];
    const { provider } = fake([{ id: 's-1', state: 'running' }], {
      async *watch(_id, _signal, cursor) {
        cursors.push(cursor);
        if (cursor === undefined) yield { events: [{ type: 'tool-start', name: 'bash' }], cursor: 'c1' };
        else yield { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' }, cursor: 'c2' };
      },
    });
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result.status).toBe('completed');
    expect(cursors).toEqual([undefined, 'c1']);
  });

  it("keeps the platform's budget message and does not interrupt a settled session", async () => {
    const { provider, calls } = fake([
      { id: 's-1', state: 'idle', stopReason: 'budget', costUsd: 3.2, error: 'cloud reached $3 budget' },
    ]);
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({
      prompt: 'p',
      cwd: '.',
      budget: { maxCostUsd: 3 },
    }).result;
    expect(result).toMatchObject({ status: 'failed', error: 'cloud reached $3 budget', failure: { kind: 'budget' } });
    expect(calls.some((call) => call.startsWith('interrupt'))).toBe(false);
  });

  it('applies options.start defaults to the workspace, the local budget and refusals', async () => {
    const { provider, starts } = fake([{ id: 's-1', state: 'running', costUsd: 2 }]);
    const result = await managedAgent(provider, {
      pollIntervalMs: 1,
      start: { workspace: 'env-1', budget: { maxCostUsd: 1 } },
    }).run({ prompt: 'p', cwd: '.' }).result;
    expect(starts[0]!.workspace).toBe('env-1');
    expect(result.failure).toEqual({ kind: 'budget' });
    const files = await managedAgent(fake([]).provider, { start: { files: [{ path: 'a', content: 'b' }] } }).run({
      prompt: 'p',
      cwd: '.',
    }).result;
    expect(files.error).toBe('cloud cannot take start files.');
  });
});

describe('managedAgent after second review', () => {
  it("reports streamed usage of a resumed session as this run's share", async () => {
    const { provider } = fake([], {
      capabilities: { resume: true },
      async get(id) {
        return { id, state: 'idle', stopReason: 'end-turn', usage: { inputTokens: 100 } };
      },
      async *watch() {
        yield { events: [{ type: 'usage', usage: { inputTokens: 105 } }] };
        yield { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' } };
      },
    });
    const result = await managedAgent(provider).run({
      prompt: 'p',
      cwd: '.',
      resume: 's-0',
      budget: { maxTokens: 10 },
    }).result;
    expect(result).toMatchObject({ status: 'completed', usage: { inputTokens: 5 } });
  });

  it('reads the final events of a session that start already reports settled', async () => {
    let reads = 0;
    const { provider } = fake([], {
      async start() {
        return { id: 's-1', state: 'idle', stopReason: 'end-turn' };
      },
      async events() {
        reads++;
        return { events: [{ type: 'message', text: 'final' }] };
      },
    });
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({ status: 'completed', text: 'final' });
    expect(reads).toBe(1);
  });

  it('takes no more input once the turn settled, while cleanup still runs', async () => {
    const sent: string[] = [];
    const { provider } = fake([{ id: 's-1', state: 'idle', stopReason: 'end-turn' }], {
      async send(_id, text) {
        sent.push(text);
      },
      release: () => new Promise((resolve) => setTimeout(resolve, 40)),
    });
    const run = managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await expect(run.steer!('more')).rejects.toThrow('cloud is not accepting input.');
    expect(sent).toEqual([]);
    expect((await run.result).status).toBe('completed');
  });

  it('frees the resources every event page listed', async () => {
    const pages = [
      { events: [] as AgentEvent[], hasMore: true, snapshot: { id: 's-1', state: 'running' as const, release: ['a'] } },
      {
        events: [] as AgentEvent[],
        snapshot: { id: 's-1', state: 'idle' as const, stopReason: 'end-turn', release: ['b'] },
      },
    ];
    const { provider, calls } = fake([], {
      async events() {
        return pages.shift() ?? { events: [] };
      },
    });
    await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(calls).toContain('release:vault-1,a,b');
  });

  it('finishes a settled turn without waiting for an answer in flight', async () => {
    const { provider } = fake([], {
      capabilities: { permissions: { approval: ['auto-approve'] } },
      async *watch() {
        yield { events: [{ type: 'approval-request', request: { id: 'a-1', kind: 'command' } }] };
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' } };
      },
      answer: () => new Promise<void>(() => undefined),
    });
    const result = await managedAgent(provider).run({
      prompt: 'p',
      cwd: '.',
      permissions: { approval: 'auto-approve' },
    }).result;
    expect(result.status).toBe('completed');
  });

  it('fails over when the resumed session cannot be read', async () => {
    const { provider, calls } = fake([], {
      capabilities: { resume: true },
      async get() {
        throw Object.assign(new Error('Service Unavailable'), { status: 503 });
      },
    });
    const result = await managedAgent(provider).run({ prompt: 'p', cwd: '.', resume: 's-0' }).result;
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'unavailable' } });
    expect(calls).not.toContain('start');
  });
});

describe('managedAgent after third review', () => {
  it('subtracts a resume baseline by total when a report gives only totalTokens', async () => {
    const { provider } = fake([], {
      capabilities: { resume: true },
      async get(id) {
        return { id, state: 'idle', stopReason: 'end-turn', usage: { inputTokens: 60, outputTokens: 40 } };
      },
      async *watch() {
        yield { events: [{ type: 'usage', usage: { totalTokens: 105 } }] };
        yield { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' } };
      },
    });
    const result = await managedAgent(provider).run({
      prompt: 'p',
      cwd: '.',
      resume: 's-0',
      budget: { maxTokens: 10 },
    }).result;
    expect(result).toMatchObject({ status: 'completed', usage: { totalTokens: 5 } });
  });

  it('lets the terminal snapshot outrank older drained events', async () => {
    const { provider } = fake([], {
      async start() {
        return { id: 's-1', state: 'idle', stopReason: 'end-turn', text: 'final', usage: { inputTokens: 105 } };
      },
      async events() {
        return {
          events: [
            { type: 'message', text: 'working' },
            { type: 'usage', usage: { inputTokens: 10 } },
          ],
        };
      },
    });
    const result = await managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({ status: 'completed', text: 'final', usage: { inputTokens: 105 } });
  });

  it('closes steering as soon as a settled state is seen', async () => {
    const sent: string[] = [];
    const { provider } = fake([], {
      async start() {
        return { id: 's-1', state: 'idle', stopReason: 'end-turn' };
      },
      async events() {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { events: [] };
      },
      async send(_id, text) {
        sent.push(text);
      },
    });
    const run = managedAgent(provider, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(run.steer!('more')).rejects.toThrow('cloud is not accepting input.');
    expect(sent).toEqual([]);
    expect((await run.result).status).toBe('completed');
  });
});
