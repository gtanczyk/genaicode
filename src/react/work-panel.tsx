import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PackAction, PackSteer, PackStep } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import type { ApprovalDecision, ApprovalRequest } from '../agents/types.js';
import {
  clockTime,
  packActivity,
  packCheckLabel,
  packLatestMessage,
  packQuotaText,
  packRunningStep,
  packStepLine,
  packStepRecency,
  packSteerReceipt,
  packTaskElapsed,
  packTaskError,
  packTaskOutcome,
  packTaskStopped,
  packTaskTitle,
  relativePath,
} from './format.js';
import { Markdown } from './markdown.js';
import { installResizeHandle } from './resize-handle.js';
import {
  askSubject,
  changedNothing,
  MERGE_LOCALLY_HELP,
  mergesLocally,
  NO_CHANGES_HELP,
  PULL_REQUEST_HELP,
  pullRequestLabel,
  reviewBlocker,
  reviewHelp,
  taskPullRequest,
  testsHelp,
  WORK_DENSE_ABOVE,
  WORK_GROUP_LABEL,
  WORK_GROUPS,
  WORK_PAGE,
  workClearable,
  workDismiss,
  workFootnote,
  workList,
  workStatus,
  workTasks,
  workTimes,
  type PullRequestStatus,
  type WorkGroup,
  type WorkPanelView,
  type WorkTask,
  type WorkTone,
} from './work.js';

export interface WorkPanelProps {
  /** The session whose delegated tasks are shown, as `<AgentChat>` gets it. */
  state: SessionState | null | undefined;
  /**
   * Which conversation `state` is (the host's id for the chat). A task's detail starts afresh, with
   * nothing typed or confirmed, when it changes. Default: `state.sessionId`.
   */
  chatId?: string;
  /** What the panel shows: the open task, the folded groups, the scroll position. The host keeps it per chat. */
  view: WorkPanelView;
  onView(view: WorkPanelView): void;
  /** The close button. Without it the panel has none. */
  onClose?(): void;
  /**
   * `docked` beside the chat (default), or `full`: a view in the chat's place, where no room is
   * left beside a chat of 600 px. See `workPanelLayout()`.
   */
  mode?: 'docked' | 'full';
  /** The docked width in pixels. Default 420. */
  width?: number;
  /** Smallest and largest docked width right now; with `onWidth` the left edge drags and takes the arrow keys. */
  bounds?: () => readonly [min: number, max: number];
  /** The edge was moved to `width`. `commit` is true when the size should be kept (the drag ended, a key). */
  onWidth?(width: number, commit: boolean): void;
  /**
   * Steer, stop, diff, review, test, merge or discard a task in its owning turn. Without it tasks are
   * read-only. A discard's `intent` is what the panel showed when the person opened its confirmation:
   * `pullRequest` when the task's pull request held its work then (the host checks that again first).
   */
  onPackAction?: WorkActionHandler;
  /** Answer an approval a task waits for. Without it the request shows with no buttons. */
  onApprove?(id: string, decision: ApprovalDecision): void;
  /** Approve this and every later request of the session. Shown beside Approve when `onApprove` is set. */
  onAutoApprove?(): void;
  /**
   * What the host learned of the pull requests the tasks' replies link to (`PackTask.pullRequest`),
   * by task (`WorkTask.key`, "turn:id"): its state, and whether the task opened it (`ours`). Only a
   * pull request the task opened stands in for Merge locally; any other is a link beside it.
   */
  pullRequests?: Readonly<Record<string, PullRequestStatus | undefined>>;
  /** Keep the person from acting (the host is disconnected): the panel keeps what it showed, dimmed. */
  disabled?: boolean;
  /** 'auto' follows prefers-color-scheme. Default 'auto'. */
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  style?: CSSProperties;
}

const GLYPHS: Record<WorkTone, ReactNode> = {
  run: <path d="M6 1.5A4.5 4.5 0 1 0 10.5 6" />,
  ask: <path d="M6 1 11 6 6 11 1 6z" fill="currentColor" />,
  err: <path d="m2.5 2.5 7 7M9.5 2.5l-7 7" />,
  block: (
    <>
      <path d="M6 1.5 11 10.5H1z" />
      <path d="M6 5v2.5M6 9v.1" />
    </>
  ),
  merge: (
    <>
      <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
      <circle cx="6" cy="6" r="1.2" fill="currentColor" />
    </>
  ),
  ok: <path d="m2 6.5 2.8 2.8L10 3.5" />,
  idle: <circle cx="6" cy="6" r="3.5" />,
};

/** A state as a hue and a shape. Decorative: the status is always written beside it. */
export function Glyph({ tone }: { tone: WorkTone }) {
  return (
    <svg className="gc-work-glyph" data-tone={tone} viewBox="0 0 12 12" aria-hidden="true">
      {GLYPHS[tone]}
    </svg>
  );
}

export const GROUP_TONE: Record<WorkGroup, WorkTone> = {
  ask: 'ask',
  failed: 'err',
  blocked: 'block',
  running: 'run',
  unmerged: 'merge',
  done: 'ok',
};

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
 * The work panel: what a lead agent delegated, beside the chat. Tasks are grouped by what to do
 * next (needs you, failed, review blockers, running, unmerged, done); a row opens the task's detail
 * with what it was asked, who does it, where it stands, what it changed and the actions that apply.
 *
 * Presentational, like `<AgentChat>`: it renders the `SessionState` it is given and reports through
 * callbacks. The host decides where it goes (`workPanelLayout`) and keeps `view` per chat
 * (`readWorkView`, `writeWorkView`). It never takes the keyboard focus by itself.
 */
export function WorkPanel(props: WorkPanelProps) {
  const tasks = workTasks(props.state, props.pullRequests);
  const { view, onView } = props;
  const mode = props.mode ?? 'docked';
  const open = view.task ? tasks.find((item) => item.key === view.task) : undefined;
  const now = useNow(tasks.some((item) => item.task.status === 'running'));
  const handle = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const resizes = mode === 'docked' && !!props.onWidth && !!props.bounds;
  // The size the handle reads back at once: React state would lag a drag by a render.
  const width = useRef(props.width);
  width.current = props.width;
  useEffect(() => {
    if (!resizes || !handle.current) return;
    const installed = installResizeHandle(handle.current, {
      axis: 'x',
      // Docked on the right: moving the edge left makes it wider.
      direction: () => -1,
      bounds: () => latest.current.bounds!(),
      read: () => width.current ?? root.current?.getBoundingClientRect().width ?? 0,
      write: (size, commit) => {
        width.current = size;
        latest.current.onWidth!(size, commit);
      },
      step: 16,
    });
    return () => installed.dispose();
  }, [resizes]);
  // Which row gets the focus back when its detail closes.
  const back = useRef<string>(undefined);
  // The detail was opened from a row here (not from the chat): its back button takes the focus.
  const fromRow = useRef(false);
  // Per chat and task, the revision whose diff the person opened. Kept here, not in the detail: Merge
  // locally after leaving the task and opening it again still sends what was looked at, so a
  // newer revision there is refused and its diff shown first. `stale` marks a revision a merge was
  // refused for: Merge locally waits until the newer diff is on screen, across navigation too.
  const inspected = useRef(new Map<string, Inspected>());
  const chat = props.chatId ?? props.state?.sessionId ?? '';
  const theme = props.theme && props.theme !== 'auto' ? props.theme : undefined;
  const act = props.disabled ? undefined : props.onPackAction;
  const approve = props.disabled ? undefined : props.onApprove;
  return (
    <aside
      ref={root}
      className={['gc-work', props.className].filter(Boolean).join(' ')}
      data-mode={mode}
      data-theme={theme}
      data-disabled={props.disabled ? 'true' : undefined}
      aria-label="Work panel"
      style={mode === 'docked' && props.width ? { width: props.width, ...props.style } : props.style}
    >
      {resizes ? (
        <div
          ref={handle}
          className="gc-work-resize"
          role="separator"
          tabIndex={0}
          aria-label="Resize work panel (arrow keys)"
          title="Drag to resize, up to half the window"
        />
      ) : null}
      <div className="gc-work-top">
        <div role="tablist" aria-label="Work">
          <button type="button" role="tab" className="gc-work-tab" aria-selected="true">
            Tasks <span className="gc-work-count">{tasks.length}</span>
          </button>
        </div>
        <span className="gc-work-grow" />
        {props.onClose ? (
          <button
            type="button"
            className="gc-work-btn gc-work-ghost gc-work-icon"
            title="Close panel"
            aria-label="Close work panel"
            onClick={props.onClose}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        ) : null}
      </div>
      <div className="gc-work-pane" role="tabpanel" aria-label="Tasks">
        {open ? (
          <TaskDetail
            // Two chats can each have a task 1:t1: what was typed or confirmed in one stays there.
            key={`${chat}\n${open.key}`}
            item={open}
            inspected={{
              get: () => inspected.current.get(`${chat}\n${open.key}`),
              set: (value) => {
                const key = `${chat}\n${open.key}`;
                if (value) inspected.current.set(key, value);
                else inspected.current.delete(key);
              },
            }}
            now={now}
            cwd={props.state?.cwd ?? ''}
            focusBack={fromRow.current}
            act={open.interactive ? act : undefined}
            onApprove={approve}
            onAutoApprove={props.disabled ? undefined : props.onAutoApprove}
            onBack={() => {
              back.current = open.key;
              fromRow.current = false;
              onView({ ...view, task: undefined });
            }}
          />
        ) : (
          <TaskList
            // Another chat's list starts where that chat's list was, not where this one is scrolled.
            key={chat}
            tasks={tasks}
            now={now}
            view={view}
            onView={onView}
            focus={back}
            onApprove={approve}
            onOpen={(key) => {
              fromRow.current = true;
              onView({ ...view, task: key });
            }}
          />
        )}
      </div>
    </aside>
  );
}

const CHIP_LABEL: Record<WorkGroup, string> = { ...WORK_GROUP_LABEL, blocked: 'Blockers' };

function TaskList({
  tasks,
  now,
  view,
  onView,
  focus,
  onApprove,
  onOpen,
}: {
  tasks: WorkTask[];
  now: number;
  view: WorkPanelView;
  onView(view: WorkPanelView): void;
  /** The row to focus once, after its detail closed. */
  focus: { current: string | undefined };
  onApprove?: WorkPanelProps['onApprove'];
  onOpen(key: string): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef({ view, onView });
  latest.current = { view, onView };
  // Back where the list was: when the chat is opened again, and after a task's detail.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (view.scroll) el.scrollTop = view.scroll;
    const key = focus.current;
    focus.current = undefined;
    if (key)
      el.querySelector<HTMLElement>(`[data-task="${CSS.escape(key)}"] .gc-work-row`)?.focus({ preventScroll: true });
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onScroll = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const top = Math.round(scroller.current?.scrollTop ?? 0);
      if (top !== (latest.current.view.scroll ?? 0)) latest.current.onView({ ...latest.current.view, scroll: top });
    }, 200);
  };
  // Each row under the pointer or the keyboard focus, as its task was when they came to it: the
  // row stays in that group and filter, and moves to its new group once both have left.
  const [held, setHeld] = useState<Record<string, WorkTask>>({});
  const over = useRef<{ hover?: WorkTask; focus?: WorkTask }>({});
  // While a button is pressed nothing is let go: a row that left the press's way would move the
  // next row's Approve from under the pointer between its press and its release.
  const pressed = useRef(false);
  const settle = () =>
    setHeld((current) => {
      const next: Record<string, WorkTask> = pressed.current ? { ...current } : {};
      for (const item of [over.current.hover, over.current.focus]) if (item) next[item.key] = current[item.key] ?? item;
      const keys = Object.keys(next);
      return keys.length === Object.keys(current).length && keys.every((key) => current[key]) ? current : next;
    });
  const hold = (how: 'hover' | 'focus', item: WorkTask | undefined) => {
    over.current[how] = item;
    settle();
  };
  /** Lets go of one row only: the pointer may be on another row, which stays where it is. */
  const release = (key: string) => {
    for (const how of ['hover', 'focus'] as const) if (over.current[how]?.key === key) over.current[how] = undefined;
    settle();
  };
  useEffect(() => {
    let later: ReturnType<typeof setTimeout> | undefined;
    // After the click the release makes, so it lands where the press did.
    const release = () => {
      if (!pressed.current) return;
      clearTimeout(later);
      later = setTimeout(() => {
        pressed.current = false;
        settle();
      });
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      clearTimeout(later);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);
  // A held row that is no longer drawn (a filter took it away under the pointer) sends no leave
  // event: it is let go here, so its task is not kept in an old group.
  useEffect(() => {
    const drawn = (key: string) => !!scroller.current?.querySelector(`[data-task="${CSS.escape(key)}"]`);
    const gone = Object.keys(held).filter((key) => !drawn(key));
    if (!gone.length) return;
    for (const how of ['hover', 'focus'] as const) {
      const key = over.current[how]?.key;
      if (key !== undefined && gone.includes(key)) over.current[how] = undefined;
    }
    setHeld((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !gone.includes(key))));
  });
  // A cleared row that left no row beside it: its group's header takes the keyboard if it is still
  // there and open to it, or else the chip that is pressed now.
  const refocus = useRef<string>(undefined);
  useLayoutEffect(() => {
    const key = refocus.current;
    refocus.current = undefined;
    if (key === undefined) return;
    const head = scroller.current?.querySelector<HTMLButtonElement>(
      `[data-section="${CSS.escape(key)}"] .gc-work-group-head button`,
    );
    const chip = scroller.current?.parentElement?.querySelector<HTMLElement>('.gc-work-chip[aria-pressed="true"]');
    const first = scroller.current?.querySelector<HTMLButtonElement>('.gc-work-group-head button:enabled');
    (head && !head.disabled ? head : (chip ?? first))?.focus({ preventScroll: true });
  });
  /** Clears one row from its × (`button`): the next row takes the keyboard, or the one before. */
  const clearRow = (item: WorkTask, button: HTMLElement, section: string) => {
    const box = button.closest('.gc-work-task');
    const beside = [box?.nextElementSibling, box?.previousElementSibling].find((el) =>
      el?.classList.contains('gc-work-task'),
    );
    const row = beside?.querySelector<HTMLElement>('.gc-work-row');
    if (row) row.focus({ preventScroll: true });
    else if (box?.contains(document.activeElement)) refocus.current = section;
    release(item.key);
    clear([item]);
  };
  // The first of the rows Show N more added takes the focus its button had.
  const reveal = useRef<{ key: string; index: number }>(undefined);
  useLayoutEffect(() => {
    const target = reveal.current;
    reveal.current = undefined;
    if (!target) return;
    const rows = scroller.current?.querySelectorAll<HTMLElement>(
      `[data-section="${CSS.escape(target.key)}"] .gc-work-row`,
    );
    rows?.[target.index]?.focus();
  });
  if (!tasks.length) {
    return (
      <div className="gc-work-scroll">
        <p className="gc-work-empty">
          No delegated tasks in this conversation. When the agent hands work to other agents, each task shows here with
          what it is doing.
        </p>
      </div>
    );
  }
  const list = workList(tasks, view, held);
  const restore = (
    <button type="button" className="gc-work-link" onClick={() => onView({ ...view, dismissed: undefined })}>
      Show them
    </button>
  );
  const clear = (items: WorkTask[]) =>
    onView({
      ...view,
      dismissed: workDismiss(
        view.dismissed,
        items.map((item) => item.key),
        tasks,
      ),
    });
  return (
    <>
      {list.tools ? (
        <div className="gc-work-tools">
          <div className="gc-work-chips" role="group" aria-label="Show tasks by status">
            {([undefined, ...WORK_GROUPS] as const).map((group) =>
              group && !list.counts[group] ? null : (
                <button
                  key={group ?? 'all'}
                  type="button"
                  className="gc-work-chip"
                  aria-pressed={group ? view.filter === group : !view.filter || !list.counts[view.filter]}
                  onClick={() =>
                    // Another chip opens its groups on their newest rows, not as far as the last one was shown.
                    onView({ ...view, filter: group && view.filter !== group ? group : undefined, more: undefined })
                  }
                >
                  {group ? CHIP_LABEL[group] : 'All'} <i>{group ? list.counts[group] : list.total}</i>
                </button>
              ),
            )}
          </div>
          <div className="gc-work-acts">
            <input
              className="gc-work-field gc-work-filter"
              type="search"
              value={view.query ?? ''}
              maxLength={200}
              placeholder="Filter by title, agent, id or status"
              aria-label="Filter tasks"
              onChange={(event) => onView({ ...view, query: event.target.value || undefined, more: undefined })}
              onKeyDown={(event) => {
                // The first Escape clears the filter; the next one reaches the host (back to the chat).
                if (event.key === 'Escape' && view.query && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  onView({ ...view, query: undefined, more: undefined });
                }
              }}
            />
            <span className="gc-work-seg" role="group" aria-label="Group tasks by">
              <button
                type="button"
                aria-pressed={view.by !== 'agent'}
                onClick={() => onView({ ...view, by: undefined })}
              >
                Status
              </button>
              <button type="button" aria-pressed={view.by === 'agent'} onClick={() => onView({ ...view, by: 'agent' })}>
                Agent
              </button>
            </span>
          </div>
        </div>
      ) : null}
      <div
        className="gc-work-scroll"
        data-dense={list.dense ? 'true' : undefined}
        ref={scroller}
        onScroll={onScroll}
        onPointerDownCapture={() => {
          pressed.current = true;
        }}
      >
        {list.sections.map((section) => {
          const { key, group, tasks: all } = section;
          // In a short list a row's own clear button is enough.
          const clearable = list.tools && (group === 'done' || group === 'failed') ? all.filter(workClearable) : [];
          const earlier = group === 'done' || group === 'failed' ? 'earlier' : 'more';
          return (
            <section key={key} className="gc-work-group" aria-label={section.label} data-section={key}>
              <div className="gc-work-group-head">
                <button
                  type="button"
                  aria-expanded={!section.folded}
                  // With a filter on, every group that matches is open.
                  disabled={list.filtering}
                  onClick={() => onView({ ...view, folded: { ...view.folded, [key]: !section.folded } })}
                >
                  <svg className="gc-work-chevron" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m6 4 4 4-4 4" />
                  </svg>
                  {group ? <Glyph tone={GROUP_TONE[group]} /> : null}
                  {section.label} <span className="gc-work-count">{all.length}</span>
                </button>
                {section.folded && list.dense ? <span className="gc-work-summary">{section.summary}</span> : null}
                <span className="gc-work-grow" />
                {clearable.length ? (
                  <button
                    type="button"
                    className="gc-work-btn gc-work-xs gc-work-ghost"
                    title={`Hides the ${clearable.length} finished ${clearable.length === 1 ? 'task' : 'tasks'} that left no worktree to merge or discard. The conversation keeps them, and Show them brings them back.`}
                    aria-label={`Clear ${clearable.length} finished from ${section.label}`}
                    onClick={(event) => {
                      // The button may go with its rows: the group's header keeps the keyboard.
                      event.currentTarget.parentElement?.querySelector('button')?.focus();
                      clear(clearable);
                    }}
                  >
                    Clear {clearable.length}
                  </button>
                ) : null}
              </div>
              {section.folded ? null : (
                <>
                  {section.shown.map((item) => (
                    <TaskRow
                      key={item.key}
                      item={item}
                      now={now}
                      onOpen={onOpen}
                      onApprove={onApprove}
                      onHold={hold}
                      onClear={workClearable(item) ? (button) => clearRow(item, button, key) : undefined}
                    />
                  ))}
                  {section.next ? (
                    <button
                      type="button"
                      className="gc-work-more"
                      onClick={() => {
                        reveal.current = { key, index: section.shown.length };
                        onView({ ...view, more: { ...view.more, [key]: (view.more?.[key] ?? 0) + WORK_PAGE } });
                      }}
                    >
                      Show {section.next} {earlier}
                      {all.length - section.shown.length > section.next
                        ? ` of ${all.length - section.shown.length}`
                        : ''}
                    </button>
                  ) : null}
                </>
              )}
            </section>
          );
        })}
        {list.sections.length ? null : list.filtering ? (
          <p className="gc-work-empty">
            No task matches.{' '}
            <button
              type="button"
              className="gc-work-link"
              onClick={() => onView({ ...view, filter: undefined, query: undefined, more: undefined })}
            >
              Show all tasks
            </button>
          </p>
        ) : null}
        {list.tools || list.cleared ? (
          <p className="gc-work-foot">
            {list.tools ? (
              <>
                {workFootnote(tasks)}
                {list.dense ? ` · one-line rows above ${WORK_DENSE_ABOVE} tasks` : ''}
              </>
            ) : null}
            {list.cleared ? (
              <span>
                {list.cleared} cleared from this list. {restore}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </>
  );
}

function TaskRow({
  item,
  now,
  onOpen,
  onApprove,
  onHold,
  onClear,
}: {
  item: WorkTask;
  now: number;
  onOpen(key: string): void;
  onApprove?: WorkPanelProps['onApprove'];
  /** The pointer or the keyboard focus came to the row (`item`), or left it. */
  onHold?(how: 'hover' | 'focus', item: WorkTask | undefined): void;
  /** Clears the task from the list, from its × (`button`). Set for a finished task that left nothing to do. */
  onClear?(button: HTMLElement): void;
}) {
  const { task } = item;
  const status = workStatus(item);
  const pullRequest = taskPullRequest(task, item.pullRequest);
  const ask = item.asks[0];
  const error = packTaskError(task);
  const elapsed = packTaskElapsed(task, now);
  const activity = task.status === 'running' ? packActivity(task.text ?? '') : undefined;
  const step = packRunningStep(task);
  const doing = step ? packStepLine(step, now, task.cwd) : undefined;
  const line = ask ? (
    <span className="gc-work-line" data-tone="ask">
      <code>{askSubject(ask)}</code>
    </span>
  ) : doing ? (
    <span className="gc-work-line gc-work-doing">
      <b>{doing.verb}</b> <code>{doing.object}</code>
      <span className="gc-work-dt"> · {doing.detail}</span>
    </span>
  ) : activity ? (
    <span className="gc-work-line">
      {activity.argument ? (
        <>
          {activity.tool} <code>{activity.argument}</code>
        </>
      ) : (
        activity.text || 'Starting…'
      )}
    </span>
  ) : error && (task.status === 'failed' || task.status === 'timeout') ? (
    <span className="gc-work-line" data-tone="err">
      {error}
    </span>
  ) : (
    <span className="gc-work-line">
      {pullRequest ? `${pullRequestLabel(pullRequest, item.pullRequest?.state)} · ` : ''}
      {packTaskOutcome(task)}
    </span>
  );
  /** The row keeps the keyboard when one of its buttons goes away with what it did. */
  const toRow = (button: HTMLElement) =>
    button.closest('.gc-work-task')?.querySelector<HTMLElement>('.gc-work-row')?.focus({ preventScroll: true });
  return (
    <div
      className="gc-work-task"
      data-task={item.key}
      onMouseEnter={() => onHold?.('hover', item)}
      onMouseLeave={() => onHold?.('hover', undefined)}
      onFocus={() => onHold?.('focus', item)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHold?.('focus', undefined);
      }}
    >
      <button
        type="button"
        className="gc-work-row"
        title={`${packTaskTitle(task)} · ${status.text}`}
        onClick={() => onOpen(item.key)}
      >
        <Glyph tone={status.tone} />
        <span className="gc-work-id">{task.id}</span>
        <span className="gc-work-title">{packTaskTitle(task)}</span>
        <span className="gc-work-who">
          {task.agent}
          {elapsed ? ` · ${elapsed}` : ''}
        </span>
        {line}
        <span className="gc-work-sr">{status.text}</span>
      </button>
      {ask && ask.kind !== 'question' && onApprove ? (
        <span className="gc-work-row-acts">
          <button
            type="button"
            className="gc-work-btn gc-work-xs gc-work-primary"
            aria-label={`Approve for ${task.id}`}
            onClick={(event) => {
              toRow(event.currentTarget);
              onApprove(ask.id, 'approve');
            }}
          >
            Approve
          </button>
          <button
            type="button"
            className="gc-work-btn gc-work-xs"
            aria-label={`Deny for ${task.id}`}
            onClick={(event) => {
              toRow(event.currentTarget);
              onApprove(ask.id, 'deny');
            }}
          >
            Deny
          </button>
        </span>
      ) : onClear ? (
        <span className="gc-work-row-acts gc-work-row-clear">
          <button
            type="button"
            className="gc-work-btn gc-work-xs gc-work-ghost gc-work-icon"
            title="Clear from this list. The conversation keeps the task."
            aria-label={`Clear ${task.id} from the list`}
            onClick={(event) => onClear(event.currentTarget)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </span>
      ) : null}
    </div>
  );
}

function AskCard({
  agent,
  request,
  onApprove,
  onAutoApprove,
}: {
  agent: string;
  request: ApprovalRequest;
  onApprove?: WorkPanelProps['onApprove'];
  onAutoApprove?: WorkPanelProps['onAutoApprove'];
}) {
  const what =
    request.kind === 'command'
      ? 'wants to run a command'
      : request.kind === 'file-change'
        ? 'wants to apply edits'
        : request.kind === 'question'
          ? 'asks a question'
          : 'asks for permission';
  return (
    <div className="gc-work-card" data-tone="ask" role="group" aria-label={`${agent} ${what}`}>
      <b>
        {agent} {what}
      </b>
      <pre className="gc-work-box">{askSubject(request)}</pre>
      {request.kind === 'question' ? (
        <p className="gc-work-note">Answer it in the chat, where its options are.</p>
      ) : onApprove ? (
        <div className="gc-work-acts">
          <button
            type="button"
            className="gc-work-btn gc-work-sm gc-work-primary"
            onClick={() => onApprove(request.id, 'approve')}
          >
            {request.scope === 'turn' ? 'Approve for this turn' : 'Approve'}
          </button>
          <button type="button" className="gc-work-btn gc-work-sm" onClick={() => onApprove(request.id, 'deny')}>
            Deny
          </button>
          {onAutoApprove ? (
            <button
              type="button"
              className="gc-work-btn gc-work-sm gc-work-ghost"
              title="Approves this and every later request for the rest of this session"
              onClick={() => onAutoApprove()}
            >
              Auto-approve all
            </button>
          ) : null}
        </div>
      ) : (
        <p className="gc-work-note">Waiting for approval…</p>
      )}
    </div>
  );
}

/** A unified diff with its added, removed and hunk lines marked. */
function Diff({ text }: { text: string }) {
  return (
    <pre className="gc-work-diff" aria-label="Diff">
      {text.split('\n').map((line, i) => (
        <span
          key={i}
          data-line={
            line.startsWith('@@')
              ? 'hunk'
              : line.startsWith('+') && !line.startsWith('+++')
                ? 'add'
                : line.startsWith('-') && !line.startsWith('---')
                  ? 'del'
                  : undefined
          }
        >
          {line || ' '}
        </span>
      ))}
    </pre>
  );
}

/** The revision whose diff was read; `stale` once a merge of it was refused and the newer diff is not shown yet. */
/** `onPackAction` of `<WorkPanel>`; a `PackActionHandler` is one. */
export type WorkActionHandler = (
  turnId: number,
  id: string,
  action: PackAction,
  intent?: { pullRequest?: true },
) => Promise<string>;

type Inspected = { revision: string; stale?: boolean };

const CHANGE_WORD: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied' };

function TaskDetail({
  item,
  inspected,
  now,
  cwd,
  focusBack,
  act,
  onApprove,
  onAutoApprove,
  onBack,
}: {
  item: WorkTask;
  /** The revision whose diff the person opened: Merge locally sends it, through reviews and tests. */
  inspected: { get(): Inspected | undefined; set(value: Inspected | undefined): void };
  now: number;
  cwd: string;
  focusBack: boolean;
  act?: WorkActionHandler;
  onApprove?: WorkPanelProps['onApprove'];
  onAutoApprove?: WorkPanelProps['onAutoApprove'];
  onBack(): void;
}) {
  const { task } = item;
  const [confirm, setConfirm] = useState<'stop' | 'discard'>();
  // What the discard confirmation was opened on: the pull request held the work, or the task had
  // changed nothing. Sent as it was then, so the host re-checks it rather than discarding whatever is
  // there once that changed while the confirmation was open.
  const [discardAs, setDiscardAs] = useState<{ pullRequest: boolean; empty: boolean }>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ text: string; revision?: string }>();
  // A merge refused because the worktree moved on from this revision: the diff reloads once the
  // newer revision is known, and the next merge takes another click. Until that diff is on screen the
  // refused revision stays the inspected one and Merge locally stays off, also after leaving the task.
  const [stale, setStale] = useState<string | undefined>(() => {
    const value = inspected.get();
    return value?.stale ? value.revision : undefined;
  });
  // Reloading the newer diff failed: it waits for the person to retry.
  const [reloadFailed, setReloadFailed] = useState(false);
  // A diff read before the revision was known: it is read again once the revision is.
  const [unresolved, setUnresolved] = useState(false);
  // A diff refused because the worktree moved on from this revision: read again for the newer one.
  const [reread, setReread] = useState<string>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusBack) backButton.current?.focus({ preventScroll: true });
  }, []);
  const running = task.status === 'running';
  const worktree = task.state === 'unmerged' && !running;
  const merges = mergesLocally(task, item.pullRequest);
  const pullRequest = taskPullRequest(task, item.pullRequest);
  const empty = changedNothing(task);
  const checks = task.checks;
  const checking = checks?.review?.status === 'running' || checks?.verify?.status === 'running';
  const visibleDiff = diff && diff.revision === checks?.revision ? diff.text : undefined;
  /** `composer`: the composer's text this action sends, cleared once sent (Send again leaves a draft alone). */
  const perform = async (action: PackAction, intent?: { pullRequest?: true }, composer?: string) => {
    if (!act || busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const text = await (intent ? act(item.turnId, task.id, action, intent) : act(item.turnId, task.id, action));
      if (action.type === 'diff') {
        if (action.revision) {
          // Marked inspected once it is on screen (below): a reply after the detail closed shows nothing.
          setStale(undefined);
          setReloadFailed(false);
          setDiff({ text, revision: action.revision });
        } else {
          // The revision was not known: the server worked it out and reports it with the task. Read
          // the diff again for that revision, so what shows is what Merge locally then sends.
          setUnresolved(true);
        }
      } else {
        if (action.type !== 'steer' && action.type !== 'review' && action.type !== 'verify') setFeedback({ text });
        setConfirm(undefined);
        if (composer !== undefined) setInput((current) => (current === composer ? '' : current));
      }
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
      // The worktree moved on since the diff that was looked at: show what is there now first.
      // (`PackActionError` and the page's own errors carry the refusal's reason.)
      const refusedStale = (error as { reason?: unknown })?.reason === 'stale';
      if (action.type === 'merge' && action.revision && refusedStale) {
        inspected.set({ revision: action.revision, stale: true });
        setDiff(undefined);
        setStale(action.revision);
        setReloadFailed(false);
      } else if (action.type === 'diff' && action.revision && refusedStale && !stale) {
        // The worktree moved on before its diff was read: read it again once the newer revision is known.
        setFeedback(undefined);
        setReread(action.revision);
      } else if (action.type === 'diff' && stale) {
        setReloadFailed(true);
      }
    } finally {
      setBusy(false);
    }
  };
  // Only a diff this detail renders is one the person read: Merge locally then sends its revision.
  useEffect(() => {
    if (visibleDiff !== undefined && diff?.revision) inspected.set({ revision: diff.revision });
  }, [visibleDiff !== undefined, diff?.revision]);
  useEffect(() => {
    if (!stale || busy || reloadFailed || !checks?.revision || checks.revision === stale) return;
    void perform({ type: 'diff', revision: checks.revision });
  }, [stale, busy, reloadFailed, checks?.revision]);
  useEffect(() => {
    if (!reread || busy || !checks?.revision || checks.revision === reread) return;
    setReread(undefined);
    void perform({ type: 'diff', revision: checks.revision });
  }, [reread, busy, checks?.revision]);
  useEffect(() => {
    if (!unresolved || busy || !checks?.revision) return;
    setUnresolved(false);
    void perform({ type: 'diff', revision: checks.revision });
  }, [unresolved, busy, checks?.revision]);
  const status = workStatus(item);
  const stopped = packTaskStopped(task);
  const error = packTaskError(task);
  const activity = running ? packActivity(task.text ?? '') : undefined;
  const elapsed = packTaskElapsed(task, now);
  const step = packRunningStep(task);
  const doing = step ? packStepLine(step, now, task.cwd) : undefined;
  const said = packLatestMessage(task);
  const send = () => {
    const text = input.trim();
    if (text) void perform({ type: 'steer', text }, undefined, input);
  };
  // Any worktree still on disk can show its diff, also one whose task changed nothing: it may have
  // been edited since.
  const diffButton =
    act && worktree ? (
      <button
        type="button"
        className="gc-work-btn gc-work-xs"
        aria-expanded={visibleDiff !== undefined}
        disabled={busy}
        onClick={() =>
          visibleDiff === undefined ? void perform({ type: 'diff', revision: checks?.revision }) : setDiff(undefined)
        }
      >
        {visibleDiff === undefined ? 'Show diff' : 'Hide diff'}
      </button>
    ) : null;
  // What the review said stays as it said it, also once the task is merged or discarded.
  const blocker = reviewBlocker(checks);
  const outdated = merges && !!checks?.review && checks.review.revision !== checks.revision;
  return (
    <>
      <div className="gc-work-scroll gc-work-detail" role="region" aria-label={`Task ${task.id}`}>
        <button
          ref={backButton}
          type="button"
          className="gc-work-btn gc-work-sm gc-work-ghost gc-work-back"
          onClick={onBack}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3 5 8l5 5" />
          </svg>
          Tasks
        </button>
        <div className="gc-work-head">
          <h3>
            <span className="gc-work-id">{task.id}</span> {packTaskTitle(task)}
          </h3>
          <span className="gc-work-pill" data-tone={status.tone} role="status">
            <Glyph tone={status.tone} />
            {status.text}
          </span>
        </div>
        <p className="gc-work-meta">
          {[
            task.agent,
            task.model,
            task.effort && `effort ${task.effort}`,
            task.mode === 'shared' ? 'works in your folder' : 'works in its own copy (a git worktree)',
            workTimes(task, now),
          ]
            .filter(Boolean)
            .join(' · ')}
          {task.mode === 'worktree' || task.cwd !== cwd ? (
            <>
              <br />
              <code title={task.cwd}>{relativePath(task.cwd, cwd)}</code>
            </>
          ) : null}
          {task.mcpServers?.length ? ` · MCP: ${task.mcpServers.join(', ')}` : ''}
        </p>
        {item.asks.map((request) => (
          <AskCard
            key={request.id}
            agent={task.agent}
            request={request}
            onApprove={onApprove}
            onAutoApprove={onAutoApprove}
          />
        ))}
        {running ? (
          <div className="gc-work-card" data-tone="run" aria-label="Doing now" role="group">
            {/* Announced when what it does changes; the time, which ticks every second, is not read out. */}
            <div className="gc-work-now" aria-live="polite">
              {doing ? (
                <>
                  <b>{doing.verb}</b> <code title={doing.object}>{doing.object}</code>
                  <span className="gc-work-elapsed" aria-hidden="true" title={`Started ${clockTime(step!.at)}`}>
                    {doing.detail}
                  </span>
                </>
              ) : (
                <>
                  {activity?.argument ? (
                    <>
                      <b>{activity.tool}</b> <code title={activity.argument}>{activity.argument}</code>
                    </>
                  ) : (
                    <b>{activity?.text || 'Starting…'}</b>
                  )}
                  {elapsed ? (
                    <span className="gc-work-elapsed" aria-hidden="true">
                      {elapsed}
                    </span>
                  ) : null}
                </>
              )}
            </div>
            {doing && said ? (
              <p className="gc-work-say">
                <small>Latest message · {task.agent}</small>
                {said}
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="gc-work-card" data-tone="err" role="group" aria-label="Error">
            <b>{status.tone === 'err' ? status.text : 'Error'}</b>
            <p>{error}</p>
          </div>
        ) : null}
        {task.quotaHint ? <p className="gc-work-note">{packQuotaText(task.agent, task.quotaHint)}</p> : null}
        {stopped ? <p className="gc-work-stopped">{stopped}.</p> : null}

        <h4 className="gc-work-label">What it was asked</h4>
        <Asked prompt={task.prompt} />

        {!running && (task.verdict || (task.text && !(stopped && task.text.trim() === task.error?.trim()))) ? (
          <>
            <h4 className="gc-work-label">
              Result <span>final reply from {task.agent}</span>
            </h4>
            <div className="gc-work-result" aria-label="Result">
              {task.verdict ? <p className="gc-work-verdict">{task.verdict.replace(/\*\*/g, '')}</p> : null}
              {task.text ? <Markdown text={task.text} /> : null}
            </div>
          </>
        ) : null}

        {task.pullRequest ? (
          <>
            {/* A pull request the task did not open is only a link: its worktree is merged or discarded as any other. */}
            <h4 className="gc-work-label">{pullRequest ? 'Pull request' : 'Pull request in its reply'}</h4>
            <p className="gc-work-pr">
              <a href={task.pullRequest.url} target="_blank" rel="noopener noreferrer">
                {pullRequestLabel(task.pullRequest, item.pullRequest?.state)}
              </a>
              <span>{task.pullRequest.url.replace(/^https:\/\/github\.com\//, '')}</span>
            </p>
            {worktree && pullRequest ? <p className="gc-work-note">{PULL_REQUEST_HELP}</p> : null}
          </>
        ) : null}

        {task.changes?.length || (worktree && !task.changes) ? (
          <>
            <h4 className="gc-work-label">
              Changed files{' '}
              <span>
                {task.changes ? `${task.changes.length} ${task.changes.length === 1 ? 'file' : 'files'}` : null}
                {checks?.revision ? (
                  <>
                    {' '}
                    · revision <code>{checks.revision.slice(0, 7)}</code>
                  </>
                ) : null}
              </span>
              {diffButton}
            </h4>
            {task.changes ? (
              <ul className="gc-work-files" aria-label="Changed files">
                {task.changes.map((line) => {
                  const [kind = '', ...rest] = line.split('\t');
                  return (
                    <li key={line}>
                      <span data-change={kind[0]} title={CHANGE_WORD[kind[0] ?? ''] ?? kind}>
                        {kind[0]}
                      </span>
                      <code>{rest.join(' → ') || line}</code>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="gc-work-note">The changed files could not be listed. Show diff has what changed.</p>
            )}
            {worktree && visibleDiff !== undefined ? <Diff text={visibleDiff} /> : null}
          </>
        ) : empty && !running ? (
          <>
            {/* The worktree is still there: an edit made in it since the task ended shows in its diff. */}
            <h4 className="gc-work-label">Changed files {diffButton}</h4>
            <p className="gc-work-note">It changed no files.{worktree ? ` ${NO_CHANGES_HELP}` : ''}</p>
            {worktree && visibleDiff !== undefined ? <Diff text={visibleDiff} /> : null}
          </>
        ) : null}

        {checks && !running && (merges || checks.review || checks.verify) ? (
          <>
            <h4 className="gc-work-label">
              Checks before merge{' '}
              {checks.revision ? (
                <span>
                  on revision <code>{checks.revision.slice(0, 7)}</code>
                </span>
              ) : null}
            </h4>
            <div className="gc-work-checks" aria-label="Checks before merge">
              {(['review', 'verify'] as const).map((kind) => {
                const source = kind === 'review' ? checks.reviewer : checks.command;
                const label = packCheckLabel(checks, kind);
                const result = checks[kind];
                const tone =
                  label === 'Failed'
                    ? 'err'
                    : label === 'Outdated'
                      ? 'ask'
                      : label === 'Running…'
                        ? 'run'
                        : kind === 'review' && blocker
                          ? 'err'
                          : 'ok';
                return (
                  <div key={kind} className="gc-work-check">
                    <div className="gc-work-check-head">
                      <b>{kind === 'review' ? 'Code review' : 'Tests'}</b>
                      {source ? kind === 'review' ? <span>by {source}</span> : <code>{source}</code> : null}
                      <span className="gc-work-grow" />
                      {result ? (
                        <span className="gc-work-pill" data-tone={tone} role="status">
                          {kind === 'review' && blocker && label === 'Reviewed' ? 'Blocker' : label}
                        </span>
                      ) : null}
                      {act && merges && source ? (
                        <button
                          type="button"
                          className="gc-work-btn gc-work-xs"
                          disabled={busy || checking}
                          onClick={() => void perform({ type: kind })}
                        >
                          {kind === 'review' ? 'Request review' : 'Run tests'}
                        </button>
                      ) : null}
                    </div>
                    {!source && merges ? (
                      <p className="gc-work-note">{kind === 'review' ? reviewHelp(task) : testsHelp(task, cwd)}</p>
                    ) : null}
                    {result?.detail ? (
                      <details>
                        <summary>{kind === 'review' ? 'Review notes' : 'Test output'}</summary>
                        <pre className="gc-work-box">{result.detail}</pre>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {act && worktree ? (
          <fieldset className="gc-work-merge" disabled={busy} aria-label={`Changes of ${task.id}`}>
            {confirm === 'discard' ? (
              <>
                <b>Discard this worktree and its changes?</b>
                <p className="gc-work-note">Its folder is deleted, files Git ignores (logs, build output) included.</p>
                <div className="gc-work-acts">
                  <button type="button" className="gc-work-btn gc-work-sm" onClick={() => setConfirm(undefined)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="gc-work-btn gc-work-sm gc-work-danger"
                    onClick={() =>
                      void perform(
                        discardAs?.empty ? { type: 'discard', empty: true } : { type: 'discard' },
                        discardAs?.pullRequest ? { pullRequest: true } : undefined,
                      )
                    }
                  >
                    Confirm discard
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="gc-work-acts">
                  {merges ? (
                    <button
                      type="button"
                      className={`gc-work-btn gc-work-sm${blocker || outdated ? '' : ' gc-work-primary'}`}
                      disabled={checking || !!stale}
                      onClick={() =>
                        void perform({ type: 'merge', revision: inspected.get()?.revision ?? checks?.revision })
                      }
                    >
                      Merge locally
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="gc-work-btn gc-work-sm gc-work-danger"
                    disabled={checking}
                    onClick={() => {
                      setDiscardAs({ pullRequest: !!pullRequest, empty });
                      setConfirm('discard');
                    }}
                  >
                    {merges ? 'Discard' : 'Discard worktree'}
                  </button>
                </div>
                {merges && stale ? (
                  <p className="gc-work-note" role="status">
                    The worktree changed since the diff you read. Merge locally waits until its new diff is shown.
                    {reloadFailed ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="gc-work-btn gc-work-xs"
                          disabled={!checks?.revision || checks.revision === stale}
                          onClick={() => setReloadFailed(false)}
                        >
                          Retry diff
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : merges ? (
                  <p className="gc-work-note">
                    {MERGE_LOCALLY_HELP}
                    {blocker
                      ? ' The review found a blocker: read its notes first.'
                      : outdated
                        ? ' The review is of an earlier revision: request it again to check what is here now.'
                        : ''}
                  </p>
                ) : null}
              </>
            )}
          </fieldset>
        ) : null}
        {task.steps?.length || task.steers?.length || task.startedAt !== undefined ? (
          <>
            <h4 className="gc-work-label">
              Timeline <span>newest first</span>
            </h4>
            <Timeline
              item={item}
              now={now}
              cwd={cwd}
              resend={
                running && task.canSteer && act && !busy ? (text) => void perform({ type: 'steer', text }) : undefined
              }
            />
          </>
        ) : null}
        {feedback ? (
          <p role="status" className={feedback.error ? 'gc-work-feedback gc-work-bad' : 'gc-work-feedback'}>
            {feedback.text}
          </p>
        ) : null}
      </div>
      {running && act ? (
        <fieldset className="gc-work-steer" disabled={busy} aria-label={`Message ${task.id}`}>
          {confirm === 'stop' ? (
            <div className="gc-work-acts">
              <b>Stop this task?</b>
              <span className="gc-work-grow" />
              <button type="button" className="gc-work-btn" onClick={() => setConfirm(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                className="gc-work-btn gc-work-danger"
                onClick={() => void perform({ type: 'stop' })}
              >
                Confirm stop
              </button>
            </div>
          ) : (
            <div className="gc-work-acts">
              {task.canSteer ? (
                <>
                  <input
                    className="gc-work-field"
                    value={input}
                    maxLength={32_000}
                    placeholder={`Message ${task.id} while it works…`}
                    aria-label={`Message to ${task.agent}`}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        send();
                      } else if (event.key === 'Escape' && input && !event.nativeEvent.isComposing) {
                        // The first Escape clears what was typed; the next one reaches the host (back to the chat).
                        event.preventDefault();
                        setInput('');
                      }
                    }}
                  />
                  <button type="button" className="gc-work-btn gc-work-primary" disabled={!input.trim()} onClick={send}>
                    Steer
                  </button>
                </>
              ) : (
                <span className="gc-work-grow" />
              )}
              <button type="button" className="gc-work-btn gc-work-danger" onClick={() => setConfirm('stop')}>
                Stop task
              </button>
            </div>
          )}
          <small>
            {task.canSteer
              ? `${task.agent} reads your message between two steps of its work. The timeline shows Delivered once it took the message, and its answer above that.`
              : `${task.agent} cannot take messages while it works. Stop the task, or wait until it finishes.`}
          </small>
        </fieldset>
      ) : null}
    </>
  );
}

const STEP_ICON: Record<PackStep['kind'] | 'start', ReactNode> = {
  tool: <path d="m3 5 3 3-3 3M8 11h5" />,
  edit: <path d="M3 13h2.5L13 5.5 10.5 3 3 10.5zM9.5 4 12 6.5" />,
  message: <path d="M2.5 3.5h11v7h-6L4.5 13v-2.5h-2z" />,
  approval: <path d="M8 2 14 8 8 14 2 8z" />,
  error: <path d="m4 4 8 8M12 4l-8 8" />,
  start: <path d="M8 2v4M8 10v4M2 8h4M10 8h4" />,
};

function StepIcon({ kind }: { kind: keyof typeof STEP_ICON }) {
  return (
    <svg className="gc-work-tl-icon" viewBox="0 0 16 16" aria-hidden="true">
      {STEP_ICON[kind]}
    </svg>
  );
}

function Clock({ at }: { at: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
      {clockTime(at)}
    </time>
  );
}

type TimelineRow = { at: number; order: number } & ({ step: PackStep } | { steer: PackSteer });

/**
 * The timeline's rows, newest first. A tool call that returned counts from its end, so one that ran
 * long and just failed is at the top; one that has not returned is left out (the card above shows
 * the one running now). Worked out when the task changes, not on every tick of the clock.
 */
function timelineRows(steps: PackStep[] = [], steers: PackSteer[] = []): TimelineRow[] {
  const rows: TimelineRow[] = [
    ...steps.flatMap((step, order) =>
      step.kind === 'tool' && step.endedAt === undefined ? [] : [{ at: packStepRecency(step), order, step }],
    ),
    ...steers.map((steer, order) => ({ at: steer.at, order, steer })),
  ];
  // At the same instant a message to the task comes before (so shows under) what followed it.
  return rows.sort((a, b) => b.at - a.at || Number('steer' in a) - Number('steer' in b) || b.order - a.order);
}

/**
 * What a task did, newest first: the tool calls that returned, with what each worked on and how it
 * went; what the agent said; the messages sent to it, each with its receipt; and its start. The
 * tool call that runs now is in the card above, not here.
 */
function Timeline({
  item,
  now,
  cwd,
  resend,
}: {
  item: WorkTask;
  now: number;
  /** The chat's folder: the task's directory is shown relative to it. */
  cwd: string;
  /** Send a message that was not delivered once more. Absent when the task takes none now. */
  resend?(text: string): void;
}) {
  const { task } = item;
  const ended = task.endedAt !== undefined;
  const rows = useMemo(() => timelineRows(task.steps, task.steers), [task.steps, task.steers]);
  return (
    <ol className="gc-work-tl" aria-label="Timeline">
      {rows.map((row) => {
        if ('steer' in row) {
          const { steer } = row;
          const receipt = packSteerReceipt(steer, task.agent, ended);
          const who = steer.from === 'lead' ? 'Lead' : 'You';
          return (
            <li key={`steer ${row.order}`} data-kind="steer">
              <StepIcon kind="message" />
              <div className="gc-work-bubble" data-from={steer.from}>
                <div className="gc-work-by">
                  <b>{who}</b>
                  <span
                    className="gc-receipt"
                    data-state={receipt.state}
                    role="status"
                    title={receipt.title}
                    aria-label={`${steer.from === 'lead' ? 'Lead’s message' : 'Your message'}: ${receipt.spoken}`}
                  >
                    {receipt.text}
                  </span>
                  <Clock at={steer.at} />
                  {receipt.state === 'failed' && steer.from === 'user' && resend ? (
                    <button type="button" className="gc-work-btn gc-work-xs" onClick={() => resend(steer.text)}>
                      Send again
                    </button>
                  ) : null}
                </div>
                <p>{steer.text}</p>
              </div>
            </li>
          );
        }
        const { step } = row;
        if (step.kind === 'message') {
          return (
            <li key={`step ${step.at} ${row.order}`} data-kind="message">
              <StepIcon kind="message" />
              <div className="gc-work-bubble">
                <div className="gc-work-by">
                  <b>{task.agent}</b>
                  <Clock at={step.at} />
                </div>
                <p>{step.text}</p>
              </div>
            </li>
          );
        }
        const line = packStepLine(step, now, task.cwd);
        return (
          <li key={`step ${step.at} ${row.order}`} data-kind={step.kind} data-failed={line.failed ? 'true' : undefined}>
            <StepIcon kind={step.kind} />
            <span className="gc-work-tl-x">
              <b>{line.verb}</b> <code title={line.object}>{line.object}</code>
              {line.detail ? <span> {line.detail}</span> : null}
            </span>
            <Clock at={row.at} />
          </li>
        );
      })}
      {task.startedAt !== undefined ? (
        <li data-kind="start">
          <StepIcon kind="start" />
          <span className="gc-work-tl-x">
            <b>Started</b> by {item.lead} in <code title={task.cwd}>{relativePath(task.cwd, cwd) || '.'}</code>
          </span>
          <Clock at={task.startedAt} />
        </li>
      ) : null}
    </ol>
  );
}

/** The task's instructions as the lead wrote them; a long one shows its start until it is opened. */
function Asked({ prompt }: { prompt: string }) {
  const [all, setAll] = useState(false);
  const long = prompt.length > 420 || prompt.split('\n').length > 6;
  return (
    <div className="gc-work-asked">
      <p data-clipped={long && !all ? 'true' : undefined}>{prompt}</p>
      {long ? (
        <button type="button" className="gc-work-link" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show less' : 'Show all of it'}
        </button>
      ) : null}
    </div>
  );
}
