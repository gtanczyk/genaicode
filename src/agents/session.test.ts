import { describe, expect, it } from 'vitest';
import { createAgentSession } from './session.js';
import type { AgentCapabilities, AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';

type Script = (task: AgentTask, emit: (event: AgentEvent) => void) => Promise<Partial<AgentResult> | void>;

/** An agent whose runs play `scripts` in order. */
function fakeAgent(scripts: Script[], capabilities: AgentCapabilities = { resume: true }) {
  const tasks: AgentTask[] = [];
  const steered: string[] = [];
  const agent: CodingAgent = {
    name: 'fake',
    command: 'fake',
    capabilities,
    run(task): AgentRun {
      tasks.push(task);
      const queue: AgentEvent[] = [];
      let wake: (() => void) | undefined;
      let finished = false;
      const emit = (event: AgentEvent) => {
        queue.push(event);
        wake?.();
      };
      const script = scripts.shift() ?? (async () => {});
      const aborted = new Promise<Partial<AgentResult>>((resolve) =>
        task.signal?.addEventListener('abort', () => resolve({ status: 'aborted', ok: false }), { once: true }),
      );
      const result = Promise.race([script(task, emit), aborted]).then((partial) => {
        const done: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, ...(partial ?? {}) };
        emit({ type: 'done', result: done });
        finished = true;
        wake?.();
        return done;
      });
      return {
        result,
        abort() {},
        ...(capabilities.steer
          ? {
              steer: async (text: string) => {
                if (finished) throw new Error('ended');
                steered.push(text);
              },
            }
          : {}),
        async *[Symbol.asyncIterator]() {
          for (;;) {
            while (queue.length) {
              const event = queue.shift()!;
              yield event;
              if (event.type === 'done') return;
            }
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      };
    },
  };
  return { agent, tasks, steered };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('createAgentSession', () => {
  it('builds a structured transcript and resumes the session on the next turn', async () => {
    const { agent, tasks } = fakeAgent([
      async (_task, emit) => {
        emit({ type: 'session', sessionId: 's-1' });
        emit({ type: 'text-delta', text: 'Look' });
        emit({ type: 'text-delta', text: 'ing.' });
        emit({ type: 'tool-start', id: 't1', name: 'shell', input: { command: 'ls' } });
        emit({ type: 'tool-end', id: 't1', output: 'a.ts' });
        emit({ type: 'file-change', paths: ['a.ts'] });
        emit({ type: 'message', text: 'Done.' });
        emit({ type: 'usage', usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 });
        return { sessionId: 's-1', text: 'Done.' };
      },
      async (_task, emit) => {
        emit({ type: 'usage', usage: { inputTokens: 5, outputTokens: 1 }, costUsd: 0.02 });
      },
    ]);
    const session = createAgentSession({ agent, cwd: '/w' });
    const seen: string[] = [];
    session.subscribe((state) => seen.push(state.status));

    session.send('first');
    await session.idle();
    const [turn] = session.get().turns;
    expect(turn.entries).toEqual([
      { kind: 'text', text: 'Looking.', streaming: false },
      { kind: 'tool', id: 't1', name: 'shell', input: { command: 'ls' }, output: 'a.ts', done: true },
      { kind: 'files', paths: ['a.ts'] },
      { kind: 'text', text: 'Done.', streaming: false },
    ]);
    expect(turn.result).toMatchObject({ ok: true, sessionId: 's-1' });
    expect(tasks[0]).toMatchObject({ prompt: 'first', cwd: '/w', resume: undefined });

    session.send('second');
    await session.idle();
    expect(tasks[1]).toMatchObject({ prompt: 'second', resume: 's-1' });
    expect(session.get()).toMatchObject({
      status: 'idle',
      usage: { inputTokens: 15, outputTokens: 3 },
      costUsd: 0.03,
    });
    expect(seen).toContain('running');
  });

  it('queues prompts while a turn runs and plays them in order', async () => {
    const gate = deferred();
    const { agent, tasks } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}, async () => {}]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('one');
    session.send('two');
    session.send('three');
    expect(session.get().queued).toEqual(['two', 'three']);
    gate.resolve();
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['one', 'two', 'three']);
    expect(session.get().turns).toHaveLength(3);
  });

  it('steers a running agent that supports it', async () => {
    const gate = deferred();
    const { agent, steered } = fakeAgent([() => gate.promise.then(() => ({}))], { steer: true });
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('start');
    expect(session.get().canSteer).toBe(true);
    session.send('also this');
    await Promise.resolve();
    expect(steered).toEqual(['also this']);
    expect(session.get().turns[0].entries).toContainEqual({ kind: 'input', text: 'also this' });
    gate.resolve();
    await session.idle();
    expect(session.get().queued).toEqual([]);
  });

  it('holds approvals until answered, and denies them on stop', async () => {
    const decisions: string[] = [];
    const { agent } = fakeAgent([
      async (task, emit) => {
        const request = { id: 'a1', kind: 'command' as const, summary: 'rm -rf build' };
        emit({ type: 'approval-request', request });
        const decision = await task.onApproval!(request);
        decisions.push(decision);
        emit({ type: 'approval-resolved', id: 'a1', decision });
      },
      async (task) => {
        decisions.push(await task.onApproval!({ id: 'a2', kind: 'other' }));
        return new Promise(() => {});
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('clean');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.get().approvals).toEqual([{ id: 'a1', kind: 'command', summary: 'rm -rf build' }]);
    expect(session.approve('nope', 'approve')).toBe(false);
    expect(session.approve('a1', 'approve')).toBe(true);
    await session.idle();
    expect(decisions).toEqual(['approve']);
    expect(session.get().turns[0].entries).toContainEqual({
      kind: 'approval',
      request: { id: 'a1', kind: 'command', summary: 'rm -rf build' },
      decision: 'approve',
    });

    session.send('again');
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.stop();
    await session.idle();
    expect(decisions).toEqual(['approve', 'deny']);
    expect(session.get().turns[1].result?.status).toBe('aborted');
  });

  it('applies autoApprove and drops the queue on stop', async () => {
    const { agent } = fakeAgent([
      async (task) => {
        expect(await task.onApproval!({ id: 'x', kind: 'file-change' })).toBe('approve');
        return new Promise(() => {});
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.', autoApprove: () => 'approve' });
    session.send('go');
    session.send('later');
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.stop();
    await session.idle();
    expect(session.get().turns).toHaveLength(1);
    expect(session.get().queued).toEqual([]);
  });

  it('starts a fresh session after switching agents or reset', async () => {
    const first = fakeAgent([async () => ({ sessionId: 's-1' })]);
    const second = fakeAgent([async () => ({ sessionId: 's-2' }), async () => {}]);
    const session = createAgentSession({ agent: first.agent, cwd: '.' });
    session.send('a');
    await session.idle();
    session.setAgent(second.agent);
    session.send('b');
    await session.idle();
    expect(second.tasks[0].resume).toBeUndefined();
    session.reset();
    session.send('c');
    await session.idle();
    expect(second.tasks[1].resume).toBeUndefined();
  });

  it('does not resume on agents without the capability', async () => {
    const { agent, tasks } = fakeAgent([async () => ({ sessionId: 's-1' }), async () => {}], {});
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('a');
    await session.idle();
    session.send('b');
    await session.idle();
    expect(tasks[1].resume).toBeUndefined();
    expect(session.get().sessionId).toBe('s-1');
  });

  it('clips long tool output', async () => {
    const { agent } = fakeAgent([
      async (_task, emit) => {
        emit({ type: 'tool-start', name: 'shell' });
        emit({ type: 'tool-end', name: 'shell', output: 'x'.repeat(50) });
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.', maxToolOutput: 10 });
    session.send('go');
    await session.idle();
    const [tool] = session.get().turns[0].entries;
    expect(tool).toMatchObject({ kind: 'tool', output: 'xxxxxxxxxx\n… (truncated)', done: true });
  });
});
