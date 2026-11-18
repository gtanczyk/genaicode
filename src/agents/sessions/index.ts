import path from 'node:path';
import { claudeSessions } from './claude.js';
import { codexSessions } from './codex.js';
import type { SessionInfo, SessionQuery, SessionSource } from './types.js';

export { claudeSessions, readClaudeSession } from './claude.js';
export type { ClaudeSessionsOptions } from './claude.js';
export { codexSessions, readCodexSession } from './codex.js';
export type { CodexSessionsOptions } from './codex.js';
export type { SessionInfo, SessionQuery, SessionSource, SessionActivity } from './types.js';

/** The session stores genaicode can read on this machine. */
export function localSessionSources(env: NodeJS.ProcessEnv = process.env): SessionSource[] {
  return [claudeSessions({ env }), codexSessions({ env })];
}

export interface SessionListing {
  /** Every source's sessions, newest first. */
  sessions: SessionInfo[];
  /** Sources that could not be read; the others are still listed. */
  errors: Array<{ source: string; message: string }>;
}

/** Sessions from several sources as one list, newest first. A source that fails is reported, not fatal. */
export async function listSessions(
  sources: readonly SessionSource[] = localSessionSources(),
  query: SessionQuery = {},
): Promise<SessionListing> {
  const errors: SessionListing['errors'] = [];
  const lists = await Promise.all(
    sources.map((source) =>
      source.list(query).catch((error: unknown) => {
        errors.push({ source: source.name, message: error instanceof Error ? error.message : String(error) });
        return [] as SessionInfo[];
      }),
    ),
  );
  const sessions = lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  return { sessions: query.limit === undefined ? sessions : sessions.slice(0, query.limit), errors };
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
    const key = session.cwd ?? session.repository ?? '';
    let project = projects.get(key);
    if (!project) {
      const name = key ? path.basename(key.replace(/\.git$/, '')) || key : '(no directory)';
      projects.set(key, (project = { key, name, sessions: [], updatedAt: 0, agents: {} }));
    }
    project.sessions.push(session);
    project.updatedAt = Math.max(project.updatedAt, session.updatedAt);
    project.agents[session.agent] = (project.agents[session.agent] ?? 0) + 1;
  }
  return [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
