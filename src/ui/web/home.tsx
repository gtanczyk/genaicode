import { useEffect, useState } from 'react';
import type { AgentShares } from '../../agents/sessions/shares.js';
import type { RateLimit } from '../../agents/types.js';
import { limitChips } from '../../react/format.js';
import { ago, topicsNow, type SessionTopic } from '../sessions.js';
import type { WebSessionListing } from './server.js';

type AgentLimit = RateLimit & { agent: string };

/** Parts of an agent's work the start screen names at most. */
const MOST_SHARES = 4;

async function load<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { 'x-genaicode-token': token } });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as T;
}

/**
 * The start screen of a chat with the session index: the topics that ask for you, those agents
 * work on now, and how much of each agent's plan is used. Shows nothing until topics exist.
 */
export function Home({
  token,
  onTopic,
  onNewTopicChat,
}: {
  token: string;
  onTopic(id: string): void;
  onNewTopicChat?(id: string): void;
}) {
  const [listing, setListing] = useState<WebSessionListing>();
  const [limits, setLimits] = useState<AgentLimit[]>([]);
  const [shares, setShares] = useState<AgentShares[]>([]);

  useEffect(() => {
    let current = true;
    const look = () => {
      load<WebSessionListing>('/api/sessions?days=7', token).then(
        (found) => current && setListing(found),
        () => undefined,
      );
      load<{ shares: AgentShares[] }>('/api/shares?days=7', token).then(
        (found) => current && setShares(found.shares),
        () => undefined,
      );
      load<{ limits: AgentLimit[] }>('/api/limits', token).then(
        (found) => current && setLimits(found.limits),
        () => undefined,
      );
    };
    look();
    const timer = setInterval(look, 60_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [token]);

  if (!listing?.topics?.length) return null;
  const now = Date.now();
  const { asking, working, recent } = topicsNow(listing.sessions, listing.topics, listing.topicOf ?? {}, now);
  const agents = [...new Set(limits.map((limit) => limit.agent))].sort();
  const row = (group: SessionTopic) => {
    const id = group.key.slice('topic:'.length);
    return (
      <div key={group.key} className="topic" data-topic-id={id}>
        <button type="button" className="topic-open" onClick={() => onTopic(id)}>
          <b>{group.name}</b>
          <span>
            {[
              group.asking ? `${group.asking} ask you` : '',
              group.active ? `${group.active} working` : '',
              Object.keys(group.agents).sort().join(', '),
              `${ago(now - group.updatedAt)} ago`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </button>
        {onNewTopicChat ? (
          <button
            type="button"
            className="chip off topic-new"
            title={`Start a new chat in ${group.name}`}
            aria-label={`New chat in ${group.name}`}
            onClick={() => onNewTopicChat(id)}
          >
            New chat
          </button>
        ) : null}
      </div>
    );
  };
  return (
    <section className="home" aria-label="Your topics">
      {agents.length ? (
        <div className="plans">
          {agents.map((agent) => {
            const chips = limitChips({ usage: {}, rateLimits: limits.filter((limit) => limit.agent === agent) }, now);
            const went = shares.find((one) => one.agent === agent)?.shares.filter((part) => part.share >= 0.05);
            return chips.length ? (
              <div key={agent} className="plan">
                <span>
                  {agent}
                  {chips.map((chip) => (
                    <span key={chip.key} className="chip" data-level={chip.level} title={chip.title}>
                      {chip.text}
                    </span>
                  ))}
                </span>
                {went?.length ? <small>Its work in the last 7 days went to</small> : null}
                {went?.length ? (
                  <ul className="went" aria-label={`Where ${agent}'s work went in the last 7 days`}>
                    {went.slice(0, MOST_SHARES).map((part) => (
                      <li key={part.topic ?? part.name} title={`${part.sessions} sessions`}>
                        {part.topic ? (
                          <button onClick={() => onTopic(part.topic!)}>{part.name}</button>
                        ) : (
                          <span>{part.name}</span>
                        )}
                        <i style={{ width: `${Math.round(part.share * 100)}%` }} />
                        <b>{Math.round(part.share * 100)}%</b>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null;
          })}
        </div>
      ) : null}
      {asking.length ? (
        <>
          <h2>Waiting for you</h2>
          {asking.map(row)}
        </>
      ) : null}
      {working.length ? (
        <>
          <h2>Agents at work</h2>
          {working.map(row)}
        </>
      ) : null}
      {recent.length ? (
        <>
          <h2>Topics</h2>
          {recent.map(row)}
        </>
      ) : null}
      {asking.length || working.length || recent.length ? null : <p>Nothing asks for you, and no agent is at work.</p>}
    </section>
  );
}
