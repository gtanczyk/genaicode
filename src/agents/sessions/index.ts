import type { CodingAgent } from '../types.js';
import type { SessionListing } from './group.js';
import type { SessionTurn } from '../session.js';
import type { SessionInfo, SessionQuery, SessionReadOptions, SessionSource } from './types.js';

export { groupSessions } from './group.js';
export type { SessionListing, SessionProject } from './group.js';

export { claudeSessions, claudeTranscript, readClaudeSession } from './claude.js';
export type { ClaudeSessionsOptions } from './claude.js';
export { codexSessions, codexTranscript, readCodexSession } from './codex.js';
export type { CodexSessionsOptions } from './codex.js';
export {
  antigravitySessions,
  copilotSessions,
  copilotTranscript,
  cursorSessions,
  geminiSessions,
  geminiTranscript,
  museTranscript,
  antigravityTranscript,
  vibeTranscript,
  museSessions,
  vibeSessions,
} from './stores.js';
export type { StoreOptions } from './stores.js';
export type { SessionInfo, SessionQuery, SessionReadOptions, SessionSource, SessionActivity } from './types.js';

/**
 * The session sources of `agents`, one per store: `codex()` and `codexLive()` share theirs.
 * Agents that keep no readable sessions (`sessions: null`) add nothing.
 */
export function agentSessionSources(agents: readonly Pick<CodingAgent, 'sessions'>[]): SessionSource[] {
  const sources = new Map<string, SessionSource>();
  for (const agent of agents) {
    if (agent.sessions && !sources.has(agent.sessions.name)) sources.set(agent.sessions.name, agent.sessions);
  }
  return [...sources.values()];
}

/** Sessions from several sources as one list, newest first. A source that fails is reported, not fatal. */
export async function listSessions(
  sources: readonly SessionSource[],
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

/**
 * The session with this id among everything `sources` list, with the source that has it. A unique
 * start of an id (8 characters or more) is enough. Undefined when there is none; rejects when
 * several sessions start with it.
 */
export async function findSession(
  sources: readonly SessionSource[],
  id: string,
  query: SessionQuery = {},
): Promise<{ session: SessionInfo; source: SessionSource } | undefined> {
  // A store that can look an id up does; the others are listed whole.
  const found = await Promise.all(
    sources.map((source) =>
      (source.find && id.length >= 8 ? source.find(id, query) : source.list(query)).catch(() => [] as SessionInfo[]),
    ),
  );
  const sessions = found.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  const exact = sessions.filter((session) => session.id === id);
  const matches = exact.length ? exact : id.length >= 8 ? sessions.filter((session) => session.id.startsWith(id)) : [];
  if (matches.length > 1 && new Set(matches.map((session) => `${session.source}:${session.id}`)).size > 1) {
    throw new Error(`${matches.length} sessions start with "${id}". Give more of the id.`);
  }
  const session = matches[0];
  const source = session && sources.find((candidate) => candidate.name === session.source);
  return session && source ? { session, source } : undefined;
}

/** What was said in `session`, read by the source that listed it. Rejects where the store cannot be read. */
export async function readSession(
  sources: readonly SessionSource[],
  session: SessionInfo,
  options?: SessionReadOptions,
): Promise<SessionTurn[]> {
  const source = sources.find((candidate) => candidate.name === session.source);
  if (!source?.read) throw new Error(`The conversations of ${session.agent} cannot be read yet, only listed.`);
  return source.read(session, options);
}
