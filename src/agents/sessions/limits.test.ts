import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claude } from '../drivers/claude.js';
import { knownLimits, limitsAgent, recordLimits, rolloutLimits, statusLineLimits } from './limits.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'genaicode-limits-'));
  dirs.push(dir);
  return { HOME: dir };
}

describe('known limits', () => {
  const now = 1_800_000_000_000;

  it('keeps the newest reading of each window and forgets the ones that reset', async () => {
    const env = home();
    recordLimits(
      'claude',
      [
        { window: '5h', status: 'ok', usedPercent: 40, resetsAt: now + 3600_000 },
        { window: '7d', status: 'ok', usedPercent: 20, resetsAt: now + 86_400_000 },
      ],
      env,
      now - 60_000,
    );
    recordLimits('claude', [{ window: '5h', status: 'warning', usedPercent: 81, resetsAt: now + 3600_000 }], env, now);
    expect(await knownLimits(env, now)).toEqual([
      { agent: 'claude', window: '5h', status: 'warning', usedPercent: 81, resetsAt: now + 3600_000, at: now },
      { agent: 'claude', window: '7d', status: 'ok', usedPercent: 20, resetsAt: now + 86_400_000, at: now - 60_000 },
    ]);
    // Two hours on the 5h window has reset: what was used of it is not known any more.
    expect((await knownLimits(env, now + 2 * 3600_000)).map((limit) => limit.window)).toEqual(['7d']);
    // A reading with no reset time is kept for a day.
    recordLimits('muse', [{ window: 'quota', status: 'exceeded', usedPercent: 100 }], env, now);
    expect((await knownLimits(env, now + 3600_000)).map((limit) => limit.agent)).toEqual(['claude', 'muse']);
    expect((await knownLimits(env, now + 25 * 3600_000)).map((limit) => limit.agent)).toEqual([]);
  });

  it('keeps nothing when told not to, or for a name that is no file name', async () => {
    const env = home();
    recordLimits('claude', [{ window: '5h', status: 'ok', usedPercent: 1 }], { ...env, GENAICODE_LIMITS: 'off' }, now);
    recordLimits('../claude', [{ window: '5h', status: 'ok', usedPercent: 1 }], env, now);
    expect(await knownLimits(env, now)).toEqual([]);
    expect(limitsAgent('codexLive')).toBe('codex');
    expect(limitsAgent('claude')).toBe('claude');
  });

  it("reads Codex's limits from its newest session", async () => {
    const env = home();
    const dir = join(env.HOME!, '.codex', 'sessions', '2027', '01', '15');
    mkdirSync(dir, { recursive: true });
    const at = new Date(now - 120_000).toISOString();
    const count = (limits: unknown) =>
      JSON.stringify({
        timestamp: at,
        type: 'event_msg',
        payload: { type: 'token_count', info: null, rate_limits: limits },
      });
    writeFileSync(
      join(dir, 'rollout-2027-01-15T08-00-00-01234567-89ab-cdef-0123-456789abcdef.jsonl'),
      [
        count({ primary: { used_percent: 5, window_minutes: 300, resets_at: now / 1000 + 600 } }),
        JSON.stringify({
          timestamp: at,
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'rate_limits' },
        }),
        count({
          primary: { used_percent: 12.34, window_minutes: 300, resets_at: now / 1000 + 600 },
          secondary: { used_percent: 90, window_minutes: 10080, resets_in_seconds: 3600 },
        }),
        '',
      ].join('\n'),
    );
    expect(await knownLimits(env, now)).toEqual([
      { agent: 'codex', window: '5h', status: 'ok', usedPercent: 12.3, resetsAt: now + 600_000, at: now - 120_000 },
      {
        agent: 'codex',
        window: '7d',
        status: 'warning',
        usedPercent: 90,
        resetsAt: now + 3_480_000,
        at: now - 120_000,
      },
    ]);
    // What a run through genaicode saw later wins over the session file.
    recordLimits('codex', [{ window: '5h', status: 'ok', usedPercent: 30, resetsAt: now + 600_000 }], env, now);
    expect((await knownLimits(env, now)).map((limit) => limit.usedPercent)).toEqual([30, 90]);
    expect(rolloutLimits({ primary: { window_minutes: 300 } }, now)).toEqual([]);
  });

  it("reads the limits in Claude Code's status line input", () => {
    expect(
      statusLineLimits({
        rate_limits: { five_hour: { used_percentage: 100, resets_at: 1_800_000_000 }, seven_day: { resets_at: 1 } },
      }),
    ).toEqual([{ window: '5h', status: 'exceeded', usedPercent: 100, resetsAt: 1_800_000_000_000 }]);
    expect(statusLineLimits({ model: {} })).toEqual([]);
  });

  it('a driver names the account its limits belong to', () => {
    expect(limitsAgent(claude().name)).toBe('claude');
  });
});
