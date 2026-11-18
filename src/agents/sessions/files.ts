import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SessionInfo, SessionQuery } from './types.js';

export interface SessionFile {
  path: string;
  mtimeMs: number;
  size: number;
}

/** Files under `dir` (to `depth` levels) whose name passes `match`, newest first. A missing `dir` is empty. */
export async function findFiles(dir: string, depth: number, match: (name: string) => boolean): Promise<SessionFile[]> {
  const found: SessionFile[] = [];
  const walk = async (current: string, left: number): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (left > 0) await walk(full, left - 1);
        } else if (entry.isFile() && match(entry.name)) {
          try {
            const stat = await fs.stat(full);
            found.push({ path: full, mtimeMs: Math.round(stat.mtimeMs), size: stat.size });
          } catch {
            // Removed while listing.
          }
        }
      }),
    );
  };
  await walk(dir, depth);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

const CHUNK = 256 * 1024;

/**
 * The JSON lines at the start and at the end of a file, without reading the middle of a large
 * one: session logs grow to many megabytes, and what names a session sits at its two ends.
 */
export async function headAndTail(file: SessionFile): Promise<{ head: unknown[]; tail: unknown[] }> {
  const handle = await fs.open(file.path, 'r');
  try {
    if (file.size <= CHUNK * 2) {
      const all = parseLines((await handle.readFile('utf8')).split('\n'));
      return { head: all, tail: all };
    }
    const first = Buffer.alloc(CHUNK);
    const last = Buffer.alloc(CHUNK);
    await handle.read(first, 0, CHUNK, 0);
    await handle.read(last, 0, CHUNK, file.size - CHUNK);
    return cut(first, last);
  } finally {
    await handle.close();
  }
}

/** The same two ends of a transcript that is already in memory. */
export function chunksOf(data: Buffer): { head: unknown[]; tail: unknown[] } {
  if (data.length <= CHUNK * 2) {
    const all = parseLines(data.toString('utf8').split('\n'));
    return { head: all, tail: all };
  }
  return cut(data.subarray(0, CHUNK), data.subarray(data.length - CHUNK));
}

// The cut falls inside a line at the end of the head and at the start of the tail.
function cut(first: Buffer, last: Buffer): { head: unknown[]; tail: unknown[] } {
  return {
    head: parseLines(first.toString('utf8').split('\n').slice(0, -1)),
    tail: parseLines(last.toString('utf8').split('\n').slice(1)),
  };
}

function parseLines(lines: string[]): unknown[] {
  const values: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      // A half-written last line.
    }
  }
  return values;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One line of at most `max` characters. */
export function oneLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The last `max` characters of `text`, as one line. */
export function ending(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `…${flat.slice(flat.length - max + 1)}` : flat;
}

/** Whether `dir` is `root` or inside it. */
export function isWithin(dir: string, root: string): boolean {
  const relative = path.relative(root, dir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Run `task` over `items`, at most `width` at a time, keeping order. */
export async function mapLimited<T, R>(
  items: readonly T[],
  width: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    }),
  );
  return results;
}

/** Written to this recently: an agent is probably still working in it. */
export const ACTIVE_MS = 2 * 60_000;

/** Apply a `SessionQuery` to sessions a source read: filter, newest first, cut to `limit`. */
export function select(sessions: SessionInfo[], query: SessionQuery): SessionInfo[] {
  const kept = sessions
    .filter((session) => query.since === undefined || session.updatedAt >= query.since)
    .filter((session) => query.cwd === undefined || (!!session.cwd && isWithin(session.cwd, query.cwd)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return query.limit === undefined ? kept : kept.slice(0, query.limit);
}

/** `state` for a store that only says when a session was last written. */
export function activeIfRecent(updatedAt: number, now = Date.now()): { state?: 'active' } {
  return now - updatedAt < ACTIVE_MS ? { state: 'active' } : {};
}

/** A JSON file's value, or undefined when it is missing or broken. */
export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The user's home directory as `env` has it. */
export function homeOf(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}

/** Epoch milliseconds of an ISO date string. */
export function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : at;
}
