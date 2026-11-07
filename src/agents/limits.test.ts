import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCli } from '../cli/args.js';
import { createRenderer } from '../cli/render.js';
import { budgetStatus, formatResetIn, limitChips } from '../react/format.js';
import { cliAgent } from './cli-agent.js';
import { claudeArgs, claudeRateLimits, createClaudeParser } from './drivers/claude.js';
import { codexNotification, codexRateLimits } from './drivers/codex-live.js';
import { vibeArgs } from './drivers/vibe.js';
import { createAgentSession } from './session.js';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';
import { runWithVerify } from './verify.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-limits-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Prints FAKE_LINES (a JSON array of objects), then stays alive until killed.
const script = join(dir, 'hang-agent.mjs');
writeFileSync(
  script,
  `for (const line of JSON.parse(process.env.FAKE_LINES ?? '[]')) process.stdout.write(JSON.stringify(line) + '\\n');
if (process.env.FAKE_HANG) setInterval(() => {}, 1000);
`,
);

/** Reads `{ tokens, cost }` lines as running-total usage reports and `{ error }` lines as errors. */
const usageAgent = cliAgent({
  name: 'fake',
  command: process.execPath,
  args: () => [script],
  createParser: () => ({
    event(value) {
      const line = value as { tokens?: number; cost?: number; error?: string };
      if (line.error) return [{ type: 'error', message: line.error }];
      return [
        {
          type: 'usage',
          usage: { inputTokens: line.tokens ?? 0, outputTokens: 0 },
          ...(line.cost !== undefined ? { costUsd: line.cost } : {}),
        },
      ];
    },
  }),
});

async function collect(run: AgentRun): Promise<{ events: AgentEvent[]; result: AgentResult }> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return { events, result: await run.result };
}

function env(lines: unknown[], hang = true): NodeJS.ProcessEnv {
  return { ...process.env, FAKE_LINES: JSON.stringify(lines), ...(hang ? { FAKE_HANG: '1' } : {}) };
}

describe('task.budget', () => {
  it('warns past warnAt and stops the agent past the token cap', async () => {
    const run = usageAgent.run({
      prompt: 'go',
      cwd: dir,
      env: env([{ tokens: 50 }, { tokens: 85 }, { tokens: 120 }]),
      budget: { maxTokens: 100 },
      timeoutMs: 10_000,
    });
    const { events, result } = await collect(run);
    expect(events.filter((event) => event.type === 'budget-warning')).toEqual([
      { type: 'budget-warning', warning: { kind: 'tokens', used: 85, limit: 100 } },
    ]);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('fake went over its token budget (120 of 100).');
    expect(events.some((event) => event.type === 'error' && event.message === result.error)).toBe(true);
  });

  it('stops on cost, with its own warnAt', async () => {
    const run = usageAgent.run({
      prompt: 'go',
      cwd: dir,
      env: env([{ cost: 0.4 }, { cost: 0.6 }]),
      budget: { maxCostUsd: 0.5, warnAt: 0.5 },
      timeoutMs: 10_000,
    });
    const { events, result } = await collect(run);
    expect(events.find((event) => event.type === 'budget-warning')).toEqual({
      type: 'budget-warning',
      warning: { kind: 'cost', used: 0.4, limit: 0.5 },
    });
    expect(result).toMatchObject({ status: 'failed', ok: false });
    expect(result.error).toContain('cost budget');
  });

  it('leaves a run inside its budget alone', async () => {
    const run = usageAgent.run({
      prompt: 'go',
      cwd: dir,
      env: env([{ tokens: 10 }], false),
      budget: { maxTokens: 100 },
    });
    const { events, result } = await collect(run);
    expect(result.status).toBe('completed');
    expect(events.some((event) => event.type === 'budget-warning')).toBe(false);
  });
});

describe('quota errors', () => {
  it('adds one exceeded quota limit after an error that says so', async () => {
    const run = usageAgent.run({
      prompt: 'go',
      cwd: dir,
      env: env([{ error: 'You exceeded your current quota (429)' }, { error: 'Rate limit hit again' }], false),
    });
    const { events } = await collect(run);
    expect(events.filter((event) => event.type === 'rate-limit')).toEqual([
      { type: 'rate-limit', limit: { window: 'quota', status: 'exceeded' } },
    ]);
  });

  it('ignores other errors', async () => {
    const run = usageAgent.run({ prompt: 'go', cwd: dir, env: env([{ error: 'Max turns reached' }], false) });
    const { events } = await collect(run);
    expect(events.some((event) => event.type === 'rate-limit')).toBe(false);
  });
});

describe('claude rate limits', () => {
  it('maps the limiting window', () => {
    expect(
      claudeRateLimits({
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.83,
        resetsAt: 1_800_000_000,
      }),
    ).toEqual([
      {
        type: 'rate-limit',
        limit: { window: '5h', status: 'warning', usedPercent: 83, resetsAt: 1_800_000_000_000 },
      },
    ]);
  });

  it('lists every window when Claude sends them', () => {
    const events = claudeRateLimits({
      status: 'rejected',
      rateLimitType: 'seven_day',
      unifiedWindows: {
        five_hour: { utilization: 0.2, resetsAt: 1_800_000_000 },
        seven_day: { utilization: 1, resetsAt: 1_800_100_000 },
      },
    });
    expect(events).toEqual([
      { type: 'rate-limit', limit: { window: '5h', status: 'ok', usedPercent: 20, resetsAt: 1_800_000_000_000 } },
      {
        type: 'rate-limit',
        limit: { window: '7d', status: 'exceeded', usedPercent: 100, resetsAt: 1_800_100_000_000 },
      },
    ]);
  });

  it('reads rate_limit_event lines and passes the cost cap on', () => {
    const parser = createClaudeParser();
    expect(
      parser.event({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' } }),
    ).toEqual([{ type: 'rate-limit', limit: { window: '5h', status: 'ok' } }]);
    expect(parser.event({ type: 'rate_limit_event' })).toEqual([]);
    const args = claudeArgs({ prompt: 'p', cwd: dir, budget: { maxCostUsd: 2.5 } });
    expect(args.join(' ')).toContain('--max-budget-usd 2.5');
  });
});

describe('codex rate limits', () => {
  it('maps primary and secondary windows', () => {
    expect(
      codexNotification('account/rateLimits/updated', {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 91, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: null },
        },
      }),
    ).toEqual([
      { type: 'rate-limit', limit: { window: '5h', status: 'warning', usedPercent: 91, resetsAt: 1_800_000_000_000 } },
      { type: 'rate-limit', limit: { window: '7d', status: 'ok', usedPercent: 12 } },
    ]);
  });

  it('names a per-model limit and reports a reached one', () => {
    expect(
      codexRateLimits({
        limitId: 'gpt-x',
        limitName: 'GPT-X',
        primary: { usedPercent: 40, windowDurationMins: 300 },
        rateLimitReachedType: 'workspace_member_usage_limit_reached',
      }),
    ).toEqual([
      { type: 'rate-limit', limit: { window: '5h', status: 'ok', usedPercent: 40, name: 'GPT-X' } },
      { type: 'rate-limit', limit: { window: 'quota', status: 'exceeded', name: 'GPT-X' } },
    ]);
  });
});

describe('vibe budget', () => {
  it('passes the lower of maxPriceUsd and the task cost cap', () => {
    const args = vibeArgs({ prompt: 'p', cwd: dir, budget: { maxCostUsd: 1 } }, { maxPriceUsd: 3 });
    expect(args.join(' ')).toContain('--max-price 1');
  });
});

/** An agent whose runs emit `events` and complete. */
function scriptedAgent(runs: AgentEvent[][]): { agent: CodingAgent; tasks: AgentTask[] } {
  const tasks: AgentTask[] = [];
  const agent: CodingAgent = {
    name: 'scripted',
    command: 'scripted',
    capabilities: { usage: true, resume: true },
    run(task) {
      tasks.push(task);
      const events = runs.shift() ?? [];
      const usage = [...events].reverse().find((event) => event.type === 'usage');
      const result: AgentResult = {
        status: 'completed',
        ok: true,
        exitCode: 0,
        signal: null,
        ...(usage?.type === 'usage' ? { usage: usage.usage, costUsd: usage.costUsd } : {}),
      };
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

describe('session budget and limits', () => {
  it('gives each turn what is left and refuses turns once it is spent', async () => {
    const { agent, tasks } = scriptedAgent([
      [{ type: 'usage', usage: { inputTokens: 60, outputTokens: 10 }, costUsd: 0.2 }],
      [{ type: 'usage', usage: { inputTokens: 30, outputTokens: 5 } }],
    ]);
    const session = createAgentSession({ agent, cwd: dir, budget: { maxTokens: 100 } });
    session.send('one');
    await session.idle();
    expect(tasks[0]!.budget).toEqual({ maxTokens: 100, warnAt: Infinity });
    session.send('two');
    await session.idle();
    expect(tasks[1]!.budget).toEqual({ maxTokens: 30, warnAt: Infinity });
    session.send('three');
    await session.idle();
    expect(tasks).toHaveLength(2);
    const last = session.get().turns.at(-1)!;
    expect(last.result?.error).toBe('The session used its token budget (105 of 100).');
    expect(session.get().budget).toEqual({ maxTokens: 100 });

    session.setBudget({ maxTokens: 1000 });
    session.send('four');
    await session.idle();
    expect(tasks).toHaveLength(3);
  });

  it('keeps the latest report per limit and clears an error-only quota after a good turn', async () => {
    const { agent } = scriptedAgent([
      [
        { type: 'rate-limit', limit: { window: '5h', status: 'ok', usedPercent: 10 } },
        { type: 'rate-limit', limit: { window: '7d', status: 'ok', usedPercent: 40 } },
        { type: 'rate-limit', limit: { window: '5h', status: 'warning', usedPercent: 85 } },
        { type: 'rate-limit', limit: { window: 'quota', status: 'exceeded' } },
      ],
    ]);
    const session = createAgentSession({ agent, cwd: dir });
    const seen: Array<string | undefined> = [];
    session.subscribe((state) => seen.push(state.rateLimits?.map((limit) => limit.window).join(',')));
    session.send('go');
    await session.idle();
    expect(seen).toContain('5h,7d,quota');
    expect(session.get().rateLimits).toEqual([
      { window: '5h', status: 'warning', usedPercent: 85 },
      { window: '7d', status: 'ok', usedPercent: 40 },
    ]);
  });
});

describe('runWithVerify budget', () => {
  it('spreads the budget over the attempts', async () => {
    const { agent, tasks } = scriptedAgent([
      [{ type: 'usage', usage: { inputTokens: 40, outputTokens: 0 } }],
      [{ type: 'usage', usage: { inputTokens: 70, outputTokens: 0 } }],
    ]);
    const loop = await runWithVerify(
      agent,
      { prompt: 'fix', cwd: dir, budget: { maxTokens: 100 } },
      {
        maxRepairs: 3,
        verify: () => ({ ok: false, detail: 'no' }),
      },
    );
    expect(tasks.map((task) => task.budget?.maxTokens)).toEqual([100, 60]);
    expect(loop).toMatchObject({ ok: false, error: 'The budget is used up; no repair attempt left.' });
  });
});

describe('display', () => {
  const now = Date.UTC(2026, 10, 7, 12, 0);

  it('formats time to reset', () => {
    expect(formatResetIn(now + 20_000, now)).toBe('now');
    expect(formatResetIn(now + 42 * 60_000, now)).toBe('in 42m');
    expect(formatResetIn(now + 125 * 60_000, now)).toBe('in 2h 5m');
    expect(formatResetIn(now + 3 * 86_400_000 + 4 * 3_600_000, now)).toBe('in 3d 4h');
  });

  it('builds chips worst first and skips stale or empty limits', () => {
    const chips = limitChips(
      {
        usage: { inputTokens: 90_000, outputTokens: 5_000 },
        costUsd: 0.5,
        budget: { maxTokens: 100_000, maxCostUsd: 5 },
        rateLimits: [
          { window: '7d', status: 'ok', usedPercent: 41.6, resetsAt: now + 125 * 60_000 },
          { window: '5h', status: 'exceeded', usedPercent: 100, resetsAt: now + 42 * 60_000 },
          { window: '5h-old', status: 'exceeded', resetsAt: now - 1 },
          { window: 'opus', status: 'ok' },
        ],
      },
      now,
    );
    expect(chips.map((chip) => [chip.text, chip.level])).toEqual([
      ['5h 100% · resets in 42m', 'exceeded'],
      ['budget 95k/100k tokens', 'warning'],
      ['budget $0.50/$5.00', 'ok'],
      ['7d 42% · resets in 2h 5m', 'ok'],
    ]);
  });

  it('rates budget rows', () => {
    expect(budgetStatus({ maxTokens: 10 }, { totalTokens: 10 }, undefined)).toEqual([
      { kind: 'tokens', used: 10, limit: 10, level: 'exceeded' },
    ]);
    expect(budgetStatus(undefined, {}, 1)).toEqual([]);
  });

  it('prints warnings once in the terminal', () => {
    const lines: string[] = [];
    const render = createRenderer({ write: () => {} }, { write: (text: string) => lines.push(text) });
    const warning: AgentEvent = { type: 'rate-limit', limit: { window: '5h', status: 'warning', usedPercent: 85 } };
    render(warning);
    render(warning);
    render({ type: 'rate-limit', limit: { window: '7d', status: 'ok', usedPercent: 10 } });
    render({ type: 'budget-warning', warning: { kind: 'tokens', used: 80, limit: 100 } });
    expect(lines).toEqual(['! 5h limit close to running out at 85%\n', '! budget: 80% of 100 tokens used\n']);
  });
});

describe('cli flags', () => {
  it('parses --max-tokens and --max-cost', () => {
    expect(parseCli(['run', '--max-tokens', '5000', '--max-cost', '$1.5', 'go'])).toMatchObject({
      kind: 'run',
      budget: { maxTokens: 5000, maxCostUsd: 1.5 },
    });
    expect(parseCli(['chat', '--max-cost', '2'])).toMatchObject({ kind: 'chat', budget: { maxCostUsd: 2 } });
    expect(parseCli(['ui'])).not.toHaveProperty('budget');
    expect(() => parseCli(['run', '--max-cost', 'lots'])).toThrow(/--max-cost/);
  });
});

describe('review fixes', () => {
  it('counts turns without totalTokens in a session that has totals', async () => {
    const { agent, tasks } = scriptedAgent([
      [{ type: 'usage', usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 } }],
      [{ type: 'usage', usage: { outputTokens: 40 } }],
      [],
    ]);
    const session = createAgentSession({ agent, cwd: dir, budget: { maxTokens: 100 } });
    for (const prompt of ['one', 'two', 'three']) {
      session.send(prompt);
      await session.idle();
    }
    expect(session.get().usage.totalTokens).toBe(90);
    expect(tasks[2]!.budget?.maxTokens).toBe(10);
  });
});

describe('limits per agent', () => {
  it('drops limits on setAgent and ignores late reports from the old agent', async () => {
    const first = scriptedAgent([[{ type: 'rate-limit', limit: { window: '5h', status: 'exceeded' } }]]);
    const session = createAgentSession({ agent: first.agent, cwd: dir });
    session.send('go');
    await session.idle();
    expect(session.get().rateLimits).toHaveLength(1);
    const second = scriptedAgent([[]]);
    session.setAgent({ ...second.agent, name: 'other' });
    expect(session.get().rateLimits).toEqual([]);
  });
});
