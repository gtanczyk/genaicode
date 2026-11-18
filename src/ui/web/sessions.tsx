import { useEffect, useMemo, useState } from 'react';
import { groupSessions, type SessionInfo, type SessionListing } from '../../agents/sessions/group.js';
import { ago, filterSessions, resumeCommand } from '../sessions.js';

const MARK: Record<string, string> = { active: '●', waiting: '○', unfinished: '◌' };
const RANGES = [
  { days: 2, label: 'Last 2 days' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 0, label: 'All time' },
];
/** Rows a project shows before "Show all". */
const FOLD = 5;

/** Every agent's sessions on this machine, by project: what is running, what waits, what stopped half way. */
export function Sessions({ token }: { token: string }) {
  const [days, setDays] = useState(7);
  const [listing, setListing] = useState<SessionListing>();
  const [failed, setFailed] = useState<string>();
  const [text, setText] = useState('');
  const [agent, setAgent] = useState('');
  const [state, setState] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string>();
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    fetch(`/api/sessions?days=${days}`, { headers: { 'x-genaicode-token': token } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`The server answered ${res.status}.`);
        return (await res.json()) as SessionListing;
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
  }, [days, token, round]);

  const all = listing?.sessions ?? [];
  const agents = useMemo(() => [...new Set(all.map((session) => session.agent))].sort(), [all]);
  const shown = useMemo(() => filterSessions(all, { text, agent, state }), [all, text, agent, state]);
  const projects = useMemo(() => groupSessions(shown), [shown]);
  const now = Date.now();

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
          <option value="waiting">○ Waiting for you</option>
          <option value="unfinished">◌ Unfinished</option>
        </select>
        <select aria-label="Period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          {RANGES.map((range) => (
            <option key={range.days} value={range.days}>
              {range.label}
            </option>
          ))}
        </select>
        <button className="chip" onClick={() => setRound(round + 1)}>
          Refresh
        </button>
        <span className="count">
          {listing ? `${shown.length} of ${all.length} sessions · ${projects.length} projects` : 'Reading…'}
        </span>
      </div>
      {failed ? <div className="errors">Could not read the sessions: {failed}</div> : null}
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
            {rows.map((session) => (
              <div key={`${session.source}:${session.id}`} className="session-row">
                <span className="mark" data-state={session.state} title={session.state ?? 'state unknown'}>
                  {MARK[session.state ?? ''] ?? '·'}
                </span>
                <span className="agent">{session.agent}</span>
                <span className="age" title={new Date(session.updatedAt).toLocaleString()}>
                  {ago(now - session.updatedAt)}
                </span>
                <span className="label" title={session.lastPrompt ?? session.title}>
                  {session.title ?? session.lastPrompt ?? session.lastReply ?? '(no prompt)'}
                  {session.branch ? <small>{session.branch}</small> : null}
                </span>
                <span className="act">
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
              </div>
            ))}
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
