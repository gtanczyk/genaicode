import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
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
