import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handoffTranscript } from './handoff.js';
import { createAgentSession } from './session.js';
import type { AgentCapabilities, AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';

type Script = (task: AgentTask, emit: (event: AgentEvent) => void) => Promise<Partial<AgentResult> | void>;

/** An agent whose runs play `scripts` in order. */
function fakeAgent(scripts: Script[], capabilities: AgentCapabilities = { resume: true }, name = 'fake') {
  const tasks: AgentTask[] = [];
  const steered: string[] = [];
  const agent: CodingAgent = {
    name,
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

  it('runs a note ahead of the waiting prompts', async () => {
    const gate = deferred();
    const { agent, tasks } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}, async () => {}]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('one');
    session.send('two');
    session.send('note', { note: true });
    expect(session.get().queued).toEqual(['two']);
    gate.resolve();
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['one', 'note', 'two']);
  });

  it('never steers a note and keeps it through a stop until the next prompt', async () => {
    const gate = deferred();
    const { agent, steered, tasks } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}, async () => {}], {
      steer: true,
    });
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('start');
    session.send('note', { note: true });
    expect(steered).toEqual([]);
    session.stop();
    gate.resolve();
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['start']);
    session.send('next');
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['start', 'note', 'next']);
  });

  it('plays held notes before a newer note', async () => {
    const gate = deferred();
    const { agent, tasks } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}, async () => {}]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('start');
    session.send('old', { note: true });
    session.stop();
    gate.resolve();
    await session.idle();
    session.send('new', { note: true });
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['start', 'old', 'new']);
  });

  it('releases held notes when a newer note arrives while the stopped turn winds down', async () => {
    const gate = deferred();
    const { agent, tasks } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}, async () => {}]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('start');
    session.send('old', { note: true });
    session.stop();
    session.send('new', { note: true });
    gate.resolve();
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['start', 'old', 'new']);
  });

  it('puts back a note whose turn a stop cut short', async () => {
    const gate = deferred();
    const { agent, tasks } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}, async () => {}]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('outcome', { note: true });
    session.stop();
    gate.resolve();
    await session.idle();
    expect(session.get().notes).toEqual(['outcome']);
    session.send('next');
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['outcome', 'outcome', 'next']);
  });

  it('queues instead of steering when asked to', async () => {
    const gate = deferred();
    const { agent, steered, tasks } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}], {
      steer: true,
    });
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('start');
    session.send('later', { queue: true });
    expect(steered).toEqual([]);
    expect(session.get().queued).toEqual(['later']);
    gate.resolve();
    await session.idle();
    expect(tasks.map((task) => task.prompt)).toEqual(['start', 'later']);
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

  it('sends transformed prompts to the agent and keeps the typed text in state', async () => {
    const gate = deferred();
    const { agent, tasks, steered } = fakeAgent([() => gate.promise.then(() => ({}))], { steer: true });
    const session = createAgentSession({ agent, cwd: '.', transformPrompt: (text) => `[ctx] ${text}` });
    session.send('fix it');
    session.send('also this');
    await Promise.resolve();
    expect(tasks[0].prompt).toBe('[ctx] fix it');
    expect(steered).toEqual(['[ctx] also this']);
    expect(session.get().turns[0].prompt).toBe('fix it');
    expect(session.get().turns[0].entries).toContainEqual({ kind: 'input', text: 'also this' });
    gate.resolve();
    await session.idle();
  });

  it('fails the turn when transformPrompt throws, and goes on with the queue', async () => {
    const gate = deferred();
    const { agent, tasks, steered } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}], {
      steer: true,
    });
    const session = createAgentSession({
      agent,
      cwd: '.',
      transformPrompt: (text) => {
        if (text.startsWith('bad')) throw new Error(`cannot brief: ${text}`);
        return text;
      },
    });
    session.send('bad first');
    await session.idle();
    expect(tasks).toHaveLength(0);
    expect(session.get().status).toBe('idle');
    expect(session.get().turns[0].result).toMatchObject({
      status: 'failed',
      ok: false,
      error: 'cannot brief: bad first',
    });
    expect(session.get().turns[0].entries).toContainEqual({ kind: 'error', message: 'cannot brief: bad first' });

    session.send('good');
    session.send('bad steer');
    await Promise.resolve();
    expect(steered).toEqual([]);
    expect(session.get().queued).toEqual(['bad steer']);
    gate.resolve();
    await session.idle();
    expect(session.get().turns.map((turn) => [turn.prompt, turn.result?.ok])).toEqual([
      ['bad first', false],
      ['good', true],
      ['bad steer', false],
    ]);
  });

  it('transforms queued prompts only when their turn starts', async () => {
    const gate = deferred();
    const { agent } = fakeAgent([() => gate.promise.then(() => ({})), async () => {}]);
    const seen: string[] = [];
    const session = createAgentSession({ agent, cwd: '.', transformPrompt: (text) => (seen.push(text), text) });
    session.send('first');
    session.send('queued');
    expect(seen).toEqual(['first']);
    gate.resolve();
    await session.idle();
    expect(seen).toEqual(['first', 'queued']);

    const blocked = deferred();
    const second = fakeAgent([() => blocked.promise.then(() => ({}))]);
    seen.length = 0;
    const stopped = createAgentSession({
      agent: second.agent,
      cwd: '.',
      transformPrompt: (text) => (seen.push(text), text),
    });
    stopped.send('run');
    stopped.send('dropped');
    stopped.stop();
    blocked.resolve();
    await stopped.idle();
    expect(seen).toEqual(['run']);
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
    // A decision the agent does not know leaves the request waiting.
    expect(session.approve('a1', 'allow' as 'approve')).toBe(false);
    expect(session.get().approvals).toHaveLength(1);
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

  it('holds a question for answer(), whatever autoApprove says', async () => {
    const request = {
      id: 'q1',
      kind: 'question' as const,
      questions: [{ id: 'color', question: 'Which color?', options: [{ label: 'Red' }, { label: 'Blue' }] }],
    };
    const got: unknown[] = [];
    const { agent } = fakeAgent([
      async (task, emit) => {
        emit({ type: 'approval-request', request });
        const answers = await task.onQuestion!(request);
        got.push(answers);
        emit({
          type: 'approval-resolved',
          id: 'q1',
          decision: answers ? 'approve' : 'deny',
          ...(answers ? { answers } : {}),
        });
      },
      async (task) => {
        got.push(await task.onQuestion!({ ...request, id: 'q2' }));
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.', autoApprove: () => 'approve' });
    session.send('ask');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.get().approvals).toEqual([request]);
    expect(session.answer('nope', {})).toBe(false);
    expect(session.answer('q1', { color: ['Blue'] })).toBe(true);
    await session.idle();
    expect(got).toEqual([{ color: ['Blue'] }]);
    expect(session.get().turns[0]!.entries).toContainEqual({
      kind: 'approval',
      request,
      decision: 'approve',
      answers: { color: ['Blue'] },
    });

    session.send('again');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.approve('q2', 'deny')).toBe(true);
    await session.idle();
    expect(got).toEqual([{ color: ['Blue'] }, undefined]);
  });

  it('shows approvals decided by permissions, once each', async () => {
    const { agent, tasks } = fakeAgent([
      async (_task, emit) => {
        const request = { id: 'a1', kind: 'command' as const, summary: 'npm test' };
        emit({ type: 'approval-request', request });
        emit({ type: 'approval-resolved', id: 'a1', decision: 'approve', automatic: true });
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.', task: { permissions: 'yolo' } });
    session.send('test');
    await session.idle();
    expect(tasks[0]!.permissions).toBe('yolo');
    expect(session.get().approvals).toEqual([]);
    expect(session.get().turns[0]!.entries.filter((entry) => entry.kind === 'approval')).toEqual([
      {
        kind: 'approval',
        request: { id: 'a1', kind: 'command', summary: 'npm test' },
        decision: 'approve',
        automatic: true,
      },
    ]);
  });

  it('drops a question the agent withdraws', async () => {
    const withdraw = new AbortController();
    let decision: string | undefined;
    const { agent } = fakeAgent([
      async (task) => {
        decision = await task.onApproval!({ id: 'a1', kind: 'other' }, withdraw.signal);
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('go');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.get().approvals).toHaveLength(1);
    withdraw.abort();
    expect(session.get().approvals).toEqual([]);
    await session.idle();
    expect(decision).toBe('deny');
    expect(session.get().approvals).toEqual([]);
    expect(session.approve('a1', 'approve')).toBe(false);
  });

  it('denies a withdrawn request even with autoApprove', async () => {
    const withdrawn = AbortSignal.abort();
    let decision: string | undefined;
    const { agent } = fakeAgent([
      async (task) => {
        decision = await task.onApproval!({ id: 'w', kind: 'other' }, withdrawn);
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.', autoApprove: () => 'approve' });
    session.send('go');
    await session.idle();
    expect(decision).toBe('deny');
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

  it('starts a fresh session after switching agents without handoff, or reset', async () => {
    const first = fakeAgent([async () => ({ sessionId: 's-1' })]);
    const second = fakeAgent([async () => ({ sessionId: 's-2' }), async () => {}]);
    const session = createAgentSession({ agent: first.agent, cwd: '.', handoff: false });
    session.send('a');
    await session.idle();
    session.setAgent(second.agent);
    session.send('b');
    await session.idle();
    expect(second.tasks[0]).toMatchObject({ prompt: 'b', resume: undefined });
    session.reset();
    session.send('c');
    await session.idle();
    expect(second.tasks[1].resume).toBeUndefined();
  });

  it('clear() starts a new conversation: no transcript, no session to resume, not during a turn', async () => {
    let release = () => {};
    const { agent, tasks } = fakeAgent([
      async () => ({ sessionId: 's-1' }),
      () => new Promise<void>((resolve) => (release = resolve)),
      async () => {},
    ]);
    const session = createAgentSession({ agent: { ...agent, capabilities: { resume: true } }, cwd: '.' });
    session.send('a');
    await session.idle();
    session.send('b');
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    expect(session.clear()).toBe(false);
    expect(session.get().turns).toHaveLength(2);
    release();
    await session.idle();
    expect(session.clear()).toBe(true);
    expect(session.get()).toMatchObject({ turns: [], queued: [], sessionId: undefined });
    session.send('c');
    await session.idle();
    expect(tasks[2]).toMatchObject({ prompt: 'c', resume: undefined });
    expect(session.get().turns).toHaveLength(1);
  });

  it('hands the conversation over to the next agent', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent(
      [
        async (_task, emit) => {
          emit({ type: 'tool-start', id: 't', name: 'Bash', input: { command: 'npm test' } });
          emit({ type: 'tool-end', id: 't', output: '3 passed' });
          emit({ type: 'file-change', paths: ['src/a.ts'] });
          emit({ type: 'message', text: 'Fixed the parser.' });
          return { sessionId: 's-1' };
        },
      ],
      { resume: true },
      'claude',
    );
    const second = fakeAgent([async () => ({ sessionId: 's-2' }), async () => {}], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd });
    session.send('fix the parser');
    await session.idle();
    session.setAgent(second.agent);
    expect(session.get().sessionId).toBeUndefined();
    session.send('now add a test');
    await session.idle();

    const prompt = second.tasks[0].prompt;
    expect(second.tasks[0].resume).toBeUndefined();
    expect(prompt).toContain('User: fix the parser\nclaude: Fixed the parser.');
    expect(prompt.endsWith('now add a test')).toBe(true);
    const turn = session.get().turns[1];
    expect(turn).toMatchObject({ prompt: 'now add a test', handoff: { turns: 1, agents: ['claude'] } });
    const file = turn.handoff!.file!;
    expect(file).toMatch(/^\.genaicode\/handoff\/.+-codex\.handoff\.md$/);
    expect(prompt).toContain(`\`${file}\``);
    const transcript = readFileSync(join(cwd, file), 'utf8');
    expect(transcript).toContain('tool `Bash` {"command":"npm test"}');
    expect(transcript).toContain('3 passed');
    expect(transcript).toContain('changed files: `src/a.ts`');
    expect(existsSync(join(cwd, '.genaicode/handoff/.gitignore'))).toBe(true);

    // Later turns resume the agent's own session without another handoff.
    session.send('thanks');
    await session.idle();
    expect(second.tasks[1]).toMatchObject({ prompt: 'thanks', resume: 's-2' });
  });

  it('resumes an agent switched back to and tells it only what it missed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent(
      [async () => ({ sessionId: 's-1' }), async () => ({ sessionId: 's-1' })],
      { resume: true },
      'claude',
    );
    const second = fakeAgent(
      [
        async (_task, emit) => {
          emit({ type: 'message', text: 'codex answer' });
          return { sessionId: 's-2' };
        },
      ],
      { resume: true },
      'codex',
    );
    const session = createAgentSession({ agent: first.agent, cwd });
    session.send('one');
    await session.idle();
    session.setAgent(second.agent);
    session.send('two');
    await session.idle();
    session.setAgent(first.agent);
    expect(session.get().sessionId).toBe('s-1');
    session.send('three');
    await session.idle();
    const back = first.tasks[1];
    expect(back.resume).toBe('s-1');
    expect(back.prompt).toContain('User: two\ncodex: codex answer');
    expect(back.prompt).not.toContain('User: one');
    expect(session.get().turns[2].handoff).toMatchObject({ turns: 1, agents: ['codex'] });
  });

  it('keeps the handoff for the next turn when the first one fails to start', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent([async () => ({ sessionId: 's-1' })], { resume: true }, 'claude');
    const second = fakeAgent(
      [async () => ({ status: 'failed', ok: false }), async () => ({ sessionId: 's-2' })],
      { resume: true },
      'codex',
    );
    const session = createAgentSession({ agent: first.agent, cwd });
    session.send('one');
    await session.idle();
    session.setAgent(second.agent);
    session.send('two');
    await session.idle();
    session.send('three');
    await session.idle();
    expect(second.tasks[1].prompt).toContain('User: one');
    expect(second.tasks[1].prompt).toContain('User: two');
  });

  it('keeps the resumed session when a resumed turn names none', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent(
      [async () => ({ sessionId: 's-1' }), async () => {}, async () => {}],
      { resume: true },
      'claude',
    );
    const second = fakeAgent([async () => ({ sessionId: 's-2' })], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd });
    session.send('one');
    await session.idle();
    session.send('two');
    await session.idle();
    expect(first.tasks[1].resume).toBe('s-1');
    session.setAgent(second.agent);
    session.send('three');
    await session.idle();
    session.setAgent(first.agent);
    session.send('four');
    await session.idle();
    expect(first.tasks[2].resume).toBe('s-1');
    expect(first.tasks[2].prompt).not.toContain('User: one');
  });

  it('does not let a running turn restore a session switched away from fresh', async () => {
    let finish!: () => void;
    const first = fakeAgent(
      [
        async () => ({ sessionId: 's-1' }),
        () => new Promise((resolve) => (finish = () => resolve({ sessionId: 's-1' }))),
        async () => {},
      ],
      { resume: true },
      'claude',
    );
    const second = fakeAgent([], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd: '.', handoff: false });
    session.send('one');
    await session.idle();
    session.send('two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.setAgent(second.agent);
    session.setAgent(first.agent, { handoff: false });
    finish();
    await session.idle();
    expect(session.get().sessionId).toBeUndefined();
    session.send('three');
    await session.idle();
    expect(first.tasks[2].resume).toBeUndefined();
  });

  it('starts the current agent fresh when switched to it without handoff', async () => {
    const first = fakeAgent([async () => ({ sessionId: 's-1' }), async () => {}], { resume: true }, 'claude');
    const session = createAgentSession({ agent: first.agent, cwd: '.' });
    session.send('one');
    await session.idle();
    session.setAgent(first.agent, { handoff: false });
    expect(session.get().sessionId).toBeUndefined();
    session.send('two');
    await session.idle();
    expect(first.tasks[1]).toMatchObject({ prompt: 'two', resume: undefined });
  });

  it("recaps a turn's final result text and runs a turn with the agent that started it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent([async () => ({ sessionId: 's-1', text: 'final answer' })], { resume: true }, 'claude');
    const second = fakeAgent([async () => {}], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd });
    let switched = false;
    session.subscribe((state) => {
      if (state.status === 'running' && !switched) {
        switched = true;
        session.setAgent(second.agent);
      }
    });
    session.send('one');
    await session.idle();
    expect(first.tasks).toHaveLength(1);
    expect(second.tasks).toHaveLength(0);
    session.send('two');
    await session.idle();
    expect(second.tasks[0].prompt).toContain('User: one\nclaude: final answer');
    const file = session.get().turns[1].handoff!.file!;
    expect(readFileSync(join(cwd, file), 'utf8')).toContain('final answer');
  });

  it('resumes the session given in options after switching away and back', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent([async () => {}], { resume: true }, 'claude');
    const second = fakeAgent([async () => ({ sessionId: 's-2' })], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd, resume: 'old' });
    session.setAgent(second.agent);
    session.send('one');
    await session.idle();
    session.setAgent(first.agent);
    session.send('two');
    await session.idle();
    expect(first.tasks[0].resume).toBe('old');
    expect(first.tasks[0].prompt).toContain('User: one');
  });

  it('leaves turns before a reset out of later handoffs', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent(
      [async () => ({ sessionId: 's-1' }), async () => ({ sessionId: 's-3' })],
      { resume: true },
      'claude',
    );
    const second = fakeAgent([async () => {}], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd });
    session.send('old topic');
    await session.idle();
    session.reset();
    session.send('new topic');
    await session.idle();
    session.setAgent(second.agent);
    session.send('go on');
    await session.idle();
    expect(second.tasks[0].prompt).toContain('User: new topic');
    expect(second.tasks[0].prompt).not.toContain('old topic');
  });

  it('writes owner-only transcripts that keep the failure reason', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    const first = fakeAgent(
      [async () => ({ status: 'failed', ok: false, error: 'claude: command not found' })],
      { resume: true },
      'claude',
    );
    const second = fakeAgent([async () => {}], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd });
    session.send('one');
    await session.idle();
    session.setAgent(second.agent);
    session.send('two');
    await session.idle();
    const file = join(cwd, session.get().turns[1].handoff!.file!);
    expect(readFileSync(file, 'utf8')).toContain('claude: command not found');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('ignores transcripts in a handoff folder that has its own .gitignore', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'handoff-'));
    mkdirSync(join(cwd, 'notes'));
    writeFileSync(join(cwd, 'notes/.gitignore'), '*.log');
    const first = fakeAgent([async () => ({ sessionId: 's-1' })], { resume: true }, 'claude');
    const second = fakeAgent([async () => {}], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd, handoff: { dir: 'notes' } });
    session.send('one');
    await session.idle();
    session.setAgent(second.agent);
    session.send('two');
    await session.idle();
    expect(session.get().turns[1].handoff!.file).toMatch(/^notes\/.+\.handoff\.md$/);
    expect(readFileSync(join(cwd, 'notes/.gitignore'), 'utf8')).toBe('*.log\n*.handoff.md\n');
  });

  it('skips the handoff when asked', async () => {
    const first = fakeAgent([async () => ({ sessionId: 's-1' })], { resume: true }, 'claude');
    const second = fakeAgent([async () => {}], { resume: true }, 'codex');
    const session = createAgentSession({ agent: first.agent, cwd: '.' });
    session.send('one');
    await session.idle();
    session.setAgent(second.agent, { handoff: false });
    session.send('two');
    await session.idle();
    expect(second.tasks[0].prompt).toBe('two');
    expect(session.get().turns[1].handoff).toBeUndefined();
  });

  it("counts each turn's usage once, as agents report running totals", async () => {
    const { agent } = fakeAgent([
      async (_task, emit) => {
        emit({ type: 'usage', usage: { inputTokens: 5, outputTokens: 1 }, costUsd: 0.1 });
        emit({ type: 'usage', usage: { inputTokens: 9, outputTokens: 2 }, costUsd: 0.15 });
      },
      async (_task, emit) => {
        emit({ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.05 });
      },
    ]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('a');
    await session.idle();
    expect(session.get()).toMatchObject({ usage: { inputTokens: 9, outputTokens: 2 }, costUsd: 0.15 });
    session.send('b');
    await session.idle();
    expect(session.get().usage).toEqual({ inputTokens: 10, outputTokens: 3 });
    expect(session.get().costUsd).toBeCloseTo(0.2);
    expect(session.get().turns[0].usage).toEqual({ inputTokens: 9, outputTokens: 2 });
  });

  it('passes an explicit first resume through, so agents without the capability refuse it', async () => {
    const { agent, tasks } = fakeAgent([async () => ({ sessionId: 'x' }), async () => {}], {});
    const session = createAgentSession({ agent, cwd: '.', resume: 'old' });
    session.send('a');
    await session.idle();
    session.send('b');
    await session.idle();
    expect(tasks.map((task) => task.resume)).toEqual(['old', undefined]);
  });

  it('keeps a reset made during a turn after that turn ends', async () => {
    const gate = deferred();
    const { agent, tasks } = fakeAgent([
      async (_task, emit) => {
        emit({ type: 'session', sessionId: 's-1' });
        await gate.promise;
        return { sessionId: 's-1' };
      },
      async () => {},
    ]);
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('a');
    await Promise.resolve();
    session.reset();
    gate.resolve();
    await session.idle();
    expect(session.get().sessionId).toBeUndefined();
    session.send('b');
    await session.idle();
    expect(tasks[1].resume).toBeUndefined();
  });

  it('stops through AgentRun.abort() and does not requeue a steer the stop cut off', async () => {
    let aborted = false;
    let rejectSteer!: (error: Error) => void;
    let finish!: () => void;
    const result: AgentResult = { status: 'aborted', ok: false, exitCode: null, signal: null };
    const runs: string[] = [];
    const agent: CodingAgent = {
      name: 'stubborn',
      command: 'stubborn',
      capabilities: { steer: true },
      run(task): AgentRun {
        runs.push(task.prompt);
        const done = new Promise<AgentResult>((resolve) => (finish = () => resolve(result)));
        return {
          result: done,
          abort() {
            aborted = true;
            rejectSteer(new Error('aborted'));
            finish();
          },
          steer: () => new Promise<void>((_resolve, reject) => (rejectSteer = reject)),
          async *[Symbol.asyncIterator]() {
            yield { type: 'done', result: await done } as AgentEvent;
          },
        };
      },
    };
    const session = createAgentSession({ agent, cwd: '.' });
    session.send('work');
    session.send('also');
    session.stop();
    await session.idle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toBe(true);
    expect(runs).toEqual(['work']);
    expect(session.get().queued).toEqual([]);
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
  it('keeps the effort of a resumed session that cannot change it, across an agent switch', () => {
    const fixed = fakeAgent([], { resume: true, effort: ['low', 'high'], effortAtStart: true }, 'fixed').agent;
    const other = fakeAgent([], { resume: true, effort: ['low', 'high'] }, 'other').agent;
    const session = createAgentSession({ agent: fixed, cwd: '/w', resume: 's-1', effort: 'low' });
    session.setAgent(other);
    session.setEffort('high');
    session.setAgent(fixed);
    expect(session.get()).toMatchObject({ sessionId: 's-1', effort: 'low' });
    expect(() => session.setEffort('high')).toThrow(/keeps the effort/);
  });

  it('toggles Plan mode per turn, sends mode default when leaving Plan on resume, and clears it on unsupported agents', async () => {
    const planner = fakeAgent(
      [
        async (_task, emit) => {
          emit({ type: 'session', sessionId: 's-plan' });
        },
        async () => {},
        async () => {},
        async () => {},
      ],
      { resume: true, plan: true },
      'planner',
    );
    const plain = fakeAgent([async () => {}], { resume: true }, 'plain');
    const session = createAgentSession({ agent: planner.agent, cwd: '/w' });
    expect(session.get().mode).toBeUndefined();
    session.setMode('plan');
    expect(session.get().mode).toBe('plan');
    session.send('plan one');
    await session.idle();
    session.send('plan two');
    await session.idle();
    session.setMode('default');
    expect(session.get().mode).toBeUndefined();
    session.send('build it');
    await session.idle();
    session.send('polish it');
    await session.idle();
    expect(planner.tasks.map((task) => [task.resume, task.mode])).toEqual([
      [undefined, 'plan'],
      ['s-plan', 'plan'],
      ['s-plan', 'default'],
      ['s-plan', undefined],
    ]);

    session.setMode('plan');
    session.setAgent(plain.agent);
    expect(session.get().mode).toBeUndefined();
    expect(() => session.setMode('plan')).toThrow(/has no Plan mode/);
    session.close();
  });

  it('never writes a secret question answer into the handoff transcript', async () => {
    const { agent } = fakeAgent([
      async (task, emit) => {
        const request = {
          id: 'q-sec',
          kind: 'question' as const,
          summary: 'API token?',
          questions: [{ id: 'tok', question: 'API token?', options: [], freeText: true, secret: true }],
        };
        emit({ type: 'approval-request', request });
        const answers = await task.onQuestion!(request);
        expect(answers).toEqual({ tok: ['super-secret-value'] });
        emit({ type: 'approval-resolved', id: 'q-sec', decision: 'approve', answers: { tok: ['••••'] } });
        emit({ type: 'message', text: 'Saved.' });
      },
    ]);
    const session = createAgentSession({ agent, cwd: '/w' });
    session.send('configure');
    await expect.poll(() => session.get().approvals.length).toBe(1);
    expect(session.answer('q-sec', { tok: ['super-secret-value'] })).toBe(true);
    await session.idle();
    const transcript = handoffTranscript(session.get().turns);
    expect(transcript).not.toContain('super-secret-value');
    expect(JSON.stringify(session.get())).not.toContain('super-secret-value');
    session.close();
  });
});
