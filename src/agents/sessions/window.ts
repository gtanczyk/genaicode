import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import type { TokenUsage } from '../../core/types.js';
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

interface ScanBase {
  /** Bytes read, up to the end of the last whole line. */
  offset: number;
  /** How the file begins: another file under the same name is read anew. */
  head: string;
  total: number;
  reports: number;
  /** The total after each report that added to it, with its time, in the file's order. */
  points: Array<[at: number, total: number]>;
}

/** What was read of a Codex rollout so far: Codex only ever adds lines, so the next look goes on from `offset`. */
interface RolloutScan extends ScanBase {
  /** The counter's last figure. */
  previous: number;
}

/** Bumped when Antigravity scan semantics change (v2: oversized >1 MiB records are scanned). */
const ANTIGRAVITY_SCAN_VERSION = 2;

/** What was read of an Antigravity `transcript.jsonl` so far: each model step adds its own tokens. */
interface AntigravityScan extends ScanBase {
  version: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

const HEAD = 256;
/** A rollout smaller than this is read again every time: keeping its scan on disk saves nothing. */
const KEEP_FROM = 1024 * 1024;
/** Cap on small files kept in memory for Antigravity scans. */
const MAX_MEMORY_SCANS = 512;
const scans = new Map<string, RolloutScan>();
const antigravityScans = new Map<string, AntigravityScan>();
const freshScan = (head = ''): RolloutScan => ({ offset: 0, head, total: 0, previous: 0, reports: 0, points: [] });
const freshAntigravityScan = (head = ''): AntigravityScan => ({
  version: ANTIGRAVITY_SCAN_VERSION,
  offset: 0,
  head,
  total: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reports: 0,
  points: [],
});
const isPoints = (value: unknown): value is Array<[number, number]> =>
  Array.isArray(value) &&
  value.every((point) => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number');
const isScan = (value: unknown): value is RolloutScan =>
  isRecord(value) &&
  [value.offset, value.total, value.previous, value.reports].every((n) => typeof n === 'number' && n >= 0) &&
  typeof value.head === 'string' &&
  isPoints(value.points);
const isAntigravityScan = (value: unknown): value is AntigravityScan =>
  isRecord(value) &&
  value.version === ANTIGRAVITY_SCAN_VERSION &&
  [value.offset, value.total, value.inputTokens, value.outputTokens, value.cachedInputTokens, value.reports].every(
    (n) => typeof n === 'number' && n >= 0,
  ) &&
  typeof value.head === 'string' &&
  isPoints(value.points);

/** Where scans of big transcripts are kept between runs: `~/.genaicode/cache/<bucket>`. */
function scanFile(file: string, env: NodeJS.ProcessEnv, bucket = 'rollouts'): string {
  const home = env.GENAICODE_HOME ?? path.join(homeOf(env), '.genaicode');
  return path.join(home, 'cache', bucket, `${createHash('sha256').update(file).digest('hex').slice(0, 32)}.json`);
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

function recordAntigravityUsage(
  scan: AntigravityScan,
  usage: { inputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; createdAt?: unknown },
): void {
  if (typeof usage.inputTokens !== 'number' && typeof usage.outputTokens !== 'number') return;
  scan.reports += 1;
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  const cached = count(usage.cacheReadTokens);
  scan.inputTokens += input;
  scan.outputTokens += output;
  scan.cachedInputTokens += cached;
  scan.total = scan.inputTokens + scan.outputTokens;
  const at = typeof usage.createdAt === 'string' ? Date.parse(usage.createdAt) : NaN;
  if (Number.isNaN(at)) return;
  if (scan.points.at(-1)?.[1] !== scan.total) scan.points.push([at, scan.total]);
}

/**
 * One line of an Antigravity `transcript.jsonl`: each `PLANNER_RESPONSE` (and `CHECKPOINT`) notes
 * that call's non-cached input, cached input and output tokens with `created_at`. Cached input is
 * kept for display but left out of `total`, or a long thread would weigh by its length alone.
 */
function takeAntigravityLine(scan: AntigravityScan, text: string): void {
  if (!text.includes('"input_tokens"') && !text.includes('"output_tokens"') && !text.includes('\\u')) return;
  let line: unknown;
  try {
    line = JSON.parse(text);
  } catch {
    return;
  }
  if (!isRecord(line)) return;
  recordAntigravityUsage(scan, {
    inputTokens: line.input_tokens,
    outputTokens: line.output_tokens,
    cacheReadTokens: line.cache_read_tokens,
    createdAt: line.created_at,
  });
}

/**
 * Streaming RFC-8259 JSON validator & top-level extractor for oversized (> 1 MiB) Antigravity
 * transcript lines. Validates the full JSON syntax at every nesting depth in O(1) memory (bounded
 * nesting stack + bounded key/timestamp buffers) while retaining only the four scalar top-level
 * fields (`input_tokens`, `output_tokens`, `cache_read_tokens`, `created_at`).
 */
type ExtractorState =
  | 'start'
  | 'obj-key-or-end'
  | 'obj-key'
  | 'obj-colon'
  | 'value'
  | 'obj-comma-or-end'
  | 'arr-val-or-end'
  | 'arr-comma-or-end'
  | 'done';
type NumState = 'sign' | 'zero' | 'int' | 'fracDot' | 'frac' | 'expSign' | 'expDigit' | 'exp';
type TrackedKey = 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'created_at';

const isJsonWs = (code: number) => code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;
const isDigit = (code: number) => code >= 0x30 && code <= 0x39;
const isHex = (code: number) =>
  (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);

class OversizedAntigravityExtractor {
  private readonly decoder = new StringDecoder('utf8');
  private readonly stack: Array<'{' | '['> = [];
  private state: ExtractorState = 'start';
  private invalid = false;

  private inString = false;
  private strPurpose: 'key' | 'val' | 'skip' = 'skip';
  private strEsc = false;
  private strUHex = 0;
  private strBuf = '';
  private strOverflow = false;

  private numState: NumState | undefined;
  private numCapture = false;
  private numBuf = '';
  private numOverflow = false;

  private litTarget: 'true' | 'false' | 'null' | undefined;
  private litPos = 0;

  private activeKey: TrackedKey | undefined;
  private inputTokens: number | undefined;
  private outputTokens: number | undefined;
  private cacheReadTokens: number | undefined;
  private createdAt: string | undefined;

  private assignActiveKey(value: number | string | undefined): void {
    if (this.activeKey === 'input_tokens') this.inputTokens = typeof value === 'number' ? value : undefined;
    else if (this.activeKey === 'output_tokens') this.outputTokens = typeof value === 'number' ? value : undefined;
    else if (this.activeKey === 'cache_read_tokens')
      this.cacheReadTokens = typeof value === 'number' ? value : undefined;
    else if (this.activeKey === 'created_at') this.createdAt = typeof value === 'string' ? value : undefined;
    this.activeKey = undefined;
  }

  private afterValue(): void {
    if (this.stack.length === 0) {
      this.state = 'done';
    } else {
      this.state = this.stack[this.stack.length - 1] === '{' ? 'obj-comma-or-end' : 'arr-comma-or-end';
    }
  }

  private finishNumber(): boolean {
    const end = this.numState;
    this.numState = undefined;
    if (end !== 'zero' && end !== 'int' && end !== 'frac' && end !== 'exp') {
      this.invalid = true;
      return false;
    }
    if (this.numCapture) {
      if (this.numOverflow) {
        this.assignActiveKey(undefined);
      } else {
        const n = Number(this.numBuf);
        this.assignActiveKey(Number.isFinite(n) ? n : undefined);
      }
    }
    this.numCapture = false;
    this.numBuf = '';
    this.numOverflow = false;
    this.afterValue();
    return true;
  }

  private feedText(text: string): void {
    for (let i = 0; i < text.length; i++) {
      if (this.invalid) return;
      const ch = text[i]!;
      const code = ch.charCodeAt(0);

      if (this.inString) {
        const capture = this.strPurpose !== 'skip' && !this.strOverflow;
        const cap = this.strPurpose === 'key' ? 256 : 512;
        if (this.strUHex > 0) {
          if (!isHex(code)) {
            this.invalid = true;
            return;
          }
          this.strUHex -= 1;
          if (capture) {
            if (this.strBuf.length < cap) this.strBuf += ch;
            else this.strOverflow = true;
          }
          continue;
        }
        if (this.strEsc) {
          this.strEsc = false;
          if (
            ch !== '"' &&
            ch !== '\\' &&
            ch !== '/' &&
            ch !== 'b' &&
            ch !== 'f' &&
            ch !== 'n' &&
            ch !== 'r' &&
            ch !== 't' &&
            ch !== 'u'
          ) {
            this.invalid = true;
            return;
          }
          if (ch === 'u') this.strUHex = 4;
          if (capture) {
            if (this.strBuf.length < cap) this.strBuf += ch;
            else this.strOverflow = true;
          }
          continue;
        }
        if (ch === '\\') {
          this.strEsc = true;
          if (capture) {
            if (this.strBuf.length < cap) this.strBuf += ch;
            else this.strOverflow = true;
          }
          continue;
        }
        if (ch === '"') {
          this.inString = false;
          if (this.strPurpose === 'key') {
            let key: unknown;
            if (!this.strOverflow) {
              try {
                key = JSON.parse(`"${this.strBuf}"`);
              } catch {
                this.invalid = true;
                return;
              }
            }
            this.activeKey =
              key === 'input_tokens' || key === 'output_tokens' || key === 'cache_read_tokens' || key === 'created_at'
                ? key
                : undefined;
            this.state = 'obj-colon';
          } else if (this.strPurpose === 'val') {
            if (this.strOverflow) {
              this.assignActiveKey(undefined);
            } else {
              let decoded: unknown;
              try {
                decoded = JSON.parse(`"${this.strBuf}"`);
              } catch {
                this.invalid = true;
                return;
              }
              this.assignActiveKey(typeof decoded === 'string' && decoded.length <= 64 ? decoded : undefined);
            }
            this.afterValue();
          } else {
            if (this.state === 'obj-key' || this.state === 'obj-key-or-end') {
              this.state = 'obj-colon';
            } else {
              if (this.stack.length === 1 && this.activeKey) this.assignActiveKey(undefined);
              this.afterValue();
            }
          }
          this.strPurpose = 'skip';
          this.strBuf = '';
          this.strOverflow = false;
          continue;
        }
        if (code < 0x20) {
          this.invalid = true;
          return;
        }
        if (capture) {
          if (this.strBuf.length < cap) this.strBuf += ch;
          else this.strOverflow = true;
        }
        continue;
      }

      if (this.litTarget !== undefined) {
        if (ch !== this.litTarget[this.litPos]) {
          this.invalid = true;
          return;
        }
        this.litPos += 1;
        if (this.litPos === this.litTarget.length) {
          this.litTarget = undefined;
          this.litPos = 0;
          if (this.stack.length === 1 && this.activeKey) this.assignActiveKey(undefined);
          this.afterValue();
        }
        continue;
      }

      if (this.numState !== undefined) {
        let consumed = true;
        if (this.numState === 'sign') {
          if (code === 0x30) this.numState = 'zero';
          else if (code >= 0x31 && code <= 0x39) this.numState = 'int';
          else {
            this.invalid = true;
            return;
          }
        } else if (this.numState === 'zero') {
          if (ch === '.') this.numState = 'fracDot';
          else if (ch === 'e' || ch === 'E') this.numState = 'expSign';
          else consumed = false;
        } else if (this.numState === 'int') {
          if (isDigit(code)) {
            // stay in 'int'
          } else if (ch === '.') this.numState = 'fracDot';
          else if (ch === 'e' || ch === 'E') this.numState = 'expSign';
          else consumed = false;
        } else if (this.numState === 'fracDot') {
          if (isDigit(code)) this.numState = 'frac';
          else {
            this.invalid = true;
            return;
          }
        } else if (this.numState === 'frac') {
          if (isDigit(code)) {
            // stay in 'frac'
          } else if (ch === 'e' || ch === 'E') this.numState = 'expSign';
          else consumed = false;
        } else if (this.numState === 'expSign') {
          if (ch === '+' || ch === '-') this.numState = 'expDigit';
          else if (isDigit(code)) this.numState = 'exp';
          else {
            this.invalid = true;
            return;
          }
        } else if (this.numState === 'expDigit') {
          if (isDigit(code)) this.numState = 'exp';
          else {
            this.invalid = true;
            return;
          }
        } else if (this.numState === 'exp') {
          if (isDigit(code)) {
            // stay in 'exp'
          } else consumed = false;
        }
        if (consumed) {
          if (this.numCapture && !this.numOverflow) {
            if (this.numBuf.length < 64) this.numBuf += ch;
            else this.numOverflow = true;
          }
          continue;
        }
        if (!this.finishNumber()) return;
        i -= 1;
        continue;
      }

      if (isJsonWs(code)) continue;

      switch (this.state) {
        case 'start':
          if (ch !== '{') {
            this.invalid = true;
            return;
          }
          this.stack.push('{');
          this.state = 'obj-key-or-end';
          break;
        case 'obj-key-or-end':
          if (ch === '}') {
            this.stack.pop();
            this.afterValue();
            break;
          }
          if (ch !== '"') {
            this.invalid = true;
            return;
          }
          this.inString = true;
          this.strPurpose = this.stack.length === 1 ? 'key' : 'skip';
          this.strBuf = '';
          this.strOverflow = false;
          break;
        case 'obj-key':
          if (ch !== '"') {
            this.invalid = true;
            return;
          }
          this.inString = true;
          this.strPurpose = this.stack.length === 1 ? 'key' : 'skip';
          this.strBuf = '';
          this.strOverflow = false;
          break;
        case 'obj-colon':
          if (ch !== ':') {
            this.invalid = true;
            return;
          }
          this.state = 'value';
          break;
        case 'arr-val-or-end':
          if (ch === ']') {
            this.stack.pop();
            this.afterValue();
            break;
          }
          this.state = 'value';
          i -= 1;
          break;
        case 'value': {
          const atTop = this.stack.length === 1;
          if (ch === '"') {
            this.inString = true;
            this.strPurpose = atTop && this.activeKey === 'created_at' ? 'val' : 'skip';
            this.strBuf = '';
            this.strOverflow = false;
          } else if (ch === '{' || ch === '[') {
            if (this.stack.length >= 4096) {
              this.invalid = true;
              return;
            }
            if (atTop && this.activeKey) this.assignActiveKey(undefined);
            this.stack.push(ch);
            this.state = ch === '{' ? 'obj-key-or-end' : 'arr-val-or-end';
          } else if (ch === '-' || isDigit(code)) {
            this.numState = ch === '-' ? 'sign' : ch === '0' ? 'zero' : 'int';
            this.numCapture = atTop && this.activeKey !== undefined;
            this.numBuf = this.numCapture ? ch : '';
            this.numOverflow = false;
          } else if (ch === 't') {
            this.litTarget = 'true';
            this.litPos = 1;
          } else if (ch === 'f') {
            this.litTarget = 'false';
            this.litPos = 1;
          } else if (ch === 'n') {
            this.litTarget = 'null';
            this.litPos = 1;
          } else {
            this.invalid = true;
            return;
          }
          break;
        }
        case 'obj-comma-or-end':
          if (ch === ',') {
            this.state = 'obj-key';
          } else if (ch === '}') {
            this.stack.pop();
            this.afterValue();
          } else {
            this.invalid = true;
            return;
          }
          break;
        case 'arr-comma-or-end':
          if (ch === ',') {
            this.state = 'value';
          } else if (ch === ']') {
            this.stack.pop();
            this.afterValue();
          } else {
            this.invalid = true;
            return;
          }
          break;
        case 'done':
          this.invalid = true;
          return;
      }
    }
  }

  feed(chunk: Buffer): void {
    if (this.invalid) return;
    const text = this.decoder.write(chunk);
    if (text) this.feedText(text);
  }

  finish(scan: AntigravityScan): void {
    if (!this.invalid) {
      const tail = this.decoder.end();
      if (tail) this.feedText(tail);
    }
    if (
      this.invalid ||
      this.inString ||
      this.numState !== undefined ||
      this.litTarget !== undefined ||
      this.state !== 'done'
    ) {
      return;
    }
    recordAntigravityUsage(scan, {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      createdAt: this.createdAt,
    });
  }
}

interface OversizedLineReader<S extends ScanBase> {
  feed(chunk: Buffer): void;
  finish(scan: S): void;
}

function workSince(scan: ScanBase, since: number): WorkWithin | undefined {
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

/** A usage report is a short line: a longer one (a tool's output) is passed over unread unless `onOversized` handles it. */
const MAX_LINE = 1024 * 1024;

/** Read what a JSONL transcript gained since `scan`. Returns the scan up to its last whole line, and one with the unfinished line too. */
async function readOn<S extends ScanBase>(
  file: string,
  scan: S,
  take: (scan: S, text: string) => void,
  onOversized?: () => OversizedLineReader<S>,
): Promise<{ kept: S; all: S }> {
  // The line so far, in the pieces it came in: joined once, when its end arrives.
  let pieces: Buffer[] = [];
  let length = 0;
  let oversized: OversizedLineReader<S> | undefined;
  const promoteOversized = (extra?: Buffer): OversizedLineReader<S> | undefined => {
    if (!onOversized) return undefined;
    const reader = (oversized ??= onOversized());
    for (const piece of pieces) reader.feed(piece);
    pieces = [];
    if (extra?.length) reader.feed(extra);
    return reader;
  };
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
      if (oversized) {
        if (last.length) oversized.feed(last);
        oversized.finish(scan);
      } else if (length + last.length > MAX_LINE) {
        promoteOversized(last)?.finish(scan);
      } else {
        const text = line(last);
        if (text !== undefined) take(scan, text);
      }
      scan.offset += length + last.length + 1;
      pieces = [];
      length = 0;
      oversized = undefined;
      start = end + 1;
    }
    if (start < chunk.length) {
      const tail = chunk.subarray(start);
      if (oversized) {
        oversized.feed(tail);
      } else if (length + tail.length > MAX_LINE) {
        if (onOversized) promoteOversized(tail);
        else pieces = [];
      } else {
        pieces.push(tail);
      }
      length += tail.length;
    }
  }
  if (!length) return { kept: scan, all: scan };
  if (oversized) {
    const all: S = { ...scan, points: [...scan.points] };
    oversized.finish(all);
    return { kept: scan, all };
  }
  const rest = line();
  if (rest === undefined) return { kept: scan, all: scan };
  // A last line without its end may still be written: counted now, read again next time.
  const all: S = { ...scan, points: [...scan.points] };
  take(all, rest);
  return { kept: scan, all };
}

async function saveScan(target: string, scan: ScanBase): Promise<void> {
  try {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(`${target}.tmp`, JSON.stringify(scan), { mode: 0o600 });
    await fs.rename(`${target}.tmp`, target);
  } catch {
    // Only a saving: the next look reads the file again.
  }
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
  if (same && from.offset === size) {
    result = { kept: from, all: from };
  } else {
    try {
      result = await readOn(file, from, takeLine);
    } catch {
      return undefined;
    }
  }
  if (size >= KEEP_FROM) {
    scans.set(file, result.kept);
    if (result.kept.offset - read >= KEEP_FROM) {
      await saveScan(scanFile(file, env), result.kept);
    }
  }
  return workSince(result.all, since);
}

/**
 * Scan an Antigravity `transcript.jsonl` for per-step token counts, reading only what the file
 * gained since the last look. Long transcripts keep their scan under `~/.genaicode/cache/antigravity`.
 */
async function scanAntigravity(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AntigravityScan | undefined> {
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
    return undefined;
  }
  let scan = antigravityScans.get(file);
  if (!scan && size >= KEEP_FROM) {
    try {
      const saved: unknown = JSON.parse(await fs.readFile(scanFile(file, env, 'antigravity'), 'utf8'));
      if (isAntigravityScan(saved)) scan = saved;
    } catch {
      // Nothing kept yet, or not readable: read the transcript from its start.
    }
  }
  const same = scan && scan.head !== '' && scan.offset <= size && head.startsWith(scan.head);
  const from = same ? { ...scan!, points: [...scan!.points] } : freshAntigravityScan(head);
  const read = from.offset;
  let result: { kept: AntigravityScan; all: AntigravityScan };
  if (same && from.offset === size) {
    result = { kept: from, all: from };
  } else {
    try {
      result = await readOn(file, from, takeAntigravityLine, () => new OversizedAntigravityExtractor());
    } catch {
      return undefined;
    }
  }
  if (antigravityScans.size >= MAX_MEMORY_SCANS && !antigravityScans.has(file)) {
    const oldest = antigravityScans.keys().next().value;
    if (oldest !== undefined) antigravityScans.delete(oldest);
  }
  antigravityScans.set(file, result.kept);
  if (size >= KEEP_FROM && result.kept.offset - read >= KEEP_FROM) {
    await saveScan(scanFile(file, env, 'antigravity'), result.kept);
  }
  return result.all;
}

/** Whole-session token usage read from an Antigravity `transcript.jsonl`, or undefined when none is recorded. */
export async function antigravityUsage(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TokenUsage | undefined> {
  const scan = await scanAntigravity(file, env);
  if (!scan || scan.reports === 0) return undefined;
  if (scan.inputTokens === 0 && scan.outputTokens === 0 && scan.cachedInputTokens === 0) return undefined;
  return {
    inputTokens: scan.inputTokens,
    outputTokens: scan.outputTokens,
    ...(scan.cachedInputTokens > 0 ? { cachedInputTokens: scan.cachedInputTokens } : {}),
  };
}

async function antigravityPart(
  file: string,
  since: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkWithin | undefined> {
  const scan = await scanAntigravity(file, env);
  return scan ? workSince(scan, since) : undefined;
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
 * times (Codex, Claude Code, Antigravity); elsewhere estimated from how much of its lifetime the window covers.
 * What was read of a long rollout or transcript is kept under `~/.genaicode/cache` (`options.env` says where home is).
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
    // Antigravity's index carries no token totals: read its transcript for the period's work.
    if (session.source === 'antigravity' && session.path) return true;
    // Started in the window: all of it is there.
    return !(session.startedAt !== undefined && session.startedAt >= since);
  });
  let next = 0;
  const work = async () => {
    while (next < older.length) {
      const session = older[next++]!;
      let within: WorkWithin | undefined;
      if (session.path && session.source === 'codex') within = await codexPart(session.path, since, options.env);
      else if (session.path && session.source === 'antigravity')
        within = await antigravityPart(session.path, since, options.env);
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
