import type { TopicStore } from './topics.js';
import type { SessionInfo } from './types.js';

/** One part of an agent's work: a topic, or what has none. */
export interface WorkShare {
  /** The topic's id. None for the sessions no topic has, and for automatic runs. */
  topic?: string;
  name: string;
  /** Its part of the agent's work, 0 to 1. */
  share: number;
  sessions: number;
}

/** How one agent's work in the listed sessions divides between topics, the largest part first. */
export interface AgentShares {
  agent: string;
  /** What the sessions were weighed by: the price the agent estimates, or tokens. */
  by: 'cost' | 'tokens';
  shares: WorkShare[];
}

/** The names of the two parts that are not topics. */
export const AUTOMATIC_SHARE = 'Automatic runs';
export const UNSORTED_SHARE = 'Not sorted yet';

const tokens = (session: SessionInfo): number =>
  session.usage?.totalTokens ?? (session.usage?.inputTokens ?? 0) + (session.usage?.outputTokens ?? 0);

/**
 * Where each agent's work went: the part of it every topic took, among `sessions` (list them with
 * `automated: true`, or scheduled runs are missing from the picture). A session weighs what its
 * agent says it used in its whole life: the estimated price where the agent keeps one, else
 * tokens. Only the proportions mean something, so no amount is returned: a subscription is not
 * charged by them. Agents whose sessions say nothing about use are left out.
 */
export function topicShares(
  sessions: readonly SessionInfo[],
  store: Pick<TopicStore, 'topics' | 'sessions'>,
): AgentShares[] {
  const names = new Map(store.topics.map((topic) => [topic.id, topic.name]));
  const agents = new Map<string, SessionInfo[]>();
  for (const session of sessions) agents.set(session.agent, [...(agents.get(session.agent) ?? []), session]);
  const found: AgentShares[] = [];
  for (const [agent, own] of agents) {
    const by = own.some((session) => (session.costUsd ?? 0) > 0) ? 'cost' : 'tokens';
    const weight = (session: SessionInfo) => (by === 'cost' ? (session.costUsd ?? 0) : tokens(session));
    const parts = new Map<string, WorkShare & { weight: number }>();
    let total = 0;
    for (const session of own) {
      const used = weight(session);
      if (!(used > 0)) continue;
      const id = session.automated ? undefined : store.sessions[`${session.source}:${session.id}`];
      const topic = id !== undefined && names.has(id) ? id : undefined;
      const name = topic !== undefined ? names.get(topic)! : session.automated ? AUTOMATIC_SHARE : UNSORTED_SHARE;
      const key = topic !== undefined ? `topic:${topic}` : name;
      const part = parts.get(key) ?? {
        ...(topic !== undefined ? { topic } : {}),
        name,
        share: 0,
        sessions: 0,
        weight: 0,
      };
      part.weight += used;
      part.sessions += 1;
      parts.set(key, part);
      total += used;
    }
    if (!total) continue;
    const shares = [...parts.values()]
      .sort((a, b) => b.weight - a.weight)
      .map(({ weight: used, ...part }) => ({ ...part, share: used / total }));
    found.push({ agent, by, shares });
  }
  return found.sort((a, b) => a.agent.localeCompare(b.agent));
}
