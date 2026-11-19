import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SessionInfo } from './types.js';

/**
 * What an agent's own hooks last said about a session: it is working, it stopped to ask whether it
 * may use a tool, or it finished its turn.
 */
export type LiveState = 'working' | 'approval' | 'idle';

export interface LiveRecord {
  /** The session source the record is for (`claude`, `codex`). */
  agent: string;
  /** The agent's own session id. */
  id: string;
  state: LiveState;
  /** When the hook that set `state` ran, epoch milliseconds. */
  at: number;
  /** When the latest hook of the session ran, where that is later than `at`. */
  seen?: number;
  cwd?: string;
  /** The tool the agent asks to use, while `state` is `approval`: the first of `asks`. */
  tool?: string;
  /** The questions not answered yet, while `state` is `approval`. */
  asks?: LiveAsk[];
  /** Tool calls seen finishing in this turn, the latest ones: a question about one of them is over. */
  done?: Array<LiveAsk & { at: number }>;
  /** When the turn began or ended last: a question from before it belongs to a finished turn. */
  turn?: number;
}

/** One "may I use this tool?": the tool's name and a digest of its input, to tell which one was answered. */
export interface LiveAsk {
  tool?: string;
  key?: string;
}

/** A record older than this says nothing any more. */
const KEEP_MS = 7 * 24 * 3600_000;
/** How long the note that a session ended is kept. */
const ENDED_MS = 3600_000;
/** A session "working" this long with nothing written is taken for one that died. */
const WORKING_MS = 30 * 60_000;
/** The agent's file can be written a little after its hook ran. */
const LAG_MS = 60_000;
/** A working agent's file is written to between hooks, but not for this long with none running. */
const UNSEEN_MS = 10 * 60_000;
/** More questions than this at once are not kept apart. */
const MAX_ASKS = 20;

/** Where the records are kept: one small file per session under `~/.genaicode/live`. */
export function liveDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.GENAICODE_HOME ?? path.join(env.HOME ?? env.USERPROFILE ?? homedir(), '.genaicode'), 'live');
}

function fileOf(dir: string, agent: string, id: string): string {
  // Ids are the agents' own text: only plain ones become a file name as they are.
  let plain = id.length > 0 && id.length <= 80;
  for (const char of id) {
    const code = char.charCodeAt(0);
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!letter && !(code >= 48 && code <= 57) && char !== '-' && char !== '_') plain = false;
  }
  const name = plain ? id : createHash('sha256').update(id).digest('hex').slice(0, 32);
  return path.join(dir, `${agent}-${name}.json`);
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** Notifications of Claude Code that mean it waits for the user to decide something. */
const ASKING = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

/**
 * What a hook's input (the JSON object Claude Code and Codex give a command hook on stdin) says
 * about its session. Undefined for an event that changes nothing.
 */
export function liveEvent(input: unknown): LiveEvent | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const event = input as Record<string, unknown>;
  const id = text(event.session_id);
  if (!id) return undefined;
  const cwd = text(event.cwd);
  const base = { id, ...(cwd ? { cwd } : {}) };
  const tool = text(event.tool_name);
  const ask: LiveAsk = { ...(tool ? { tool } : {}), ...(tool ? { key: inputKey(event.tool_input) } : {}) };
  switch (event.hook_event_name) {
    case 'SessionStart':
      // After a compaction the agent goes on working.
      return event.source === 'compact' ? undefined : { ...base, state: 'idle' };
    case 'UserPromptSubmit':
      return { ...base, state: 'working' };
    case 'PermissionRequest':
      return { ...base, state: 'approval', ask };
    case 'Notification': {
      const type = text(event.notification_type);
      if (type === 'idle_prompt') return { ...base, state: 'idle' };
      // It names no tool: the question it is about may already be known from `PermissionRequest`.
      return type && ASKING.has(type) ? { ...base, state: 'approval', ask: {}, reminder: true } : undefined;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied':
      // The tool ran or was refused: its question, if there was one, is answered.
      return { ...base, state: 'working', answered: ask };
    case 'Stop':
    case 'StopFailure':
    case 'Interrupt':
      return { ...base, state: 'idle' };
    case 'SessionEnd':
      return { ...base, state: 'ended' };
    default:
      return undefined;
  }
}

export interface LiveEvent {
  id: string;
  state: LiveState | 'ended';
  cwd?: string;
  /** `approval`: the question asked. */
  ask?: LiveAsk;
  /** `approval`: a reminder of a question, which adds none when one is known. */
  reminder?: boolean;
  /** A tool finished: the question about it, when there was one, is answered. Changes nothing else. */
  answered?: LiveAsk;
}

/** A digest of a tool's input: enough to tell two calls apart, nothing of what they hold. */
function inputKey(input: unknown): string {
  let value = input;
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    // Codex adds a reason for the approval that the finished call does not carry.
    const rest = { ...(input as Record<string, unknown>) };
    delete rest.description;
    value = rest;
  }
  return createHash('sha256')
    .update(JSON.stringify(value) ?? '')
    .digest('hex')
    .slice(0, 16);
}

/**
 * `asks` without the one a finished tool answers: the same call, or failing that a question that
 * named no tool. A call another hook rewrote on approval no longer matches, so its question stays
 * until the turn ends: better that than hiding the question of another call of the same tool.
 */
function answer(asks: readonly LiveAsk[], done: LiveAsk, exact = false): LiveAsk[] {
  let at = asks.findIndex((ask) => ask.tool === done.tool && ask.key === done.key);
  if (at < 0 && !exact) at = asks.findIndex((ask) => ask.tool === undefined);
  return at < 0 ? [...asks] : [...asks.slice(0, at), ...asks.slice(at + 1)];
}

/** A record as kept: also `ended`, which only says from when on earlier hooks no longer count. */
type Kept = Omit<LiveRecord, 'state'> & { state: LiveState | 'ended' };

async function readRecord(file: string): Promise<Kept | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<Kept> | null;
    if (!value || typeof value.agent !== 'string' || typeof value.id !== 'string') return undefined;
    if (typeof value.at !== 'number') return undefined;
    if (value.seen !== undefined && typeof value.seen !== 'number') return undefined;
    if (value.asks !== undefined && !Array.isArray(value.asks)) return undefined;
    if (value.done !== undefined && !Array.isArray(value.done)) return undefined;
    if (value.turn !== undefined && typeof value.turn !== 'number') return undefined;
    const states: unknown[] = ['working', 'approval', 'idle', 'ended'];
    if (!states.includes(value.state)) return undefined;
    return value as Kept;
  } catch {
    return undefined;
  }
}

/**
 * Note what a hook of `agent` reported. Resolves to the record now kept, or undefined when the
 * event changed nothing (or ended the session, which drops its record).
 */
export async function recordHook(
  agent: string,
  input: unknown,
  options: {
    env?: NodeJS.ProcessEnv;
    now?: number;
    /** Told what the record was and what it is now, once it is written (`genaicode notify`). */
    onRecord?(before: LiveRecord | undefined, after: LiveRecord): void;
  } = {},
): Promise<LiveRecord | undefined> {
  const event = liveEvent(input);
  if (!event) return undefined;
  const dir = liveDir(options.env);
  const file = fileOf(dir, agent, event.id);
  const at = options.now ?? Date.now();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Hooks run side by side, each in its own process: one at a time reads, decides and writes.
  const release = await lock(`${file}.lock`);
  try {
    const before = await readRecord(file);
    // An event that ran before the latest one seen says nothing new.
    // A question is the exception: another tool's hook may get here first, and it still waits.
    const late = !!before && Math.max(before.at, before.seen ?? 0) > at;
    const ask = event.reminder ? undefined : event.ask;
    const over = (before?.done ?? []).some((done) => done.tool === ask?.tool && done.key === ask?.key && done.at >= at);
    const thisTurn = at >= (before?.turn ?? 0);
    const stillAsked = !!ask?.tool && !over && thisTurn && before?.state !== 'idle' && before?.state !== 'ended';
    // So is the end of a call in this turn: its question is over, asked already or learned of later.
    const answers = !!event.answered?.tool && thisTurn && (before?.state === 'approval' || before?.state === 'working');
    if (late && !stillAsked && !answers) return undefined;
    // A late event does not move the session back in time.
    const when = late ? Math.max(before!.at, before!.seen ?? 0) : at;
    const cwd = event.cwd ?? before?.cwd;
    const known = { agent, id: event.id, ...(cwd ? { cwd } : {}) };
    let record: Kept;
    let changed = true;
    if (event.state === 'ended') {
      // Kept for a while, so a hook still running from before the end does not bring the session back.
      record = { agent, id: event.id, state: 'ended', at };
      changed = false;
    } else if (event.answered) {
      // A tool that ran with no question asked changes no state, but it was seen.
      if (!before || before.state === 'ended') return undefined;
      const asked = before.state === 'approval' ? (before.asks ?? [{}]) : [];
      // Learned late, it answers its own question only, not one that names no tool.
      const left = answer(asked, event.answered, late);
      changed = asked.length > 0 && left.length < asked.length;
      // A tool running after the turn was over: something (another Stop hook) kept the agent going.
      if (before.state === 'idle') {
        record = { ...known, state: 'working', at };
        changed = true;
      } else if (!changed) record = { ...before, seen: when };
      else if (left.length) record = { ...known, state: 'approval', at: before.at, seen: when, ...asking(left) };
      else record = { ...known, state: 'working', at: when };
    } else if (event.state === 'approval') {
      const asked = before?.state === 'approval' ? (before.asks ?? []) : [];
      // A reminder of a question already known adds none.
      // A question that names its tool is the one an earlier reminder was about.
      const named = event.ask?.tool ? asked.filter((ask) => ask.tool !== undefined) : asked;
      const asks = event.reminder && asked.length ? asked : [...named, event.ask ?? {}].slice(-MAX_ASKS);
      const seen = late ? { at: before!.at, ...(before!.seen !== undefined ? { seen: before!.seen } : {}) } : { at };
      record = { ...known, state: 'approval', ...seen, ...asking(asks) };
    } else {
      record = { ...known, state: event.state as LiveState, at, turn: at };
    }
    if (record.turn === undefined && before?.turn !== undefined && record.state !== 'ended') record.turn = before.turn;
    if (record.state === 'working' || record.state === 'approval') {
      const done = [...(before?.done ?? []), ...(event.answered ? [{ ...event.answered, at }] : [])].slice(-MAX_ASKS);
      if (done.length) record.done = done;
      else delete record.done;
    } else delete record.done;
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
    if (record.state !== 'ended') {
      options.onRecord?.(before && before.state !== 'ended' ? (before as LiveRecord) : undefined, record as LiveRecord);
    }
    return changed && record.state !== 'ended' ? (record as LiveRecord) : undefined;
  } finally {
    await release();
  }
}

/** What a record that waits for approval says about the questions. */
function asking(asks: LiveAsk[]): Pick<LiveRecord, 'tool' | 'asks'> {
  const tool = asks.find((ask) => ask.tool)?.tool;
  return { ...(tool ? { tool } : {}), asks };
}

/** A lock older than this was left by a hook that died. */
const LOCK_STALE_MS = 5000;

/** Hold `lockDir` (a directory: making one is atomic), waiting briefly for another hook to let go. */
async function lock(lockDir: string): Promise<() => Promise<void>> {
  const release = () => fs.rmdir(lockDir).catch(() => undefined);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await fs.mkdir(lockDir);
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const age = await fs.stat(lockDir).then(
      (stat) => Date.now() - stat.mtimeMs,
      () => 0,
    );
    if (age > LOCK_STALE_MS) await fs.rmdir(lockDir).catch(() => undefined);
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Better a rare lost update than a hook that hangs.
  return async () => undefined;
}

/** What the hooks of `agent` last said about session `id`, also that it ended; undefined when nothing. */
export async function liveRecord(
  agent: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<(Omit<LiveRecord, 'state'> & { state: LiveState | 'ended' }) | undefined> {
  return readRecord(fileOf(liveDir(env), agent, id));
}

/** Every record kept, by `agent:id`. Records too old to mean anything are removed on the way. */
export async function readLive(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<Map<string, LiveRecord>> {
  const dir = liveDir(env);
  const records = new Map<string, LiveRecord>();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return records;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const file = path.join(dir, name);
        const record = await readRecord(file);
        if (!record) return;
        const keep = record.state === 'ended' ? ENDED_MS : KEEP_MS;
        if (now - record.at > keep) await fs.rm(file, { force: true }).catch(() => undefined);
        else if (record.state !== 'ended') records.set(`${record.agent}:${record.id}`, record as LiveRecord);
      }),
  );
  return records;
}

/**
 * `sessions` with what the agents' hooks reported put over what the files suggest: `state`, and
 * `waitingFor` (`approval` with the tool asked for, or `reply`). A record the session's file has
 * since moved past is left out, as is a "working" one nothing has confirmed for a long time.
 */
export function withLive(
  sessions: readonly SessionInfo[],
  live: ReadonlyMap<string, LiveRecord>,
  now = Date.now(),
): SessionInfo[] {
  if (!live.size) return [...sessions];
  return sessions.map((session) => {
    const record = live.get(`${session.source}:${session.id}`);
    if (!record) return session;
    // The latest hook of the session, whether or not it changed the state.
    const seen = Math.max(record.at, record.seen ?? 0);
    if (record.state === 'working') {
      // Written to long after the last hook ran: the hooks no longer report this session.
      if (session.updatedAt > seen + UNSEEN_MS) return session;
      if (now - Math.max(seen, session.updatedAt) > WORKING_MS) return session;
      return { ...session, state: 'active', updatedAt: Math.max(session.updatedAt, record.at) };
    }
    // Written to after the agent stopped: something the hooks did not see went on.
    if (session.updatedAt > seen + LAG_MS) return session;
    return {
      ...session,
      state: 'waiting',
      updatedAt: Math.max(session.updatedAt, record.at),
      waitingFor: record.state === 'approval' ? 'approval' : 'reply',
      ...(record.state === 'approval' && record.tool ? { waitingTool: record.tool } : {}),
    };
  });
}
