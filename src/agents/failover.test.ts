import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCli } from '../cli/args.js';
import { parseSlash } from '../ui/format.js';
import { cliAgent } from './cli-agent.js';
import { describeFailover, shouldFailOver, withFallback } from './failover.js';
import { createAppAgent } from '../app-agent/app-agent.js';
import { createAgentSession } from './session.js';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-failover-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Prints FAKE_LINES (a JSON array of objects), then exits with FAKE_EXIT.
const script = join(dir, 'agent.mjs');
writeFileSync(
  script,
  `for (const line of JSON.parse(process.env.FAKE_LINES ?? '[]')) process.stdout.write(JSON.stringify(line) + '\\n');
process.exitCode = Number(process.env.FAKE_EXIT ?? 0);
`,
);

/** `{ outcome }` lines end the task with that outcome; `{ tokens }` lines report usage. */
const scripted = (command = process.execPath) =>
  cliAgent({
    name: 'fake',
    command,
    args: () => [script],
    createParser: () => {
      let outcome: { ok: boolean; error?: string } | undefined;
      return {
        event(value) {
          const line = value as { outcome?: { ok: boolean; error?: string }; tokens?: number };
          if (line.outcome) outcome = line.outcome;
          if (line.tokens !== undefined) return [{ type: 'usage', usage: { inputTokens: line.tokens } }];
          return [];
        },
        outcome: () => outcome,
      };
    },
  });

const runWith = async (lines: unknown[], exit = 0, extra: Partial<AgentTask> = {}, command?: string) => {
  const run = scripted(command).run({
    prompt: 'go',
    cwd: dir,
    env: { ...process.env, FAKE_LINES: JSON.stringify(lines), FAKE_EXIT: String(exit) },
    ...extra,
  });
  for await (const event of run) void event;
  return run.result;
};

describe('AgentResult.failure', () => {
  it('tells a spent quota from a failed task', async () => {
    const quota = await runWith([{ outcome: { ok: false, error: '429: usage limit reached' } }], 1);
    expect(quota.failure).toEqual({ kind: 'quota' });
    expect(shouldFailOver(quota)).toBe(true);

    const task = await runWith([{ outcome: { ok: false, error: 'Tests still fail.' } }], 1);
    expect(task.status).toBe('failed');
    expect(task.failure).toBeUndefined();
    expect(shouldFailOver(task)).toBe(false);
  });

  it('reports a missing sign-in', async () => {
    const result = await runWith([{ outcome: { ok: false, error: 'Not logged in. Please run /login.' } }], 1);
    expect(result.failure).toEqual({ kind: 'auth' });
  });

  it('reports a missing CLI', async () => {
    const result = await runWith([], 0, {}, join(dir, 'no-such-agent'));
    expect(result.failure).toEqual({ kind: 'unavailable' });
  });

  it('reports a CLI that exits without a result as a crash', async () => {
    const result = await runWith([], 3);
    expect(result.failure).toEqual({ kind: 'crash' });
  });

  it('marks a spent budget, which does not fail over', async () => {
    const result = await runWith([{ tokens: 50 }], 0, { budget: { maxTokens: 10 } });
    expect(result.failure).toEqual({ kind: 'budget' });
    expect(shouldFailOver(result)).toBe(false);
  });

  it('keeps the reset time of a reported limit', async () => {
    const at = Date.UTC(2026, 10, 7, 16, 0);
    const agent = cliAgent({
      name: 'fake',
      command: process.execPath,
      args: () => [script],
      createParser: () => ({
        event: () => [{ type: 'rate-limit', limit: { window: '5h', status: 'exceeded', resetsAt: at } }],
        outcome: () => ({ ok: false, error: 'limit' }),
      }),
    });
    const run = agent.run({ prompt: 'go', cwd: dir, env: { ...process.env, FAKE_LINES: '[{}]', FAKE_EXIT: '1' } });
    expect((await run.result).failure).toEqual({ kind: 'quota', resetsAt: at });
    expect(describeFailover('claude', 'codex', { kind: 'quota', resetsAt: at })).toMatch(
      /^claude → codex \(quota, resets /,
    );
  });
});

type Outcome = Partial<AgentResult> | ((task: AgentTask) => Partial<AgentResult>);

/** An agent whose runs end as `outcomes` say, in order (then completed). */
function fake(name: string, outcomes: Outcome[] = [], events: AgentEvent[] = []) {
  const tasks: AgentTask[] = [];
  const agent: CodingAgent = {
    name,
    command: name,
    capabilities: { resume: true, effort: ['high'] },
    run(task): AgentRun {
      tasks.push(task);
      const next = outcomes.shift() ?? {};
      const partial = typeof next === 'function' ? next(task) : next;
      const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, ...partial };
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          yield* events;
          yield { type: 'done', result };
        },
      };
    },
  };
  return { agent, tasks };
}

const out = (kind: NonNullable<AgentResult['failure']>['kind']): Partial<AgentResult> => ({
  status: 'failed',
  ok: false,
  error: `${kind}!`,
  failure: { kind },
});

describe('withFallback', () => {
  it('runs the task on the next agent when one is out, without its session', async () => {
    const claude = fake('claude', [out('quota')]);
    const codex = fake('codex', [{ text: 'done' }]);
    const run = withFallback([claude.agent, codex.agent]).run({ prompt: 'fix it', cwd: dir, resume: 's-1' });
    const events: AgentEvent[] = [];
    for await (const event of run) events.push(event);
    const result = await run.result;
    expect(result).toMatchObject({ ok: true, text: 'done' });
    expect(events).toContainEqual({ type: 'failover', from: 'claude', to: 'codex', failure: { kind: 'quota' } });
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(codex.tasks[0]).toMatchObject({ prompt: 'fix it', resume: undefined });
  });

  it('drops vendor ids, keeps what is left of the budget, and adds up usage', async () => {
    const claude = fake('claude', [{ ...out('quota'), usage: { inputTokens: 60 }, costUsd: 0.6 }]);
    const codex = fake('codex', [{ usage: { inputTokens: 10 }, costUsd: 0.1 }]);
    const result = await withFallback([claude.agent, codex.agent]).run({
      prompt: 'x',
      cwd: dir,
      model: 'opus',
      effort: 'max',
      budget: { maxTokens: 100, maxCostUsd: 1 },
    }).result;
    expect(codex.tasks[0]).toMatchObject({ model: undefined, effort: undefined });
    expect(codex.tasks[0]!.budget!.maxTokens).toBe(40);
    expect(codex.tasks[0]!.budget!.maxCostUsd).toBeCloseTo(0.4);
    expect(result.usage).toEqual({ inputTokens: 70 });
    expect(result.costUsd).toBeCloseTo(0.7);
  });

  it('reports usage for the whole run, so a session counts every agent', async () => {
    const claude = fake(
      'claude',
      [{ ...out('quota'), usage: { inputTokens: 60 } }],
      [{ type: 'usage', usage: { inputTokens: 60 } }],
    );
    const codex = fake('codex', [{ usage: { inputTokens: 10 } }], [{ type: 'usage', usage: { inputTokens: 10 } }]);
    const session = createAgentSession({ agent: withFallback([claude.agent, codex.agent]), cwd: dir });
    session.send('go');
    await session.idle();
    expect(session.get().usage).toEqual({ inputTokens: 70 });
  });

  it('marks a CLI that preparation could not start as unavailable', async () => {
    const agent = cliAgent({
      name: 'fake',
      command: join(dir, 'missing'),
      args: () => [],
      prepare: () => {
        throw Object.assign(new Error('could not list MCP servers: spawn ENOENT'), { code: 'ENOENT' });
      },
      createParser: () => ({ event: () => [] }),
    });
    expect((await agent.run({ prompt: 'x', cwd: dir }).result).failure).toEqual({ kind: 'unavailable' });
  });

  it('does not start the next agent once the budget is spent', async () => {
    const claude = fake('claude', [{ ...out('crash'), usage: { inputTokens: 100 } }]);
    const codex = fake('codex');
    const result = await withFallback([claude.agent, codex.agent]).run({
      prompt: 'x',
      cwd: dir,
      budget: { maxTokens: 100 },
    }).result;
    expect(result.failure).toEqual({ kind: 'crash' });
    expect(codex.tasks).toHaveLength(0);
  });

  it('keeps vendor ids from the agent a later run starts on', async () => {
    const claude = fake('claude', [out('quota')]);
    const codex = fake('codex', [{ sessionId: 'x-1' }, {}]);
    const both = withFallback([claude.agent, codex.agent]);
    await both.run({ prompt: 'a', cwd: dir, model: 'opus' }).result;
    // A repair: claude ran out, so codex goes first, resuming its own session but not claude's model.
    await both.run({ prompt: 'b', cwd: dir, model: 'opus', resume: 'x-1' }).result;
    expect(codex.tasks[1]).toMatchObject({ prompt: 'b', model: undefined, resume: 'x-1' });
  });

  it('leaves other failures alone', async () => {
    const claude = fake('claude', [{ status: 'failed', ok: false, error: 'tests fail' }]);
    const codex = fake('codex');
    const result = await withFallback([claude.agent, codex.agent]).run({ prompt: 'x', cwd: dir }).result;
    expect(result.error).toBe('tests fail');
    expect(codex.tasks).toHaveLength(0);
  });

  it('gives up after the last agent, and skips an agent that ran out on later runs', async () => {
    const claude = fake('claude', [out('quota')]);
    const codex = fake('codex', [out('auth'), {}]);
    const both = withFallback([claude.agent, codex.agent]);
    const first = await both.run({ prompt: 'a', cwd: dir }).result;
    expect(first.failure).toEqual({ kind: 'auth' });
    // Both ran out: the next run goes in the original order, each still tried once.
    await both.run({ prompt: 'b', cwd: dir }).result;
    expect(claude.tasks.map((task) => task.prompt)).toEqual(['a', 'b']);
  });
});

describe('session failover', () => {
  it('is off without a fallback list', async () => {
    const claude = fake('claude', [out('quota')]);
    const session = createAgentSession({ agent: claude.agent, cwd: dir });
    session.send('go');
    await session.idle();
    expect(session.get().agent).toBe('claude');
    expect(session.get().turns).toHaveLength(1);
  });

  it('moves to the next agent, says so, and runs the prompt again there', async () => {
    const claude = fake('claude', [out('quota')], [{ type: 'file-change', paths: ['a.ts'] }]);
    const codex = fake('codex', [{ text: 'ok', sessionId: 'x-1' }, {}]);
    const session = createAgentSession({
      agent: claude.agent,
      cwd: dir,
      model: 'opus',
      effort: 'high',
      fallback: [claude.agent, codex.agent],
    });
    expect(session.get().fallback).toEqual(['claude', 'codex']);
    session.send('fix the bug');
    await session.idle();
    const [failed, retried] = session.get().turns;
    expect(failed!.entries.at(-1)).toEqual({
      kind: 'failover',
      from: 'claude',
      to: 'codex',
      failure: { kind: 'quota' },
    });
    expect(retried).toMatchObject({ agent: 'codex', prompt: 'fix the bug' });
    expect(session.get()).toMatchObject({ agent: 'codex', model: undefined, effort: 'high' });
    // The changes the first agent made reach the next one.
    expect(codex.tasks[0]!.prompt).toMatch(/claude stopped part-way.*a\.ts[\s\S]*fix the bug$/);
    expect(codex.tasks[0]!.model).toBeUndefined();
    // The new agent stays.
    session.send('next');
    await session.idle();
    expect(codex.tasks[1]).toMatchObject({ prompt: 'next', resume: 'x-1' });
  });

  it('hands the earlier conversation to the agent that takes over', async () => {
    const claude = fake('claude', [{ text: 'parser fixed', sessionId: 'c-1' }, out('quota')]);
    const codex = fake('codex', [{ text: 'ok' }]);
    const session = createAgentSession({ agent: claude.agent, cwd: dir, fallback: [codex.agent] });
    session.send('fix the parser');
    await session.idle();
    session.send('add a test');
    await session.idle();
    const prompt = codex.tasks[0]!.prompt;
    expect(prompt).toContain('User: fix the parser\nclaude: parser fixed');
    // The failed attempt is the prompt itself, not history.
    expect(prompt).not.toContain('User: add a test');
    expect(prompt.endsWith('add a test')).toBe(true);
    expect(session.get().turns[2]!.handoff).toMatchObject({ turns: 1, agents: ['claude'] });
  });

  it('tells the next agent what the user steered into the failed turn', async () => {
    const gate = { open: () => {} };
    const claude: CodingAgent = {
      ...fake('claude').agent,
      capabilities: { steer: true },
      run(): AgentRun {
        const result = new Promise<AgentResult>((resolve) => {
          gate.open = () =>
            resolve({ status: 'failed', ok: false, exitCode: 1, signal: null, failure: { kind: 'quota' } });
        });
        return {
          result,
          abort() {},
          steer: async () => {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'done', result: await result };
          },
        };
      },
    };
    const codex = fake('codex');
    const session = createAgentSession({ agent: claude, cwd: dir, fallback: [codex.agent] });
    session.send('Change the API');
    await new Promise((r) => setTimeout(r, 0));
    session.send('Keep backwards compatibility');
    await new Promise((r) => setTimeout(r, 0));
    gate.open();
    await session.idle();
    expect(codex.tasks[0]!.prompt).toBe(
      'Change the API\n\nWhile claude worked on it, the user added:\n- Keep backwards compatibility',
    );
  });

  it('tries each agent once per prompt', async () => {
    const claude = fake('claude', [out('quota'), {}]);
    const codex = fake('codex', [out('crash')]);
    const session = createAgentSession({ agent: claude.agent, cwd: dir, fallback: [codex.agent, claude.agent] });
    session.send('go');
    await session.idle();
    expect(session.get().turns.map((turn) => turn.agent)).toEqual(['claude', 'codex']);
    expect(session.get().turns.at(-1)!.result?.failure).toEqual({ kind: 'crash' });
  });

  it('can be changed or turned off', async () => {
    const claude = fake('claude', [out('quota')]);
    const codex = fake('codex');
    const session = createAgentSession({ agent: claude.agent, cwd: dir, fallback: [codex.agent] });
    session.setFallback(undefined);
    expect(session.get().fallback).toBeUndefined();
    session.send('go');
    await session.idle();
    expect(codex.tasks).toHaveLength(0);
  });
});

describe('--fallback and /fallback', () => {
  it('parses agent lists', () => {
    expect(parseCli(['run', '--fallback', 'codex,gemini', '--fallback', 'cursor', 'go'])).toMatchObject({
      fallback: ['codex', 'gemini', 'cursor'],
    });
    expect(parseCli(['chat', '--fallback', 'codex'])).toMatchObject({ fallback: ['codex'] });
    expect(() => parseCli(['ui', '--fallback', ','])).toThrow(/agent names/);
    expect(parseSlash('/fallback codex, gemini')).toEqual({ kind: 'fallback', names: ['codex', 'gemini'] });
    expect(parseSlash('/fallback off')).toEqual({ kind: 'fallback', off: true });
    expect(parseSlash('/fallback')).toEqual({ kind: 'fallback' });
  });
});

describe('app agent failover', () => {
  it('follows the session to the fallback agent, and takes a new list', async () => {
    const claude = fake('claude', [out('quota')]);
    const codex = fake('codex');
    const gemini = fake('gemini');
    const app = createAppAgent({
      name: 'app',
      mcpUrl: 'http://127.0.0.1:1/mcp',
      agents: () => [claude.agent, codex.agent, gemini.agent],
      agent: 'claude',
      fallback: ['codex'],
    });
    expect(app.get().fallback).toEqual(['codex']);
    app.send('hello');
    for (let i = 0; i < 100 && app.get().session?.status !== 'idle'; i++) await new Promise((r) => setTimeout(r, 5));
    expect(app.get().agent).toBe('codex');
    expect(codex.tasks).toHaveLength(1);
    app.configure({ fallback: ['gemini', 'claude'] });
    expect(app.get()).toMatchObject({ agent: 'codex', fallback: ['gemini', 'claude'] });
    expect(() => app.configure({ fallback: ['nope'] })).toThrow(/unknown agent/);
    app.close();
  });
});

describe('app agent failover briefing', () => {
  it('briefs the fallback again, with the conversation so far, on a later turn', async () => {
    const claude = fake('claude', [{ text: 'hi there' }, out('quota')]);
    const codex = fake('codex');
    const app = createAppAgent({
      name: 'the console',
      mcpUrl: 'http://127.0.0.1:1/mcp',
      agents: () => [claude.agent, codex.agent],
      agent: 'claude',
      fallback: ['codex'],
      instructions: 'Costs are in PLN.',
    });
    const idle = async () => {
      for (let i = 0; i < 200 && app.get().session?.status !== 'idle'; i++) await new Promise((r) => setTimeout(r, 5));
    };
    app.send('first');
    await idle();
    app.send('second');
    await idle();
    const prompt = codex.tasks[0]!.prompt;
    expect(prompt).toContain('You are the assistant inside the console');
    expect(prompt).toContain('Costs are in PLN.');
    expect(prompt).toContain('User: first');
    expect(prompt.endsWith('User message:\nsecond')).toBe(true);
    app.close();
  });
});
