import { useEffect, useState } from 'react';
import type { RateLimit } from '../../agents/types.js';
import { limitChips } from '../../react/format.js';
import { ago, topicsNow, type SessionTopic } from '../sessions.js';
import type { WebSessionListing } from './server.js';

type AgentLimit = RateLimit & { agent: string };

async function load<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { 'x-genaicode-token': token } });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as T;
}

/**
 * The start screen of a chat with the session index: the topics that ask for you, those agents
 * work on now, and how much of each agent's plan is used. Shows nothing until topics exist.
 */
export function Home({ token, onTopic }: { token: string; onTopic(id: string): void }) {
  const [listing, setListing] = useState<WebSessionListing>();
  const [limits, setLimits] = useState<AgentLimit[]>([]);

  useEffect(() => {
    let current = true;
    const look = () => {
      load<WebSessionListing>('/api/sessions?days=7', token).then(
        (found) => current && setListing(found),
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
  const { asking, working } = topicsNow(listing.sessions, listing.topics, listing.topicOf ?? {}, now);
  const agents = [...new Set(limits.map((limit) => limit.agent))].sort();
  const row = (group: SessionTopic) => (
    <button key={group.key} className="topic" onClick={() => onTopic(group.key.slice('topic:'.length))}>
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
  );
  return (
    <section className="home" aria-label="Your topics">
      {agents.length ? (
        <div className="plans">
          {agents.map((agent) => {
            const chips = limitChips({ usage: {}, rateLimits: limits.filter((limit) => limit.agent === agent) }, now);
            return chips.length ? (
              <span key={agent} className="plan">
                {agent}
                {chips.map((chip) => (
                  <span key={chip.key} className="chip" data-level={chip.level} title={chip.title}>
                    {chip.text}
                  </span>
                ))}
              </span>
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
      {asking.length || working.length ? null : <p>Nothing asks for you, and no agent is at work.</p>}
    </section>
  );
}
