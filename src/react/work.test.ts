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
  workClearable,
  workDismiss,
  workFootnote,
  workGroups,
  workList,
  workNeedsYou,
  workPanelLayout,
  workStatus,
  workSummary,
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

const range = (from: number, to: number) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => `t${from + (to < from ? -i : i)}`);

describe('workList', () => {
  const many = (count: number, patch: (n: number) => Partial<PackTask>) =>
    workTasks(session(Array.from({ length: count }, (_, i) => task(`t${i + 1}`, { mode: 'shared', ...patch(i + 1) }))));

  it('is whole up to 15 tasks, and cuts a group to 8 rows above; one row is never held back alone', () => {
    const short = workList(
      many(15, () => ({ status: 'running' })),
      {},
    );
    expect(short).toMatchObject({ total: 15, dense: false, tools: true, filtering: false, cleared: 0 });
    expect(short.sections.map((section) => [section.key, section.shown.length, section.next])).toEqual([
      ['running', 15, 0],
    ]);
    const long = workList(
      many(70, (n) => ({ status: n <= 9 ? 'failed' : 'running' })),
      {},
    );
    expect(long.dense).toBe(true);
    expect(long.sections.map((section) => [section.key, section.shown.length, section.next, section.folded])).toEqual([
      ['failed', 9, 0, false],
      ['running', 8, 50, false],
    ]);
    expect(long.sections[1]!.shown[0]!.task.id).toBe('t70');
    const more = workList(
      many(70, () => ({ status: 'running' })),
      { more: { running: 50 } },
    );
    expect(more.sections.map((section) => [section.shown.length, section.next])).toEqual([[58, 12]]);
  });

  it('a short list ignores a remembered filter: it has no chips to take it off with', () => {
    const tasks = many(6, (n) => ({ status: n === 1 ? 'failed' : 'completed' }));
    const list = workList(tasks, { filter: 'failed', query: 'nothing', by: 'agent' });
    expect(list).toMatchObject({ tools: false, filtering: false });
    expect(list.sections.map((section) => [section.key, section.tasks.length])).toEqual([
      ['failed', 1],
      ['done', 5],
    ]);
    // A chip whose group emptied is off too.
    expect(
      workList(
        many(20, () => ({})),
        { filter: 'failed' },
      ).filtering,
    ).toBe(false);
  });

  it('only a finished task with no worktree left to merge or discard can be cleared', () => {
    const tasks = workTasks(
      session([
        task('t1', { mode: 'shared' }),
        task('t2', { mode: 'shared', status: 'failed' }),
        task('t3', { state: 'merged' }),
        task('t4', { state: 'discarded' }),
        task('t5', { state: 'unmerged', changes: ['M\ta'] }),
        task('t6', { state: 'unmerged', changes: [] }),
        task('t7', { mode: 'shared', status: 'running' }),
        task('t8', { state: 'unmerged', status: 'failed' }),
      ]),
    );
    expect(tasks.filter(workClearable).map((item) => item.task.id)).toEqual(['t1', 't2', 't3', 't4']);
    // Clearing the others does nothing: they stay in the list.
    const list = workList(tasks, {
      dismissed: workDismiss(
        ['1:t1'],
        tasks.map((item) => item.key),
        tasks,
      ),
    });
    expect(list).toMatchObject({ total: 4, cleared: 4 });
    // The keys of tasks the chat no longer has are dropped.
    expect(workDismiss(['1:t1', 'gone'], ['1:t2', '1:t3'], tasks)).toEqual(['1:t1', '1:t2', '1:t3']);
  });

  it('keeps every cleared task of the chat, past 2,000 too', () => {
    const tasks = many(2501, () => ({}));
    const keys = tasks.map((item) => item.key);
    // Clear 2001, then the rest: none of them comes back.
    const first = workDismiss(undefined, keys.slice(0, 2001), tasks);
    expect(first).toHaveLength(2001);
    expect(workList(tasks, { dismissed: first })).toMatchObject({ total: 500, cleared: 2001 });
    const all = workDismiss(first, keys.slice(2001), tasks);
    expect(all).toHaveLength(2501);
    expect(workList(tasks, { dismissed: all })).toMatchObject({ total: 0, cleared: 2501 });
  });

  it('shows the newest 8 of a group in every view: by agent, under a chip and under a text filter', () => {
    // 20 old failures of codex, then 40 of its tasks that run now.
    const tasks = many(60, (n) => ({ status: n <= 20 ? 'failed' : 'running' }));
    const newest = range(60, 53);
    const shown = (view: Parameters<typeof workList>[1]) =>
      workList(tasks, view).sections.map((section) => [
        section.key,
        section.shown.map((item) => item.task.id),
        section.next,
      ]);
    expect(shown({ by: 'agent' })).toEqual([['agent:codex', newest, 50]]);
    expect(shown({ filter: 'running' })).toEqual([['running', newest, 32]]);
    expect(shown({ query: 'running' })).toEqual([['running', newest, 32]]);
    expect(shown({ filter: 'failed' })).toEqual([['failed', range(20, 13), 12]]);
  });

  it('keeps a held row in the text filter it matched while its task changes', () => {
    const before = many(20, () => ({ status: 'running' }));
    const after = many(20, (n) => ({ status: n === 20 ? 'failed' : 'running' }));
    const ids = (query: string, held?: Parameters<typeof workList>[2]) =>
      workList(after, { query }, held).sections.flatMap((section) => section.shown.map((item) => item.task.id));
    expect(ids('running')).not.toContain('t20');
    const held = { '1:t20': before.at(-1)! };
    expect(ids('running', held)).toContain('t20');
    // A query the row did not match when it was held takes it away.
    expect(ids('nothing', held)).toEqual([]);
  });

  it('says what a folded group holds', () => {
    const tasks = many(12, (n) => ({
      agent: n % 2 ? 'codex' : 'claude',
      status: n <= 2 ? 'aborted' : 'completed',
    }));
    expect(workSummary(tasks)).toBe('10 done · 2 stopped');
    expect(workSummary(tasks.slice(2))).toBe('5 codex · 5 claude');
    expect(workSummary(tasks.slice(2, 3))).toBe('1 done');
    expect(workFootnote(tasks)).toBe('claude leads · 12 tasks · 2 agents · newest first in each group');
  });
});

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
    task('t9', { status: 'completed', mode: 'shared', dismissed: true }),
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

  it('keeps the filters, the grouping, the rows shown and the cleared tasks, and drops what it cannot read', () => {
    const kept = store();
    const view = {
      tab: 'tasks' as const,
      folded: { done: false, 'agent:codex': true },
      filter: 'failed' as const,
      query: 'codex',
      by: 'agent' as const,
      more: { done: 50 },
      dismissed: ['1:t1', '1:t2'],
    };
    writeWorkView(kept, 'a', view);
    expect(readWorkView(kept, 'a')).toEqual(view);
    kept.setItem(
      WORK_VIEW_KEY,
      JSON.stringify([
        ['a', { filter: 'nope', query: 7, by: 'size', more: { done: 'all', failed: 50 }, dismissed: ['1:t1', 2] }],
      ]),
    );
    expect(readWorkView(kept, 'a')).toEqual({ tab: 'tasks', more: { failed: 50 }, dismissed: ['1:t1'] });
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
