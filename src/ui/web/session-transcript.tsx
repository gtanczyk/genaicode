import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TurnAttachments } from '../../react/attachments.js';
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
  positions,
  question,
}: {
  session: SessionInfo;
  token: string;
  revision: number;
  positions?: Map<string, number>;
  question?: string;
}) {
  const [conversation, setConversation] = useState<ReturnType<typeof storedConversation>>();
  const [error, setError] = useState<string>();
  const url = transcriptUrl(session);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const previous = useRef<typeof conversation>(undefined);
  const [unread, setUnread] = useState(false);
  const openingQuestion = useRef(question);
  useLayoutEffect(() => {
    const pane = scroll.current;
    if (!pane || !conversation) return;
    const prev = previous.current;
    if (!prev) {
      const anchor = Array.from(pane.querySelectorAll<HTMLElement>('[data-opening-question]')).at(-1);
      pane.scrollTop = anchor
        ? pane.scrollTop + anchor.getBoundingClientRect().top - pane.getBoundingClientRect().top
        : (positions?.get(url) ?? pane.scrollHeight);
      follow.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 32;
    } else if (follow.current) {
      pane.scrollTop = pane.scrollHeight;
    } else {
      const last = conversation.turns.at(-1);
      const old = prev.turns.at(-1);
      if (
        last?.startedAt !== old?.startedAt ||
        last?.id !== old?.id ||
        last?.parts.length !== old?.parts.length ||
        last?.parts.at(-1)?.text !== old?.parts.at(-1)?.text
      )
        setUnread(true);
    }
    previous.current = conversation;
  }, [conversation, positions, url]);
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
  }, [url, token, revision, session.updatedAt]);
  if (error && !conversation) return <p role="alert">Could not read this session: {error}</p>;
  if (!conversation) return <p role="status">Reading transcript…</p>;
  return (
    <>
      <div
        className="thread-messages"
        ref={scroll}
        tabIndex={0}
        aria-label="Conversation history"
        onScroll={(event) => {
          const pane = event.currentTarget;
          follow.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 32;
          if (follow.current) setUnread(false);
          if (positions) {
            if (follow.current) positions.delete(url);
            else positions.set(url, pane.scrollTop);
          }
        }}
      >
        {error && <p role="alert">Could not refresh this session: {error}</p>}
        {conversation.notice && <Markdown text={conversation.notice} />}
        {conversation.status && <p>{conversation.status}</p>}
        {conversation.pullRequests?.map((pr) => (
          <p key={pr.repository + '#' + pr.number}>
            <a href={`https://github.com/${pr.repository}/pull/${pr.number}`} target="_blank" rel="noreferrer">
              {pr.repository}#{pr.number}
            </a>{' '}
            · {pr.state} · {pr.title}
          </p>
        ))}
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
                      <summary>{part.summary ?? 'Activity details'}</summary>
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
                  <div
                    key={i}
                    className={'thread-message ' + part.role}
                    data-opening-question={
                      part.role === 'agent' &&
                      openingQuestion.current &&
                      part.text.includes(openingQuestion.current.trim())
                        ? true
                        : undefined
                    }
                  >
                    <div className="thread-byline">
                      {part.role === 'agent' && <Icon name="spark" />}
                      <strong>{part.role === 'user' ? 'You' : turn.speaker}</strong>
                      {i === 0 && stamp && (
                        <time dateTime={stamp.toISOString()} title={stamp.toLocaleString()}>
                          {time.format(stamp)}
                        </time>
                      )}
                    </div>
                    {part.text && <Markdown text={part.text} />}
                    {part.attachments && <TurnAttachments items={part.attachments} />}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      {unread && (
        <button
          type="button"
          className="thread-new"
          onClick={() => {
            if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
            setUnread(false);
          }}
        >
          New messages ↓
        </button>
      )}
    </>
  );
}
