import { useEffect, useMemo, useState } from 'react';
import {
  acceptsSessionPrompt,
  groupSessions,
  staleSessions,
  waitingSessions,
  type SessionInfo,
} from '../../agents/sessions/group.js';
import type { PendingAsk } from '../../agents/sessions/answer.js';
import type { WebSessionListing } from './server.js';
import { SessionReply } from './session-reply.js';
import { ago, canContinueHere, filterSessions, groupInOrder, resumeCommand } from '../sessions.js';

const MARK: Record<string, string> = { active: '●', waiting: '○', unfinished: '◌', approval: '◆' };

/** `approval` for a session that asks to use a tool; its `state` otherwise. */
const shownState = (session: SessionInfo): string =>
  session.waitingFor === 'approval' ? 'approval' : (session.state ?? '');
const stateTitle = (session: SessionInfo): string =>
  session.waitingFor === 'approval'
    ? `asks for approval${session.waitingTool ? ` to use ${session.waitingTool}` : ''}`
    : (session.state ?? 'state unknown');

const RANGES = [
  { days: 2, label: 'Last 2 days' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 0, label: 'All time' },
];
/** Rows a project shows before "Show all". */
const FOLD = 5;

/** How many sessions one archive request carries: the server takes up to 1000. */
const ARCHIVE_BATCH = 500;

/** Every agent's sessions on this machine, by project: what is running, what waits, what stopped half way. */
export function Sessions({
  token,
  cwd,
  onContinue,
}: {
  token: string;
  /** Where the chat works: sessions from here can be taken over. */
  cwd: string;
  /** Take the session over in the chat. */
  onContinue(session: SessionInfo): void;
}) {
  const [days, setDays] = useState(7);
  const [listing, setListing] = useState<WebSessionListing>();
  const [replyTo, setReplyTo] = useState<SessionInfo>();
  const [receipt, setReceipt] = useState<{ session: SessionInfo; text: string }>();
  const [failed, setFailed] = useState<string>();
  const [text, setText] = useState('');
  const [agent, setAgent] = useState('');
  const [state, setState] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string>();
  const [round, setRound] = useState(0);

  const authHeaders = useMemo<Record<string, string> | undefined>(
    () => (token ? { 'x-genaicode-token': token } : undefined),
    [token],
  );

  useEffect(() => {
    let current = true;
    fetch(`/api/sessions?days=${days}`, authHeaders ? { headers: authHeaders } : undefined)
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
  }, [days, authHeaders, round]);

  const all = listing?.sessions ?? [];
  const agents = useMemo(() => [...new Set(all.map((session) => session.agent))].sort(), [all]);
  const waiting = useMemo(() => waitingSessions(all), [all]);
  const stale = useMemo(() => staleSessions(all), [all]);
  const [archiveFailed, setArchiveFailed] = useState<string>();
  /** Put sessions away (`genaicode sessions archive`), or bring them back. */
  const archive = (sessions: readonly SessionInfo[], archived: boolean) => {
    const keys = sessions.map(({ source, id }) => ({ source, id }));
    // In batches the server takes, one after another.
    const send = async () => {
      for (let start = 0; start < keys.length; start += ARCHIVE_BATCH) {
        const res = await fetch('/api/archive', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify({ sessions: keys.slice(start, start + ARCHIVE_BATCH), archived }),
        });
        if (!res.ok) return `The server answered ${res.status}.`;
      }
      return undefined;
    };
    send()
      .then(setArchiveFailed)
      .catch((error: unknown) => setArchiveFailed(error instanceof Error ? error.message : String(error)))
      .finally(() => setRound((value) => value + 1));
  };
  const shown = useMemo(() => {
    const found = filterSessions(all, { text, agent, state });
    // What waits for you: the sessions that ask for approval come first.
    return state === 'waiting' || state === 'approval' ? waitingSessions(found) : found;
  }, [all, text, agent, state]);
  // What waits for you keeps its order across projects: the one with an approval first.
  const inbox = state === 'waiting' || state === 'approval';
  const projects = useMemo(() => (inbox ? groupInOrder(shown) : groupSessions(shown)), [shown, inbox]);
  const now = Date.now();

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
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ behavior, ...(message ? { message } : {}) }),
    })
      .then((res) =>
        setAnswerFailed(
          res.ok
            ? undefined
            : res.status === 409
              ? 'That question was answered already.'
              : `The server answered ${res.status}.`,
        ),
      )
      .catch((error: unknown) => setAnswerFailed(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setAnswering(undefined);
        setRound((value) => value + 1);
      });
  };
  const questionsOf = (session: SessionInfo) =>
    (listing?.asks ?? []).filter((ask) => ask.agent === session.agent && ask.session === session.id);

  const copy = (session: SessionInfo) => {
    const command = resumeCommand(session);
    if (!command) return;
    // No Clipboard API on a page that is not a secure context: show the command to copy by hand.
    const show = () => void window.prompt('Continue it in a terminal with:', command);
    if (!navigator.clipboard) return show();
    void navigator.clipboard.writeText(command).then(() => setCopied(session.id), show);
  };

  return (
    <main className="sessions">
      <div className="tools">
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
          <option value="waiting">○ Waiting for you</option>
          <option value="unfinished">◌ Unfinished</option>
          <option value="archived">Archived</option>
        </select>
        <select aria-label="Period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          {RANGES.map((range) => (
            <option key={range.days} value={range.days}>
              {range.label}
            </option>
          ))}
        </select>
        {waiting.length ? (
          <button
            className={`chip waits${state === 'waiting' ? ' on' : ''}`}
            title="Sessions whose next move is yours, approvals first"
            aria-pressed={state === 'waiting'}
            onClick={() => setState(state === 'waiting' ? '' : 'waiting')}
          >
            {waiting.length} wait{waiting.length === 1 ? 's' : ''} for you
            {waiting[0]?.waitingFor === 'approval'
              ? ` · ${waiting.filter((session) => session.waitingFor === 'approval').length} ◆`
              : ''}
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
        <button className="chip" onClick={() => setRound(round + 1)}>
          Refresh
        </button>
        <span className="count">
          {listing ? `${shown.length} of ${all.length} sessions · ${projects.length} projects` : 'Reading…'}
        </span>
      </div>
      {failed ? <div className="errors">Could not read the sessions: {failed}</div> : null}
      {receipt ? (
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
      {projects.map((project) => {
        const whole = open.has(project.key) || project.sessions.length <= FOLD;
        const rows = whole ? project.sessions : project.sessions.slice(0, FOLD);
        return (
          <details key={project.key} className="project" open>
            <summary>
              <b>{project.name}</b>
              <span className="path">{project.key.startsWith('cloud:') ? 'cloud' : project.key}</span>
              <span className="counts">
                {Object.entries(project.agents)
                  .map(([name, count]) => `${name} ${count}`)
                  .join(' · ')}
              </span>
            </summary>
            {rows.map((session) => {
              const sender =
                acceptsSessionPrompt(session) &&
                listing?.senders?.find((s) => s.agent === session.agent && s.source === session.source);
              const replying = replyTo?.source === session.source && replyTo.id === session.id;
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
                    {session.waitingFor === 'approval' ? <small className="asks">{stateTitle(session)}</small> : null}
                    {session.branch ? <small>{session.branch}</small> : null}
                  </span>
                  <span className="act">
                    {sender && !replying ? <button onClick={() => setReplyTo(session)}>Reply</button> : null}
                    {session.where === 'local' && session.state !== 'active' ? (
                      <button
                        title={
                          session.archived
                            ? 'Show it among the sessions again'
                            : 'Hide it from the sessions; any news in it brings it back'
                        }
                        onClick={() => archive([session], !session.archived)}
                      >
                        {session.archived ? 'Unarchive' : 'Archive'}
                      </button>
                    ) : null}
                    {canContinueHere(session, cwd, listing?.readable ?? []) ? (
                      <button
                        title="Bring this conversation into the chat: the agent chosen there continues it"
                        onClick={() => onContinue(session)}
                      >
                        Continue here
                      </button>
                    ) : null}
                    {session.url ? (
                      <a href={session.url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    ) : resumeCommand(session) ? (
                      <button title={resumeCommand(session)} onClick={() => copy(session)}>
                        {copied === session.id ? 'Copied' : 'Copy resume command'}
                      </button>
                    ) : null}
                  </span>
                </div>,
                replying && sender ? (
                  <SessionReply
                    key={`reply:${session.source}:${session.id}`}
                    session={session}
                    token={token}
                    sandboxes={sender.sandboxes}
                    onClose={() => setReplyTo(undefined)}
                    onSent={(text) => {
                      setReceipt({ session, text });
                      setReplyTo((current) =>
                        current?.source === session.source && current.id === session.id ? undefined : current,
                      );
                      setRound((value) => value + 1);
                    }}
                  />
                ) : null,
                ...(session.waitingCommands ?? []).map(({ tool, command }, i) => (
                  <div key={`command:${session.source}:${session.id}:${i}`} className="question-row command-preview">
                    <span className="what">
                      <b>{tool}</b>
                      <code>{command}</code>
                    </span>
                  </div>
                )),
                ...questionsOf(session).map((ask) => (
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
                )),
              ];
            })}
            {whole ? null : (
              <div className="more">
                <button onClick={() => setOpen(new Set([...open, project.key]))}>
                  Show all {project.sessions.length}
                </button>
              </div>
            )}
          </details>
        );
      })}
      {listing && !shown.length ? <div className="count">No sessions match.</div> : null}
    </main>
  );
}
