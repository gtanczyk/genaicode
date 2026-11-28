import { useEffect, useMemo, useState } from 'react';
import {
  attentionOf,
  groupSessions,
  staleSessions,
  waitingSessions,
  type SessionInfo,
} from '../../agents/sessions/group.js';
import type { PendingAsk } from '../../agents/sessions/answer.js';
import type { WebSessionListing } from './server.js';
import { chatTitle, folderName, sessionKey } from '../sidebar.js';
import { Icon } from './sidebar.js';
import type { SessionState } from '../../agents/session.js';
import { ActivityRadar } from './activity-radar.js';
import { SessionTranscript, transcriptUrl } from './session-transcript.js';
import { NeedTime } from './needs-you.js';
import type { NeedsItem } from '../needs-you.js';
import { OpenAgentSession } from './open-agent-session.js';
import { ReplyStatus, SessionReply, useSessionReplyDrafts } from './session-reply.js';
import { TranscriptMenu } from './transcript-menu.js';
import {
  ago,
  askingStore,
  canContinueHere,
  filterSessions,
  groupByTopic,
  groupInOrder,
  resumeCommand,
  sessionStores,
  sessionReplyTarget,
  UNSORTED_TOPIC,
  type SessionTopic,
} from '../sessions.js';

const MARK: Record<string, string> = {
  active: '●',
  waiting: '○',
  unfinished: '◌',
  approval: '◆',
  now: '◉',
  stalled: '◇',
};

/** What a session's last message asked, as the row's mark says it. */
const ENDING_TITLE: Record<string, string> = {
  question: 'asked a question',
  request: 'asked you to confirm or decide',
  command: 'gave you a command to run',
  offer: 'offered to go on',
  unreported: 'could not report back',
};

/** `approval` for a session that asks to use a tool, `now`/`stalled` by `attentionOf`; its `state` otherwise. */
const shownState = (session: SessionInfo): string =>
  session.waitingFor === 'approval' ? 'approval' : (attentionOf(session) ?? session.state ?? '');
const stateTitle = (session: SessionInfo): string => {
  if (session.waitingFor === 'approval')
    return `asks for approval${session.waitingTool ? ` to use ${session.waitingTool}` : ''}`;
  const attention = attentionOf(session);
  const said = session.ending ? ENDING_TITLE[session.ending] : undefined;
  if (attention === 'now') return `needs you now: ${said}`;
  if (attention === 'stalled') return `stalled: ${said}`;
  return session.state ?? 'state unknown';
};

const RANGES = [
  { days: 2, label: 'Last 2 days' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 0, label: 'All time' },
];
/** States whose list keeps the order of what waits for you: approvals first. */
const INBOX = new Set(['waiting', 'approval', 'now', 'stalled']);

/** Rows a project shows before "Show all". */
const FOLD = 5;

/** How many sessions one archive request carries: the server takes up to 1000. */
const ARCHIVE_BATCH = 500;

export async function setSessionArchive(token: string, sessions: readonly SessionInfo[], archived: boolean) {
  const keys = sessions.map(({ source, id }) => ({ source, id }));
  try {
    for (let start = 0; start < keys.length; start += ARCHIVE_BATCH) {
      const res = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ sessions: keys.slice(start, start + ARCHIVE_BATCH), archived }),
      });
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    }
  } finally {
    // Earlier batches may have been committed even when a later batch failed.
    window.dispatchEvent(new Event('genaicode-history-changed'));
  }
}

/** What a topic asks of the user and what goes on in it, for its heading. */
const asksOf = (group: Partial<SessionTopic>): string =>
  [
    group.asking ? `${group.asking} need${group.asking === 1 ? 's' : ''} you` : '',
    group.active ? `${group.active} working` : '',
    group.stalled ? `${group.stalled} stalled` : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** Every agent's sessions on this machine, by project: what is running, what waits, what stopped half way. */
export function Sessions({
  token,
  live,
  liveSource,
  selected,
  readingPositions,
  openingQuestion,
  need,
  onOpen,
  onArchived,
  onDelete,
  cwd,
  home,
  onContinue,
  onNewTopicChat,
  topic,
  onAllTopics,
  own,
  onAllSessions,
  initialState,
  initialDays,
  nativeSave,
  onStatus,
  onAnswered,
  onReplied,
}: {
  token: string;
  live?: SessionState;
  liveSource?: string;
  selected?: SessionInfo;
  readingPositions?: Map<string, number>;
  openingQuestion?: string;
  need?: NeedsItem;
  onOpen(session: SessionInfo): void;
  onArchived?(): void;
  onDelete?(chat: SessionInfo): void;
  /** Where the chat works: sessions from here can be taken over. */
  cwd: string;
  /** True in `--home` mode: any local readable session can be continued, and topics get New chat. */
  home?: boolean;
  /** Take the session over in the chat. */
  onContinue(session: SessionInfo): void;
  /** A question a session held open was answered here (or already elsewhere): the window's other lists drop it. */
  onAnswered?(ask: string, of?: { agent: string; session: string }): void;
  /** A reply went to a session from here: the window's other lists stop offering one. */
  onReplied?(session: SessionInfo): void;
  /** Start a new conversation in the resolved directory of a topic (`--home` mode). */
  onNewTopicChat?(topicId: string): void;
  /** Show only this topic (its id), as picked on the start screen. */
  topic?: string;
  /** Back to every topic. */
  onAllTopics?(): void;
  /** Show only the conversations this chat had itself. */
  own?: boolean;
  /** Back to every agent's sessions. */
  onAllSessions?(): void;
  /** The State filter the view opens with (`now`: what needs you). The person can change it. */
  initialState?: string;
  /** The Period the view opens with, in days (`0`: all time). Default 7. The person can change it. */
  initialDays?: number;
  /** Desktop host handles Save File dialogs natively. */
  nativeSave?: boolean;
  /** Brief feedback after copying or downloading a session's ID or transcript. */
  onStatus?(message: string, isError?: boolean): void;
}) {
  const [days, setDays] = useState(initialDays ?? 7);
  const [listing, setListing] = useState<WebSessionListing>();
  const { attempts, drafts, keepDraft, replyTo, setReplyTo, closeReply } = useSessionReplyDrafts();
  const receipt = [...attempts.values()].reverse().find((attempt) => attempt.from === 'sessions');
  const [failed, setFailed] = useState<string>();
  const [text, setText] = useState('');
  const [agent, setAgent] = useState('');
  const [state, setState] = useState(initialState ?? '');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    const refresh = () => setRound((value) => value + 1);
    window.addEventListener('genaicode-history-changed', refresh);
    return () => window.removeEventListener('genaicode-history-changed', refresh);
  }, []);
  const [radar, setRadar] = useState(false);
  const hasSelected = !!selected;
  useEffect(() => {
    if (!hasSelected && !radar) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') setRound((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [hasSelected, radar]);
  // By topic once there are topics, unless the user chose otherwise.
  const [chosen, setChosen] = useState<'topic' | 'project'>();

  useEffect(() => {
    let current = true;
    fetch(`/api/sessions?days=${days}${own ? '&own=1' : ''}`, { headers: { 'x-genaicode-token': token } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`The server answered ${res.status}.`);
        return (await res.json()) as WebSessionListing;
      })
      .then(
        (found) => {
          if (!current) return;
          setListing(found);
          setFailed(undefined);
        },
        (error: unknown) => current && setFailed(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      current = false;
    };
  }, [days, token, round, own]);

  const index = useMemo(() => {
    const byStore = new Map<string, { display: SessionInfo; stores: SessionInfo[] }>();
    const rows = [];
    const topicsBySession = { ...listing?.topicOf };
    const rank = (row: SessionInfo) =>
      Number(listing?.readable?.includes(row.source) ?? false) * 2 +
      Number(listing?.senders?.some((sender) => sender.agent === row.agent && sender.source === row.source) ?? false);
    for (const group of sessionStores(listing?.sessions ?? [])) {
      // Display the readable source first, preferring one which can also resume the session.
      group.sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt);
      const reader = group[0]!;
      const activity =
        askingStore(group) ?? group.reduce((latest, row) => (row.updatedAt > latest.updatedAt ? row : latest));
      const display =
        activity === reader
          ? reader
          : {
              ...reader,
              state: activity.state,
              updatedAt: activity.updatedAt,
              ending: activity.ending,
              lastReply: activity.lastReply,
              lastReplyAt: activity.lastReplyAt,
              waitingFor: activity.waitingFor,
              waitingTool: activity.waitingTool,
              waitingCommands: activity.waitingCommands,
              turnInProgress: activity.turnInProgress,
              archived: activity.archived,
            };
      const assigned = group.map((row) => listing?.topicOf?.[sessionKey(row)]).filter((id): id is string => !!id);
      const primaryTopic = topic && assigned.includes(topic) ? topic : assigned[0];
      if (!own && primaryTopic) topicsBySession[sessionKey(display)] = primaryTopic;
      rows.push(display);
      for (const row of group) byStore.set(sessionKey(row), { display, stores: group });
    }
    return { rows, byStore, topicsBySession };
  }, [listing, own, topic]);
  const all = useMemo(() => {
    if (!own) return index.rows;
    const sessions = listing?.sessions ?? [];
    if (home) return sessions;
    const here = cwd.replace(/[\\/]+$/, '');
    return sessions.filter((session) => session.where === 'local' && session.cwd?.replace(/[\\/]+$/, '') === here);
  }, [index, own, home, cwd, listing]);

  const storesOf = (row: SessionInfo) => (own ? [row] : (index.byStore.get(sessionKey(row))?.stores ?? [row]));
  const topicNames = useMemo(
    () => new Map((listing?.topics ?? []).map((item) => [item.id, item.name])),
    [listing?.topics],
  );
  const topicNameOf = (session: SessionInfo) => {
    const id = index.topicsBySession[sessionKey(session)];
    return id ? topicNames.get(id) : undefined;
  };
  const agents = useMemo(() => [...new Set(all.map((session) => session.agent))].sort(), [all]);
  const needs = useMemo(() => all.filter((session) => attentionOf(session) === 'now'), [all]);
  const stalled = useMemo(() => all.filter((session) => attentionOf(session) === 'stalled'), [all]);
  const stale = useMemo(() => staleSessions(all), [all]);
  const [archiveFailed, setArchiveFailed] = useState<string>();
  /** Put sessions away (`genaicode sessions archive`), or bring them back. */
  const archive = (sessions: readonly SessionInfo[], archived: boolean) => {
    setSessionArchive(token, sessions.flatMap(storesOf), archived)
      .then(() => setArchiveFailed(undefined))
      .catch((error: unknown) => setArchiveFailed(error instanceof Error ? error.message : String(error)))
      .finally(() => onArchived?.());
  };
  const shown = useMemo(() => {
    const inTopic = topic ? all.filter((session) => index.topicsBySession[sessionKey(session)] === topic) : all;
    const found = filterSessions(inTopic, { text, agent, state });
    // What waits for you: the sessions that ask for approval come first.
    return INBOX.has(state) ? waitingSessions(found) : found;
  }, [all, text, agent, state, topic, index]);
  // What waits for you keeps its order across projects: the one with an approval first.
  const inbox = INBOX.has(state);
  const now = Date.now();
  const sorted = !!listing?.topics?.length;
  // Its own conversations are one list: no topics among them.
  const by = sorted && !own ? (chosen ?? 'topic') : 'project';
  const projects = useMemo(() => {
    if (own && home) {
      if (!shown.length) return [];
      const counts: Record<string, number> = {};
      let updatedAt = 0;
      for (const session of shown) {
        counts[session.agent] = (counts[session.agent] ?? 0) + 1;
        updatedAt = Math.max(updatedAt, session.updatedAt);
      }
      return [{ key: 'own', name: 'Chats of this app', sessions: shown, updatedAt, agents: counts }];
    }
    return by === 'topic'
      ? groupByTopic(shown, listing?.topics ?? [], index.topicsBySession)
      : inbox
        ? groupInOrder(shown)
        : groupSessions(shown);
  }, [shown, inbox, by, listing, index, own, home]);

  const [answering, setAnswering] = useState<string>();
  const [answerFailed, setAnswerFailed] = useState<string>();
  /** Answer a question a session holds open (`genaicode hooks install --answer`). */
  const answer = (ask: PendingAsk, behavior: 'allow' | 'deny') => {
    let message: string | undefined;
    if (behavior === 'deny') {
      const why = window.prompt('Deny: tell the agent why (optional)', '');
      if (why === null) return;
      message = why.trim() || undefined;
    }
    setAnswering(ask.id);
    fetch(`/api/asks/${ask.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
      body: JSON.stringify({ behavior, ...(message ? { message } : {}) }),
    })
      .then((res) => {
        if (res.ok || res.status === 409) onAnswered?.(ask.id, { agent: ask.agent, session: ask.session });
        setAnswerFailed(
          res.ok
            ? undefined
            : res.status === 409
              ? 'That question was answered already.'
              : `The server answered ${res.status}.`,
        );
      })
      .catch((error: unknown) => setAnswerFailed(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setAnswering(undefined);
        setRound((value) => value + 1);
      });
  };
  const questionsOf = (session: SessionInfo) => {
    if (!listing?.asks?.length) return [];
    if (session.where !== 'local') return [];
    const matches = index.rows.filter(
      (row) => row.where === 'local' && row.agent === session.agent && row.id === session.id,
    );
    if (matches.length !== 1 || matches[0]?.cwd !== session.cwd) return [];
    return (listing?.asks ?? []).filter(
      (ask) => ask.agent === session.agent && ask.session === session.id && (!ask.cwd || ask.cwd === session.cwd),
    );
  };

  const questionActions = (session: SessionInfo) =>
    questionsOf(session).map((ask) => (
      <div key={`ask:${ask.id}`} className="question-row">
        <span className="what" title={ask.preview}>
          <b>{ask.tool ?? 'A tool'}</b>
          {ask.preview ? <code>{ask.preview}</code> : null}
        </span>
        <span className="act">
          <button className="allow" disabled={answering === ask.id} onClick={() => answer(ask, 'allow')}>
            Approve
          </button>
          <button disabled={answering === ask.id} onClick={() => answer(ask, 'deny')}>
            Deny
          </button>
        </span>
      </div>
    ));
  const copy = (session: SessionInfo) => {
    const command = resumeCommand(session);
    if (!command) return;
    // No Clipboard API on a page that is not a secure context: show the command to copy by hand.
    const show = () => void window.prompt('Continue it in a terminal with:', command);
    if (!navigator.clipboard) return show();
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(transcriptUrl(session));
      onStatus?.('Copied resume command');
    }, show);
  };

  const senderOf = (session: SessionInfo) =>
    questionsOf(session).length ? undefined : sessionReplyTarget(session, storesOf(session), listing?.senders);
  const actions = (session: SessionInfo, close?: () => void, includeReply = true) => {
    const sender = senderOf(session);
    const action = (label: string, run: () => void, title?: string) => (
      <button
        type="button"
        role={close ? 'menuitem' : undefined}
        title={title}
        onClick={() => {
          close?.();
          run();
        }}
      >
        {label}
      </button>
    );
    return (
      <>
        {includeReply &&
          sender &&
          replyTo !== sessionKey(sender.session) &&
          action('Reply', () => setReplyTo(sessionKey(sender.session)), `Send to this session in ${session.agent}`)}
        {canContinueHere(session, cwd, listing?.readable ?? [], { anyCwd: home }) &&
          action('Continue here', () => onContinue(session), 'Bring this conversation into the current chat')}
        {resumeCommand(session) &&
          action(
            copied === transcriptUrl(session) && !close ? 'Copied' : 'Copy resume command',
            () => copy(session),
            resumeCommand(session),
          )}
        {session.url && (
          <a role={close ? 'menuitem' : undefined} href={session.url} target="_blank" rel="noreferrer">
            {own ? 'Open' : 'Open in browser'}
          </a>
        )}
        {own &&
          onDelete &&
          session.where === 'local' &&
          session.state !== 'active' &&
          !session.turnInProgress &&
          action('Delete chat history…', () => onDelete(session))}
        {session.where === 'local' &&
          session.state !== 'active' &&
          action(session.archived ? 'Unarchive' : 'Archive', () => archive([session], !session.archived))}
      </>
    );
  };
  const attemptFor = (session: SessionInfo) =>
    storesOf(session)
      .map((row) => attempts.get(sessionKey(row)))
      .filter((attempt) => attempt !== undefined)
      .sort((a, b) => b.at - a.at)[0];
  const replyEditor = (session: SessionInfo) => {
    const sender = senderOf(session);
    if (!sender || replyTo !== sessionKey(sender.session)) {
      const attempt = attemptFor(session);
      return attempt && attempt.phase !== 'completed' ? (
        <ReplyStatus key={`status:${sessionKey(session)}`} attempt={attempt} />
      ) : null;
    }
    const key = sessionKey(sender.session);
    return (
      <SessionReply
        key={`reply:${session.source}:${session.id}`}
        from="sessions"
        session={sender.session}
        token={token}
        sandboxes={sender.sandboxes}
        draft={drafts.get(key)}
        onDraft={(draft) => keepDraft(key, draft)}
        onClose={() => closeReply(key)}
        onSent={() => {
          closeReply(key);
          onReplied?.(session);
        }}
      />
    );
  };
  const detail = selected && (index.byStore.get(sessionKey(selected))?.display ?? selected);
  const replyTarget = detail && senderOf(detail);
  // The readable store can be an alias of the store used for sending. Match only this grouped session.
  const attempt = detail && attemptFor(detail);
  const editing = replyTarget && replyTo === sessionKey(replyTarget.session);
  const worktree =
    detail?.agent === 'antigravity' &&
    detail.cwd?.replace(/\\/g, '/').match(/\/\.gemini\/antigravity\/worktrees\/([^/]+)\/([^/]+)\/?$/);

  const list = (
    <main hidden={!!detail} className="sessions">
      <div className="tools">
        {own ? (
          <button className="chip waits" title="Show the sessions of every agent" onClick={onAllSessions}>
            Chats of this app ×
          </button>
        ) : null}
        {topic ? (
          <>
            <button className="chip waits" title="Show every topic" onClick={onAllTopics}>
              {listing?.topics?.find((one) => one.id === topic)?.name ?? 'Topic'} ×
            </button>
            {onNewTopicChat ? (
              <button className="chip off" onClick={() => onNewTopicChat(topic)}>
                New chat
              </button>
            ) : null}
          </>
        ) : null}
        <input
          type="search"
          placeholder="Search titles, prompts, directories, branches…"
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
        />
        <select aria-label="Agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="">All agents</option>
          {agents.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="State" value={state} onChange={(event) => setState(event.target.value)}>
          <option value="">Any state</option>
          <option value="active">● Active</option>
          <option value="approval">◆ Asks for approval</option>
          <option value="now">◉ Needs you now</option>
          <option value="stalled">◇ Stalled</option>
          <option value="waiting">○ Waiting for you</option>
          <option value="unfinished">◌ Unfinished</option>
          <option value="archived">Archived</option>
        </select>
        {sorted && !own && !radar ? (
          <select
            aria-label="Group by"
            value={by}
            onChange={(event) => setChosen(event.target.value === 'project' ? 'project' : 'topic')}
          >
            <option value="topic">By topic</option>
            <option value="project">By directory</option>
          </select>
        ) : null}
        <select aria-label="Period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          {RANGES.map((range) => (
            <option key={range.days} value={range.days}>
              {range.label}
            </option>
          ))}
        </select>
        {needs.length ? (
          <button
            className={`chip waits${state === 'now' ? ' on' : ''}`}
            title="Approvals, and questions or commands to run from the last 3 days: someone waits on your answer"
            aria-pressed={state === 'now'}
            onClick={() => setState(state === 'now' ? '' : 'now')}
          >
            {needs.length} need{needs.length === 1 ? 's' : ''} you now
            {needs.some((session) => session.waitingFor === 'approval')
              ? ` · ${needs.filter((session) => session.waitingFor === 'approval').length} ◆`
              : ''}
          </button>
        ) : null}
        {stalled.length ? (
          <button
            className={`chip${state === 'stalled' ? ' on' : ''}`}
            title="Left on an offer to go on, a report that could not be sent, or a question older than 3 days: nobody is blocked"
            aria-pressed={state === 'stalled'}
            onClick={() => setState(state === 'stalled' ? '' : 'stalled')}
          >
            {stalled.length} stalled
          </button>
        ) : null}
        {stale.length && state !== 'archived' ? (
          <button
            className="chip"
            title="Put away every session waiting for you or left half way for 2 days or more. Their files stay; any news brings one back."
            onClick={() => archive(stale, true)}
          >
            Archive {stale.length} stale
          </button>
        ) : null}
        <button className="chip" aria-pressed={radar} onClick={() => setRadar(!radar)}>
          Activity radar
        </button>
        <button className="chip" onClick={() => setRound(round + 1)}>
          Refresh
        </button>
        <span className="count">
          {listing && radar
            ? `${shown.length} of ${all.length} sessions`
            : listing
              ? `${shown.length} of ${all.length} sessions · ${projects.length} ${by === 'topic' ? 'topics' : 'projects'}`
              : 'Reading…'}
        </span>
      </div>
      {failed ? <div className="errors">Could not read the sessions: {failed}</div> : null}
      {receipt?.phase === 'completed' ? (
        <div className="session-receipt" role="status">
          <b>
            {receipt.session.agent} · {receipt.session.title ?? receipt.session.id}
          </b>
          <p>{receipt.text || 'Turn completed.'}</p>
        </div>
      ) : null}
      {answerFailed ? <div className="errors">Could not answer: {answerFailed}</div> : null}
      {archiveFailed ? <div className="errors">Could not archive: {archiveFailed}</div> : null}
      {listing?.errors.map((error) => (
        <div key={error.source} className="errors">
          {error.source}: {error.message}
        </div>
      ))}
      {radar ? (
        <ActivityRadar
          sessions={shown}
          topics={index.topicsBySession}
          topicNames={topicNames}
          live={live}
          liveSource={liveSource}
          onOpen={onOpen}
        />
      ) : (
        projects.map((project) => {
          // Stalled sessions fold under their topic unless asked for: they block nobody.
          const unfold = inbox || open.has(`stalled:${project.key}`);
          const folded = unfold ? [] : project.sessions.filter((session) => attentionOf(session, now) === 'stalled');
          const listed = folded.length
            ? project.sessions.filter((session) => !folded.includes(session))
            : project.sessions;
          const whole = open.has(project.key) || listed.length <= FOLD;
          const rows = whole ? listed : listed.slice(0, FOLD);
          const topicId =
            by === 'topic' && project.key.startsWith('topic:') && project.key !== UNSORTED_TOPIC
              ? project.key.slice('topic:'.length)
              : undefined;
          return (
            <details key={project.key} className="project" open>
              <summary>
                <b>{project.name}</b>
                <span className="path">
                  {own && home
                    ? ''
                    : by === 'topic'
                      ? asksOf(project)
                      : project.key.startsWith('cloud:')
                        ? 'cloud'
                        : project.key}
                </span>
                <span className="counts">
                  {Object.entries(project.agents)
                    .map(([name, count]) => `${name} ${count}`)
                    .join(' · ')}
                </span>
                {topicId && onNewTopicChat ? (
                  <button
                    type="button"
                    className="topic-new"
                    aria-label={`New chat in ${project.name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onNewTopicChat(topicId);
                    }}
                  >
                    New chat
                  </button>
                ) : null}
              </summary>
              {rows.map((session) => {
                const rowTopic = by !== 'topic' ? topicNameOf(session) : undefined;
                return [
                  <div key={`${session.source}:${session.id}`} className="session-row">
                    <span className="mark" data-state={shownState(session)} title={stateTitle(session)}>
                      {MARK[shownState(session)] ?? '·'}
                    </span>
                    <span className="agent">{session.agent}</span>
                    <span className="age" title={new Date(session.updatedAt).toLocaleString()}>
                      {ago(now - session.updatedAt)}
                    </span>
                    <span className="label" title={session.lastPrompt ?? session.title}>
                      {session.title ?? session.lastPrompt ?? session.lastReply ?? '(no prompt)'}
                      {!own && session.source !== session.agent && (
                        <small title="Session source">{session.source}</small>
                      )}
                      {rowTopic ? <small className="topic-tag">{rowTopic}</small> : null}
                      {session.waitingFor === 'approval' ? <small className="asks">{stateTitle(session)}</small> : null}
                      {session.branch ? <small>{session.branch}</small> : null}
                    </span>
                    <span className="act">
                      {own ? (
                        actions(session)
                      ) : (
                        <button className="open-session" onClick={() => onOpen(session)}>
                          Open
                        </button>
                      )}
                      <TranscriptMenu
                        extra={own ? undefined : (close) => actions(session, close)}
                        token={token}
                        endpoint={transcriptUrl(session)}
                        sessionId={session.id}
                        sessionPath={session.path}
                        storedSession={{ source: session.source, id: session.id }}
                        nativeSave={nativeSave}
                        label="⋯"
                        ariaLabel={`Session actions for ${session.title ?? session.id}`}
                        title="Session actions"
                        onStatus={onStatus}
                      />
                    </span>
                  </div>,
                  !selected && replyEditor(session),
                  ...(session.waitingCommands ?? []).map(({ tool, command }, i) => (
                    <div key={`command:${session.source}:${session.id}:${i}`} className="question-row command-preview">
                      <span className="what">
                        <b>{tool}</b>
                        <code>{command}</code>
                      </span>
                    </div>
                  )),
                  ...questionActions(session),
                ];
              })}
              {whole && !folded.length ? null : (
                <div className="more">
                  {whole ? null : (
                    <button onClick={() => setOpen(new Set([...open, project.key]))}>Show all {listed.length}</button>
                  )}
                  {folded.length ? (
                    <button
                      title="Left on an offer, a report that could not be sent, or an old question"
                      // Every row, so the five-row fold does not hide what was asked for.
                      onClick={() => setOpen(new Set([...open, project.key, `stalled:${project.key}`]))}
                    >
                      Show {folded.length} stalled
                    </button>
                  ) : null}
                </div>
              )}
            </details>
          );
        })
      )}
      {listing && !shown.length ? (
        <div className="count">
          {own && !all.length ? 'No conversations in this app in that time.' : 'No sessions match.'}
        </div>
      ) : null}
    </main>
  );
  return (
    <>
      {detail && (
        <main className="sessions session-detail" aria-label="Session transcript">
          <div className="thread-column">
            {need && (
              <div className="thread-need">
                <b>{need.action}</b>
                <NeedTime item={need} now={now} />
              </div>
            )}
            <SessionTranscript
              key={transcriptUrl(detail)}
              session={detail}
              token={token}
              revision={round}
              positions={readingPositions}
              question={openingQuestion}
            />
            <footer className="thread-footer">
              {detail.where === 'local' && questionActions(detail)}
              {answerFailed && <p role="alert">{answerFailed}</p>}
              {attempt && (!editing || attempt.phase === 'completed') && <ReplyStatus attempt={attempt} />}
              {!replyTarget &&
                attempt?.phase !== 'pending' &&
                detail.where === 'local' &&
                !questionsOf(detail).length &&
                listing && (
                  <span className="thread-availability">
                    {detail.waitingFor === 'approval'
                      ? 'Approval requested in the agent'
                      : detail.turnInProgress
                        ? 'Turn in progress'
                        : detail.state === 'active'
                          ? 'Recent session activity · the next reply is available when the session is idle'
                          : !detail.cwd
                            ? 'No working directory recorded for this session'
                            : !storesOf(detail).some((row) =>
                                  listing.senders?.some(
                                    (sender) => sender.agent === row.agent && sender.source === row.source,
                                  ),
                                )
                              ? `No local ${detail.agent} sender available`
                              : 'Waiting for a resumable session state'}
                  </span>
                )}
              {replyTarget &&
                (replyTo === sessionKey(replyTarget.session) ? (
                  replyEditor(detail)
                ) : (
                  <button
                    className="thread-reply"
                    type="button"
                    onClick={() => setReplyTo(sessionKey(replyTarget.session))}
                  >
                    Reply to “{chatTitle(detail)}” in local {replyTarget.session.agent}…{' '}
                    <span aria-hidden="true">↵</span>
                  </button>
                ))}
              <div className="thread-context">
                {(detail.cwd || detail.repository) && (
                  <span
                    className="session-origin"
                    title={[detail.agent, detail.source, detail.cwd ?? detail.repository].join(' · ')}
                  >
                    <Icon name="folder" />
                    {worktree
                      ? worktree[1] + ' / ' + worktree[2]
                      : detail.cwd
                        ? folderName(detail.cwd)
                        : detail.repository}
                  </span>
                )}
                <OpenAgentSession session={detail} />
                <TranscriptMenu
                  token={token}
                  endpoint={transcriptUrl(detail)}
                  sessionId={detail.id}
                  sessionPath={detail.path}
                  storedSession={{ source: detail.source, id: detail.id }}
                  nativeSave={nativeSave}
                  label="⋯"
                  ariaLabel="Session actions"
                  title="Session actions"
                  buttonClassName="thread-more"
                  onStatus={onStatus}
                  extra={(close) => actions(detail, close, false)}
                />
              </div>
            </footer>
            {archiveFailed && <p role="alert">{archiveFailed}</p>}
            {failed && <p role="alert">{failed}</p>}
          </div>
        </main>
      )}
      {list}
    </>
  );
}
