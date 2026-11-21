import { useState, type ReactNode } from 'react';
import type { PackAction, PackTask } from '../agents/pack.js';
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { ApprovalRequest } from '../agents/types.js';
import { packCheckLabel, packMetrics, packTaskStatus, relativePath } from './format.js';
import { Markdown } from './markdown.js';

export type PackActionHandler = (turnId: number, id: string, action: PackAction) => Promise<string>;

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
  const [selected, select] = useState<string>();
  const id = selected ?? pack.tasks[0]?.id ?? (pending.length ? 'queue' : undefined);
  const task = pack.tasks.find((item) => item.id === id);
  const waiting = pending.filter((request) => request.subtaskId === id);
  return (
    <section className="gc-pack" aria-label="Pack tasks">
      <div className="gc-pack-head">
        <div>
          <strong>Pack tasks</strong>
          <small>
            {pack.lead} leads · {packMetrics(turn)}
          </small>
        </div>
        <button type="button" className="gc-btn" aria-pressed={id === 'queue'} onClick={() => select('queue')}>
          Approvals · {pending.length}
        </button>
      </div>
      {pack.tasks.length || id === 'queue' ? (
        <div className="gc-pack-work">
          <div className="gc-pack-list" role="group" aria-label="Delegated tasks">
            {pack.tasks.map((item) => {
              const asks = pending.some((request) => request.subtaskId === item.id);
              return (
                <button type="button" key={item.id} aria-pressed={id === item.id} onClick={() => select(item.id)}>
                  <code>{item.id}</code>
                  <span>
                    <strong>{item.prompt}</strong>
                    <small>
                      {item.agent} · <span className={asks ? 'gc-pack-warn' : ''}>{packTaskStatus(item, asks)}</span>
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
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
            <TaskDetail key={task.id} task={task} cwd={cwd} turnId={turn.id} act={pack.interactive ? act : undefined}>
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
  cwd,
  turnId,
  act,
  children,
}: {
  task: PackTask;
  cwd: string;
  turnId: number;
  act?: PackActionHandler;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<'steer' | 'stop' | 'discard'>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ text: string; revision?: string }>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const running = task.status === 'running';
  const worktree = task.state === 'unmerged';
  const checks = task.checks;
  const checking = checks?.review?.status === 'running' || checks?.verify?.status === 'running';
  const visibleDiff = diff && diff.revision === checks?.revision ? diff.text : undefined;
  const perform = async (action: PackAction) => {
    if (!act || busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const text = await act(turnId, task.id, action);
      if (action.type === 'diff') setDiff({ text, revision: checks?.revision });
      else {
        if (action.type !== 'review' && action.type !== 'verify') setFeedback({ text });
        setMode(undefined);
        setInput('');
      }
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  };
  const confirm = (mode === 'stop' && running) || (mode === 'discard' && worktree && !running);
  return (
    <section className="gc-pack-detail" aria-label={'Task ' + task.id}>
      <small>
        {task.id} · {task.agent} · {task.mode === 'shared' ? 'Shared directory' : 'Worktree'}
      </small>
      <strong>{task.prompt}</strong>
      <code className="gc-pack-path" title={task.cwd}>
        {relativePath(task.cwd, cwd)}
      </code>
      {task.text && <Markdown text={task.text} />}
      {task.error && <p className="gc-err">{task.error}</p>}
      {children}
      {task.changes?.length ? (
        <ul>
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
                {!source && worktree && (
                  <small>
                    {kind === 'review'
                      ? 'Requires another installed agent with a read-only mode.'
                      : 'Choose the test command with --verify.'}
                  </small>
                )}
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
                    onClick={() => (visibleDiff === undefined ? void perform({ type: 'diff' }) : setDiff(undefined))}
                  >
                    {visibleDiff === undefined ? 'Show diff' : 'Hide diff'}
                  </button>
                  <button
                    type="button"
                    className="gc-btn gc-primary"
                    disabled={checking}
                    onClick={() => void perform({ type: 'merge', revision: checks?.revision })}
                  >
                    Merge locally
                  </button>
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
