import { describe, expect, it, vi } from 'vitest';
import { ACTIVE_MS, cachedSessionReader, type SessionFile } from './files.js';
import type { SessionInfo } from './types.js';

const info = (file: SessionFile, now: number): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id: file.path,
  where: 'local',
  updatedAt: file.mtimeMs,
  state: now - file.mtimeMs < ACTIVE_MS ? 'active' : 'waiting',
});

describe('cachedSessionReader', () => {
  it('reads a file again only once its size or modification time changes', async () => {
    const read = vi.fn(async (file: SessionFile, now: number) => info(file, now));
    const cached = cachedSessionReader(read);
    const file = { path: '/a.jsonl', mtimeMs: 1000, size: 10 };
    await cached(file, 5000);
    await cached({ ...file }, 6000);
    expect(read).toHaveBeenCalledTimes(1);
    await cached({ ...file, size: 11 }, 6000);
    await cached({ ...file, size: 11, mtimeMs: 2000 }, 6000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('says a session is active by the clock, not by when it was first read', async () => {
    const cached = cachedSessionReader(async (file, now) => info(file, now));
    const file = { path: '/a.jsonl', mtimeMs: 1000, size: 10 };
    expect((await cached(file, 1000 + ACTIVE_MS - 1))?.state).toBe('active');
    expect((await cached(file, 1000 + ACTIVE_MS))?.state).toBe('waiting');
  });

  it('hands out a copy each caller may change', async () => {
    const cached = cachedSessionReader(async (file, now) => info(file, now));
    const file = { path: '/a.jsonl', mtimeMs: 1000, size: 10 };
    const first = await cached(file, 1e9);
    first!.title = 'changed';
    expect((await cached(file, 1e9))?.title).toBeUndefined();
  });

  it('remembers files that hold no session, and forgets the least recently used past its size', async () => {
    const read = vi.fn(async (file: SessionFile) => (file.path === '/none' ? null : info(file, Infinity)));
    const cached = cachedSessionReader(read, 2);
    const at = (path: string) => ({ path, mtimeMs: 1, size: 1 });
    expect(await cached(at('/none'))).toBeNull();
    expect(await cached(at('/none'))).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    await cached(at('/b'));
    await cached(at('/none'));
    await cached(at('/c'));
    read.mockClear();
    await cached(at('/none'));
    await cached(at('/b'));
    expect(read.mock.calls.map(([file]) => file.path)).toEqual(['/b']);
  });

  it('does not remember a read that failed', async () => {
    const read = vi.fn<(file: SessionFile, now: number) => Promise<SessionInfo | null>>();
    read.mockRejectedValueOnce(new Error('busy'));
    read.mockImplementation(async (file, now) => info(file, now));
    const cached = cachedSessionReader(read);
    const file = { path: '/a.jsonl', mtimeMs: 1, size: 1 };
    await expect(cached(file)).rejects.toThrow('busy');
    expect(await cached(file)).not.toBeNull();
  });

  it('tells apart two writes of the same size in the same millisecond', async () => {
    const read = vi.fn(async (file: SessionFile, now: number) => info(file, now));
    const cached = cachedSessionReader(read);
    await cached({ path: '/a.jsonl', mtimeMs: 1000, exactMtimeMs: 1000.1, size: 10 });
    await cached({ path: '/a.jsonl', mtimeMs: 1000, exactMtimeMs: 1000.4, size: 10 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('copies nested objects too', async () => {
    const cached = cachedSessionReader(async (file, now) => ({
      ...info(file, now),
      project: { id: 'chan_1', name: 'Plan' },
      usage: { totalTokens: 5 },
    }));
    const file = { path: '/a.jsonl', mtimeMs: 1000, size: 10 };
    const first = await cached(file);
    first!.project!.name = 'changed';
    first!.usage!.totalTokens = 9;
    expect(await cached(file)).toMatchObject({ project: { name: 'Plan' }, usage: { totalTokens: 5 } });
  });
});
