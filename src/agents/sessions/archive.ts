import { promises as fs } from 'node:fs';
import path from 'node:path';
import { liveDir } from './live.js';
import type { SessionInfo } from './types.js';

export { STALE_MS, staleSessions } from './group.js';

/**
 * Sessions put away: left half way or waiting for days, no longer worth a look. Archiving changes
 * nothing in the agents' own stores: genaicode notes the session's key and when, and hides it. A
 * session with news after that (a new prompt, a hook's report) comes back by itself.
 */
export type SessionArchive = Map<string, number>;

/** An archived session this long untouched is forgotten from the file: its store has moved on too. */
const FORGET_MS = 180 * 24 * 3600_000;

/** Where the archive is kept: beside the hooks' reports, readable by you only. */
export function archiveFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(liveDir(env)), 'archived.json');
}

/** How a session is known in the archive. */
export const archiveKey = (session: Pick<SessionInfo, 'source' | 'id'>): string => `${session.source}:${session.id}`;

/** The archive: session key to when it was archived. Empty when there is none or it cannot be read. */
export async function readArchive(env: NodeJS.ProcessEnv = process.env): Promise<SessionArchive> {
  try {
    const saved = JSON.parse(await fs.readFile(archiveFile(env), 'utf8')) as unknown;
    const archive: SessionArchive = new Map();
    if (typeof saved === 'object' && saved !== null && !Array.isArray(saved)) {
      for (const [key, at] of Object.entries(saved)) if (typeof at === 'number') archive.set(key, at);
    }
    return archive;
  } catch {
    return new Map();
  }
}

/** Whether `session` is archived: archived, and nothing happened in it since. */
export function isArchived(session: SessionInfo, archive: ReadonlyMap<string, number>): boolean {
  const at = archive.get(archiveKey(session));
  return at !== undefined && session.updatedAt <= at;
}

/** `sessions` with `archived: true` on those put away. */
export function withArchive(sessions: readonly SessionInfo[], archive: ReadonlyMap<string, number>): SessionInfo[] {
  if (!archive.size) return [...sessions];
  return sessions.map((session) => (isArchived(session, archive) ? { ...session, archived: true } : session));
}

/**
 * Archive `sessions` (`archived` true), or bring them back (false). Resolves to how many changed.
 * Writes are not locked: two at the same moment can lose one, which archiving again repairs.
 */
export async function archiveSessions(
  sessions: ReadonlyArray<Pick<SessionInfo, 'source' | 'id'>>,
  archived = true,
  options: { env?: NodeJS.ProcessEnv; now?: number } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const archive = await readArchive(env);
  let changed = 0;
  for (const session of sessions) {
    const key = archiveKey(session);
    if (archived) {
      if (!archive.has(key)) changed += 1;
      archive.set(key, now);
    } else if (archive.delete(key)) changed += 1;
  }
  for (const [key, at] of archive) if (now - at > FORGET_MS) archive.delete(key);
  const file = archiveFile(env);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(Object.fromEntries(archive))}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
  return changed;
}
