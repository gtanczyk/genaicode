import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claude } from '../drivers/claude.js';
import {
  antigravityUsageLimits,
  keepRunLimit,
  knownLimits,
  limitsAgent,
  parseAntigravityUsageLimits,
  probeAntigravityLimits,
  recordLimits,
  rolloutLimits,
  statusLineLimits,
} from './limits.js';

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
    // A session written to later, whose last reading is older, does not hide the newer one.
    const env2 = home();
    const dir2 = join(env2.HOME!, '.codex', 'sessions', '2027', '01', '15');
    mkdirSync(dir2, { recursive: true });
    const reading = (minutesAgo: number, used: number) =>
      `${JSON.stringify({
        timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: now / 1000 + 600 } },
        },
      })}\n`;
    const older = join(dir2, 'rollout-2027-01-15T08-00-00-11111111-89ab-cdef-0123-456789abcdef.jsonl');
    const newer = join(dir2, 'rollout-2027-01-15T09-00-00-22222222-89ab-cdef-0123-456789abcdef.jsonl');
    writeFileSync(newer, reading(1, 90));
    writeFileSync(older, reading(30, 10));
    utimesSync(newer, new Date(now - 60_000), new Date(now - 60_000));
    utimesSync(older, new Date(now), new Date(now));
    expect((await knownLimits(env2, now)).map((limit) => limit.usedPercent)).toEqual([90]);
  });

  it("reads the limits in Claude Code's status line input", () => {
    expect(
      statusLineLimits({
        rate_limits: { five_hour: { used_percentage: 100, resets_at: 1_800_000_000 }, seven_day: { resets_at: 1 } },
      }),
    ).toEqual([{ window: '5h', status: 'exceeded', usedPercent: 100, resetsAt: 1_800_000_000_000 }]);
    expect(statusLineLimits({ model: {} })).toEqual([]);
  });

  it("a run's limit is kept under the home its agent ran in, unless the caller turned it off", async () => {
    const env = home();
    const limit = { window: '5h', status: 'ok' as const, usedPercent: 7, resetsAt: Date.now() + 3600_000 };
    // The suite itself runs with it off.
    keepRunLimit(claude().name, limit, env);
    expect(await knownLimits(env)).toEqual([]);
    vi.stubEnv('GENAICODE_LIMITS', '');
    try {
      keepRunLimit('codexLive', limit, env);
      expect((await knownLimits(env)).map((known) => known.agent)).toEqual(['codex']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('parses and probes Antigravity /usage JSON plan limits', async () => {
    const payload = {
      conversation_id: '',
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-weekly',
                  window: 'weekly',
                  remaining_fraction: 0.7969,
                  reset_time: '2026-12-03T07:57:12Z',
                },
                {
                  id: 'gemini-5h',
                  window: '5h',
                  remaining_fraction: 0.15,
                  reset_time: '2026-11-27T01:00:26Z',
                },
              ],
            },
            {
              name: 'Claude and GPT models',
              buckets: [
                {
                  id: '3p-5h',
                  window: '5h',
                  remaining_fraction: 0,
                  reset_time: '2026-11-27T02:05:12Z',
                },
              ],
            },
          ],
        },
      },
    };
    const expected = [
      {
        window: '7d',
        status: 'ok',
        usedPercent: 20.3,
        resetsAt: Date.parse('2026-12-03T07:57:12Z'),
        name: 'Gemini',
      },
      {
        window: '5h',
        status: 'warning',
        usedPercent: 85,
        resetsAt: Date.parse('2026-11-27T01:00:26Z'),
        name: 'Gemini',
      },
      {
        window: '5h',
        status: 'exceeded',
        usedPercent: 100,
        resetsAt: Date.parse('2026-11-27T02:05:12Z'),
        name: 'Claude and GPT',
      },
    ];
    expect(antigravityUsageLimits(payload)).toEqual(expected);
    expect(parseAntigravityUsageLimits(`Fetching...\n${JSON.stringify(payload)}\n`)).toEqual(expected);
    expect(parseAntigravityUsageLimits('not json')).toEqual([]);

    const env = home();
    const binDir = join(env.HOME!, 'bin');
    mkdirSync(binDir, { recursive: true });
    const fakeAgy = join(binDir, 'agy');
    const futurePayload = {
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-5h',
                  window: '5h',
                  remaining_fraction: 0.8,
                  reset_time: new Date(Date.now() + 3_600_000).toISOString(),
                },
              ],
            },
          ],
        },
      },
    };
    writeFileSync(
      fakeAgy,
      `#!${process.execPath}\nif (process.argv.includes('/usage')) process.stdout.write(${JSON.stringify(JSON.stringify(futurePayload))});\n`,
      { mode: 0o755 },
    );
    const probeEnv = { ...env, PATH: binDir };
    vi.stubEnv('GENAICODE_LIMITS', '');
    try {
      const probed = await probeAntigravityLimits({ env: probeEnv });
      expect(probed).toHaveLength(1);
      expect(probed[0]).toMatchObject({ window: '5h', status: 'ok', usedPercent: 20, name: 'Gemini' });
      const stored = await knownLimits(probeEnv);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ agent: 'antigravity', window: '5h', usedPercent: 20, name: 'Gemini' });
      // Missing binary returns [].
      expect(await probeAntigravityLimits({ command: 'no-such-agy-bin', env: probeEnv })).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
