import type { ReactNode } from 'react';
import type { SessionState } from '../agents/session.js';
import {
  packActivity,
  packLatestMessage,
  packRunningStep,
  packSteerReceipt,
  packStepLine,
  packTaskTitle,
} from './format.js';
import { agoText, leadNow, leadPlan, taskAsks, teamFeed, watchedTasks } from './live.js';
import { AskCard, Glyph, type WorkPanelProps } from './work-panel.js';
import type { WorkPanelView, WorkTask } from './work.js';

/** Approval cards Live › Needs you shows before it points to Tasks. */
const ASKS_SHOWN = 2;

/**
 * The Live tab of `<WorkPanel>`: what everybody is doing. What waits for the person in this chat,
 * the lead's plan and what it does now, up to three running tasks as cards, and one feed over all
 * tasks. A task id anywhere opens that task's detail.
 */
export function WorkLive({
  state,
  tasks,
  now,
  view,
  onView,
  needsYou,
  onApprove,
  onAutoApprove,
  onOpen,
}: {
  state: SessionState | null | undefined;
  tasks: WorkTask[];
  now: number;
  view: WorkPanelView;
  onView(view: WorkPanelView): void;
  needsYou?: WorkPanelProps['needsYou'];
  onApprove?: WorkPanelProps['onApprove'];
  onAutoApprove?: WorkPanelProps['onAutoApprove'];
  onOpen(key: string): void;
}) {
  const asks = taskAsks(tasks, { questions: true });
  const plan = leadPlan(state);
  const doing = leadNow(state);
  const turn = state?.turns.at(-1);
  const lead = doing?.lead ?? plan?.lead ?? turn?.pack?.lead ?? turn?.agent;
  const pinned = view.pinned ?? [];
  const watched = watchedTasks(tasks, pinned);
  const everything = view.feed === 'all';
  const feed = teamFeed(tasks, { everything });
  const ref = (key: string, id: string) => (
    <button type="button" className="gc-work-ref" aria-label={`Open task ${id}`} onClick={() => onOpen(key)}>
      {id}
    </button>
  );
  return (
    <div className="gc-work-scroll gc-live">
      {asks.length ? (
        <section aria-label="Needs you">
          <h4 className="gc-work-label">
            Needs you <span>{asks.length} in this chat</span>
            {needsYou && needsYou.total > asks.length ? (
              <button type="button" className="gc-work-link" onClick={needsYou.onOpen}>
                all {needsYou.total} ›
              </button>
            ) : null}
          </h4>
          {asks.slice(0, ASKS_SHOWN).map(({ item, request }) => (
            <AskCard
              key={request.id}
              agent={item.task.agent}
              request={request}
              onApprove={onApprove}
              onAutoApprove={onAutoApprove}
              task={{ id: item.task.id, onOpen: () => onOpen(item.key) }}
            />
          ))}
          {asks.length > ASKS_SHOWN ? (
            <button
              type="button"
              className="gc-work-link"
              onClick={() =>
                onView({
                  ...view,
                  tab: 'tasks',
                  task: undefined,
                  filter: 'ask',
                  folded: { ...view.folded, ask: false },
                })
              }
            >
              Show {asks.length - ASKS_SHOWN} more in Tasks
            </button>
          ) : null}
        </section>
      ) : null}

      {lead ? (
        <section aria-label="Lead">
          <h4 className="gc-work-label">
            Lead <span>{plan ? `${lead} · its plan` : lead}</span>
          </h4>
          {plan ? (
            <ol className="gc-live-plan" aria-label="Plan">
              {plan.steps.map(({ step, status }, index) => (
                <li key={index} data-status={status} aria-current={status === 'in_progress' ? 'step' : undefined}>
                  <span className="gc-live-mark" aria-hidden="true">
                    {status === 'completed' ? (
                      <svg viewBox="0 0 12 12">
                        <path d="m2.5 6.5 2.3 2.3L9.5 3.5" />
                      </svg>
                    ) : null}
                  </span>
                  <span>{step}</span>
                  <span className="gc-work-sr">{status.replace('_', ' ')}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {doing ? (
            <div className="gc-work-card" data-tone="run" role="group" aria-label="The lead now">
              <div className="gc-work-now" aria-live="polite">
                <b>{doing.verb}</b>
                {doing.object ? (
                  <>
                    {' '}
                    <code title={doing.object}>{doing.object}</code>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="gc-work-note">
              The turn is finished. While {lead} works, this shows what it is doing and the plan it reported.
            </p>
          )}
        </section>
      ) : null}

      <section aria-label="Watching">
        <h4 className="gc-work-label">
          Watching <span>tasks you pinned or messaged, then the newest</span>
        </h4>
        {watched.length ? (
          watched.map((item) => (
            <WatchCard
              key={item.key}
              item={item}
              now={now}
              pinned={pinned}
              view={view}
              onView={onView}
              id={ref(item.key, item.task.id)}
            />
          ))
        ) : (
          <p className="gc-work-note">No task is running.</p>
        )}
      </section>

      <section aria-label="Team feed">
        <h4 className="gc-work-label">
          Team feed <span />
          <span className="gc-live-seg" role="group" aria-label="What the feed shows">
            <button
              type="button"
              aria-pressed={!everything}
              onClick={() => onView({ ...view, feed: undefined })}
              title="Messages, approvals, failures, finished tasks and your own messages"
            >
              Highlights
            </button>
            <button
              type="button"
              aria-pressed={everything}
              onClick={() => onView({ ...view, feed: 'all' })}
              title="Every read, edit and command too"
            >
              Everything
            </button>
          </span>
        </h4>
        {feed.length ? (
          <ol className="gc-live-feed" aria-label="Team feed, newest first">
            {feed.map((entry) => (
              <li key={entry.id} data-quiet={entry.quiet ? 'true' : undefined}>
                {/* Not read out as it ticks; the full time is its tooltip. */}
                <time
                  dateTime={entry.at === Number.MAX_SAFE_INTEGER ? undefined : new Date(entry.at).toISOString()}
                  title={entry.at === Number.MAX_SAFE_INTEGER ? undefined : new Date(entry.at).toLocaleString()}
                >
                  {agoText(entry.at, now)}
                </time>
                <Glyph tone={entry.tone === 'run' ? 'idle' : entry.tone} />
                <span className="gc-live-x">
                  {entry.from === 'task' ? (
                    <>
                      {ref(entry.task, entry.taskId)} {entry.agent} · {entry.text}
                    </>
                  ) : (
                    <>
                      {entry.from === 'you' ? 'You' : 'Lead'} → {ref(entry.task, entry.taskId)}:{' '}
                      <span className="gc-receipt" data-state={entry.receipt!.state} title={entry.receipt!.title}>
                        {entry.receipt!.text}
                      </span>
                    </>
                  )}
                  {entry.code ? (
                    <>
                      {' '}
                      <code>{entry.code}</code>
                    </>
                  ) : null}
                  {entry.tail ? ` · ${entry.tail}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="gc-work-note">Nothing yet. What the tasks say, ask for and finish shows here.</p>
        )}
        <p className="gc-work-note gc-live-foot">
          {everything
            ? 'Everything: each read, edit and command has its own line.'
            : 'Highlights: messages, approvals, failures, finished tasks and your own messages with their delivery. Routine reads and edits are one line per task.'}
        </p>
      </section>
    </div>
  );
}

function WatchCard({
  item,
  now,
  pinned,
  view,
  onView,
  id,
}: {
  item: WorkTask;
  now: number;
  pinned: readonly string[];
  view: WorkPanelView;
  onView(view: WorkPanelView): void;
  id: ReactNode;
}) {
  const { task } = item;
  const step = packRunningStep(task);
  const doing = step ? packStepLine(step, now, task.cwd) : undefined;
  const activity = doing ? undefined : packActivity(task.text ?? '');
  const said = packLatestMessage(task);
  const mine = task.steers?.findLast((steer) => steer.from === 'user');
  const receipt = mine ? packSteerReceipt(mine, task.agent, task.endedAt !== undefined) : undefined;
  const isPinned = pinned.includes(item.key);
  return (
    <div className="gc-work-card gc-live-watch" role="group" aria-label={`Task ${task.id}`}>
      <div className="gc-live-watch-head">
        <Glyph tone="run" />
        {id}
        <b title={packTaskTitle(task)}>{packTaskTitle(task)}</b>
        <span className="gc-work-who">{task.agent}</span>
        <button
          type="button"
          className="gc-work-btn gc-work-xs gc-work-ghost gc-work-icon"
          aria-pressed={isPinned}
          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${task.id}`}
          title={isPinned ? 'Unpin: a newer running task may take its place' : 'Pin: keep this task here while it runs'}
          onClick={() =>
            onView({
              ...view,
              pinned: isPinned ? pinned.filter((key) => key !== item.key) : [...pinned, item.key],
            })
          }
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 2.5h4l-.5 4 2 2.5h-7l2-2.5zM8 9v4.5" />
          </svg>
        </button>
      </div>
      <div className="gc-work-line gc-work-doing">
        {doing ? (
          <>
            <b>{doing.verb}</b> <code title={doing.object}>{doing.object}</code>
            <span className="gc-work-dt" aria-hidden="true">
              {' '}
              · {doing.detail}
            </span>
          </>
        ) : activity?.argument ? (
          <>
            <b>{activity.tool}</b> <code title={activity.argument}>{activity.argument}</code>
          </>
        ) : (
          <b>{activity?.text || 'Starting…'}</b>
        )}
      </div>
      {said ? <p className="gc-live-say">“{said}”</p> : null}
      {receipt ? (
        <p className="gc-live-mine">
          Your last message:{' '}
          <span className="gc-receipt" data-state={receipt.state} title={receipt.title}>
            {receipt.text}
          </span>
        </p>
      ) : null}
    </div>
  );
}
