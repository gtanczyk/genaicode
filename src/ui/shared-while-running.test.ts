import { describe, expect, it, vi } from 'vitest';
import { sharedWhileRunning } from './shared-while-running.js';

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
});
