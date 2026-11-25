import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../agents/sessions/types.js';
import {
  needsFilters,
  underFilter,
  waited,
  type NeedsDecision,
  type NeedsFilter,
  type NeedsItem,
} from '../needs-you.js';
import { towerText } from '../tower-format.js';
import { SessionReply, type SessionReplyDraft } from './session-reply.js';
import { StateGlyph } from './sidebar.js';

/**
 * Since when each of `keys` is known to this window: for what waits without a time of its own (an
 * approval of the open chat, a message the lead proposed). A key that left is forgotten.
 */
export function useFirstSeen(keys: readonly string[]): ReadonlyMap<string, number> {
  const seen = useRef(new Map<string, number>());
  const now = Date.now();
  for (const key of keys) if (!seen.current.has(key)) seen.current.set(key, now);
  for (const key of [...seen.current.keys()]) if (!keys.includes(key)) seen.current.delete(key);
  return seen.current;
}

const OPEN_LABEL = { chat: 'Open chat', own: 'Open chat', sessions: 'Open session' } as const;

export interface NeedsYouPageProps {
  /** The queue (`needsItems`): what the count on the sidebar's "Needs you" counts. */
  items: readonly NeedsItem[];
  /** The open chat's title: the name of its filter. */
  chatTitle?: string;
  connected: boolean;
  token: string;
  /** What the tower last did, and the stores it could not read. */
  tower?: { status?: string; unavailable: readonly string[] };
  /** Applies an answer. False: the item was no longer open. */
  decide(decision: NeedsDecision): Promise<boolean>;
  /** Goes where the item is at home: the chat, another chat, or the list of sessions. */
  onOpen(item: NeedsItem): void;
  /** Whether the window has the list of sessions to go to. Default true. */
  sessionsPage?: boolean;
  /** A reply was sent to a session: it no longer waits. */
  onReplied(session: SessionInfo, reply: string): void;
  /** For tests: the time ages are counted from. Default: now, read again every half minute. */
  now?: number;
}

/**
 * The Needs you page (docs/design/desktop-layout.md): one queue of everything that waits for the
 * person, across projects and agents, with the answers that can be given in place.
 */
export function NeedsYouPage(props: NeedsYouPageProps) {
  const { items } = props;
  const [filter, setFilter] = useState<NeedsFilter>('all');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<string>();
  const [replyTo, setReplyTo] = useState<string>();
  // What is typed to each card, by its key: a filter that hides the card keeps it.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, SessionReplyDraft>>(new Map());
  const keepDraft = (key: string, draft: SessionReplyDraft | undefined) =>
    setDrafts((all) => {
      const next = new Map(all);
      if (draft) next.set(key, draft);
      else next.delete(key);
      return next;
    });
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const now = props.now ?? clock;

  const act = async (item: NeedsItem, decision: NeedsDecision) => {
    setBusy(item.key);
    try {
      setFeedback((await props.decide(decision)) ? '' : 'This item is no longer open.');
    } catch {
      setFeedback('Could not apply this decision.');
    } finally {
      setBusy((current) => (current === item.key ? undefined : current));
    }
  };

  const shown = items.filter((item) => underFilter(item, filter));
  // What was done here, and what the tower last did (a delivery that failed after a reply was
  // sent says so too): each on its own.
  const towerStatus = towerText(props.tower?.status ?? '');
  return (
    <main className="needs-page" aria-label="Needs you">
      <div className="needs-in">
        <div className="needs-h">
          <h2>Needs you</h2>
          {items.length ? <span className="pill warn">{items.length} open</span> : null}
        </div>
        <p className="needs-lead">
          One queue for everything that waits on your answer. Answering an item here or in its chat clears it
          everywhere.
        </p>
        {props.tower?.unavailable.length ? (
          <p className="errors">Unavailable stores · {props.tower.unavailable.map((s) => towerText(s)).join(', ')}</p>
        ) : null}
        <p role="status" className="needs-status">
          {feedback ? <span>{feedback}</span> : null}
          {feedback && towerStatus ? ' · ' : null}
          {towerStatus ? <span data-from="tower">{towerStatus}</span> : null}
        </p>
        {items.length ? (
          <div className="needs-filters" role="group" aria-label="Filter">
            {needsFilters(items, props.chatTitle).map((chip) => (
              <button
                key={chip.filter}
                type="button"
                className="chipf"
                aria-pressed={filter === chip.filter}
                onClick={() => setFilter(chip.filter)}
              >
                <span>{chip.label}</span> <i>{chip.count}</i>
              </button>
            ))}
          </div>
        ) : (
          <div className="needs-empty">
            <StateGlyph state="ok" decorative />
            <b>Nothing needs you now</b>
            <span>Approvals and questions from every project and agent wait here until you answer them.</span>
          </div>
        )}
        {items.length && !shown.length ? <p className="needs-none">Nothing waits here.</p> : null}
        {shown.map((item) => {
          const age = waited(item.since, now);
          const replying = replyTo === item.key && !!item.reply;
          return (
            <article className="needs-card" key={item.key} data-source={item.source} data-kind={item.kind}>
              <div className="needs-meta">
                <StateGlyph state="ask" decorative />
                <b>{item.action}</b>
                {item.project ? (
                  <span className="tag" title={item.project.path}>
                    {item.project.name}
                  </span>
                ) : null}
                <span className="tag">{item.agent}</span>
                <span className="needs-origin">
                  {item.origin}
                  {age ? (
                    <>
                      {' · '}
                      <time
                        dateTime={new Date(item.since!).toISOString()}
                        title={new Date(item.since!).toLocaleString()}
                      >
                        {age}
                      </time>
                    </>
                  ) : null}
                </span>
              </div>
              {item.verbatim ? <pre>{item.text}</pre> : <div className="needs-text">“{item.text}”</div>}
              {item.note ? <small className="needs-note">{item.note}</small> : null}
              <div className="needs-acts">
                {item.choices.map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    className={`btn sm${choice.primary ? ' primary' : ''}`}
                    disabled={!props.connected || busy === item.key}
                    onClick={() => void act(item, choice.decision)}
                  >
                    {choice.label}
                  </button>
                ))}
                {item.reply && !replying ? (
                  <button type="button" className="btn sm primary" onClick={() => setReplyTo(item.key)}>
                    Reply
                  </button>
                ) : null}
                {item.open.to !== 'sessions' || props.sessionsPage !== false ? (
                  <button type="button" className="btn sm ghost" onClick={() => props.onOpen(item)}>
                    {OPEN_LABEL[item.open.to]}
                  </button>
                ) : null}
              </div>
              {replying ? (
                <SessionReply
                  session={item.reply!.session}
                  token={props.token}
                  sandboxes={item.reply!.sandboxes}
                  draft={drafts.get(item.key)}
                  onDraft={(draft) => keepDraft(item.key, draft)}
                  onClose={() => {
                    keepDraft(item.key, undefined);
                    setReplyTo((current) => (current === item.key ? undefined : current));
                  }}
                  onSent={(reply) => {
                    keepDraft(item.key, undefined);
                    // Another card's editor may be open by now: its draft stays.
                    setReplyTo((current) => (current === item.key ? undefined : current));
                    setFeedback(`Sent to ${item.agent}, ${item.origin}.`);
                    props.onReplied(item.reply!.session, reply);
                  }}
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </main>
  );
}
