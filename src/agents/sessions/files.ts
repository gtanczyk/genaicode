import { stripVTControlCharacters } from 'node:util';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SessionInfo, SessionQuery } from './types.js';
import { personText } from '../host-text.js';

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

const MAX_SCAN_LINE_BYTES = 2 * 1024 * 1024;

/**
 * Scan a JSONL file backwards in chunks for the last line matching `match`. Raw UTF-8 bytes are
 * checked for `marker` before decoding or parsing, and giant single lines without newlines are
 * skipped in O(1) memory.
 */
export async function findLastLineMatch<T>(
  filePath: string,
  size: number,
  marker: string,
  match: (line: string) => { found: true; value: T } | { found: false },
  signal?: AbortSignal,
): Promise<T | undefined> {
  const needle = Buffer.from(marker, 'utf8');
  const handle = await fs.open(filePath, 'r');
  try {
    let end = size;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let pendingOverflow = false;
    const checkLine = (buf: Buffer): { found: true; value: T } | { found: false } => {
      if (!buf.length || !buf.includes(needle)) return { found: false };
      return match(buf.toString('utf8'));
    };
    const flushPendingWith = (prefix: Buffer): { found: true; value: T } | { found: false } => {
      if (pendingOverflow) {
        pending = [];
        pendingBytes = 0;
        pendingOverflow = false;
        return { found: false };
      }
      if (!pending.length) return checkLine(prefix);
      const parts = [prefix, ...pending.reverse()];
      pending = [];
      pendingBytes = 0;
      return checkLine(Buffer.concat(parts));
    };
    while (end > 0) {
      signal?.throwIfAborted();
      const start = Math.max(0, end - CHUNK);
      const length = end - start;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      let cursor = length;
      let nl = buf.lastIndexOf(0x0a, cursor - 1);
      if (nl < 0) {
        if (!pendingOverflow) {
          pendingBytes += length;
          if (pendingBytes > MAX_SCAN_LINE_BYTES) {
            pending = [];
            pendingOverflow = true;
          } else {
            pending.push(buf);
          }
        }
        end = start;
        continue;
      }
      const tailResult = flushPendingWith(buf.subarray(nl + 1, cursor));
      if (tailResult.found) return tailResult.value;
      cursor = nl;
      while (cursor > 0) {
        nl = buf.lastIndexOf(0x0a, cursor - 1);
        if (nl < 0) break;
        const lineResult = checkLine(buf.subarray(nl + 1, cursor));
        if (lineResult.found) return lineResult.value;
        cursor = nl;
      }
      if (cursor > 0) {
        const prefix = buf.subarray(0, cursor);
        if (start === 0) {
          const firstResult = checkLine(prefix);
          if (firstResult.found) return firstResult.value;
        } else {
          pending = [prefix];
          pendingBytes = cursor;
          pendingOverflow = false;
        }
      }
      end = start;
    }
    if (pending.length) {
      const result = flushPendingWith(Buffer.alloc(0));
      if (result.found) return result.value;
    }
    return undefined;
  } finally {
    await handle.close();
  }
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

/** A prompt as a one-line preview: the person's words, without a briefing genaicode added (`personText`). */
export function promptLine(text: string, max = 200): string {
  return oneLine(personText(text), max);
}

/** Keep previews on one terminal-safe line, including the ellipsis in the limit. */
export function previewText(value: string): string {
  // eslint-disable-next-line no-control-regex
  const controls = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g;
  const line = stripVTControlCharacters(value).replace(/\s+/g, ' ').replace(controls, '').trim();
  if (line.length <= 200) return line;
  return `${line.slice(0, 199).replace(/[\ud800-\udbff]$/, '')}…`;
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

/** How many session files a `cachedSessionReader` remembers: more than a busy machine writes in a year. */
const READ_CACHE_FILES = 8192;

/**
 * `read` for a session file, remembered while the file keeps its size and modification time. A
 * listing reads both ends of every file in its window, and a program that lists again and again (the
 * app's sidebar, `sessions --watch`) would otherwise parse the same unchanged megabytes each time.
 * The file is read as if long settled (`now` = Infinity); whether it is active is the clock's
 * business and is put on each copy handed out. Each call gets its own copy to change.
 */
export function cachedSessionReader(
  read: (file: SessionFile, now: number) => Promise<SessionInfo | null>,
  max = READ_CACHE_FILES,
): (file: SessionFile, now?: number) => Promise<SessionInfo | null> {
  const kept = new Map<string, { mtimeMs: number; size: number; info: SessionInfo | null }>();
  return async (file, now = Date.now()) => {
    let entry = kept.get(file.path);
    if (!entry || entry.mtimeMs !== file.mtimeMs || entry.size !== file.size) {
      entry = { mtimeMs: file.mtimeMs, size: file.size, info: await read(file, Infinity) };
    }
    // Most recently used last, so the oldest goes first when there are too many.
    kept.delete(file.path);
    kept.set(file.path, entry);
    if (kept.size > max) kept.delete(kept.keys().next().value as string);
    if (!entry.info) return null;
    const info = { ...entry.info };
    if (now - file.mtimeMs < ACTIVE_MS) info.state = 'active';
    return info;
  };
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
  // A zero time (Go's 0001-01-01, the epoch) says no time was kept.
  return Number.isNaN(at) || at <= 0 ? undefined : at;
}

/**
 * Whether `cwd` is where programs run agents, not people: a temporary directory, or a worktree
 * genaicode made for a delegated task (`.genaicode/worktrees`).
 */
export function isScratchDir(cwd: string | undefined): boolean {
  if (!cwd) return false;
  const place = cwd.replace(/\\/g, '/');
  return (
    /\/\.genaicode\/worktrees(\/|$)/.test(place) ||
    /^(\/private)?\/(tmp|var\/folders|var\/tmp)(\/|$)/.test(place) ||
    /\/AppData\/Local\/Temp(\/|$)/i.test(place)
  );
}

/** Whether `cwd` is a worktree an agent's app keeps for its own tasks (Antigravity, Codex, Claude Code). */
export function isAgentWorktree(cwd: string | undefined): boolean {
  if (!cwd) return false;
  const dir = cwd.replace(/\\/g, '/');
  return ['/.gemini/antigravity/worktrees/', '/.codex/worktrees/', '/.claude/worktrees/'].some((part) =>
    dir.includes(part),
  );
}
