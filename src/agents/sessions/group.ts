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
