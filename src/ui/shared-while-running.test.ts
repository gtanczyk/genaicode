import { describe, expect, it, vi } from 'vitest';
import { sessionsOncePerMinute, sharedWhileRunning } from './shared-while-running.js';

describe('sharedWhileRunning', () => {
  it('gives callers of the same key the read under way, and reads afresh once it ended', async () => {
    let finish!: (value: string) => void;
    const read = vi.fn(
      (query: { key: string }) => new Promise<string>((done) => (finish = (v) => done(v + query.key))),
    );
    const shared = sharedWhileRunning((query: { key: string }) => query.key, read);
    const one = shared({ key: 'a' });
    const two = shared({ key: 'a' });
    expect(read).toHaveBeenCalledTimes(1);
    finish('x');
    expect(await Promise.all([one, two])).toEqual(['xa', 'xa']);
    void shared({ key: 'a' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads separately for another key, and lets a failure go to its callers only', async () => {
    const read = vi.fn(async (key: string) => {
      if (key === 'bad') throw new Error('no');
      return key;
    });
    const shared = sharedWhileRunning((key: string) => key, read);
    await expect(shared('bad')).rejects.toThrow('no');
    expect(await shared('good')).toBe('good');
    await expect(shared('bad')).rejects.toThrow('no');
    expect(read).toHaveBeenCalledTimes(3);
  });

  describe('sessionsOncePerMinute', () => {
    it('reads once from the start of the minute and gives each caller the sessions after its own cutoff', async () => {
      const read = vi.fn(async ({ since }: { own?: boolean; since?: number }) => ({
        sessions: [{ updatedAt: 65_000 }, { updatedAt: 70_000 }].filter(
          (s) => since === undefined || s.updatedAt >= since,
        ),
      }));
      const list = sessionsOncePerMinute(read);
      const [early, late] = await Promise.all([list({ since: 64_000 }), list({ since: 66_000 })]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith({ since: 60_000 });
      expect(early.sessions.map((s) => s.updatedAt)).toEqual([65_000, 70_000]);
      expect(late.sessions.map((s) => s.updatedAt)).toEqual([70_000]);
    });

    it('reads apart for own chats, for another minute and without a cutoff', async () => {
      const read = vi.fn<(query: { own?: boolean; since?: number }) => Promise<{ sessions: never[] }>>(async () => ({
        sessions: [],
      }));
      const list = sessionsOncePerMinute(read);
      await Promise.all([list({ since: 1000 }), list({ own: true, since: 1000 }), list({ since: 61_000 }), list({})]);
      expect(read.mock.calls.map(([query]) => query)).toEqual([
        { since: 0 },
        { own: true, since: 0 },
        { since: 60_000 },
        {},
      ]);
    });
  });
});
