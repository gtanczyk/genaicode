import { useEffect, useState } from 'react';
import { ago, topicsNow, type SessionTopic } from '../sessions.js';
import type { WebSessionListing } from './server.js';

async function load<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { 'x-genaicode-token': token } });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as T;
}

/**
 * The start screen of a chat with the session index: the topics that need you now, those agents
 * work on now and those left stalled (folded). Shows nothing until topics exist. Plan limits and
 * where each agent's work went are in Settings › Usage.
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

  useEffect(() => {
    let current = true;
    const look = () => {
      load<WebSessionListing>('/api/sessions?days=7', token).then(
        (found) => current && setListing(found),
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
  const { asking, working, recent, stalled } = topicsNow(listing.sessions, listing.topics, listing.topicOf ?? {}, now);
  const row = (group: SessionTopic) => {
    const id = group.key.slice('topic:'.length);
    return (
      <div key={group.key} className="topic" data-topic-id={id}>
        <button type="button" className="topic-open" onClick={() => onTopic(id)}>
          <b>{group.name}</b>
          <span>
            {[
              group.asking ? `${group.asking} need${group.asking === 1 ? 's' : ''} you` : '',
              group.active ? `${group.active} working` : '',
              group.stalled ? `${group.stalled} stalled` : '',
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
      {asking.length ? (
        <>
          <h2>Needs you now</h2>
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
      {asking.length || working.length || recent.length ? null : <p>Nothing needs you now, and no agent is at work.</p>}
      {stalled.length ? (
        <details className="stalled">
          <summary>
            Stalled in {stalled.length} topic{stalled.length === 1 ? '' : 's'}
            <small>offers, unsent reports and questions left for days</small>
          </summary>
          {stalled.map(row)}
        </details>
      ) : null}
    </section>
  );
}
