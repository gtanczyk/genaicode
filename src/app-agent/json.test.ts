import { describe, expect, it } from 'vitest';
import { safeJson } from './json.js';

describe('safeJson', () => {
  it('writes BigInts, cycles and shared objects', () => {
    const shared = { a: 1 };
    const cyclic: Record<string, unknown> = { n: 1n, x: shared, y: shared };
    cyclic.self = cyclic;
    expect(JSON.parse(safeJson(cyclic))).toEqual({ n: '1', x: { a: 1 }, y: { a: 1 }, self: '[Circular]' });
  });

  it('survives a toJSON or a getter that throws', () => {
    const hostile = {
      ok: 1,
      bad: {
        toJSON() {
          throw new Error('no');
        },
      },
      get boom() {
        throw new Error('no');
      },
    };
    expect(JSON.parse(safeJson({ input: hostile }))).toEqual({
      input: { ok: 1, bad: {}, boom: '[Unreadable]' },
    });
  });
});
