import { useEffect, useState } from 'react';
import { Markdown } from '../../react/markdown.js';
import type { SessionInfo } from '../../agents/sessions/types.js';
import type { storedConversation } from '../transcript.js';
import { Icon } from './sidebar.js';

export function transcriptUrl({ source, id }: SessionInfo) {
  return `/api/sessions/${encodeURIComponent(source)}/${encodeURIComponent(id)}/transcript`;
}

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const date = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

export function SessionTranscript({
  session,
  token,
  revision,
}: {
  session: SessionInfo;
  token: string;
  revision: number;
}) {
  const [conversation, setConversation] = useState<ReturnType<typeof storedConversation>>();
  const [error, setError] = useState<string>();
  const url = transcriptUrl(session);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url + '?format=conversation', { signal: controller.signal, headers: { 'x-genaicode-token': token } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `The server answered ${res.status}.`);
        return res.json();
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setConversation(body);
          setError(undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [url, token, revision]);
  if (error) return <p role="alert">Could not read this session: {error}</p>;
  if (!conversation) return <p role="status">Reading transcript…</p>;
  return (
    <div className="thread-messages">
      {conversation.notice && <Markdown text={conversation.notice} />}
      {conversation.turns.map((turn, index) => {
        const stamp = turn.startedAt > 0 ? new Date(turn.startedAt) : undefined;
        const previous = conversation.turns[index - 1];
        const showDate =
          stamp && (!previous || !previous.startedAt || date.format(previous.startedAt) !== date.format(stamp));
        return (
          <section className="thread-turn" key={turn.id} aria-label={`Turn ${turn.id}`}>
            {showDate && <div className="thread-date">{date.format(stamp)}</div>}
            {turn.parts.map((part, i) => {
              if (part.role === 'activity')
                return (
                  <details className="thread-activity" key={i}>
                    <summary>Activity details</summary>
                    <Markdown text={part.text} />
                  </details>
                );
              if (part.role === 'note')
                return (
                  <div className="thread-note" key={i}>
                    <Markdown text={part.text} />
                  </div>
                );
              return (
                <div key={i} className={'thread-message ' + part.role}>
                  <div className="thread-byline">
                    {part.role === 'agent' && <Icon name="spark" />}
                    <strong>{part.role === 'user' ? 'You' : turn.speaker}</strong>
                    {i === 0 && stamp && (
                      <time dateTime={stamp.toISOString()} title={stamp.toLocaleString()}>
                        {time.format(stamp)}
                      </time>
                    )}
                  </div>
                  <Markdown text={part.text} />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
