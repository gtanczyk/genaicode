import type { ReplyEnding, SessionInfo } from './types.js';

// No Node imports here: the browser's Sessions view groups with this too.
export type { SessionInfo };

export interface SessionListing {
  /** Every source's sessions, newest first. */
  sessions: SessionInfo[];
  /** Sources that could not be read; the others are still listed. */
  errors: Array<{ source: string; message: string }>;
}

// Word edges that hold for Polish letters too: `\b` does not see `ę` or `ć` as part of a word.
const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;
const UNREPORTED = [
  new RegExp(String.raw`send_message\W{0,3}\s+(zniknęło|zostało usunięte|is gone|was removed|is no longer)`, 'iu'),
  new RegExp(
    String.raw`${B}(tool|narzędzie)${E}[^.?!]{0,80}${B}(no longer available|was removed|is gone|zniknęło|zostało usunięte)`,
    'iu',
  ),
  new RegExp(
    String.raw`${B}(can't|cannot|couldn't|could not|unable to)\s+(send|post|report|deliver)${E}[^.?!]{0,80}${B}(thread|project|coordinator|conversation)${E}`,
    'iu',
  ),
  new RegExp(
    String.raw`${B}nie (mogę|mogłem|mogłam|udało się)\s+(wysłać|przekazać|odesłać|zaraportować)${E}[^.?!]{0,80}${B}(wątk|projekt|koordynator)`,
    'iu',
  ),
];
const OFFER = new RegExp(
  String.raw`${B}(if you want|if you'd like|let me know|tell me|just say|i can also|want me to|jeśli chcesz|jeżeli chcesz|daj znać|napisz|mogę też|mogę)${E}`,
  'iu',
);
/** What may follow the last word: quotes, brackets, emphasis, an emoji. */
const TRAILING_CHAR = /^[\s"'”’)\]*_`~\p{Extended_Pictographic}\uFE0F]$/u;

/** Strip `TRAILING_CHAR`s from the end in linear time without backtracking on `+$`. */
function stripTrailing(input: string): string {
  let end = input.length;
  while (end > 0) {
    const prev = input.charCodeAt(end - 1);
    const start =
      prev >= 0xdc00 &&
      prev <= 0xdfff &&
      end >= 2 &&
      input.charCodeAt(end - 2) >= 0xd800 &&
      input.charCodeAt(end - 2) <= 0xdbff
        ? end - 2
        : end - 1;
    if (!TRAILING_CHAR.test(input.slice(start, end))) break;
    end = start;
  }
  return end === input.length ? input : input.slice(0, end);
}

/**
 * What the end of an agent's message asks of the user, by its shape alone: it says it could not
 * report back, it ends with a question, with a command in a code block, or with an offer to go on.
 * A guess from the last 200 characters: a request put as a statement is not seen.
 */
export function replyEnding(lastReply: string | undefined): ReplyEnding | undefined {
  if (!lastReply) return undefined;
  if (UNREPORTED.some((pattern) => pattern.test(lastReply))) return 'unreported';
  const text = stripTrailing(lastReply);
  if (text.endsWith('?')) return 'question';
  // A code block closes the message: something to run.
  if (lastReply.trimEnd().endsWith('```') && /```(ba|z|fi)?sh\b|```shell\b|```console\b/.test(lastReply)) {
    return 'command';
  }
  const body = text.endsWith('.') || text.endsWith('!') ? text.slice(0, -1) : text;
  const last = body.slice(Math.max(body.lastIndexOf('.'), body.lastIndexOf('?'), body.lastIndexOf('!')) + 1);
  if (OFFER.test(last)) return 'offer';
  return undefined;
}

/** A local conversation ready for a new turn in its own directory. */
export function acceptsSessionPrompt(session: SessionInfo): boolean {
  return (
    session.where === 'local' &&
    !!session.cwd &&
    !session.turnInProgress &&
    (session.state === 'waiting' || session.state === 'unfinished') &&
    session.waitingFor !== 'approval'
  );
}

/** A question at the end of a message still waits for this long; after, the thread was left. */
export const ASKING_MS = 3 * 24 * 3600_000;

/** Whether a session asks for you now: for approval, or with a message that asked something not long ago. */
export function isAsking(session: SessionInfo, now = Date.now()): boolean {
  if (session.archived || session.state !== 'waiting') return false;
  return session.waitingFor === 'approval' || (!!session.ending && now - session.updatedAt < ASKING_MS);
}

/** A project: the sessions of every agent that share a directory (or a repository, in the cloud). */
export interface SessionProject {
  /** The directory or repository. `''` for sessions that name neither. */
  key: string;
  /** Its last path segment, for display. */
  name: string;
  sessions: SessionInfo[];
  updatedAt: number;
  /** Sessions per agent. */
  agents: Record<string, number>;
}

/**
 * The sessions whose next move is the user's (`state: 'waiting'`): those that ask for approval
 * first, then those whose last message asks something (`ending`), then the others, newest first
 * in each. Archived ones are left out.
 */
export function waitingSessions(sessions: readonly SessionInfo[]): SessionInfo[] {
  // Approvals, then what ends on a question or a request, then what just ended.
  const asks = (session: SessionInfo) => (session.waitingFor === 'approval' ? 0 : session.ending ? 1 : 2);
  return sessions
    .filter((session) => session.state === 'waiting' && !session.archived)
    .sort((a, b) => asks(a) - asks(b) || b.updatedAt - a.updatedAt);
}

/** Group sessions by where they work, newest project first. */
export function groupSessions(sessions: readonly SessionInfo[]): SessionProject[] {
  const projects = new Map<string, SessionProject>();
  for (const session of sessions) {
    const place = session.cwd ?? session.repository;
    // A cloud session that names no repository groups under its platform.
    const key = place ?? (session.where === 'cloud' ? `cloud:${session.source}` : '');
    let project = projects.get(key);
    if (!project) {
      const name = place ? lastSegment(place) || place : key ? session.source : '(no directory)';
      projects.set(key, (project = { key, name, sessions: [], updatedAt: 0, agents: {} }));
    }
    project.sessions.push(session);
    project.updatedAt = Math.max(project.updatedAt, session.updatedAt);
    project.agents[session.agent] = (project.agents[session.agent] ?? 0) + 1;
  }
  return [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The last path segment of a directory or a repository URL, without `.git`. */
function lastSegment(place: string): string {
  const parts = place
    .replace(/\.git$/, '')
    .split(/[\\/]/)
    .filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** A session waiting or left half way this long is stale (`sessions archive --stale`): two days. */
export const STALE_MS = 2 * 24 * 3600_000;

/**
 * The sessions nobody came back to: waiting for you or left half way, nothing for `olderThanMs`
 * (default two days), and not archived already. Never one an agent works in.
 */
export function staleSessions(
  sessions: readonly SessionInfo[],
  olderThanMs = STALE_MS,
  now = Date.now(),
): SessionInfo[] {
  return sessions.filter(
    (session) =>
      !session.archived &&
      session.where === 'local' &&
      (session.state === 'waiting' || session.state === 'unfinished') &&
      now - Math.max(session.updatedAt, session.heardAt ?? 0) >= olderThanMs,
  );
}
