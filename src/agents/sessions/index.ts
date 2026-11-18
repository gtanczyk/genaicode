import type { CodingAgent } from '../types.js';
import type { SessionListing } from './group.js';
import type { SessionInfo, SessionQuery, SessionSource } from './types.js';

export { groupSessions } from './group.js';
export type { SessionListing, SessionProject } from './group.js';

export { claudeSessions, readClaudeSession } from './claude.js';
export type { ClaudeSessionsOptions } from './claude.js';
export { codexSessions, readCodexSession } from './codex.js';
export type { CodexSessionsOptions } from './codex.js';
export {
  antigravitySessions,
  copilotSessions,
  cursorSessions,
  geminiSessions,
  museSessions,
  vibeSessions,
} from './stores.js';
export type { StoreOptions } from './stores.js';
export type { SessionInfo, SessionQuery, SessionSource, SessionActivity } from './types.js';

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
