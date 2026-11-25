import { describe, expect, it } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import {
  mergesLocally,
  pullRequestLabel,
  pullRequestSettled,
  readWorkView,
  reviewBlocker,
  WORK_VIEW_KEY,
  workGroups,
  workNeedsYou,
  workPanelLayout,
  workStatus,
  workTasks,
  writeWorkView,
  type PullRequestStatus,
} from './work.js';

const base = { agent: 'codex', prompt: 'Do it.', cwd: '/work/app', mode: 'worktree' as const };
const task = (id: string, patch: Partial<PackTask>): PackTask => ({ ...base, id, status: 'completed', ...patch });

function session(tasks: PackTask[], approvals: SessionState['approvals'] = []): SessionState {
  return {
    agent: 'claude',
    cwd: '/work/app',
    status: 'running',
    canSteer: true,
    usage: {},
    queued: [],
    approvals,
    turns: [
      {
        id: 1,
        agent: 'claude',
        prompt: 'go',
        startedAt: 0,
        entries: [],
        pack: { lead: 'claude', maxParallel: 4, interactive: true, tasks },
      },
    ],
  } as SessionState;
}

describe('workPanelLayout', () => {
  // The Widths table of docs/design/desktop-layout.md: sidebar 268 px, rail 56 px.
  it.each([
    [1440, 268, true, 420],
    [1280, 268, true, 412],
    [1100, 268, false, 380],
    [1100, 56, true, 420],
    [900, 56, false, 380],
  ])('at %i px with a %i px sidebar: docks %s, %i px', (window, side, docks, width) => {
    expect(workPanelLayout({ room: window - side, window })).toMatchObject({ docks, width });
  });

  it('keeps a dragged width between 380 px and what the chat and half the window leave', () => {
    expect(workPanelLayout({ room: 1172, window: 1440, saved: 200 }).width).toBe(380);
    expect(workPanelLayout({ room: 1172, window: 1440, saved: 500 }).width).toBe(500);
    // 1172 - 600 = 572 is what the chat leaves.
    expect(workPanelLayout({ room: 1172, window: 1440, saved: 900 })).toMatchObject({ width: 572, max: 572 });
    // With the rail the chat would leave 1344; half the window is the limit.
    expect(workPanelLayout({ room: 1944, window: 2000, saved: 1200 }).width).toBe(1000);
  });
});

describe('workTasks', () => {
  const tasks = [
    task('t1', { status: 'completed', mode: 'shared' }),
    task('t2', { status: 'completed', state: 'unmerged' }),
    task('t3', { status: 'failed', error: 'boom' }),
    task('t4', { status: 'running' }),
    task('t5', { status: 'running' }),
    task('t6', {
      state: 'unmerged',
      checks: { revision: 'abc', review: { revision: 'abc', status: 'completed', detail: '- BLOCKER: loses data' } },
    }),
    task('t7', { state: 'unmerged', pullRequest: { url: 'https://github.com/o/r/pull/7', number: 7 } }),
    task('t8', { status: 'aborted', stoppedBy: 'user' }),
  ];
  // t7 opened the pull request its reply links to.
  const opened = { '1:t7': { ours: true } };
  const state = session(tasks, [
    { id: 't5:ap-1', kind: 'command', subtaskId: 't5', summary: '[codex t5] npm install' },
  ]);

  it('groups by what to do next, newest first in a group', () => {
    const list = workTasks(state, opened);
    expect(workGroups(list).map(({ group, tasks }) => [group, tasks.map((item) => item.task.id)])).toEqual([
      ['ask', ['t5']],
      ['failed', ['t3']],
      ['blocked', ['t6']],
      ['running', ['t4']],
      ['unmerged', ['t2']],
      ['done', ['t8', 't7', 't1']],
    ]);
    expect(workNeedsYou(list)).toBe(1);
    expect(list[0]).toMatchObject({ key: '1:t1', turnId: 1, lead: 'claude', interactive: true });
  });

  it('names each status with its tone', () => {
    const status = Object.fromEntries(workTasks(state, opened).map((item) => [item.task.id, workStatus(item)]));
    expect(status).toEqual({
      t1: { text: 'Done', tone: 'ok' },
      t2: { text: 'Unmerged', tone: 'merge' },
      t3: { text: 'Failed', tone: 'err' },
      t4: { text: 'Running', tone: 'run' },
      t5: { text: 'Needs approval', tone: 'ask' },
      t6: { text: 'Review blocker', tone: 'block' },
      t7: { text: 'PR #7', tone: 'idle' },
      t8: { text: 'Stopped', tone: 'idle' },
    });
    const pr = (status: PullRequestStatus) =>
      workTasks(state, { '1:t7': status }).find((item) => item.task.id === 't7')!;
    expect(workStatus(pr({ state: 'merged', ours: true }))).toEqual({ text: 'PR #7 · merged', tone: 'ok' });
    expect(workStatus(pr({ state: 'open', ours: true }))).toEqual({ text: 'PR #7 · open', tone: 'idle' });
    expect(pullRequestLabel(pr({}).task.pullRequest!, 'closed')).toBe('PR #7 · closed');
  });

  it('takes a linked pull request for the outcome only when the task opened it', () => {
    const t7 = (status?: PullRequestStatus) =>
      workTasks(state, status ? { '1:t7': status } : undefined).find((item) => item.task.id === 't7')!;
    // "Fixed locally, see PR #7 for the original bug": the worktree is to merge or discard.
    for (const status of [undefined, { state: 'merged' as const, ours: false }]) {
      expect(t7(status).group).toBe('unmerged');
      expect(workStatus(t7(status))).toEqual({ text: 'Unmerged', tone: 'merge' });
      expect(mergesLocally(t7(status).task, status)).toBe(true);
    }
    expect(t7({ state: 'open', ours: true }).group).toBe('done');
    expect(mergesLocally(t7().task, { ours: true })).toBe(false);
  });

  it('keeps asking about a closed pull request: only a merge is final', () => {
    expect(pullRequestSettled({ state: 'merged', ours: true })).toBe(true);
    expect(pullRequestSettled({ state: 'closed', ours: true })).toBe(false);
    expect(pullRequestSettled({ state: 'open' })).toBe(false);
    expect(pullRequestSettled(undefined)).toBe(false);
  });

  it('has nothing to merge for a task that changed no files, and keeps one whose files are unknown', () => {
    const empty = task('t9', { state: 'unmerged', changes: [] });
    const unknown = task('t9', { state: 'unmerged' });
    expect(mergesLocally(empty)).toBe(false);
    expect(mergesLocally(unknown)).toBe(true);
    const [item] = workTasks(session([empty]));
    expect(item!.group).toBe('done');
    expect(workStatus(item!)).toEqual({ text: 'No changes', tone: 'idle' });
  });

  it('leaves approvals with the turn that still runs', () => {
    const ended = session(tasks, state.approvals);
    ended.turns[0]!.result = { status: 'completed', ok: true, exitCode: 0, signal: null };
    expect(workNeedsYou(workTasks(ended))).toBe(0);
    expect(workTasks(undefined)).toEqual([]);
  });
});

describe('reviewBlocker', () => {
  const review = (detail: string, status: 'completed' | 'failed' = 'completed', revision = 'abc') =>
    reviewBlocker({ revision: 'abc', review: { revision, status, detail } });
  it('is a review of the current revision that failed or lists a blocker', () => {
    expect(review('**BLOCKER**: the migration drops a column')).toBe(true);
    expect(review('1. BLOCKER the migration drops a column')).toBe(true);
    expect(review('LGTM. No BLOCKER found.\nFOLLOW-UP: rename it')).toBe(false);
    expect(review('could not start', 'failed')).toBe(true);
    // The verdict line the reviewer is asked to end with decides too.
    expect(review('[P1] Merge deletes user data\n\nVERDICT: CHANGES REQUESTED')).toBe(true);
    expect(review('**VERDICT:** changes requested')).toBe(true);
    expect(review('Looks fine.\nVERDICT: LGTM')).toBe(false);
    // An earlier round quoted is not this review: its last own verdict decides.
    expect(
      review('> BLOCKER: drops rows\n> VERDICT: CHANGES REQUESTED\n\nFixed: rows are kept.\n\nVERDICT: LGTM'),
    ).toBe(false);
    expect(review('VERDICT: LGTM in the last round, but now:\n\nVERDICT: CHANGES REQUESTED')).toBe(true);
    // A review of an earlier revision says nothing about what is there now.
    expect(review('BLOCKER: x', 'completed', 'old')).toBe(false);
    expect(reviewBlocker(undefined)).toBe(false);
  });
});

describe('what is remembered per chat', () => {
  const store = () => {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => kept.set(key, value),
    };
  };

  it('keeps each chat its own state, and starts an unknown chat undecided', () => {
    const kept = store();
    expect(readWorkView(kept, 'a')).toEqual({ tab: 'tasks' });
    writeWorkView(kept, 'a', {
      tab: 'tasks',
      open: false,
      task: '1:t2',
      folded: { done: false },
      scroll: 120,
      seen: 3,
    });
    writeWorkView(kept, 'b', { tab: 'tasks', open: true });
    expect(readWorkView(kept, 'a')).toEqual({
      tab: 'tasks',
      open: false,
      task: '1:t2',
      folded: { done: false },
      scroll: 120,
      seen: 3,
    });
    expect(readWorkView(kept, 'b')).toEqual({ tab: 'tasks', open: true });
  });

  it('drops the chats looked at longest ago, and survives a damaged or blocked store', () => {
    const kept = store();
    for (let i = 0; i < 60; i++) writeWorkView(kept, `chat-${i}`, { tab: 'tasks', open: true });
    expect(JSON.parse(kept.getItem(WORK_VIEW_KEY)!)).toHaveLength(50);
    expect(readWorkView(kept, 'chat-0')).toEqual({ tab: 'tasks' });
    expect(readWorkView(kept, 'chat-59')).toEqual({ tab: 'tasks', open: true });
    kept.setItem(WORK_VIEW_KEY, '{not json');
    expect(readWorkView(kept, 'chat-59')).toEqual({ tab: 'tasks' });
    const blocked = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(readWorkView(blocked, 'a')).toEqual({ tab: 'tasks' });
    expect(() => writeWorkView(blocked, 'a', { tab: 'tasks' })).not.toThrow();
  });
});
