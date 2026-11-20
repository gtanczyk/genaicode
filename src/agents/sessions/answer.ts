import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { liveDir, liveEvent, liveRecord, type LiveAsk } from './live.js';

/**
 * A question an agent's hook holds open (`genaicode hooks install --answer`): the agent asks
 * whether it may use a tool, and the answer can come from the tower (`genaicode sessions approve`,
 * the browser's Sessions view) as well as from the agent's own dialog, whichever is first.
 */
export interface PendingAsk {
  /** What `answerAsk` takes. */
  id: string;
  agent: string;
  /** The agent's session id. */
  session: string;
  cwd?: string;
  tool?: string;
  /** What the tool would do, cut short: the command, the file, the address. */
  preview?: string;
  /** When it was asked, epoch milliseconds. */
  at: number;
  /** The hook process that waits: once it is gone, so is the question. */
  pid: number;
}

export type AskDecision = { behavior: 'allow' } | { behavior: 'deny'; message?: string };

/** Where the open questions are kept: beside the hooks' reports, readable by the user only. */
export function asksDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(liveDir(env)), 'asks');
}

const ID = /^[a-f0-9]{12}$/;
const PREVIEW_MAX = 200;

/** A line or two of what a tool's input would do; nothing when it names nothing plain. */
export function askPreview(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const fields = input as Record<string, unknown>;
  for (const name of ['command', 'file_path', 'path', 'url', 'pattern', 'query', 'prompt']) {
    const value = fields[name];
    if (typeof value === 'string' && value.trim()) {
      const plain = value.replace(/\s+/g, ' ').trim();
      return plain.length > PREVIEW_MAX ? `${plain.slice(0, PREVIEW_MAX - 1)}…` : plain;
    }
  }
  return undefined;
}

async function writePrivate(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Not ours to signal, but there.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseAsk(value: unknown): PendingAsk | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const ask = value as Partial<PendingAsk>;
  if (typeof ask.id !== 'string' || !ID.test(ask.id)) return undefined;
  if (typeof ask.agent !== 'string' || typeof ask.session !== 'string') return undefined;
  if (typeof ask.at !== 'number' || typeof ask.pid !== 'number') return undefined;
  return {
    id: ask.id,
    agent: ask.agent,
    session: ask.session,
    ...(typeof ask.cwd === 'string' ? { cwd: ask.cwd } : {}),
    ...(typeof ask.tool === 'string' ? { tool: ask.tool } : {}),
    ...(typeof ask.preview === 'string' ? { preview: ask.preview } : {}),
    at: ask.at,
    pid: ask.pid,
  };
}

/** The questions waiting for an answer, oldest first. Ones whose hook is gone are removed. */
export async function pendingAsks(env: NodeJS.ProcessEnv = process.env): Promise<PendingAsk[]> {
  const dir = asksDir(env);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const asks = await Promise.all(
    names
      .filter((name) => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
      .map(async (name) => {
        const file = path.join(dir, name);
        const ask = await fs
          .readFile(file, 'utf8')
          .then((source) => parseAsk(JSON.parse(source)))
          .catch(() => undefined);
        if (ask && alive(ask.pid)) return ask;
        // Killed before it could clean up: the agent took the answer itself.
        if (ask) await Promise.all([fs.rm(file, { force: true }), fs.rm(answerFile(dir, ask.id), { force: true })]);
        return undefined;
      }),
  );
  return asks.filter((ask): ask is PendingAsk => !!ask).sort((a, b) => a.at - b.at);
}

const answerFile = (dir: string, id: string) => path.join(dir, `${id}.answer`);

/**
 * Answer an open question. Resolves to false when there is no such question (any more): it was
 * answered already, in the agent or here, or its hook gave up waiting.
 */
export async function answerAsk(
  id: string,
  decision: AskDecision,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!ID.test(id)) return false;
  const dir = asksDir(env);
  const ask = (await pendingAsks(env)).find((pending) => pending.id === id);
  if (!ask) return false;
  const message = decision.behavior === 'deny' ? decision.message?.trim().slice(0, 500) : undefined;
  // Only the first answer counts, and it shows whole: written aside, then linked in, which fails
  // when an answer is there already.
  const temporary = path.join(dir, `${id}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  await fs.writeFile(
    temporary,
    `${JSON.stringify({ behavior: decision.behavior, ...(message ? { message } : {}) })}\n`,
    { mode: 0o600 },
  );
  try {
    await fs.link(temporary, answerFile(dir, id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return true;
}

export interface WaitOptions {
  env?: NodeJS.ProcessEnv;
  /** How long to hold the question open. Default 9 minutes, under the hook's own 10. */
  timeoutMs?: number;
  /** How often to look for an answer. Default 300 ms. */
  pollMs?: number;
  /** Stops waiting: the agent took the answer itself and ends the hook. */
  signal?: AbortSignal;
  now?(): number;
}

/**
 * Hold a `PermissionRequest` hook's question open for the tower and wait. Resolves to the
 * decision given there, or undefined when the question was answered in the agent, its session
 * moved on, or the time ran out: the agent's own dialog then decides, as without the hook.
 */
export async function waitForAnswer(
  agent: string,
  input: unknown,
  options: WaitOptions = {},
): Promise<AskDecision | undefined> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const event = liveEvent(input);
  if (!event || event.state !== 'approval' || !event.ask?.tool) return undefined;
  const own: LiveAsk = event.ask;
  const fields = input as Record<string, unknown>;
  const dir = asksDir(env);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const id = randomBytes(6).toString('hex');
  const file = path.join(dir, `${id}.json`);
  const at = now();
  const preview = askPreview(fields.tool_input);
  const ask: PendingAsk = {
    id,
    agent,
    session: event.id,
    ...(event.cwd ? { cwd: event.cwd } : {}),
    tool: own.tool!,
    ...(preview ? { preview } : {}),
    at,
    pid: process.pid,
  };
  await writePrivate(file, ask);
  const timeoutMs = options.timeoutMs ?? 9 * 60_000;
  const pollMs = options.pollMs ?? 300;
  const same = (other: LiveAsk) => other.tool === own.tool && other.key === own.key;
  let asked = false;
  try {
    while (!options.signal?.aborted && now() - at < timeoutMs) {
      // An answer that does not read whole yet is looked at again.
      const answer = await fs
        .readFile(answerFile(dir, id), 'utf8')
        .then((source) => JSON.parse(source) as AskDecision)
        .catch(() => undefined);
      if (answer?.behavior === 'allow') return { behavior: 'allow' };
      if (answer?.behavior === 'deny') return answer.message ? answer : { behavior: 'deny' };
      // What the agent's other hooks report: the question answered in its own dialog, a new turn.
      const record = await liveRecord(agent, event.id, env);
      if (record) {
        const fresh = Math.max(record.at, record.seen ?? 0) >= at;
        if ((record.state === 'idle' || record.state === 'ended') && record.at >= at) return undefined;
        if ((record.turn ?? 0) > at) return undefined;
        if ((record.done ?? []).some((done) => same(done) && done.at >= at)) return undefined;
        const asking = record.state === 'approval' && (record.asks ?? []).some(same);
        if (asking) asked = true;
        else if (asked && fresh) return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return undefined;
  } finally {
    await Promise.all([fs.rm(file, { force: true }), fs.rm(answerFile(dir, id), { force: true })]);
  }
}
