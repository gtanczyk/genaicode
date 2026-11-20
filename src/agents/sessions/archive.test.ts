import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { filterSessions } from '../../ui/sessions.js';
import { archiveFile, archiveSessions, isArchived, readArchive, STALE_MS, staleSessions } from './archive.js';
import { waitingSessions } from './group.js';
import { listSessions } from './index.js';
import type { SessionInfo, SessionSource } from './types.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-archive-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let homes = 0;
const home = () => {
  const dir = join(root, `h${(homes += 1)}`);
  mkdirSync(dir, { recursive: true });
  return { HOME: dir };
};

const NOW = 10 * STALE_MS;
const session = (over: Partial<SessionInfo>): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id: 's',
  where: 'local',
  updatedAt: NOW,
  state: 'waiting',
  ...over,
});

describe('archiving sessions', () => {
  it('keeps what was put away, and brings back a session with news', async () => {
    const env = home();
    expect(await readArchive(env)).toEqual(new Map());
    expect(
      await archiveSessions(
        [
          { source: 'claude', id: 'a' },
          { source: 'codex', id: 'a' },
        ],
        true,
        { env, now: NOW },
      ),
    ).toBe(2);
    expect(statSync(archiveFile(env)).mode & 0o777).toBe(0o600);
    const archive = await readArchive(env);
    expect(isArchived(session({ id: 'a', updatedAt: NOW - 1 }), archive)).toBe(true);
    // Something happened in it after: back among the others.
    expect(isArchived(session({ id: 'a', updatedAt: NOW + 1 }), archive)).toBe(false);
    expect(isArchived(session({ id: 'b' }), archive)).toBe(false);
    expect(await archiveSessions([{ source: 'codex', id: 'a' }], false, { env, now: NOW })).toBe(1);
    expect([...(await readArchive(env)).keys()]).toEqual(['claude:a']);
    // Long untouched entries are forgotten on the next write.
    await archiveSessions([{ source: 'claude', id: 'z' }], true, { env, now: NOW + 365 * 24 * 3600_000 });
    expect([...(await readArchive(env)).keys()]).toEqual(['claude:z']);
  });

  it('picks the sessions left for days, never one at work or in the cloud', () => {
    const sessions = [
      session({ id: 'old-wait', updatedAt: NOW - STALE_MS - 1 }),
      session({ id: 'old-half', state: 'unfinished', updatedAt: NOW - 3 * STALE_MS }),
      session({ id: 'old-busy', state: 'active', updatedAt: NOW - 3 * STALE_MS }),
      session({ id: 'old-cloud', where: 'cloud', updatedAt: NOW - 3 * STALE_MS }),
      session({ id: 'old-archived', archived: true, updatedAt: NOW - 3 * STALE_MS }),
      session({ id: 'recent', updatedAt: NOW - 1000 }),
    ];
    expect(staleSessions(sessions, STALE_MS, NOW).map((one) => one.id)).toEqual(['old-wait', 'old-half']);
    expect(staleSessions(sessions, 500, NOW).map((one) => one.id)).toContain('recent');
  });

  it('marks archived sessions in the listing; what waits and the Sessions view leave them out', async () => {
    const env = home();
    const listed = [
      session({ id: 'kept', updatedAt: Date.now() - 5000 }),
      session({ id: 'gone', updatedAt: Date.now() - 6000 }),
    ];
    const source: SessionSource = { name: 'claude', where: 'local', list: async () => listed };
    await archiveSessions([{ source: 'claude', id: 'gone' }], true, { env });
    const { sessions } = await listSessions([source], { env, live: false });
    expect(sessions.map((one) => [one.id, one.archived])).toEqual([
      ['kept', undefined],
      ['gone', true],
    ]);
    expect(waitingSessions(sessions).map((one) => one.id)).toEqual(['kept']);
    expect(filterSessions(sessions, {}).map((one) => one.id)).toEqual(['kept']);
    expect(filterSessions(sessions, { state: 'archived' }).map((one) => one.id)).toEqual(['gone']);
  });
});
