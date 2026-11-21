import type { CodingAgent } from '../types.js';
import type { SessionListing } from './group.js';
import type { SessionTurn } from '../session.js';
import type { SessionInfo, SessionQuery, SessionReadOptions, SessionSource } from './types.js';
import { readLive, withLive, type LiveRecord } from './live.js';
import { readArchive, withArchive } from './archive.js';
import { withCommandPreviews } from './approval-previews.js';
import { isScratchDir, mapLimited } from './files.js';

import { replyEnding } from './group.js';
import { isTopicsRun, readTopics } from './topics.js';

export { groupSessions, replyEnding, waitingSessions } from './group.js';
export type { SessionListing, SessionProject } from './group.js';

export { claudeSessions, claudeTranscript, readClaudeSession } from './claude.js';
export type { ClaudeSessionsOptions } from './claude.js';
export { codexProjects, codexSessions, codexTranscript, readCodexSession } from './codex.js';
export type { CodexProject } from './codex.js';
export type { CodexSessionsOptions, CodexSessionsVia } from './codex.js';
export { codexThreads, codexTurns, openCodexServer, readCodexThread } from './codex-api.js';
export type { CodexServer, CodexServerOptions } from './codex-api.js';
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
export { liveDir, liveEvent, liveRecord, readLive, recordHook, withLive } from './live.js';
export { hookInput } from './hook-input.js';
export {
  archiveFile,
  archiveKey,
  archiveSessions,
  isArchived,
  readArchive,
  STALE_MS,
  staleSessions,
  withArchive,
} from './archive.js';
export type { SessionArchive } from './archive.js';
export { answerAsk, askPreview, asksDir, pendingAsks, waitForAnswer } from './answer.js';
export type { AskDecision, PendingAsk, WaitOptions } from './answer.js';
export { noticeFor, notifyFile, readNotify, sendNotice, writeNotify } from './notify.js';
export type { Notice, NotifySettings, SendOptions } from './notify.js';
export type { LiveRecord, LiveState } from './live.js';
export {
  ANSWER_AGENTS,
  HOOK_AGENTS,
  hookCommand,
  hooksFile,
  hooksStatus,
  installHooks,
  uninstallHooks,
} from './hooks.js';
export type { HookAgent, HooksOptions, HooksStatus } from './hooks.js';
export {
  findTopic,
  inRunDirectory,
  isAsking,
  isTopicsRun,
  folderTopics,
  projectTopics,
  mergeTopics,
  moveSessions,
  readTopics,
  renameTopic,
  sortedTopics,
  summarizeTopics,
  topicNamed,
  TOPICS_BATCH,
  topicsBatches,
  TOPICS_PROMPT_MARK,
  topicsFile,
  topicsPrompt,
  unsortedSessions,
  withTopicsRun,
  writeTopics,
} from './topics.js';
export type { Topic, TopicFolder, TopicStore, TopicSummary } from './topics.js';
export { checkSessions, cliVersion } from './doctor.js';
export type { SessionCheck, SessionCheckOptions } from './doctor.js';
export { serveMcpStdio, SESSION_TOOLS_INSTRUCTIONS, sessionTools } from './tools.js';
export { SessionSendGate, sessionSendTool } from './send-tool.js';
export type { SessionSendHandler, SessionSendTarget, SessionSendToolOptions } from './send-tool.js';
export type { SessionToolsOptions } from './tools.js';
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

/**
 * Sessions from several sources as one list, newest first. A source that fails is reported, not
 * fatal. Where an agent's hooks report what its sessions do, that is in `state` and `waitingFor`.
 */
export async function listSessions(
  sources: readonly SessionSource[],
  query: SessionQuery = {},
): Promise<SessionListing> {
  const errors: SessionListing['errors'] = [];
  // genaicode's own sorting runs (`topics refresh`) are nobody's conversation.
  const runs = new Set((await readTopics(query.env)).runs);
  // Nor is what ran in a temporary directory or in a worktree genaicode made for a delegated task.
  const marked = (entry: SessionInfo): SessionInfo =>
    !entry.automated && (isTopicsRun(entry, runs) || isScratchDir(entry.cwd)) ? { ...entry, automated: true } : entry;
  const read = (asked: SessionQuery) =>
    Promise.all(
      sources.map((source) =>
        source.list(asked).then(
          (list) => list.map(marked),
          (error: unknown) => {
            errors.push({ source: source.name, message: error instanceof Error ? error.message : String(error) });
            return [] as SessionInfo[];
          },
        ),
      ),
    );
  let lists = await read(query);
  // Sessions nobody typed into are left out below: where they took places, more are read to fill the limit.
  if (!query.automated && query.limit !== undefined && lists.some((list) => list.some((entry) => entry.automated))) {
    errors.length = 0;
    lists = await read({ ...query, limit: query.limit * AUTOMATED_ROOM });
  }
  // What the agents' own hooks reported goes over what their files suggest.
  const live = query.live === false ? undefined : await readLive(query.env, undefined, query).catch(() => undefined);
  let found = lists.flat();
  if (live?.size) {
    if (query.limit !== undefined || query.since !== undefined) {
      // Those come straight from their stores: a sorting run among them is marked here.
      found = found.concat((await reported(sources, found, live, query)).map(marked));
    }
    // A session counts from its latest news, which may be a hook's.
    found = withLive(found, live).filter((session) => query.since === undefined || session.updatedAt >= query.since);
  }
  // Sessions put away (`genaicode sessions archive`) say so.
  const archive = await readArchive(query.env);
  const sessions = withArchive(found, archive)
    .filter((session) => query.automated || !session.automated)
    .map(withEnding)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = query.limit === undefined ? sessions : sessions.slice(0, query.limit);
  return {
    sessions: live?.size
      ? await mapLimited(shown, 8, (entry) => withCommandPreviews(entry, live.get(`${entry.source}:${entry.id}`)))
      : shown,
    errors,
  };
}

/** Scheduled tasks can be most of a store: this many times the limit is read to fill it without them. */
const AUTOMATED_ROOM = 3;

/** A waiting session says what the end of its last message asks, when it asks something. */
function withEnding(session: SessionInfo): SessionInfo {
  const ending = session.state === 'waiting' ? replyEnding(session.lastReply) : undefined;
  return ending ? { ...session, ending } : session;
}

/**
 * Sessions a listing with a `limit` or a `since` left out though their hooks reported something
 * recent enough: newer than the oldest one listed, and not before `since`. They belong in it once
 * the reports are counted.
 */
async function reported(
  sources: readonly SessionSource[],
  listed: readonly SessionInfo[],
  live: ReadonlyMap<string, LiveRecord>,
  query: SessionQuery,
): Promise<SessionInfo[]> {
  const have = new Set(listed.map((session) => `${session.source}:${session.id}`));
  const full = query.limit !== undefined && listed.length >= query.limit;
  const oldest = full ? Math.min(...listed.map((session) => session.updatedAt)) : 0;
  // Looked up whatever the age of their files: the report is what makes them recent.
  const whole = { ...query, limit: undefined, since: undefined };
  const missing = [...live.values()].filter((record) => {
    const seen = Math.max(record.at, record.seen ?? 0);
    return !have.has(`${record.agent}:${record.id}`) && seen > oldest && seen >= (query.since ?? 0);
  });
  const lookups = sources.map(async (source) => {
    const ids = missing.filter((record) => record.agent === source.name).map((record) => record.id);
    if (!ids.length) return [];
    // A store that can look an id up does; another is listed whole, once.
    const sessions = source.find
      ? (await Promise.all(ids.map((id) => source.find!(id, whole)))).flat()
      : await source.list(whole);
    return sessions.filter((session) => ids.includes(session.id));
  });
  return (await Promise.all(lookups.map((lookup) => lookup.catch(() => [] as SessionInfo[])))).flat();
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
export {
  describeKnownLimits,
  knownLimits,
  limitsAgent,
  limitsDir,
  recordLimits,
  shortLimit,
  statusLineLimits,
  type KnownLimit,
} from './limits.js';
