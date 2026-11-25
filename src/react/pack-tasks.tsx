import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PackAction, PackTask } from '../agents/pack.js';
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { ApprovalRequest } from '../agents/types.js';
import {
  PACK_DENSE_ABOVE,
  PACK_DENSE_PAGE,
  packActivity,
  packCheckLabel,
  packDenseList,
  packMetrics,
  packQuotaText,
  packSteerText,
  packTaskClearable,
  packTaskElapsed,
  packTaskError,
  packTaskList,
  packTaskOutcome,
  packTaskStatus,
  packTaskStopped,
  packTaskTitle,
  packWorkLine,
  relativePath,
} from './format.js';
import { Markdown } from './markdown.js';
import { MERGE_LOCALLY_HELP, mergesLocally, pullRequestLabel, reviewHelp, testsHelp } from './work.js';

export type PackActionHandler = (turnId: number, id: string, action: PackAction) => Promise<string>;

/** The status a task's pill and dot are colored by. */
function statusKey(task: PackTask, asks: boolean): string {
  if (asks) return 'asks';
  if (task.status === 'completed' && task.state === 'unmerged') return 'ready';
  if (task.state === 'discarded') return 'aborted';
  return task.status;
}

/** Ticks every second while `active`, so running tasks show how long they have run. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The work a lead agent handed to other agents in one turn: a list of the tasks (what still needs
 * attention first, then finished ones newest first, older ones folded away) and the selected
 * task's progress, result and actions.
 */
export function PackTasks({
  turn,
  cwd,
  pending,
  act,
  approval,
}: {
  turn: SessionTurn;
  cwd: string;
  pending: SessionState['approvals'];
  act?: PackActionHandler;
  approval(request: ApprovalRequest): ReactNode;
}) {
  const pack = turn.pack!;
  const visibleTasks = pack.tasks.filter((item) => !item.dismissed);
  const [selected, select] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const asking = (task: PackTask) => pending.some((request) => request.subtaskId === task.id);
  // A long list: one-line rows, a filter, the first rows only, and finished tasks that can be cleared.
  const dense = visibleTasks.length > PACK_DENSE_ABOVE;
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(0);
  const [cleared, setCleared] = useState<string[]>([]);
  // A cleared task is not picked by itself; one that runs again or asks is back.
  const gone = (task: PackTask) => dense && cleared.includes(task.id) && packTaskClearable(task, asking(task));
  const first = packTaskList(
    visibleTasks.filter((task) => !gone(task)),
    { asking },
  ).shown[0]?.id;
  const id = selected ?? first ?? (pending.length ? 'queue' : undefined);
  const long = dense ? packDenseList(visibleTasks, { asking, keep: id, query, more, cleared }) : undefined;
  const list = long ?? packTaskList(visibleTasks, { asking, keep: id, expanded });
  const foldable = !dense && packTaskList(visibleTasks, { asking }).hidden > 0;
  const task = visibleTasks.find((item) => item.id === id);
  const waiting = pending.filter((request) => request.subtaskId === id);
  const now = useNow(visibleTasks.some((item) => item.status === 'running'));
  // One task needs no list beside it: its card takes the whole width.
  const single = visibleTasks.length === 1 && id !== 'queue';
  const row = (item: PackTask) => {
    const asks = asking(item);
    const status = statusKey(item, asks);
    const outcome = packTaskOutcome(item);
    const elapsed = packTaskElapsed(item, now);
    // A running task's row shows what it does right now: its current command or latest message.
    const live = item.status === 'running' ? packActivity(item.text ?? '') : undefined;
    const steer = item.steers?.at(-1);
    return (
      <button
        type="button"
        key={item.id}
        aria-pressed={id === item.id}
        data-status={status}
        title={`${item.id}: ${item.prompt}`}
        onClick={() => select(item.id)}
      >
        <span className="gc-pack-dot" data-status={status} aria-hidden="true" />
        <span className="gc-pack-row">
          <strong>{packTaskTitle(item)}</strong>
          <small>
            {item.agent} · <span className={asks ? 'gc-pack-warn' : ''}>{packTaskStatus(item, asks)}</span>
            {elapsed ? ` · ${elapsed}` : ''}
          </small>
          {steer ? (
            <small className="gc-pack-steer" data-delivery={steer.delivery}>
              {packSteerText(steer, item.agent)}
            </small>
          ) : null}
          {live ? (
            <span className="gc-pack-live" aria-live="polite">
              {live.argument ? (
                <>
                  {live.tool} <code>{live.argument}</code>
                </>
              ) : (
                live.text || 'Starting…'
              )}
            </span>
          ) : outcome ? (
            <small className="gc-pack-outcome">{outcome}</small>
          ) : null}
        </span>
      </button>
    );
  };
  return (
    <section className="gc-pack" aria-label="Delegated tasks">
      <div className="gc-pack-head">
        <div>
          <strong>Delegated tasks</strong>
          <small title={`${pack.lead} handed these tasks to other agents; up to ${pack.maxParallel} run at once.`}>
            {packMetrics(turn)}
          </small>
        </div>
        {pending.length || id === 'queue' ? (
          <button
            type="button"
            className={pending.length ? 'gc-btn gc-pack-asks' : 'gc-btn'}
            aria-pressed={id === 'queue'}
            onClick={() => select(id === 'queue' ? undefined : 'queue')}
          >
            Approvals · {pending.length}
          </button>
        ) : null}
      </div>
      {long ? (
        <div className="gc-pack-tools">
          <small className="gc-pack-summary">{packWorkLine(visibleTasks, pending)}</small>
          <input
            type="search"
            value={query}
            maxLength={200}
            placeholder="Filter by title, agent, id or status"
            aria-label="Filter tasks"
            onChange={(event) => {
              setQuery(event.target.value);
              setMore(0);
            }}
          />
          {long.clearable.length ? (
            <button
              type="button"
              className="gc-btn"
              title="Hides the finished tasks that left no worktree to merge or discard. The conversation keeps them."
              onClick={() => {
                setCleared([...new Set([...cleared, ...long.clearable.map((item) => item.id)])]);
                // The shown task may go with them: the card shows the first of the rest.
                if (long.clearable.some((item) => item.id === id)) select(undefined);
              }}
            >
              Clear {long.clearable.length} finished
            </button>
          ) : null}
          {long.cleared ? (
            <button type="button" className="gc-btn" onClick={() => setCleared([])}>
              Show {long.cleared} cleared
            </button>
          ) : null}
        </div>
      ) : null}
      {visibleTasks.length || id === 'queue' ? (
        <div className={single ? 'gc-pack-work gc-pack-single' : 'gc-pack-work'}>
          {single ? null : (
            <div className="gc-pack-list" role="group" aria-label="Task list" data-dense={dense ? 'true' : undefined}>
              {list.shown.map(row)}
              {long && !long.shown.length ? (
                <p className="gc-pack-none">{query.trim() ? 'No task matches.' : 'Every finished task is cleared.'}</p>
              ) : null}
              {long?.hidden ? (
                <button type="button" className="gc-pack-more" onClick={() => setMore(more + PACK_DENSE_PAGE)}>
                  Show {Math.min(long.hidden, PACK_DENSE_PAGE)} {long.earlier ? 'earlier' : 'more'}
                  {long.hidden > PACK_DENSE_PAGE ? ` of ${long.hidden}` : ''}
                </button>
              ) : null}
              {foldable ? (
                <button
                  type="button"
                  className="gc-pack-more"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {list.hidden ? `Show ${list.hidden} earlier` : 'Show fewer'}
                </button>
              ) : null}
            </div>
          )}
          {id === 'queue' ? (
            <section className="gc-pack-detail" aria-label="Approval queue">
              <strong>Approval queue</strong>
              {pending.length ? (
                pending.map((request) => <div key={request.id}>{approval(request)}</div>)
              ) : (
                <p>No pending approvals.</p>
              )}
            </section>
          ) : task ? (
            <TaskDetail
              key={task.id}
              task={task}
              pin={() => {
                // Until someone picks a task the card follows the newest; once they work with the
                // shown one (open Steer, type, click), it stays, so a new task does not take its place.
                if (selected === undefined) select(task.id);
              }}
              cwd={cwd}
              now={now}
              turnId={turn.id}
              asks={waiting.length > 0}
              act={pack.interactive ? act : undefined}
            >
              {waiting.map((request) => (
                <div key={request.id}>{approval(request)}</div>
              ))}
            </TaskDetail>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TaskDetail({
  task,
  pin,
  cwd,
  now,
  turnId,
  asks,
  act,
  children,
}: {
  task: PackTask;
  /** Keeps this task selected: called when someone interacts with its detail. */
  pin(): void;
  cwd: string;
  now: number;
  turnId: number;
  asks: boolean;
  act?: PackActionHandler;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<'steer' | 'stop' | 'discard'>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ text: string; revision?: string }>();
  const inspected = useRef<string>(undefined);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const running = task.status === 'running';
  const worktree = task.state === 'unmerged';
  // A worktree that changed no files has nothing to merge.
  const merges = mergesLocally(task);
  const checks = task.checks;
  const checking = checks?.review?.status === 'running' || checks?.verify?.status === 'running';
  const visibleDiff = diff && diff.revision === checks?.revision ? diff.text : undefined;
  const perform = async (action: PackAction) => {
    if (!act || busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const text = await act(turnId, task.id, action);
      if (action.type === 'diff') {
        inspected.current = action.revision;
        setDiff({ text, revision: action.revision });
      } else {
        if (action.type !== 'review' && action.type !== 'verify') setFeedback({ text });
        else inspected.current = undefined;
        setMode(undefined);
        setInput('');
      }
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  };
  const elapsed = packTaskElapsed(task, now);
  const stopped = packTaskStopped(task);
  const error = packTaskError(task);
  const activity = running && task.text ? packActivity(task.text) : undefined;
  const confirm = (mode === 'stop' && running) || (mode === 'discard' && worktree && !running);
  return (
    <section
      className="gc-pack-detail"
      aria-label={'Task ' + task.id}
      onClickCapture={pin}
      onFocusCapture={pin}
      onKeyDownCapture={pin}
    >
      <div className="gc-pack-title">
        <strong>{packTaskTitle(task)}</strong>
        <span className="gc-pack-status" data-status={statusKey(task, asks)}>
          {packTaskStatus(task, asks)}
        </span>
      </div>
      <small className="gc-pack-meta">
        {[
          task.agent,
          task.model,
          task.effort && `effort ${task.effort}`,
          task.mcpServers?.length ? `MCP: ${task.mcpServers.join(', ')}` : undefined,
          elapsed && (running ? `running for ${elapsed}` : `took ${elapsed}`),
          task.mode === 'shared' ? 'works in your directory' : 'works in its own git worktree',
        ]
          .filter(Boolean)
          .join(' · ')}
        {task.mode === 'worktree' || task.cwd !== cwd ? (
          <>
            {' · '}
            <code title={task.cwd}>{relativePath(task.cwd, cwd)}</code>
          </>
        ) : null}{' '}
        · <span className="gc-pack-id">id {task.id}</span>
      </small>
      {running ? (
        <p className="gc-pack-now">
          <span>Now</span>{' '}
          {activity?.argument ? (
            <>
              {activity.tool} <code>{activity.argument}</code>
            </>
          ) : (
            (activity?.text ?? 'Starting…')
          )}
        </p>
      ) : task.text && !(stopped && task.text.trim() === task.error?.trim()) ? (
        <div className="gc-pack-result" aria-label="Result">
          <small className="gc-pack-label">Final reply from {task.agent}</small>
          <Markdown text={task.text} />
        </div>
      ) : null}
      {task.quotaHint && <p className="gc-pack-warn">{packQuotaText(task.agent, task.quotaHint)}</p>}
      {stopped && <p className="gc-pack-stopped">{stopped}.</p>}
      {error && <p className="gc-err">{error}</p>}
      {children}
      {task.steers?.length ? (
        <section className="gc-pack-steers" aria-label="Messages sent while it ran">
          <small className="gc-pack-label">Sent while it ran</small>
          <ol>
            {task.steers.map((steer, i) => (
              <li key={i}>
                <p>{steer.text}</p>
                <small className="gc-pack-steer" data-delivery={steer.delivery} role="status">
                  {packSteerText(steer, task.agent)}
                </small>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <details className="gc-pack-prompt">
        <summary>Instructions given to {task.agent}</summary>
        <p>{task.prompt}</p>
      </details>
      {/* Only linked: without a lookup the card cannot tell whether the task opened it. */}
      {task.pullRequest ? (
        <p className="gc-pack-pr">
          <a href={task.pullRequest.url} target="_blank" rel="noopener noreferrer">
            {pullRequestLabel(task.pullRequest)}
          </a>
        </p>
      ) : null}
      {task.changes?.length ? <small className="gc-pack-label">Changed files</small> : null}
      {task.changes?.length ? (
        <ul aria-label="Changed files">
          {task.changes.map((line) => (
            <li key={line}>
              <code>{line}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {worktree && visibleDiff !== undefined && <pre className="gc-pack-diff">{visibleDiff}</pre>}
      {checks && !running && (worktree || checks.review || checks.verify) && (
        <div className="gc-pack-checks" aria-label="Pre-merge checks">
          {(['review', 'verify'] as const).map((kind) => {
            const label = kind === 'review' ? 'Code review' : 'Tests';
            const source = kind === 'review' ? checks.reviewer : checks.command;
            const status = packCheckLabel(checks, kind);
            const result = checks[kind];
            return (
              <div key={kind}>
                <div className="gc-pack-check-row">
                  <strong>{label}</strong>
                  {source && <code>{source}</code>}
                  {result && (
                    <span
                      className={status === 'Outdated' || status === 'Failed' ? 'gc-pack-warn' : undefined}
                      role="status"
                    >
                      {status}
                    </span>
                  )}
                  {act && worktree && source && (
                    <button
                      type="button"
                      className="gc-btn"
                      disabled={busy || checking}
                      onClick={() => void perform({ type: kind })}
                    >
                      {kind === 'review' ? 'Request review' : 'Run tests'}
                    </button>
                  )}
                </div>
                {!source && worktree && <small>{kind === 'review' ? reviewHelp(task) : testsHelp(task, cwd)}</small>}
                {result?.detail && (
                  <details>
                    <summary>{kind === 'review' ? 'Review notes' : 'Test output'}</summary>
                    <pre className="gc-pack-diff">{result.detail}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      {act && (
        <fieldset disabled={busy} aria-label={'Actions for ' + task.id}>
          {confirm ? (
            <>
              <strong>{mode === 'stop' ? 'Stop this task?' : 'Discard this worktree and its changes?'}</strong>
              <div className="gc-buttons">
                <button type="button" className="gc-btn" onClick={() => setMode(undefined)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="gc-btn gc-danger"
                  onClick={() => void perform({ type: mode === 'stop' ? 'stop' : 'discard' })}
                >
                  {mode === 'stop' ? 'Confirm stop' : 'Confirm discard'}
                </button>
              </div>
            </>
          ) : mode === 'steer' && running ? (
            <>
              <label>
                Message to {task.agent}
                <textarea value={input} maxLength={32_000} onChange={(event) => setInput(event.target.value)} />
              </label>
              <div className="gc-buttons">
                <button
                  type="button"
                  className="gc-btn gc-primary"
                  disabled={!input.trim()}
                  onClick={() => void perform({ type: 'steer', text: input.trim() })}
                >
                  Send instruction
                </button>
                <button type="button" className="gc-btn" onClick={() => setMode(undefined)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="gc-buttons">
              {running && task.canSteer && (
                <button type="button" className="gc-btn" onClick={() => setMode('steer')}>
                  Steer
                </button>
              )}
              {running && (
                <button type="button" className="gc-btn gc-danger" onClick={() => setMode('stop')}>
                  Stop task
                </button>
              )}
              {worktree && !running && (
                <>
                  <button
                    type="button"
                    className="gc-btn"
                    onClick={() =>
                      visibleDiff === undefined
                        ? void perform({ type: 'diff', revision: checks?.revision })
                        : setDiff(undefined)
                    }
                  >
                    {visibleDiff === undefined ? 'Show diff' : 'Hide diff'}
                  </button>
                  {merges ? (
                    <button
                      type="button"
                      className="gc-btn gc-primary"
                      title={MERGE_LOCALLY_HELP}
                      disabled={checking}
                      onClick={() => void perform({ type: 'merge', revision: inspected.current ?? checks?.revision })}
                    >
                      Merge locally
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="gc-btn gc-danger"
                    disabled={checking}
                    onClick={() => setMode('discard')}
                  >
                    Discard
                  </button>
                </>
              )}
            </div>
          )}
        </fieldset>
      )}
      {feedback && (
        <p role="status" className={feedback.error ? 'gc-err' : undefined}>
          {feedback.text}
        </p>
      )}
    </section>
  );
}
