import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { homeOf } from './files.js';
import { zstdFile } from './transcript.js';
import type { SessionInfo } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const count = (value: unknown): number => (typeof value === 'number' && value > 0 ? value : 0);

/** What a session did in a period. */
export interface WorkWithin {
  /** The part of its whole life's work, 0 to 1. */
  part: number;
  /** The tokens it used there, where its file counts them: weigh by these, not by `part` of its total. */
  tokens?: number;
}

/** Each line of a session file, or of the `.zst` Codex made of it. Nothing when neither can be read. */
async function eachLine(file: string, take: (line: string) => void): Promise<boolean> {
  try {
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) take(line);
    return true;
  } catch {
    try {
      const data = await zstdFile(`${file}.zst`);
      if (!data) return false;
      for (const line of data.toString('utf8').split('\n')) take(line);
      return true;
    } catch {
      return false;
    }
  }
}

/** Codex's count without the input it read again from its cache. */
function codexWeight(report: Record<string, unknown>): number {
  // Only a report without its parts is counted by its total: all input from cache is no new work.
  if (typeof report.input_tokens !== 'number' && typeof report.output_tokens !== 'number') {
    return count(report.total_tokens);
  }
  return Math.max(0, count(report.input_tokens) - count(report.cached_input_tokens)) + count(report.output_tokens);
}

/** What was read of a Codex rollout so far: Codex only ever adds lines, so the next look goes on from `offset`. */
interface RolloutScan {
  /** Bytes read, up to the end of the last whole line. */
  offset: number;
  /** How the file begins: another file under the same name is read anew. */
  head: string;
  total: number;
  /** The counter's last figure. */
  previous: number;
  reports: number;
  /** The total after each report that added to it, with its time, in the file's order. */
  points: Array<[at: number, total: number]>;
}

const HEAD = 256;
/** A rollout smaller than this is read again every time: keeping its scan saves nothing. */
const KEEP_FROM = 1024 * 1024;
const scans = new Map<string, RolloutScan>();
const freshScan = (head = ''): RolloutScan => ({ offset: 0, head, total: 0, previous: 0, reports: 0, points: [] });
const isScan = (value: unknown): value is RolloutScan =>
  isRecord(value) &&
  [value.offset, value.total, value.previous, value.reports].every((n) => typeof n === 'number' && n >= 0) &&
  typeof value.head === 'string' &&
  Array.isArray(value.points) &&
  value.points.every((point) => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number');

/** Where scans of big rollouts are kept between runs: `~/.genaicode/cache/rollouts`. */
function scanFile(file: string, env: NodeJS.ProcessEnv): string {
  const home = env.GENAICODE_HOME ?? path.join(homeOf(env), '.genaicode');
  return path.join(home, 'cache', 'rollouts', `${createHash('sha256').update(file).digest('hex').slice(0, 32)}.json`);
}

/** One line of a rollout: Codex notes the thread's running total with a time after every model call. */
function takeLine(scan: RolloutScan, text: string): void {
  if (!text.includes('token_count') && !text.includes('token_usage_record')) return;
  let line: unknown;
  try {
    line = JSON.parse(text);
  } catch {
    return;
  }
  if (!isRecord(line) || !isRecord(line.payload)) return;
  const report =
    line.type === 'token_usage_record'
      ? line.payload.thread_token_usage
      : isRecord(line.payload.info)
        ? line.payload.info.total_token_usage
        : undefined;
  if (!isRecord(report)) return;
  scan.reports += 1;
  const running = codexWeight(report);
  // A counter that starts over (a thread taken up by another process) goes on from where it was:
  // it is lower than before, or it equals its own latest call, which only a first call does.
  const call = isRecord(line.payload.info) ? line.payload.info.last_token_usage : undefined;
  // The same figure again is a repeated report, not new work.
  const startsOver =
    running < scan.previous || (running !== scan.previous && isRecord(call) && codexWeight(call) === running);
  scan.total += startsOver ? running : running - scan.previous;
  scan.previous = running;
  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  if (Number.isNaN(at)) return;
  // A report that added nothing says nothing new about where the total stood.
  if (scan.points.at(-1)?.[1] !== scan.total) scan.points.push([at, scan.total]);
}

function workSince(scan: RolloutScan, since: number): WorkWithin | undefined {
  if (scan.reports === 0) return undefined;
  let before = 0;
  for (let i = scan.points.length - 1; i >= 0; i--) {
    if (scan.points[i]![0] < since) {
      before = scan.points[i]![1];
      break;
    }
  }
  // The tokens themselves too: the session's own figure is its latest counter, not this sum.
  // Reports that add up to nothing (all read from cache) are a measured zero, not a missing figure.
  return scan.total > 0
    ? { part: (scan.total - before) / scan.total, tokens: scan.total - before }
    : { part: 0, tokens: 0 };
}

/** A usage report is a short line: a longer one (a tool's output) is passed over unread. */
const MAX_LINE = 1024 * 1024;

/** Read what the rollout gained since `scan`. Returns the scan up to its last whole line, and one with the unfinished line too. */
async function readOn(file: string, scan: RolloutScan): Promise<{ kept: RolloutScan; all: RolloutScan }> {
  // The line so far, in the pieces it came in: joined once, when its end arrives.
  let pieces: Buffer[] = [];
  let length = 0;
  const line = (last?: Buffer): string | undefined => {
    const whole = length + (last?.length ?? 0);
    if (whole > MAX_LINE) return undefined;
    return (pieces.length ? Buffer.concat(last ? [...pieces, last] : pieces, whole) : last!).toString('utf8');
  };
  for await (const chunk of createReadStream(file, { start: scan.offset }) as AsyncIterable<Buffer>) {
    let start = 0;
    let end: number;
    while ((end = chunk.indexOf(10, start)) !== -1) {
      const last = chunk.subarray(start, end);
      const text = line(last);
      if (text !== undefined) takeLine(scan, text);
      scan.offset += length + last.length + 1;
      pieces = [];
      length = 0;
      start = end + 1;
    }
    if (start < chunk.length) {
      // Past the longest line worth reading only its length is kept.
      if (length <= MAX_LINE) pieces.push(chunk.subarray(start));
      length += chunk.length - start;
    }
  }
  const rest = length ? line() : undefined;
  if (rest === undefined) return { kept: scan, all: scan };
  // A last line without its end may still be written: counted now, read again next time.
  const all = { ...scan, points: [...scan.points] };
  takeLine(all, rest);
  return { kept: scan, all };
}

/**
 * The part of a Codex thread's work done at or after `since`, from its rollout. Input it read
 * again from its cache is left out, or a long thread would outweigh everything by its length
 * alone. A long rollout is read once: later looks read only what it gained.
 */
async function codexPart(
  file: string,
  since: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkWithin | undefined> {
  let size: number;
  let head: string;
  try {
    const handle = await fs.open(file, 'r');
    try {
      size = (await handle.stat()).size;
      const start = Buffer.alloc(Math.min(HEAD, size));
      await handle.read(start, 0, start.length, 0);
      head = start.toString('latin1');
    } finally {
      await handle.close();
    }
  } catch {
    // Codex packs an old rollout: read whole, it does not grow.
    const scan = freshScan();
    try {
      const data = await zstdFile(`${file}.zst`);
      if (!data) return undefined;
      for (const line of data.toString('utf8').split('\n')) takeLine(scan, line);
    } catch {
      return undefined;
    }
    return workSince(scan, since);
  }
  let scan = scans.get(file);
  if (!scan && size >= KEEP_FROM) {
    try {
      const saved: unknown = JSON.parse(await fs.readFile(scanFile(file, env), 'utf8'));
      if (isScan(saved)) scan = saved;
    } catch {
      // Nothing kept yet, or not readable: read the rollout from its start.
    }
  }
  // The same file, only longer: its beginning is as it was.
  const same = scan && scan.head !== '' && scan.offset <= size && head.startsWith(scan.head);
  // A copy: two looks at once must not both add to the one kept.
  const from = same ? { ...scan!, points: [...scan!.points] } : freshScan(head);
  const read = from.offset;
  let result: { kept: RolloutScan; all: RolloutScan };
  try {
    result = await readOn(file, from);
  } catch {
    return undefined;
  }
  if (size >= KEEP_FROM) {
    scans.set(file, result.kept);
    if (result.kept.offset - read >= KEEP_FROM) {
      const target = scanFile(file, env);
      try {
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.writeFile(`${target}.tmp`, JSON.stringify(result.kept), { mode: 0o600 });
        await fs.rename(`${target}.tmp`, target);
      } catch {
        // Only a saving: the next look reads the rollout again.
      }
    }
  }
  return workSince(result.all, since);
}

/**
 * The same for a Claude Code transcript: every answer carries its use and its time. Tokens are
 * weighed roughly as they are priced, since the session's whole-life figure is a price.
 */
async function claudePart(file: string, since: number): Promise<number | undefined> {
  let total = 0;
  let within = 0;
  const seen = new Set<string>();
  const done = await eachLine(file, (text) => {
    if (!text.includes('"usage"')) return;
    let line: unknown;
    try {
      line = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(line) || !isRecord(line.message) || !isRecord(line.message.usage)) return;
    // One answer is written as several lines, each repeating its use.
    const id = typeof line.message.id === 'string' ? line.message.id : undefined;
    if (id !== undefined) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    const usage = line.message.usage;
    const weight =
      count(usage.input_tokens) +
      5 * count(usage.output_tokens) +
      1.25 * count(usage.cache_creation_input_tokens) +
      0.1 * count(usage.cache_read_input_tokens);
    total += weight;
    const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
    if (!(at < since)) within += weight;
  });
  return done && total > 0 ? within / total : undefined;
}

/** Where the files cannot say: the part of the session's lifetime that falls in the window. */
function partByTime(session: SessionInfo, since: number): number {
  if (session.startedAt === undefined || session.updatedAt <= session.startedAt) return 1;
  return Math.min(1, Math.max(0, (session.updatedAt - since) / (session.updatedAt - session.startedAt)));
}

/**
 * What each session did at or after `since`: the part (0 to 1) of its work, and the tokens where counted. A session's own
 * figures cover its whole life, so one old, long session touched once in the window would
 * otherwise count as if all of it happened there. Read from the session's file where it keeps
 * times (Codex, Claude Code); elsewhere estimated from how much of its lifetime the window covers.
 * What was read of a long Codex rollout is kept under `~/.genaicode/cache/rollouts` (`options.env` says where home is).
 */
export async function partsSince(
  sessions: readonly SessionInfo[],
  since: number,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<Map<SessionInfo, WorkWithin>> {
  const parts = new Map<SessionInfo, WorkWithin>();
  const older = sessions.filter((session) => {
    // A Codex rollout is read either way: its counter can start over, and the session's own figure is the last one.
    if (session.source === 'codex' && session.path) return true;
    // Started in the window: all of it is there.
    return !(session.startedAt !== undefined && session.startedAt >= since);
  });
  let next = 0;
  const work = async () => {
    while (next < older.length) {
      const session = older[next++]!;
      let within: WorkWithin | undefined;
      if (session.path && session.source === 'codex') within = await codexPart(session.path, since, options.env);
      else if (session.path && session.source === 'claude') {
        const part = await claudePart(session.path, since);
        if (part !== undefined) within = { part };
      }
      parts.set(session, within ?? { part: partByTime(session, since) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  return parts;
}
