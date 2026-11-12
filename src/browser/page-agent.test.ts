import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { fakeLanguageModel } from './fake-model.js';
import { createPageAgent, type PageAgent, type PageAgentState } from './page-agent.js';
import type { PageTool } from './tools.js';

async function settled(agent: PageAgent, done: (state: PageAgentState) => boolean): Promise<PageAgentState> {
  if (done(agent.get())) return agent.get();
  return new Promise((resolve) => {
    const stop = agent.subscribe((state) => {
      if (!done(state)) return;
      stop();
      resolve(state);
    });
  });
}
const idle = (agent: PageAgent) =>
  settled(agent, (state) => state.session.status === 'idle' && state.session.turns.length > 0);

const theme: PageTool = {
  name: 'set_theme',
  description: 'Switch the theme.',
  inputSchema: { type: 'object', properties: { theme: { type: 'string', enum: ['dark', 'light'] } } },
  write: true,
  summary: (args) => `Switch to ${String(args.theme)}`,
  run: vi.fn(({ theme: value }) => `theme is ${String(value)}`),
};

describe('createPageAgent', () => {
  it('runs a turn on the built-in model and draws it as session state', async () => {
    const model = fakeLanguageModel(['Hello there.']);
    const agent = createPageAgent({ name: 'wolf', instructions: 'Be a wolf.', nano: { languageModel: model.factory } });
    expect(agent.get().model.status).toBe('checking');
    expect(await agent.refresh()).toBe('available');

    agent.send('  hi  ');
    expect(agent.get().session).toMatchObject({ status: 'running', agent: 'wolf' });
    const state = await idle(agent);
    const [turn] = state.session.turns;
    expect(turn).toMatchObject({ id: 1, agent: 'wolf', prompt: 'hi' });
    expect(turn.entries).toEqual([{ kind: 'text', text: 'Hello there.', streaming: false }]);
    expect(turn.result).toMatchObject({ status: 'completed', ok: true });
    expect(state.context).toEqual({ used: 10, window: 1000 });
    expect(state.session.usage).toEqual({ totalTokens: 10 });
    // The driver's own session id is not shown as a chip.
    expect(state.session.sessionId).toBeUndefined();
    expect(model.created[0].initialPrompts?.[0].content).toContain('Be a wolf.');

    agent.send('again');
    await settled(agent, (next) => next.session.status === 'idle' && next.session.turns.length === 2);
    expect(model.created).toHaveLength(1);
    // Each turn reports its own tokens; the session adds them up.
    expect(agent.get().session.turns.map((each) => each.usage)).toEqual([{ totalTokens: 10 }, { totalTokens: 10 }]);
    expect(agent.get().session.usage).toEqual({ totalTokens: 20 });
    expect(agent.get().context).toEqual({ used: 20, window: 1000 });
  });

  it('holds a write tool until the user approves it', async () => {
    const script = ['{"action":"set_theme"}', '{"theme":"dark"}', '{"action":"reply"}', 'Done.'];
    const agent = createPageAgent({ tools: [theme], nano: { languageModel: fakeLanguageModel(script).factory } });
    agent.send('go dark');
    const waiting = await settled(agent, (state) => state.session.approvals.length === 1);
    const [request] = waiting.session.approvals;
    expect(request).toMatchObject({
      summary: 'Switch to dark',
      detail: { tool: 'set_theme', args: { theme: 'dark' } },
    });
    expect(theme.run).not.toHaveBeenCalled();
    expect(agent.approve('nope', 'approve')).toBe(false);
    expect(agent.approve(request.id, 'approve')).toBe(true);
    const state = await idle(agent);
    expect(theme.run).toHaveBeenCalledTimes(1);
    expect(state.session.approvals).toEqual([]);
    const kinds = state.session.turns[0].entries.map((entry) => entry.kind);
    expect(kinds).toEqual(['tool', 'approval', 'text']);
    expect(state.session.turns[0].entries[1]).toMatchObject({ decision: 'approve' });
    expect(state.session.turns[0].entries[0]).toMatchObject({ done: true, output: 'theme is dark' });
  });

  it('answers approvals itself when autoApprove decides', async () => {
    const script = ['{"action":"set_theme"}', '{"theme":"light"}', '{"action":"reply"}', 'No.'];
    const agent = createPageAgent({
      tools: [{ ...theme, run: vi.fn(() => 'x') }],
      nano: { languageModel: fakeLanguageModel(script).factory },
      autoApprove: () => 'deny',
    });
    agent.send('go light');
    const state = await idle(agent);
    expect(state.session.turns[0].entries[0]).toMatchObject({
      isError: true,
      output: 'The user declined this action.',
    });
  });

  it('queues prompts sent during a turn, and stop drops them', async () => {
    let release: (text: string) => void = () => {};
    const model = fakeLanguageModel([() => new Promise<string>((resolve) => (release = resolve)), 'Second.']);
    const agent = createPageAgent({ nano: { languageModel: model.factory } });
    agent.send('one');
    agent.send('two');
    expect(agent.get().session.queued).toEqual(['two']);
    await vi.waitFor(() => expect(model.calls).toHaveLength(1));
    release('First.');
    const state = await settled(agent, (next) => next.session.status === 'idle' && next.session.turns.length === 2);
    expect(state.session.turns.map((turn) => turn.result?.text)).toEqual(['First.', 'Second.']);

    const slow = createPageAgent({ nano: { languageModel: fakeLanguageModel([() => new Promise(() => {})]).factory } });
    slow.send('one');
    slow.send('two');
    await vi.waitFor(() => expect(slow.get().session.turns).toHaveLength(1));
    slow.stop();
    const stopped = await idle(slow);
    expect(stopped.session.queued).toEqual([]);
    expect(stopped.session.turns).toHaveLength(1);
    expect(stopped.session.turns[0].result).toMatchObject({ status: 'aborted' });
  });

  it('resets to a new conversation and ignores the old run', async () => {
    const model = fakeLanguageModel(['One.', () => new Promise(() => {}), 'Fresh.']);
    const agent = createPageAgent({ nano: { languageModel: model.factory } });
    agent.send('a');
    await idle(agent);
    agent.send('b');
    await vi.waitFor(() => expect(model.calls).toHaveLength(2));
    agent.reset();
    expect(agent.get().session).toMatchObject({ status: 'idle', turns: [], queued: [], approvals: [] });
    expect(agent.get().context).toBeUndefined();
    expect(model.destroyed).toBe(1);
    agent.send('c');
    const state = await idle(agent);
    expect(state.session.turns).toHaveLength(1);
    expect(state.session.turns[0].result?.text).toBe('Fresh.');
    expect(model.created).toHaveLength(2);
  });

  it('reports the model: missing, downloadable, downloading', async () => {
    const missing = createPageAgent({});
    expect(await missing.refresh()).toBe('unavailable');
    missing.send('hi');
    const failed = await idle(missing);
    expect(failed.session.turns[0].entries[0]).toMatchObject({ kind: 'error' });

    const model = fakeLanguageModel(['ok'], { availability: 'downloadable', download: [0, 0.4, 1] });
    const agent = createPageAgent({ nano: { languageModel: model.factory } });
    expect(await agent.refresh()).toBe('downloadable');
    const seen: string[] = [];
    agent.subscribe((state) => seen.push(`${state.model.status}:${state.model.progress ?? ''}`));
    await agent.prepare();
    expect(seen).toEqual(['downloading:0', 'downloading:0.4', 'loading:1', 'available:']);
  });

  it('closes the turn when a driver throws or ends without a result', async () => {
    let mode: 'throw' | 'silent' | 'ok' = 'throw';
    const result: AgentResult = { status: 'completed', ok: true, exitCode: null, signal: null };
    const flaky: CodingAgent = {
      name: 'flaky',
      command: 'none',
      capabilities: {},
      run(): AgentRun {
        if (mode === 'throw') throw new Error('cannot start');
        const events: AgentEvent[] =
          mode === 'ok'
            ? [{ type: 'done', result }]
            : [
                { type: 'tool-start', id: 't1', name: 'look', input: {} },
                { type: 'text-delta', text: 'Half an ans' },
              ];
        return {
          result: Promise.resolve(result),
          abort() {},
          async *[Symbol.asyncIterator]() {
            yield* events;
          },
        };
      },
    };
    const agent = createPageAgent({ agent: flaky });
    agent.send('a');
    mode = 'silent';
    agent.send('b');
    const state = await settled(agent, (next) => next.session.status === 'idle' && next.session.turns.length === 2);
    expect(state.session.turns[0].entries).toEqual([{ kind: 'error', message: 'cannot start' }]);
    expect(state.session.turns.map((turn) => turn.result?.status)).toEqual(['failed', 'failed']);
    expect(state.session.turns[1].entries).toMatchObject([
      { kind: 'tool', done: true, isError: true },
      { kind: 'text', text: 'Half an ans', streaming: false },
    ]);
    expect(state.session.queued).toEqual([]);
    mode = 'ok';
    agent.send('c');
    await settled(agent, (next) => next.session.status === 'idle' && next.session.turns.length === 3);
    expect(agent.get().session.turns[2].result?.ok).toBe(true);
  });

  it('drives any CodingAgent given instead of nano', async () => {
    const tasks: AgentTask[] = [];
    const custom: CodingAgent = {
      name: 'custom',
      command: 'none',
      capabilities: {},
      run(task): AgentRun {
        tasks.push(task);
        const result: AgentResult = { status: 'completed', ok: true, exitCode: null, signal: null, text: 'ok' };
        const events: AgentEvent[] = [
          { type: 'session', sessionId: 's1', model: 'm' },
          { type: 'message', text: 'ok' },
          { type: 'done', result },
        ];
        return {
          result: Promise.resolve(result),
          abort() {},
          async *[Symbol.asyncIterator]() {
            yield* events;
          },
        };
      },
    };
    const agent = createPageAgent({ agent: custom });
    expect(agent.get().model.status).toBe('available');
    agent.send('a');
    await idle(agent);
    agent.send('b');
    await settled(agent, (state) => state.session.status === 'idle' && state.session.turns.length === 2);
    expect(tasks.map((task) => task.resume)).toEqual([undefined, 's1']);
    expect(agent.get().session.model).toBe('m');
  });
});
