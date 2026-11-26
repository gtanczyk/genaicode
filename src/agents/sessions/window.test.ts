import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { topicShares } from './shares.js';
import type { SessionInfo } from './types.js';
import { partsSince } from './window.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-window-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const day = 86_400_000;
const now = Date.parse('2026-11-22T08:00:00Z');
const since = now - 7 * day;
const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();

const file = (name: string, lines: unknown[]) => {
  const path = join(dir, name);
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'));
  return path;
};
const session = (source: string, id: string, over: Partial<SessionInfo>): SessionInfo => ({
  source,
  agent: source,
  id,
  where: 'local',
  updatedAt: now - day,
  ...over,
});
const counted = (daysAgo: number, input: number, cached: number, output: number) => ({
  timestamp: at(daysAgo),
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } },
  },
});

it('counts only what a Codex thread did in the period, without input read again from cache', async () => {
  // Months of work, then one prompt in the period: 1,000 of 101,000 new tokens.
  const old = session('codex', 'old', {
    startedAt: now - 80 * day,
    usage: { inputTokens: 2_000_800, cachedInputTokens: 1_900_000, outputTokens: 200, totalTokens: 2_001_000 },
    path: file('old.jsonl', [
      counted(60, 900_000, 800_000, 0),
      counted(30, 1_900_000, 1_800_000, 0),
      counted(6, 2_000_800, 1_900_000, 200),
    ]),
  });
  // The same new work in the period, in a thread that began there.
  const fresh = session('codex', 'fresh', {
    startedAt: now - 2 * day,
    usage: { inputTokens: 50_800, cachedInputTokens: 50_000, outputTokens: 200, totalTokens: 51_000 },
  });
  const parts = await partsSince([old, fresh], since);
  expect(parts.get(old)?.part).toBeCloseTo(1_000 / 101_000, 5);
  expect(parts.get(old)?.tokens).toBe(1_000);
  expect(parts.has(fresh)).toBe(false);

  const store = {
    topics: [
      { id: 'k', name: 'Kids' },
      { id: 'g', name: 'Knights' },
    ],
    sessions: { 'codex:old': 'k', 'codex:fresh': 'g' },
  };
  // Whole-life figures put the old thread first; the period's put it last.
  expect(topicShares([old, fresh], store)[0]!.shares[0]!.name).toBe('Kids');
  const within = topicShares([old, fresh], store, parts)[0]!.shares;
  // 1,000 new tokens each: cached input weighs nothing on either side.
  expect(within.map((share) => share.share)).toEqual([0.5, 0.5]);
});

it('weighs a Codex thread whose counter started over by the tokens of the period', async () => {
  const resumed = session('codex', 'r', {
    startedAt: now - 30 * day,
    // The session's own figure is the latest counter only.
    usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
    path: file('r.jsonl', [counted(20, 1_000, 0, 0), counted(3, 100, 0, 0)]),
  });
  const fresh = session('codex', 'f', { startedAt: now - day, usage: { inputTokens: 100, outputTokens: 0 } });
  // A first report said again in the period adds nothing.
  const said = () => {
    const report = counted(20, 1_000, 0, 0);
    Object.assign(report.payload.info, { last_token_usage: { input_tokens: 1_000, output_tokens: 0 } });
    return report;
  };
  const again = session('codex', 'a', {
    startedAt: now - 30 * day,
    path: file('a.jsonl', [said(), { ...said(), timestamp: at(2) }]),
  });
  expect((await partsSince([again], since)).get(again)).toEqual({ part: 0, tokens: 0 });
  // A call that read everything from cache is no new work, and no counter starting over.
  const cached = session('codex', 'c', {
    startedAt: now - 3 * day,
    path: file('cached.jsonl', [
      {
        ...counted(3, 1_000, 1_000, 0),
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 1_000,
              cached_input_tokens: 1_000,
              output_tokens: 0,
              total_tokens: 1_000,
            },
          },
        },
      },
      counted(2, 1_100, 1_000, 10),
    ]),
  });
  expect((await partsSince([cached], since)).get(cached)).toEqual({ part: 1, tokens: 110 });
  // Nothing but cache, ever: a measured zero, not a figure to guess from the session's total.
  const idle = session('codex', 'i', {
    startedAt: now - 30 * day,
    usage: { totalTokens: 1_000 },
    path: file('idle.jsonl', [counted(1, 1_000, 1_000, 0)]),
  });
  expect((await partsSince([idle], since)).get(idle)).toEqual({ part: 0, tokens: 0 });
  // Both counters inside the period, in a thread that began there: read all the same.
  const both = session('codex', 'b', {
    startedAt: now - 3 * day,
    usage: { inputTokens: 100, outputTokens: 0 },
    path: file('b.jsonl', [counted(3, 1_000, 0, 0), counted(2, 100, 0, 0)]),
  });
  expect((await partsSince([both], since)).get(both)).toEqual({ part: 1, tokens: 1_100 });
  // A new counter already past the old one: its first report equals its own latest call.
  const first = counted(3, 2_000, 0, 0);
  const call = { input_tokens: 2_000, cached_input_tokens: 0, output_tokens: 0 };
  Object.assign(first.payload.info, { last_token_usage: call });
  const higher = session('codex', 'h', {
    startedAt: now - 30 * day,
    path: file('h.jsonl', [counted(20, 1_000, 0, 0), first, counted(2, 2_500, 0, 0)]),
  });
  expect((await partsSince([higher], since)).get(higher)).toEqual({ part: 2_500 / 3_500, tokens: 2_500 });
  const parts = await partsSince([resumed, fresh], since);
  expect(parts.get(resumed)).toEqual({ part: 100 / 1_100, tokens: 100 });
  const store = { topics: [{ id: 'a', name: 'A' }], sessions: { 'codex:r': 'a' } };
  expect(topicShares([resumed, fresh], store, parts)[0]!.shares.map((share) => share.share)).toEqual([0.5, 0.5]);
});

it('weighs a Claude Code transcript by the answers of the period, each counted once', async () => {
  const answer = (id: string, daysAgo: number, output: number) => ({
    type: 'assistant',
    timestamp: at(daysAgo),
    message: { id, usage: { input_tokens: 0, output_tokens: output } },
  });
  const claude = session('claude', 'c', {
    startedAt: now - 20 * day,
    costUsd: 10,
    path: file('c.jsonl', [answer('m1', 15, 300), answer('m2', 2, 100), answer('m2', 2, 100)]),
  });
  expect((await partsSince([claude], since)).get(claude)?.part).toBeCloseTo(0.25, 5);
});

it('estimates from the lifetime where no file says, and keeps a session whose start is unknown whole', async () => {
  const noFile = session('gemini', 'g', { startedAt: now - 15 * day, updatedAt: now - day });
  const gone = session('codex', 'x', {
    startedAt: now - 15 * day,
    updatedAt: now - day,
    path: join(dir, 'none.jsonl'),
  });
  const unknown = session('gemini', 'u', {});
  const parts = await partsSince([noFile, gone, unknown], since);
  expect(parts.get(noFile)?.part).toBeCloseTo(6 / 14, 5);
  expect(parts.get(gone)?.part).toBeCloseTo(6 / 14, 5);
  expect(parts.get(unknown)).toEqual({ part: 1 });
});

it('reads a long Codex rollout once, then only what it gained', async () => {
  const env = { GENAICODE_HOME: join(dir, 'home') };
  const filler = { timestamp: at(20), type: 'response_item', payload: { text: 'x'.repeat(1_000) } };
  const lines = [counted(20, 5_000, 0, 0), ...Array.from({ length: 1_200 }, () => filler), counted(1, 5_100, 0, 0)];
  const long = session('codex', 'long', { startedAt: now - 30 * day, path: file('long.jsonl', lines) });
  expect((await partsSince([long], since, { env })).get(long)).toEqual({ part: 100 / 5_100, tokens: 100 });
  expect(readdirSync(join(dir, 'home', 'cache', 'rollouts'))).toHaveLength(1);
  // Two reports in one minute, the period starting between them: only the second is in it.
  const close = session('codex', 'close', {
    path: file('close.jsonl', [
      { ...counted(0, 100_000, 0, 0), timestamp: '2026-11-22T08:00:10Z' },
      { ...counted(0, 100_100, 0, 0), timestamp: '2026-11-22T08:00:40Z' },
    ]),
  });
  expect((await partsSince([close], Date.parse('2026-11-22T08:00:30Z'), { env })).get(close)?.tokens).toBe(100);
  // A line longer than any report (a tool's output) is passed over, whole or not.
  const wide = session('codex', 'wide', {
    path: file('wide.jsonl', [counted(1, 10, 0, 0), { text: 'token_count'.repeat(200_000) }, counted(1, 30, 0, 0)]),
  });
  expect((await partsSince([wide], since, { env })).get(wide)?.tokens).toBe(30);
  // The last line had no end yet: it is read again, not counted twice.
  appendFileSync(long.path!, `\n${JSON.stringify(counted(0, 5_400, 0, 0))}\n`);
  expect((await partsSince([long], since, { env })).get(long)).toEqual({ part: 400 / 5_400, tokens: 400 });
  expect((await partsSince([long], now - 12 * 3_600_000, { env })).get(long)?.tokens).toBe(300);
  // A later run starts from what the earlier one kept: the rollout's start is not read again.
  vi.resetModules();
  const later = await import('./window.js');
  // The other long rollout above has a scan there too: this thread's is the one that stopped at 5,000.
  const scans = join(dir, 'home', 'cache', 'rollouts');
  const kept = readdirSync(scans)
    .map((name) => join(scans, name))
    .find((path) => readFileSync(path, 'utf8').includes('"total":5000'))!;
  // Marked, to see that it is what the later run goes on from.
  writeFileSync(kept, readFileSync(kept, 'utf8').replace('"total":5000', '"total":6000'));
  expect((await later.partsSince([long], 0, { env })).get(long)?.tokens).toBe(6_400);
  // Another file under the same name is read from its start.
  writeFileSync(
    long.path!,
    [counted(1, 50, 0, 0), ...Array.from({ length: 1_200 }, () => filler)]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );
  expect((await partsSince([long], since, { env })).get(long)).toEqual({ part: 1, tokens: 50 });
});

it('counts Antigravity transcript tokens in the period without cache reads, and caches long transcripts', async () => {
  const step = (daysAgo: number, input: number, cached: number, output: number, type = 'PLANNER_RESPONSE') => ({
    type,
    created_at: at(daysAgo),
    input_tokens: input,
    cache_read_tokens: cached,
    output_tokens: output,
  });
  const old = session('antigravity', 'a1', {
    path: file('agy-old.jsonl', [
      step(20, 9_000, 100_000, 1_000),
      step(2, 800, 200_000, 200),
      step(1, 400, 200_000, 100, 'CHECKPOINT'),
    ]),
  });
  const fresh = session('antigravity', 'a2', {
    path: file('agy-fresh.jsonl', [step(1, 1_200, 10_000, 300)]),
  });
  const parts = await partsSince([old, fresh], since);
  expect(parts.get(old)).toEqual({ part: 1_500 / 11_500, tokens: 1_500 });
  expect(parts.get(fresh)).toEqual({ part: 1, tokens: 1_500 });

  const store = {
    topics: [
      { id: 't1', name: 'Old' },
      { id: 't2', name: 'Fresh' },
    ],
    sessions: { 'antigravity:a1': 't1', 'antigravity:a2': 't2' },
  };
  const shares = topicShares([old, fresh], store, parts);
  expect(shares).toEqual([
    {
      agent: 'antigravity',
      by: 'tokens',
      shares: [
        { topic: 't1', name: 'Old', share: 0.5, sessions: 1 },
        { topic: 't2', name: 'Fresh', share: 0.5, sessions: 1 },
      ],
    },
  ]);

  // A long transcript is cached under cache/antigravity and updated incrementally on append.
  const env = { GENAICODE_HOME: join(dir, 'agy-home') };
  const filler = { type: 'GENERIC', created_at: at(20), content: 'x'.repeat(1_000) };
  const long = session('antigravity', 'a-long', {
    path: file('agy-long.jsonl', [
      step(20, 4_000, 0, 1_000),
      ...Array.from({ length: 1_200 }, () => filler),
      step(1, 400, 50_000, 100),
    ]),
  });
  expect((await partsSince([long], since, { env })).get(long)).toEqual({ part: 500 / 5_500, tokens: 500 });
  expect(readdirSync(join(dir, 'agy-home', 'cache', 'antigravity'))).toHaveLength(1);
  appendFileSync(long.path!, `\n${JSON.stringify(step(0, 300, 0, 200))}\n`);
  expect((await partsSince([long], since, { env })).get(long)).toEqual({ part: 1_000 / 6_000, tokens: 1_000 });

  // Oversized (> 1 MiB) Antigravity records still report top-level usage without counting nested decoy fields.
  const huge = session('antigravity', 'a-huge', {
    path: file('agy-huge.jsonl', [
      {
        type: 'PLANNER_RESPONSE',
        created_at: at(1),
        tool_calls: [
          {
            name: 'write_file',
            args: {
              // Nested object and escaped string with decoy keys must not be counted.
              input_tokens: 999_999,
              content: '{"input_tokens":888888,"output_tokens":777777}' + 'a'.repeat(1_200_000),
            },
          },
        ],
        input_tokens: 200,
        cache_read_tokens: 5_000,
        output_tokens: 50,
      },
      step(1, 10, 0, 1),
    ]),
  });
  expect((await partsSince([huge], since, { env })).get(huge)).toEqual({ part: 1, tokens: 261 });

  // Unversioned v1 Antigravity scan caches from before oversized-line support trigger a rescan from byte zero.
  const hugeCacheDir = join(dir, 'agy-home', 'cache', 'antigravity');
  const legacyEnv = { GENAICODE_HOME: join(dir, 'agy-legacy') };
  const legacyFile = file('agy-legacy.jsonl', [
    {
      type: 'PLANNER_RESPONSE',
      created_at: at(1),
      payload: 'x'.repeat(1_100_000),
      input_tokens: 200,
      output_tokens: 50,
    },
    step(1, 5, 0, 1),
  ]);
  const legacySession = session('antigravity', 'a-legacy', { path: legacyFile });
  // Prime the cache, then downgrade it on disk to an unversioned v1 scan that had skipped the >1 MiB line.
  expect((await partsSince([legacySession], since, { env: legacyEnv })).get(legacySession)?.tokens).toBe(256);
  const legacyCacheDir = join(dir, 'agy-legacy', 'cache', 'antigravity');
  const legacyCachePath = join(legacyCacheDir, readdirSync(legacyCacheDir)[0]!);
  const savedV2 = JSON.parse(readFileSync(legacyCachePath, 'utf8')) as Record<string, unknown>;
  delete savedV2.version;
  savedV2.total = 6;
  savedV2.inputTokens = 5;
  savedV2.outputTokens = 1;
  savedV2.reports = 1;
  savedV2.points = [[Date.parse(at(1)), 6]];
  writeFileSync(legacyCachePath, JSON.stringify(savedV2));
  vi.resetModules();
  const reloaded = await import('./window.js');
  expect((await reloaded.partsSince([legacySession], since, { env: legacyEnv })).get(legacySession)?.tokens).toBe(256);
  expect(readdirSync(hugeCacheDir).length).toBeGreaterThanOrEqual(1);

  // Oversized extractor matches JSON.parse on escaped keys, escaped timestamps, malformed scalars, and duplicate null keys.
  const rawHuge = join(dir, 'agy-escapes.jsonl');
  const pad = 'p'.repeat(1_100_000);
  const fullEscape = (value: string) =>
    [...value].map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const oldTsFullEscaped = fullEscape(at(20));
  const recentTsEscaped = at(1).replace(/Z$/, '\\u005a');
  writeFileSync(
    rawHuge,
    [
      // Escaped quote in second key `"input_tokens\""` must NOT overwrite `"input_tokens":3`, and fully Unicode-escaped old timestamp (>192 raw bytes) still keeps it before `since`.
      `{"payload":"${pad}","input_tokens":3,"input_tokens\\"":700,"created_at":"${oldTsFullEscaped}"}`,
      // Valid recent oversized record with escaped key `\u0069nput_tokens` and escaped timestamp `\u005a`.
      `{"payload":"${pad}","\\u0069nput_tokens":40,"output_tokens":10,"created_at":"${recentTsEscaped}"}`,
      // Valid small (< 1 MiB) record with escaped key `\u0069nput_tokens` also counts identically.
      `{"\\u0069nput_tokens":8,"output_tokens":2,"created_at":"${recentTsEscaped}"}`,
      // Malformed split scalar `1 2`, missing value after `:`, and trailing comma must all be rejected like JSON.parse.
      `{"payload":"${pad}","input_tokens":1 2,"created_at":"${recentTsEscaped}"}`,
      `{"payload":"${pad}","input_tokens":7,"output_tokens":}`,
      `{"payload":"${pad}","input_tokens":7,}`,
      // Duplicate `"input_tokens":null` replaces earlier numeric value (leaving only output_tokens: 7).
      `{"payload":"${pad}","input_tokens":500,"input_tokens":null,"output_tokens":7,"created_at":"${recentTsEscaped}"}`,
    ].join('\n') + '\n',
  );
  const escapedSession = session('antigravity', 'a-escaped', { path: rawHuge });
  expect((await reloaded.partsSince([escapedSession], since, { env: legacyEnv })).get(escapedSession)).toEqual({
    part: 67 / 70,
    tokens: 67,
  });
});
