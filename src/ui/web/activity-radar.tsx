import { useMemo, useState } from 'react';
import { attentionOf, type SessionInfo } from '../../agents/sessions/group.js';
import type { SessionState } from '../../agents/session.js';
import { chatTitle, folderName, sessionKey } from '../sidebar.js';
import { ago } from '../sessions.js';

const PAGE_SIZE = 6;

function activity(row: SessionInfo) {
  if (row.archived) return 'Archived';
  if (row.waitingFor === 'approval') return 'Approval';
  const attention = attentionOf(row);
  if (attention === 'now') return 'Needs you';
  if (row.turnInProgress) return 'Running';
  if (attention === 'stalled') return 'Stalled';
  return row.state ? { active: 'Active', waiting: 'Waiting', unfinished: 'Unfinished' }[row.state] : 'Unknown';
}

function connection(
  from: SessionInfo,
  to: SessionInfo,
  topics: Record<string, string>,
  topicNames: Map<string, string>,
) {
  const pr = from.pullRequests?.find((a) =>
    to.pullRequests?.some((b) => a.repository === b.repository && a.number === b.number),
  );
  if (pr) return { rank: 0, label: `Same PR · ${pr.repository}#${pr.number}` };
  if (from.project?.id && from.project.id === to.project?.id)
    return { rank: 1, label: `Same Claude project · ${from.project.name ?? from.project.id}` };
  const topic = topics[sessionKey(from)];
  if (topic && topic === topics[sessionKey(to)])
    return { rank: 2, label: `Same topic · ${topicNames.get(topic) ?? topic}` };
  if (from.repository && from.repository === to.repository)
    return { rank: 3, label: `Same repository · ${from.repository}` };
  if (from.cwd && from.where === 'local' && to.where === 'local' && from.cwd === to.cwd)
    return { rank: 4, label: `Same directory · ${from.cwd}` };
}

export function ActivityRadar({
  sessions,
  topics,
  topicNames,
  live,
  liveSource,
  onOpen,
}: {
  sessions: readonly SessionInfo[];
  topics: Record<string, string>;
  topicNames: Map<string, string>;
  live?: SessionState;
  liveSource?: string;
  onOpen(row: SessionInfo): void;
}) {
  const [links, setLinks] = useState(false);
  const [linkPage, setLinkPage] = useState(0);
  const [selected, select] = useState<string>();
  const [moreFor, setMoreFor] = useState<string>();
  const rows = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt || sessionKey(a).localeCompare(sessionKey(b))),
    [sessions],
  );
  const agents = useMemo(() => {
    const groups = new Map<string, SessionInfo[]>();
    for (const row of rows) {
      const group = groups.get(row.agent);
      if (group) group.push(row);
      else groups.set(row.agent, [row]);
    }
    return groups;
  }, [rows]);
  const focus = rows.find((row) => sessionKey(row) === selected) ?? rows[0];
  const related = useMemo(() => {
    if (!focus) return [];
    return rows
      .flatMap((row) => {
        if (row === focus) return [];
        const why = connection(focus, row, topics, topicNames);
        return why ? [{ row, ...why }] : [];
      })
      .sort((a, b) => a.rank - b.rank);
  }, [rows, focus, topics, topicNames]);
  if (!focus) return null;
  const key = sessionKey(focus);
  const group = agents.get(focus.agent)!;
  const mapped = links ? related : group.map((row) => ({ row, label: focus.agent }));
  const page = links
    ? Math.min(linkPage, Math.max(0, Math.ceil(mapped.length / PAGE_SIZE) - 1))
    : Math.floor(group.indexOf(focus) / PAGE_SIZE);
  const offset = page * PAGE_SIZE;
  const nodes = mapped.slice(offset, offset + PAGE_SIZE).map(({ row, label }, i, chunk) => {
    const angle = (i * 2 * Math.PI) / chunk.length + (chunk.length > 3 ? Math.PI / 6 : 0);
    return { row, label, x: 50 + 32 * Math.cos(angle), y: 50 + 33 * Math.sin(angle) };
  });
  const delegated =
    liveSource === focus.source
      ? (live?.turns ?? []).flatMap((turn) => {
          const id =
            turn.result?.sessionId ?? (!turn.result && turn === live?.turns.at(-1) ? live.sessionId : undefined);
          const pack = turn.pack;
          if (focus.id !== id || !pack || (turn.agent !== focus.agent && pack.lead !== focus.agent)) return [];
          return pack.tasks.map((task) => ({ turn: turn.id, task, lead: pack.lead }));
        })
      : [];
  const pick = (row: SessionInfo) => {
    select(sessionKey(row));
    setMoreFor(undefined);
    setLinkPage(0);
  };
  const goTo = (n: number) => (links ? setLinkPage(n) : pick(group[n * PAGE_SIZE]!));
  const now = Date.now();
  return (
    <section className="activity-radar" aria-label="Activity radar">
      <header className="radar-head">
        <h2>Activity radar</h2>
        <span>
          {agents.size} {agents.size === 1 ? 'agent' : 'agents'} · {rows.length}{' '}
          {rows.length === 1 ? 'thread' : 'threads'}
        </span>
      </header>
      <div className="radar-agents" role="group" aria-label="Focus agent">
        {[...agents].map(([agent, threads]) => (
          <button className="btn sm" key={agent} aria-pressed={focus.agent === agent} onClick={() => pick(threads[0]!)}>
            {agent} <small>{threads.length}</small>
          </button>
        ))}
      </div>
      <div className="radar-grid">
        <div className="radar-map-card">
          <div className="radar-mode" role="group" aria-label="Map connections">
            <button className="btn sm" aria-pressed={!links} onClick={() => setLinks(false)}>
              Agent threads
            </button>
            <button className="btn sm" aria-pressed={links} onClick={() => setLinks(true)}>
              Thread links
            </button>
          </div>
          <div
            className="radar-map"
            role="group"
            aria-label={links ? 'Connected threads' : `Threads of ${focus.agent}`}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {[16, 32, 47].map((r) => (
                <ellipse key={r} cx="50" cy="50" rx={r} ry={r} />
              ))}
              {nodes.map(({ row, x, y }) => (
                <line key={sessionKey(row)} x1="50" y1="50" x2={x} y2={y} className={row === focus ? 'selected' : ''} />
              ))}
            </svg>
            <strong className="radar-hub" title={links ? chatTitle(focus) : focus.agent}>
              {links ? chatTitle(focus) : focus.agent}
            </strong>
            {nodes.map(({ row, label, x, y }) => (
              <button
                key={sessionKey(row)}
                className="radar-node"
                style={{ left: x + '%', top: y + '%' }}
                aria-label={`${chatTitle(row)} · ${activity(row)}`}
                title={`${chatTitle(row)} · ${label}`}
                aria-pressed={row === focus}
                onClick={() => pick(row)}
              >
                <span className="radar-dot" data-state={activity(row)} />
                <b>{chatTitle(row)}</b>
                <small>
                  {links ? row.agent : activity(row)} · {ago(now - row.updatedAt)}
                </small>
              </button>
            ))}
          </div>
          <div className="radar-page">
            <span>{links ? 'Shared PR, project, topic or directory' : 'Last activity · newest first'}</span>
            <span>{mapped.length ? `${offset + 1}–${offset + nodes.length} of ${mapped.length}` : '0 links'}</span>
            {mapped.length > PAGE_SIZE && (
              <>
                <button
                  className="btn sm"
                  disabled={!page}
                  onClick={() => goTo(page - 1)}
                  aria-label="Previous threads"
                >
                  ←
                </button>
                <button
                  className="btn sm"
                  disabled={offset + PAGE_SIZE >= mapped.length}
                  onClick={() => goTo(page + 1)}
                  aria-label="Next threads"
                >
                  →
                </button>
              </>
            )}
          </div>
        </div>
        <article className="radar-detail" aria-label="Thread details">
          <div className="radar-meta">
            <span className="radar-dot" data-state={activity(focus)} />
            {activity(focus)} · {ago(now - focus.updatedAt)} ago
          </div>
          <h3>{chatTitle(focus)}</h3>
          <p className="radar-place" title={focus.cwd ?? focus.repository}>
            {[focus.agent, focus.cwd ? folderName(focus.cwd) : focus.repository, focus.branch]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <button className="btn primary" onClick={() => onOpen(focus)}>
            Open transcript
          </button>
          {delegated.length > 0 && (
            <section>
              <h4>Delegated tasks</h4>
              {delegated.map(({ turn, task, lead }) => (
                <div className="radar-edge" key={turn + ':' + task.id}>
                  <b>{task.title || task.prompt}</b>
                  <small>
                    {lead} → {task.agent} · {task.status}
                  </small>
                </div>
              ))}
            </section>
          )}
          <section>
            <h4>
              Related threads <small>{related.length}</small>
            </h4>
            {!related.length && <p className="radar-place">No recorded links in this selection.</p>}
            {(moreFor === key ? related : related.slice(0, 4)).map(({ row, label }) => (
              <button className="radar-edge" key={sessionKey(row)} onClick={() => pick(row)} title={label}>
                <b>{chatTitle(row)}</b>
                <small>
                  {row.agent} · {label}
                </small>
              </button>
            ))}
            {related.length > 4 && (
              <button className="btn sm ghost" onClick={() => setMoreFor(moreFor === key ? undefined : key)}>
                {moreFor === key ? 'Show fewer' : `Show all ${related.length}`}
              </button>
            )}
          </section>
        </article>
      </div>
    </section>
  );
}
