import { describe, expect, it } from 'vitest';
import { quotaHints, type RoutingCandidate } from './pack-routing.js';
import type { KnownLimit } from './sessions/limits.js';

const now = Date.UTC(2026, 2, 1);
const reset = now + 60 * 60_000;
const lead = { name: 'codex', installed: true, capabilities: {} };
const helper = {
  name: 'helper',
  installed: true,
  capabilities: { mcp: true, effort: ['high'] },
  models: new Set(['exact']),
};
const read = (agent: string, usedPercent: number, fields: Partial<KnownLimit> = {}): KnownLimit => ({
  agent,
  window: '5h',
  at: now,
  usedPercent,
  status: usedPercent >= 100 ? 'exceeded' : usedPercent >= 80 ? 'warning' : 'ok',
  resetsAt: reset,
  ...fields,
});
const hint = (readings: KnownLimit[], needs = {}, candidates: RoutingCandidate[] = [lead, helper]) =>
  quotaHints(candidates, readings, needs, now).get('codex');

describe('pack quota advice', () => {
  it('uses fresh observations for the relevant account and latest recovery', () => {
    const capacity = read('helper', 45);
    expect(hint([read('codexLive', 100), capacity])).toMatchObject({
      alternative: 'helper',
      observedAt: now,
      resetsAt: reset,
    });
    for (const limit of [
      read('codex', 90),
      read('codex', 100, { resetsAt: now }),
      read('codex', 100, { at: now - 16 * 60_000 }),
      read('codex', 100, { at: now + 1 }),
    ])
      expect(hint([limit, capacity])).toBeUndefined();
    expect(hint([read('codex', 100, { at: now - 100 }), read('codex', 20), capacity])).toBeUndefined();
    expect(hint([read('codex', 90, { status: 'exceeded' }), capacity])).toHaveProperty('alternative', 'helper');
  });
  it('offers only actual capacity and matching task requirements', () => {
    const exhausted = read('codex', 100);
    const capacity = read('helper', 35);
    const needs = { model: 'exact', effort: 'high', mcp: true };
    expect(hint([exhausted, capacity], needs)).toHaveProperty('alternative', 'helper');
    for (const readings of [
      [],
      [read('helper', 10, { at: now - 16 * 60_000 })],
      [capacity, read('helper', 100, { window: '7d' })],
    ])
      expect(hint([exhausted, ...readings], needs)).not.toHaveProperty('alternative');
    for (const candidate of [
      { ...helper, installed: false },
      { ...helper, models: new Set(['other']) },
      { ...helper, capabilities: { mcp: false, effort: ['high'] } },
      { ...helper, capabilities: { mcp: true, effort: ['low'] } },
    ])
      expect(hint([exhausted, capacity], needs, [lead, candidate])).not.toHaveProperty('alternative');
    expect(
      hint([exhausted, read('codexLive', 10, { window: '7d' })], {}, [lead, { ...helper, name: 'codexLive' }]),
    ).not.toHaveProperty('alternative');
  });
  it('separates named pools and model-only limits from the general account', () => {
    for (const [window, name, model] of [
      ['7d-opus', undefined, 'claude-opus-4'],
      ['5h', 'exact', 'exact'],
    ] as const) {
      const limited = read('codex', 100, { window, name });
      expect(hint([limited])).toBeUndefined();
      expect(hint([limited], { model: 'different' })).toBeUndefined();
      expect(hint([limited], { model })).toHaveProperty('observedAt', now);
    }
  });
});
