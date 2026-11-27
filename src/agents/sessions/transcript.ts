import { promises as fs } from 'node:fs';
import type { SessionEntry, SessionTurn } from '../session.js';
import type { SessionReadOptions } from './types.js';
import { personText } from '../host-text.js';

// The end of a long transcript is what the next agent needs; the start is left out.
const TAIL_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED = 32 * 1024 * 1024;

/** The JSON lines of the last megabytes of a transcript file. */
export async function transcriptLines(
  file: string,
  options?: Pick<SessionReadOptions, 'onTruncated'>,
): Promise<unknown[]> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= TAIL_BYTES) return parse((await handle.readFile('utf8')).split('\n'));
    const tail = Buffer.alloc(TAIL_BYTES);
    await handle.read(tail, 0, TAIL_BYTES, size - TAIL_BYTES);
    options?.onTruncated?.('tail-bytes');
    // The cut falls inside a line.
    return parse(tail.toString('utf8').split('\n').slice(1));
  } finally {
    await handle.close();
  }
}

/** The content of a zstd file, where this Node can read zstd (22.15 and later) and the file is not huge. */
export async function zstdFile(file: string): Promise<Buffer | undefined> {
  const zlib = (await import('node:zlib')) as {
    zstdDecompress?: (data: Buffer, done: (error: Error | null, out: Buffer) => void) => void;
  };
  const decompress = zlib.zstdDecompress;
  if (!decompress) return undefined;
  const handle = await fs.open(file, 'r');
  let data: Buffer;
  try {
    if ((await handle.stat()).size > MAX_COMPRESSED) return undefined;
    data = await handle.readFile();
  } finally {
    await handle.close();
  }
  return new Promise<Buffer>((resolve, reject) =>
    decompress(data, (error, out) => (error ? reject(error) : resolve(out))),
  );
}

/** The JSON lines at the end of a transcript that is already in memory. */
export function linesOf(data: Buffer, options?: Pick<SessionReadOptions, 'onTruncated'>): unknown[] {
  if (data.length <= TAIL_BYTES) return parse(data.toString('utf8').split('\n'));
  options?.onTruncated?.('tail-bytes');
  return parse(
    data
      .subarray(data.length - TAIL_BYTES)
      .toString('utf8')
      .split('\n')
      .slice(1),
  );
}

function parse(lines: string[]): unknown[] {
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

type ToolEntry = Extract<SessionEntry, { kind: 'tool' }>;

/**
 * Collects what a store's reader finds, in order, into turns the way `createAgentSession` keeps
 * them. What comes before the first prompt (the cut of a long transcript) is left out.
 */
export function transcriptBuilder(agent: string, options: SessionReadOptions = {}) {
  const maxToolOutput = options.maxToolOutput ?? 4_000;
  const turns: SessionTurn[] = [];
  const tools = new Map<string, ToolEntry>();
  let current: SessionTurn | undefined;
  let clock = 0;
  const tick = (at: number | undefined) => {
    if (at !== undefined) clock = at;
    if (current) current.endedAt = clock;
  };
  return {
    prompt(text: string, at?: number, attachments?: SessionTurn['attachments']) {
      if (at !== undefined) clock = at;
      // A briefing genaicode added to the prompt is not what the person said.
      const said = personText(text);
      const prompt = said && said !== text.trim() ? said : text;
      current = { id: turns.length + 1, agent, prompt, entries: [], startedAt: clock, endedAt: clock };
      if (attachments?.length) current.attachments = attachments;
      turns.push(current);
    },
    text(text: string, at?: number) {
      if (!current || !text.trim()) return;
      current.entries.push({ kind: 'text', text, streaming: false });
      tick(at);
    },
    files(paths: string[]) {
      if (paths.length) current?.entries.push({ kind: 'files', paths });
    },
    tool(id: string | undefined, name: string, input: unknown, at?: number) {
      if (!current) return;
      const entry: ToolEntry = { kind: 'tool', ...(id ? { id } : {}), name, input, done: false };
      current.entries.push(entry);
      if (id) tools.set(id, entry);
      tick(at);
    },
    toolResult(id: string | undefined, output: string | undefined, isError?: boolean, at?: number) {
      const entry = id ? tools.get(id) : undefined;
      if (!entry) return;
      if (output !== undefined) {
        entry.output = output.length <= maxToolOutput ? output : `${output.slice(0, maxToolOutput)}\n… (truncated)`;
      }
      if (isError) entry.isError = true;
      entry.done = true;
      tick(at);
    },
    /** The latest `maxTurns` turns, each ended: a session that was read is not running here. */
    turns(): SessionTurn[] {
      const limit = options.maxTurns ?? 100;
      if (turns.length > limit) options.onTruncated?.('max-turns');
      const kept = turns.slice(-limit);
      return kept.map((turn, index) => {
        const last = turn.entries.findLast((entry) => entry.kind === 'text');
        return {
          ...turn,
          id: index + 1,
          entries: turn.entries.map((entry) => (entry.kind === 'tool' ? { ...entry, done: true } : entry)),
          result: {
            status: 'completed',
            ok: true,
            exitCode: null,
            signal: null,
            ...(last?.kind === 'text' ? { text: last.text.trim() } : {}),
          },
        };
      });
    },
  };
}
