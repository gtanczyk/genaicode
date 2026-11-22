import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { zstdFile } from './transcript.js';
import type { SessionInfo } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const count = (value: unknown): number => (typeof value === 'number' && value > 0 ? value : 0);

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

/**
 * The part of a Codex thread's work done at or after `since`, from its rollout: Codex notes the
 * thread's running total with a time after every model call. Input it read again from its cache
 * is left out, or a long thread would outweigh everything by its length alone.
 */
async function codexPart(file: string, since: number): Promise<number | undefined> {
  let total = 0;
  let before = 0;
  let previous = 0;
  const done = await eachLine(file, (text) => {
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
    const fresh = Math.max(0, count(report.input_tokens) - count(report.cached_input_tokens));
    const running = fresh + count(report.output_tokens) || count(report.total_tokens);
    // A counter that starts over (a thread taken up by another process) goes on from where it was.
    total += running >= previous ? running - previous : running;
    previous = running;
    const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
    if (at < since) before = total;
  });
  return done && total > 0 ? (total - before) / total : undefined;
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
 * The part (0 to 1) of each session's work that was done at or after `since`. A session's own
 * figures cover its whole life, so one old, long session touched once in the window would
 * otherwise count as if all of it happened there. Read from the session's file where it keeps
 * times (Codex, Claude Code); elsewhere estimated from how much of its lifetime the window covers.
 */
export async function partsSince(sessions: readonly SessionInfo[], since: number): Promise<Map<SessionInfo, number>> {
  const parts = new Map<SessionInfo, number>();
  const older = sessions.filter((session) => {
    // Started in the window: all of it is there.
    if (session.startedAt !== undefined && session.startedAt >= since) return false;
    return true;
  });
  let next = 0;
  const work = async () => {
    while (next < older.length) {
      const session = older[next++]!;
      let part: number | undefined;
      if (session.path && session.source === 'codex') part = await codexPart(session.path, since);
      else if (session.path && session.source === 'claude') part = await claudePart(session.path, since);
      parts.set(session, part ?? partByTime(session, since));
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  return parts;
}
