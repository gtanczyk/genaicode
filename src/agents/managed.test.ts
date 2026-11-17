import { describe, expect, it } from 'vitest';
import {
  isManagedSettled,
  managedAgent,
  type ManagedProvider,
  type ManagedSnapshot,
  type ManagedStart,
  type ManagedUpdate,
} from './managed.js';
import type { AgentEvent } from './types.js';

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
        yield { snapshot: { id: 's-1', state: 'idle', stopReason: 'end-turn' }, events: [] };
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
