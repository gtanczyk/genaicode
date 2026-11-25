/**
 * What `<WorkPanel>` shows and where it fits, without React: the delegated tasks of a session in
 * the groups of "what to do next", their status in words, the panel's place beside the chat, and
 * what is remembered of it per chat.
 */
import type { PackTaskChecks } from '../agents/pack-checks.js';
import type { PackPullRequest, PackTask } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import type { ApprovalRequest } from '../agents/types.js';
import { formatDuration, relativePath } from './format.js';

/** The panel's narrowest width, its width until someone drags it, and what the chat keeps beside it. */
export const WORK_PANEL_MIN = 380;
export const WORK_PANEL_DEFAULT = 420;
export const WORK_CHAT_MIN = 600;

/**
 * Where the panel goes. `room` is the width the chat and the panel share (the window without the
 * sidebar). The panel docks beside the chat while the chat keeps `WORK_CHAT_MIN`; otherwise it is a
 * full-width view in the chat's place. Docked, it is `saved` (or the default) between
 * `WORK_PANEL_MIN` and `max`: what the chat leaves, and never more than half the window.
 */
export function workPanelLayout(sizes: { room: number; window: number; saved?: number }): {
  docks: boolean;
  width: number;
  max: number;
} {
  const max = Math.floor(Math.min(sizes.room - WORK_CHAT_MIN, sizes.window / 2));
  const docks = max >= WORK_PANEL_MIN;
  const width = Math.max(WORK_PANEL_MIN, Math.min(Math.round(sizes.saved ?? WORK_PANEL_DEFAULT), max));
  return { docks, width: docks ? width : WORK_PANEL_MIN, max: Math.max(max, WORK_PANEL_MIN) };
}

/** Whether a pull request is still open, was merged, or was closed without a merge. */
export type PullRequestState = 'open' | 'merged' | 'closed';

/** What the host learned of the pull request a task's final reply links to (`PackTask.pullRequest`). */
export interface PullRequestStatus {
  state?: PullRequestState;
  /**
   * The task opened it: its worktree has the pull request's head branch checked out, so the work is
   * in the pull request. Otherwise the reply only refers to it, and the worktree is merged or
   * discarded as any other.
   */
  ours?: boolean;
}

/** The groups of the task list, in the order of what to do next. */
export const WORK_GROUPS = ['ask', 'failed', 'blocked', 'running', 'unmerged', 'done'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];

export const WORK_GROUP_LABEL: Record<WorkGroup, string> = {
  ask: 'Needs you',
  failed: 'Failed',
  blocked: 'Review blockers',
  running: 'Running',
  unmerged: 'Unmerged',
  done: 'Done',
};

/** A delegated task with what the panel needs beside it. */
export interface WorkTask {
  /** Unique in the session: the owning turn and the task's id. */
  key: string;
  /** The turn that delegated it: actions go to that turn. */
  turnId: number;
  task: PackTask;
  /** Approvals it waits for right now. */
  asks: ApprovalRequest[];
  /** The turn's pack still takes actions (a transcript read from a store does not). */
  interactive: boolean;
  /** The lead that delegated it. */
  lead: string;
  group: WorkGroup;
  /** What the host learned of the pull request its reply links to, once it looked. */
  pullRequest?: PullRequestStatus;
}

/**
 * A review that stands in the way of a merge: one on the current revision that failed, or whose
 * notes have a line that starts with BLOCKER.
 */
export function reviewBlocker(checks: PackTaskChecks | undefined): boolean {
  const review = checks?.review;
  if (!review || review.status === 'running' || review.revision !== checks.revision) return false;
  return review.status === 'failed' || /^[\s>*_#\-\d.)]*BLOCKER\b/m.test(review.detail ?? '');
}

/**
 * Whether a pull request's state can no longer change: only a merge is final. A closed one can be
 * reopened (and merged), so a host keeps asking about it while it shows.
 */
export function pullRequestSettled(status: PullRequestStatus | undefined): boolean {
  return status?.state === 'merged';
}

/** The pull request a task ended in: the one its reply links to, when the task opened it. */
export function taskPullRequest(task: PackTask, status?: PullRequestStatus): PackPullRequest | undefined {
  return task.pullRequest && status?.ours ? task.pullRequest : undefined;
}

/** A worktree task that is known to have changed no files: there is nothing to merge. */
export function changedNothing(task: PackTask): boolean {
  return task.mode === 'worktree' && !!task.changes && task.changes.length === 0;
}

/**
 * A worktree task whose changes are neither merged nor discarded, and are in no pull request the
 * task opened. A task that changed no files has nothing to merge; one whose files could not be
 * listed still may.
 */
export function mergesLocally(task: PackTask, pullRequest?: PullRequestStatus): boolean {
  return (
    task.state === 'unmerged' &&
    task.status !== 'running' &&
    !taskPullRequest(task, pullRequest) &&
    !changedNothing(task)
  );
}

function groupOf(task: PackTask, asks: number, pullRequest?: PullRequestStatus): WorkGroup {
  if (asks) return 'ask';
  if (task.status === 'running') return 'running';
  if (task.status === 'failed' || task.status === 'timeout') return 'failed';
  if (mergesLocally(task, pullRequest)) return reviewBlocker(task.checks) ? 'blocked' : 'unmerged';
  return 'done';
}

/**
 * Every delegated task of the session, oldest first, each with its group. `pullRequests` is what
 * the host learned of the pull requests the tasks' replies link to, by `WorkTask.key`.
 */
export function workTasks(
  state: SessionState | null | undefined,
  pullRequests?: Readonly<Record<string, PullRequestStatus | undefined>>,
): WorkTask[] {
  const list: WorkTask[] = [];
  for (const turn of state?.turns ?? []) {
    if (!turn.pack) continue;
    // Only a turn still running has approvals to answer.
    const pending = turn.result ? [] : (state?.approvals ?? []);
    for (const task of turn.pack.tasks) {
      const asks = pending.filter((request) => request.subtaskId === task.id);
      const key = `${turn.id}:${task.id}`;
      const pullRequest = task.pullRequest ? pullRequests?.[key] : undefined;
      list.push({
        key,
        turnId: turn.id,
        task,
        asks,
        interactive: turn.pack.interactive,
        lead: turn.pack.lead,
        group: groupOf(task, asks.length, pullRequest),
        ...(pullRequest ? { pullRequest } : {}),
      });
    }
  }
  return list;
}

/** The tasks by group, in the groups' order, newest first inside a group; empty groups are left out. */
export function workGroups(tasks: readonly WorkTask[]): Array<{ group: WorkGroup; tasks: WorkTask[] }> {
  const newest = tasks.slice().reverse();
  return WORK_GROUPS.map((group) => ({ group, tasks: newest.filter((item) => item.group === group) })).filter(
    (entry) => entry.tasks.length,
  );
}

/** How many tasks wait for the person: the count on the Work button. */
export function workNeedsYou(tasks: readonly WorkTask[]): number {
  return tasks.filter((item) => item.group === 'ask').length;
}

/** "PR #12 · merged": the pull request a task ended in, with its state once it is known. */
export function pullRequestLabel(pullRequest: PackPullRequest, state?: PullRequestState): string {
  return `PR #${pullRequest.number}${state ? ` · ${state}` : ''}`;
}

/** The hue and shape a status is drawn with (docs/design/desktop-layout.md, "Visual language"). */
export type WorkTone = 'run' | 'ask' | 'err' | 'block' | 'merge' | 'ok' | 'idle';

/** A task's status in words, and the tone of its glyph and pill. */
export function workStatus(item: WorkTask): { text: string; tone: WorkTone } {
  const { task } = item;
  if (item.group === 'ask') return { text: 'Needs approval', tone: 'ask' };
  if (task.status === 'running') return { text: 'Running', tone: 'run' };
  if (task.status === 'failed') return { text: 'Failed', tone: 'err' };
  if (task.status === 'timeout') return { text: 'Timed out', tone: 'err' };
  const pullRequest = taskPullRequest(task, item.pullRequest);
  if (pullRequest) {
    const state = item.pullRequest?.state;
    return { text: pullRequestLabel(pullRequest, state), tone: state === 'merged' ? 'ok' : 'idle' };
  }
  if (task.state === 'merged') return { text: 'Merged locally', tone: 'ok' };
  if (task.state === 'discarded') return { text: 'Discarded', tone: 'idle' };
  if (item.group === 'blocked') return { text: 'Review blocker', tone: 'block' };
  if (task.state === 'unmerged' && changedNothing(task)) return { text: 'No changes', tone: 'idle' };
  if (task.state === 'unmerged') return { text: 'Unmerged', tone: 'merge' };
  if (task.status === 'aborted') return { text: 'Stopped', tone: 'idle' };
  return { text: 'Done', tone: 'ok' };
}

/** "started 10:02 · ran 3m 12s": when a task started and how long it ran, or has run so far. */
export function workTimes(task: PackTask, now = Date.now()): string {
  if (task.startedAt === undefined) return '';
  const started = new Date(task.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const end = task.endedAt ?? (task.status === 'running' ? now : undefined);
  if (end === undefined) return `started ${started}`;
  const span = formatDuration(end - task.startedAt);
  return `started ${started} · ${task.status === 'running' ? `running for ${span}` : `took ${span}`}`;
}

/** An approval's subject without the "[agent id]" a pack puts in front of it. */
export function askSubject(request: ApprovalRequest): string {
  return (request.summary ?? request.kind).replace(/^\[[^\]]*\]\s*/, '');
}

/** What the person can do when no agent can review a task's changes. */
export function reviewHelp(task: PackTask): string {
  return (
    `No second agent can review these changes: a review is done by an installed agent other than ${task.agent} ` +
    'that can read a patch without running tools (Claude Code can). Read the changes yourself with Show diff, ' +
    'or install and sign in to such an agent and start a new chat.'
  );
}

/** What the person can do when the chat has no test command. `cwd` is the chat's folder. */
export function testsHelp(task: PackTask, cwd = ''): string {
  return (
    `No test command is set for this chat, so tests cannot run from here. Run them yourself in ${relativePath(task.cwd, cwd)}, ` +
    'or start genaicode with --verify "npm test" (your own test command) to get a Run tests button.'
  );
}

/** What Merge locally does, in one line. */
export const MERGE_LOCALLY_HELP =
  'Merge locally copies this task’s changes from its worktree into your project folder. Nothing is staged, committed or pushed.';

/** What is left to do with a worktree whose work is in a pull request. */
export const PULL_REQUEST_HELP =
  'The work is in the pull request, so there is nothing to merge here. Discard removes the local worktree copy only.';

/** What is left to do with a worktree whose task changed no files. */
export const NO_CHANGES_HELP = 'There is nothing to merge. Discard worktree removes the empty worktree.';

// ---------------------------------------------------------------------------------------------
// What is remembered

/** What the panel remembers per chat. */
export interface WorkPanelView {
  /** Open or closed, once the person chose; until then the panel opens by itself where it fits. */
  open?: boolean;
  tab: WorkTab;
  /** The task whose detail is open (`WorkTask.key`). */
  task?: string;
  /** Groups folded by hand. Done is folded by itself while another group has tasks. */
  folded?: Partial<Record<WorkGroup, boolean>>;
  /** How far the task list is scrolled. */
  scroll?: number;
  /** How many tasks the chat had when the panel was last looked at: more than that is news. */
  seen?: number;
}

/** The panel's tabs. Live, Changes and Artifacts come with later steps of the layout. */
export type WorkTab = 'tasks';

export const WORK_VIEW_KEY = 'genaicode-work';
export const WORK_WIDTH_KEY = 'genaicode-work-width';
/** Chats whose panel state is kept; the ones looked at longest ago are dropped. */
const WORK_VIEWS_KEPT = 50;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readViews(store: Store): Array<[string, WorkPanelView]> {
  try {
    const parsed: unknown = JSON.parse(store.getItem(WORK_VIEW_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, WorkPanelView] =>
        Array.isArray(entry) && typeof entry[0] === 'string' && !!entry[1] && typeof entry[1] === 'object',
    );
  } catch {
    // Storage blocked or damaged: nothing is remembered.
    return [];
  }
}

/** What was remembered for `chat`; a chat seen for the first time starts on Tasks, undecided. */
export function readWorkView(store: Store, chat: string): WorkPanelView {
  const found = readViews(store).find(([key]) => key === chat)?.[1];
  return {
    tab: 'tasks',
    ...(typeof found?.open === 'boolean' ? { open: found.open } : {}),
    ...(typeof found?.task === 'string' ? { task: found.task } : {}),
    ...(found?.folded && typeof found.folded === 'object' ? { folded: found.folded } : {}),
    ...(typeof found?.scroll === 'number' ? { scroll: found.scroll } : {}),
    ...(typeof found?.seen === 'number' ? { seen: found.seen } : {}),
  };
}

export function writeWorkView(store: Store, chat: string, view: WorkPanelView): void {
  try {
    const rest = readViews(store).filter(([key]) => key !== chat);
    store.setItem(WORK_VIEW_KEY, JSON.stringify([[chat, view], ...rest].slice(0, WORK_VIEWS_KEPT)));
  } catch {
    // Storage blocked: the state lasts until the page is closed.
  }
}
