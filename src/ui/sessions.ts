import { attentionOf, groupSessions, type SessionInfo, type SessionProject } from '../agents/sessions/group.js';

/** Alternate stores can index one agent session. Conflicting project locations identify distinct rows. */
export function sessionStores(rows: readonly SessionInfo[]): SessionInfo[][] {
  const identity = (row: SessionInfo) => JSON.stringify([row.where, row.agent, row.id]);
  const location = (row: SessionInfo) => (row.where === 'cloud' ? row.repository : row.cwd);
  // An index may omit the project. It belongs with the known location only when that is unambiguous.
  const places = new Map<string, string | null>();
  for (const row of rows) {
    const place = location(row);
    if (!place) continue;
    const key = identity(row);
    if (!places.has(key)) places.set(key, place);
    else if (places.get(key) !== place) places.set(key, null);
  }
  const groups = new Map<string, SessionInfo[]>();
  for (const row of rows) {
    const id = identity(row);
    const key =
      places.get(id) === null ? JSON.stringify([id, location(row), location(row) ? undefined : row.source]) : id;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

/** What the Sessions view narrows the list by. */
export interface SessionFilter {
  /** Words that must all appear in the title, prompts, directory, branch, agent or id. */
  text?: string;
  agent?: string;
  /**
   * A `SessionActivity`, `approval` for sessions that ask to use a tool, `open` for those that wait
   * for the user, `now` / `stalled` by `attentionOf`, `archived` for those put away. Archived sessions show only under `archived`.
   */
  state?: string;
}

export function filterSessions(sessions: readonly SessionInfo[], filter: SessionFilter): SessionInfo[] {
  const words = (filter.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
    if (filter.agent && session.agent !== filter.agent) return false;
    if ((filter.state === 'archived') !== !!session.archived) return false;
    if (filter.state === 'archived') {
      // Every archived one, whatever its state.
    } else if (filter.state === 'approval') {
      if (session.waitingFor !== 'approval') return false;
    } else if (filter.state === 'now' || filter.state === 'stalled') {
      if (attentionOf(session) !== filter.state) return false;
    } else if (filter.state === 'open' ? session.state === 'waiting' : filter.state && session.state !== filter.state)
      return false;
    if (!words.length) return true;
    const hay = [
      session.title,
      session.firstPrompt,
      session.lastPrompt,
      session.cwd,
      session.repository,
      session.branch,
      session.agent,
      session.id,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/**
 * Projects in the order of their first session in `sessions`, not by their newest activity: for
 * a list already in the order to show (what waits for you, approvals first).
 */
export function groupInOrder(sessions: readonly SessionInfo[]): SessionProject[] {
  const at = new Map(sessions.map((session, index) => [session, index]));
  const first = (project: SessionProject) => Math.min(...project.sessions.map((session) => at.get(session)!));
  return groupSessions(sessions).sort((a, b) => first(a) - first(b));
}

/** A topic's sessions as the Sessions view shows them: a group like a project, with what it asks. */
export interface SessionTopic extends SessionProject {
  /** Sessions that need you now: an approval, or a question or command not long ago. */
  asking: number;
  /** Sessions left on an offer, a failed report or an old question: nobody is blocked on them. */
  stalled: number;
  /** Sessions an agent works in now. */
  active: number;
}

/** The key of the group for sessions no topic has. */
export const UNSORTED_TOPIC = 'topic:';

/**
 * Sessions by the topic they were sorted into (`genaicode topics`): the topics that ask for you
 * first, then the latest, and what no topic has last. `topicOf` maps `source:id` to a topic id.
 */
export function groupByTopic(
  sessions: readonly SessionInfo[],
  topics: ReadonlyArray<{ id: string; name: string }>,
  topicOf: Readonly<Record<string, string>>,
  now = Date.now(),
): SessionTopic[] {
  const names = new Map(topics.map((topic) => [topic.id, topic.name]));
  const groups = new Map<string, SessionTopic>();
  for (const session of sessions) {
    const id = topicOf[`${session.source}:${session.id}`];
    const name = id === undefined ? undefined : names.get(id);
    const key = name === undefined ? UNSORTED_TOPIC : `topic:${id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: name ?? 'Not sorted yet',
        sessions: [],
        updatedAt: 0,
        agents: {},
        asking: 0,
        stalled: 0,
        active: 0,
      };
      groups.set(key, group);
    }
    group.sessions.push(session);
    group.updatedAt = Math.max(group.updatedAt, session.updatedAt);
    group.agents[session.agent] = (group.agents[session.agent] ?? 0) + 1;
    if (session.state === 'active') group.active += 1;
    const attention = attentionOf(session, now);
    if (attention === 'now') group.asking += 1;
    else if (attention === 'stalled') group.stalled += 1;
  }
  const last = (group: SessionTopic) => (group.key === UNSORTED_TOPIC ? 1 : 0);
  return [...groups.values()].sort(
    (a, b) => last(a) - last(b) || Math.sign(b.asking) - Math.sign(a.asking) || b.updatedAt - a.updatedAt,
  );
}

/** Topics a start screen shows at most, per list. */
const MOST_TOPICS = 6;

/**
 * What to look at first: the topics that need you now, then those agents work on now and that ask
 * nothing, then recent quiet topics, and those that only stalled (to show folded). Sessions no
 * topic has are left out: they have no name to show.
 */
export function topicsNow(
  sessions: readonly SessionInfo[],
  topics: ReadonlyArray<{ id: string; name: string }>,
  topicOf: Readonly<Record<string, string>>,
  now = Date.now(),
): { asking: SessionTopic[]; working: SessionTopic[]; recent: SessionTopic[]; stalled: SessionTopic[] } {
  const named = groupByTopic(
    sessions.filter((session) => !session.archived),
    topics,
    topicOf,
    now,
  ).filter((group) => group.key !== UNSORTED_TOPIC);
  return {
    asking: named.filter((group) => group.asking).slice(0, MOST_TOPICS),
    working: named.filter((group) => !group.asking && group.active).slice(0, MOST_TOPICS),
    recent: named.filter((group) => !group.asking && !group.active && !group.stalled).slice(0, MOST_TOPICS),
    // Every one: they are folded, and the point is to see how much was left.
    stalled: named.filter((group) => !group.asking && !group.active && group.stalled),
  };
}

/** `5m`, `3h`, `12d`: how long ago, in the largest unit that fits. */
export function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/** The command that continues a local session in the terminal; none for a cloud session. */
export function resumeCommand(session: SessionInfo): string | undefined {
  if (session.where !== 'local') return undefined;
  const quote = (text: string) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);
  return `genaicode chat -a ${quote(session.agent)}${session.cwd ? ` -C ${quote(session.cwd)}` : ''} -r ${quote(session.id)}`;
}

/**
 * Whether the chat working in `cwd` can take a session over: a local one from that directory or
 * below it (or any local session when `anyCwd` is true in `--home` mode), in a store whose
 * conversations can be read (`readable` source names).
 */
export function canContinueHere(
  session: SessionInfo,
  cwd: string,
  readable: readonly string[],
  options?: { anyCwd?: boolean },
): boolean {
  if (session.where !== 'local' || !readable.includes(session.source)) return false;
  if (options?.anyCwd) return true;
  if (!session.cwd || !cwd) return false;
  let end = cwd.length;
  while (end > 1 && (cwd[end - 1] === '/' || cwd[end - 1] === '\\')) end -= 1;
  const root = cwd.slice(0, end);
  return session.cwd === root || session.cwd.startsWith(`${root}/`) || session.cwd.startsWith(`${root}\\`);
}
