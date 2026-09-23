import { describe, expect, it } from 'vitest';
import { hostedAgent, type HostedAgentProvider, type HostedPoll } from './hosted.js';
import type { AgentEvent } from './types.js';

function provider(polls: HostedPoll[], extra: Partial<HostedAgentProvider> = {}) {
  const calls: string[] = [];
  const impl: HostedAgentProvider = {
    name: 'remote',
    async start(task) {
      calls.push(`start:${task.prompt}:${'env' in task}`);
      return { id: 'r-1' };
    },
    async poll(id, cursor) {
      calls.push(`poll:${id}:${cursor ?? '-'}`);
      return polls.shift() ?? { state: 'running' };
    },
    async cancel(id) {
      calls.push(`cancel:${id}`);
    },
    ...extra,
  };
  return { impl, calls };
}

describe('hostedAgent', () => {
  it('polls until the task completes and relays its events', async () => {
    const { impl, calls } = provider([
      { state: 'running', events: [{ type: 'tool-start', name: 'shell' }], cursor: 'c1' },
      { state: 'completed', events: [{ type: 'message', text: 'PR opened' }], cursor: 'c2' },
    ]);
    const run = hostedAgent(impl, { pollIntervalMs: 1 }).run({ prompt: 'fix', cwd: 'org/repo', env: { A: '1' } });
    const events: AgentEvent[] = [];
    for await (const event of run) events.push(event);
    expect(await run.result).toMatchObject({ status: 'completed', ok: true, sessionId: 'r-1', text: 'PR opened' });
    expect(events.map((event) => event.type)).toEqual(['session', 'tool-start', 'message', 'done']);
    expect(calls).toEqual(['start:fix:false', 'poll:r-1:-', 'poll:r-1:c1']);
  });

  it('holds polling while a slow consumer is far behind', async () => {
    const big = (): HostedPoll => ({
      state: 'running',
      events: [{ type: 'message', text: 'x'.repeat(5 * 1024 * 1024) }],
    });
    const { impl, calls } = provider([big(), big(), big(), big(), { state: 'completed' }]);
    const run = hostedAgent(impl, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' });
    let pollsWhileStalled = 0;
    for await (const event of run) {
      if (event.type === 'session') {
        await new Promise((resolve) => setTimeout(resolve, 100));
        pollsWhileStalled = calls.filter((call) => call.startsWith('poll')).length;
      }
    }
    expect(pollsWhileStalled).toBe(2);
    expect(await run.result).toMatchObject({ status: 'completed' });
    expect(calls.filter((call) => call.startsWith('poll'))).toHaveLength(5);
  });

  it('reports a failed task', async () => {
    const { impl } = provider([{ state: 'failed', error: 'tests red' }]);
    const result = await hostedAgent(impl, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({ status: 'failed', error: 'tests red' });
  });

  it('cancels on abort and on timeout', async () => {
    const aborted = provider([]);
    const run = hostedAgent(aborted.impl, { pollIntervalMs: 5 }).run({ prompt: 'p', cwd: '.' });
    setTimeout(() => run.abort(), 20);
    expect(await run.result).toMatchObject({ status: 'aborted' });
    expect(aborted.calls.at(-1)).toBe('cancel:r-1');

    const slow = provider([]);
    const timed = await hostedAgent(slow.impl, { pollIntervalMs: 5 }).run({ prompt: 'p', cwd: '.', timeoutMs: 20 })
      .result;
    expect(timed).toMatchObject({ status: 'timeout' });
    expect(slow.calls.at(-1)).toBe('cancel:r-1');
  });

  it('cancels when aborted during a poll that then reports completed', async () => {
    let release: (() => void) | undefined;
    const { impl, calls } = provider([], {
      poll: () => new Promise<HostedPoll>((resolve) => (release = () => resolve({ state: 'completed' }))),
    });
    const run = hostedAgent(impl, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    run.abort();
    release!();
    expect(await run.result).toMatchObject({ status: 'aborted' });
    expect(calls.at(-1)).toBe('cancel:r-1');
  });

  it('cancels the remote task when polling fails', async () => {
    const { impl, calls } = provider([], {
      poll: async () => {
        throw new Error('network down');
      },
    });
    const result = await hostedAgent(impl, { pollIntervalMs: 1 }).run({ prompt: 'p', cwd: '.' }).result;
    expect(result).toMatchObject({ status: 'failed', error: 'Polling remote failed: network down' });
    expect(calls.at(-1)).toBe('cancel:r-1');
  });

  it('fails cleanly when the task cannot start, and steers through send', async () => {
    const broken = provider([], {
      start: async () => {
        throw new Error('401');
      },
    });
    expect(await hostedAgent(broken.impl).run({ prompt: 'p', cwd: '.' }).result).toMatchObject({
      status: 'failed',
      error: '401',
    });

    const sent: string[] = [];
    const steerable = provider([{ state: 'running' }, { state: 'completed' }], {
      send: async (_id, text) => {
        sent.push(text);
      },
    });
    const agent = hostedAgent(steerable.impl, { pollIntervalMs: 1 });
    expect(agent.capabilities.steer).toBe(true);
    const run = agent.run({ prompt: 'p', cwd: '.' });
    for await (const event of run) if (event.type === 'session') await run.steer!('more');
    await run.result;
    expect(sent).toEqual(['more']);
  });
});
