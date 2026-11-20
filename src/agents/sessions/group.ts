import type { SessionInfo } from './types.js';

// No Node imports here: the browser's Sessions view groups with this too.
export type { SessionInfo };

export interface SessionListing {
  /** Every source's sessions, newest first. */
  sessions: SessionInfo[];
  /** Sources that could not be read; the others are still listed. */
  errors: Array<{ source: string; message: string }>;
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
 * first, then the others, newest first in each. Archived ones are left out.
 */
export function waitingSessions(sessions: readonly SessionInfo[]): SessionInfo[] {
  const asks = (session: SessionInfo) => (session.waitingFor === 'approval' ? 0 : 1);
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
