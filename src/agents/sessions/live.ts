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
  /** When the hook ran, epoch milliseconds. */
  at: number;
  cwd?: string;
  /** The tool the agent asks to use, while `state` is `approval`. */
  tool?: string;
}

/** A record older than this says nothing any more. */
const KEEP_MS = 7 * 24 * 3600_000;
/** A session "working" this long with nothing written is taken for one that died. */
const WORKING_MS = 30 * 60_000;
/** The agent's file can be written a little after its hook ran. */
const LAG_MS = 60_000;

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
export function liveEvent(
  input: unknown,
): { id: string; state: LiveState | 'ended'; cwd?: string; tool?: string; onlyAfterApproval?: boolean } | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const event = input as Record<string, unknown>;
  const id = text(event.session_id);
  if (!id) return undefined;
  const cwd = text(event.cwd);
  const base = { id, ...(cwd ? { cwd } : {}) };
  switch (event.hook_event_name) {
    case 'SessionStart':
      // After a compaction the agent goes on working.
      return event.source === 'compact' ? undefined : { ...base, state: 'idle' };
    case 'UserPromptSubmit':
      return { ...base, state: 'working' };
    case 'PermissionRequest': {
      const tool = text(event.tool_name);
      return { ...base, state: 'approval', ...(tool ? { tool } : {}) };
    }
    case 'Notification': {
      const type = text(event.notification_type);
      if (type === 'idle_prompt') return { ...base, state: 'idle' };
      return type && ASKING.has(type) ? { ...base, state: 'approval' } : undefined;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied':
      // The tool ran or was refused: the question, if there was one, is answered.
      return { ...base, state: 'working', onlyAfterApproval: true };
    case 'Stop':
    case 'StopFailure':
      return { ...base, state: 'idle' };
    case 'SessionEnd':
      return { ...base, state: 'ended' };
    default:
      return undefined;
  }
}

async function readRecord(file: string): Promise<LiveRecord | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<LiveRecord> | null;
    if (!value || typeof value.agent !== 'string' || typeof value.id !== 'string') return undefined;
    if (typeof value.at !== 'number') return undefined;
    if (value.state !== 'working' && value.state !== 'approval' && value.state !== 'idle') return undefined;
    return value as LiveRecord;
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
  options: { env?: NodeJS.ProcessEnv; now?: number } = {},
): Promise<LiveRecord | undefined> {
  const event = liveEvent(input);
  if (!event) return undefined;
  const dir = liveDir(options.env);
  const file = fileOf(dir, agent, event.id);
  if (event.state === 'ended') {
    await fs.rm(file, { force: true });
    return undefined;
  }
  const at = options.now ?? Date.now();
  const before = await readRecord(file);
  // Hooks run side by side: a later event's record is not replaced by an earlier one's.
  if (before && before.at > at) return undefined;
  if (event.onlyAfterApproval && before?.state !== 'approval') return undefined;
  const cwd = event.cwd ?? before?.cwd;
  const record: LiveRecord = {
    agent,
    id: event.id,
    state: event.state,
    at,
    ...(cwd ? { cwd } : {}),
    ...(event.state === 'approval' && (event.tool ?? before?.tool) ? { tool: event.tool ?? before?.tool } : {}),
  };
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
  return record;
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
        if (now - record.at > KEEP_MS) await fs.rm(file, { force: true }).catch(() => undefined);
        else records.set(`${record.agent}:${record.id}`, record);
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
    if (record.state === 'working') {
      if (now - Math.max(record.at, session.updatedAt) > WORKING_MS) return session;
      return { ...session, state: 'active', updatedAt: Math.max(session.updatedAt, record.at) };
    }
    // Written to after the agent stopped: something the hooks did not see went on.
    if (session.updatedAt > record.at + LAG_MS) return session;
    return {
      ...session,
      state: 'waiting',
      updatedAt: Math.max(session.updatedAt, record.at),
      waitingFor: record.state === 'approval' ? 'approval' : 'reply',
      ...(record.state === 'approval' && record.tool ? { waitingTool: record.tool } : {}),
    };
  });
}
