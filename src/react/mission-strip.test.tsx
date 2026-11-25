// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import { packApproval } from '../agents/pack.js';
import type { SessionEntry, SessionState } from '../agents/session.js';
import type { ApprovalRequest } from '../agents/types.js';
import {
  AgentChat,
  MissionStrip,
  WorkPanel,
  type MissionStripProps,
  type WorkPanelProps,
  type WorkPanelView,
} from '../react.js';
import { agoText, leadNow, leadNowText, missionActive, missionCounts, teamFeed, watchedTasks } from './live.js';
import { readWorkView, workList, workTasks, writeWorkView } from './work.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t0 = Date.parse('2026-10-06T10:00:00Z');
const NOW = t0 + 600_000;
const cwd = '/work/app/.genaicode/worktrees';

function task(id: string, patch: Partial<PackTask> = {}): PackTask {
  return {
    id,
    agent: 'codex',
    title: `Task ${id}`,
    prompt: `Do ${id}.`,
    mode: 'worktree',
    status: 'running',
    cwd: `${cwd}/${id}`,
    startedAt: t0 + Number(id.slice(1)) * 1000,
    ...patch,
  };
}

const ask = (id: string, summary: string, agent = 'codex'): ApprovalRequest =>
  packApproval(id, agent, { id: `ap-${id}`, kind: 'command', summary });

function session(tasks: PackTask[], patch: Partial<SessionState> = {}, entries: SessionEntry[] = []): SessionState {
  return {
    agent: 'claude',
    cwd: '/work/app',
    status: 'running',
    canSteer: true,
    usage: {},
    queued: [],
    approvals: [],
    turns: [
      {
        id: 7,
        agent: 'claude',
        prompt: 'Delegate what you can.',
        startedAt: t0,
        entries,
        pack: { lead: 'claude', maxParallel: 4, interactive: true, tasks },
      },
    ],
    ...patch,
  } as SessionState;
}

/** The same session with its turn ended. */
const ended = (state: SessionState): SessionState => ({
  ...state,
  status: 'idle',
  approvals: [],
  turns: state.turns.map((turn) => ({ ...turn, endedAt: NOW, result: { status: 'completed', ok: true } as never })),
});

const done = (id: string, patch: Partial<PackTask> = {}) =>
  task(id, { status: 'completed', state: 'merged', endedAt: t0 + 90_000, text: 'Done.', ...patch });

let host: HTMLDivElement;
let root: Root;
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const $$ = (selector: string) => Array.from(host.querySelectorAll<HTMLElement>(selector));
const texts = (selector: string) => $$(selector).map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
const button = (name: string) =>
  $$('button').find((item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name);
const click = (element: Element | undefined) =>
  act(() => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
/** Lets a newly shown request on the strip settle, so its buttons take clicks. */
const settle = () => vi.setSystemTime(Date.now() + 500);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const strip = (state: SessionState, props: Partial<MissionStripProps> = {}) =>
  act(() => root.render(<MissionStrip state={state} {...props} />));

describe('<MissionStrip>', () => {
  it('idle: nothing while no delegated work runs', () => {
    strip(session([]));
    expect($('.gc-strip')).toBeNull();
    // A chat that never delegated, and one whose turn and tasks all ended.
    strip({ ...session([]), turns: [] });
    expect($('.gc-strip')).toBeNull();
    strip(ended(session([done('t1'), done('t2', { status: 'failed', state: undefined, error: 'No.' })])));
    expect($('.gc-strip')).toBeNull();
    expect(missionActive(ended(session([done('t1')])), workTasks(ended(session([done('t1')]))))).toBe(false);
  });

  it('running: a count per state in the order of the groups, and what the lead does now', () => {
    const onOpenGroup = vi.fn();
    strip(
      session(
        [
          task('t1'),
          task('t2'),
          done('t3'),
          done('t4', { status: 'failed', state: undefined, error: 'The server did not start.' }),
          done('t5', { state: 'unmerged', changes: ['M\ta.ts'] }),
        ],
        {},
        [{ kind: 'tool', name: 'mcp__pack__wait', input: {}, done: false }],
      ),
      { onOpenGroup },
    );
    expect(texts('.gc-strip-stat')).toEqual(['1Failed', '2Running', '1Unmerged', '1Done']);
    expect($('.gc-strip-stat').getAttribute('aria-label')).toBe('1 failed');
    expect($('.gc-strip-lead').textContent).toBe('claude: waiting for 2 tasks');
    // No approval: no second row, and nothing announced.
    expect($('.gc-strip-ask')).toBeNull();
    expect($('.gc-strip-sr').textContent).toBe('');
    click($('.gc-strip-stat[data-group="running"]'));
    expect(onOpenGroup).toHaveBeenCalledWith('running');
    // Without a handler the counts are text, not buttons that do nothing.
    strip(session([task('t1')]));
    expect($('.gc-strip-stat').tagName).toBe('SPAN');
    expect($$('.gc-strip button')).toEqual([]);
  });

  it('a turn that delegated keeps its strip while it runs, also once its tasks ended', () => {
    strip(session([done('t1')], {}, [{ kind: 'text', text: 'Merging', streaming: true }]));
    expect(texts('.gc-strip-stat')).toEqual(['1Done']);
    expect($('.gc-strip-lead').textContent).toBe('claude: writing its reply');
  });

  it('needs you: the head of the queue with Approve and Deny, and how many wait in this chat', () => {
    const onApprove = vi.fn();
    const onOpenGroup = vi.fn();
    const onOpenTask = vi.fn();
    const state = session([task('t1'), task('t2', { agent: 'gemini' }), task('t3')], {
      approvals: [
        ask('t2', 'npm install left-pad', 'gemini'),
        ask('t3', 'rm -rf dist'),
        // A task's question is answered in the chat, and the lead's own approval stays there too.
        { id: 't1:q', subtaskId: 't1', kind: 'question', questions: [] } as ApprovalRequest,
        { id: 'lead-1', kind: 'command', summary: 'git push' },
      ],
    });
    strip(state, { onApprove, onOpenGroup, onOpenTask });
    expect(texts('.gc-strip-stat')).toEqual(['3Needs you']);
    expect($('.gc-strip-what').textContent).toBe('gemini · t2 wants to run');
    expect($('.gc-strip-ask code').textContent).toBe('npm install left-pad');
    expect($('.gc-strip-sr').textContent).toBe('gemini, task t2, wants to run: npm install left-pad');
    expect($('.gc-strip-lead').textContent).toBe('claude: waiting for your answer in the chat');
    click(button('1 of 2 in this chat ›'));
    expect(onOpenGroup).toHaveBeenCalledWith('ask');
    click(button('Open task t2'));
    expect(onOpenTask).toHaveBeenCalledWith('7:t2');
    settle();
    click(button('Deny for t2'));
    click(button('Approve for t2'));
    expect(onApprove.mock.calls).toEqual([
      ['t2:ap-t2', 'deny'],
      ['t2:ap-t2', 'approve'],
    ]);
    // Answered: the next one moves up, in place.
    strip({ ...state, approvals: state.approvals.slice(1, 2) }, { onApprove });
    expect($('.gc-strip-what').textContent).toBe('codex · t3 wants to run');
    expect($('.gc-strip-of').textContent).toBe('1 in this chat');
    // Disconnected, or a host that takes no answers: the request shows without buttons.
    strip(state, { onApprove, disabled: true });
    expect(button('Approve for t2')).toBeUndefined();
    expect($('.gc-strip-ask code').textContent).toBe('npm install left-pad');
  });

  it('a double click answers only the request that was shown, not the one that moves up', () => {
    const onApprove = vi.fn();
    const state = session([task('t1'), task('t2')], {
      approvals: [ask('t1', 'npm test'), ask('t2', 'rm -rf build')],
    });
    strip(state, { onApprove });
    const first = $('.gc-strip-ask');
    settle();
    click(button('Approve for t1'));
    // The host answered t1: the next request takes its place, as a new row.
    strip({ ...state, approvals: state.approvals.slice(1) }, { onApprove });
    expect($('.gc-strip-ask code').textContent).toBe('rm -rf build');
    expect($('.gc-strip-ask')).not.toBe(first);
    click(button('Approve for t2'));
    click(button('Deny for t2'));
    expect(onApprove.mock.calls).toEqual([['t1:ap-t1', 'approve']]);
    // Keyboard activation of the focused button is an intentional choice immediately.
    act(() => (button('Deny for t2') as HTMLElement).click());
    expect(onApprove.mock.calls.pop()).toEqual(['t2:ap-t2', 'deny']);
    // Once it has been in view a moment, it takes an answer.
    settle();
    click(button('Approve for t2'));
    expect(onApprove.mock.calls).toEqual([
      ['t1:ap-t1', 'approve'],
      ['t2:ap-t2', 'approve'],
    ]);
  });

  it('counts only what Tasks lists: finished tasks cleared from it are not counted', () => {
    const state = session([
      task('t1'),
      done('t2', { mode: 'shared', state: undefined }),
      done('t3', { mode: 'shared', state: undefined }),
      done('t4', { status: 'failed', state: undefined, error: 'No.' }),
      done('t5', { state: 'unmerged', changes: ['M\ta.ts'] }),
    ]);
    const tasks = workTasks(state);
    // All four finished tasks cleared; t5 still has a worktree to merge, so Tasks keeps it.
    const dismissed = ['7:t2', '7:t3', '7:t4', '7:t5'];
    const listed = Object.entries(workList(tasks, { dismissed }).counts).filter(([, count]) => count);
    expect(listed).toEqual([
      ['running', 1],
      ['unmerged', 1],
    ]);
    expect(missionCounts(tasks, dismissed).map((entry) => [entry.group, entry.count])).toEqual(listed);
    strip(state, { dismissed });
    expect(texts('.gc-strip-stat')).toEqual(['1Running', '1Unmerged']);
  });

  it('many tasks: still one row of counts', () => {
    const many = Array.from({ length: 48 }, (_, index) =>
      index < 20
        ? task(`t${index + 1}`)
        : index < 23
          ? done(`t${index + 1}`, { status: 'failed', state: undefined, error: 'Out of quota.' })
          : done(`t${index + 1}`),
    );
    const approvals = ['t1', 't2', 't3'].map((id) => ask(id, `npm test -- ${id}`));
    strip(session(many, { approvals }), { onOpenGroup: vi.fn(), onApprove: vi.fn() });
    expect(texts('.gc-strip-stat')).toEqual(['3Needs you', '3Failed', '17Running', '25Done']);
    expect($$('.gc-strip-row')).toHaveLength(1);
    expect($$('.gc-strip-ask')).toHaveLength(1);
    expect(button('1 of 3 in this chat ›')).toBeDefined();
    expect(missionCounts(workTasks(session(many, { approvals }))).map((entry) => entry.count)).toEqual([3, 3, 17, 25]);
  });
});

describe('<AgentChat missionStrip>', () => {
  const chat = (state: SessionState, props: Partial<Parameters<typeof AgentChat>[0]> = {}) =>
    act(() => root.render(<AgentChat state={state} onSend={() => {}} onApprove={() => {}} {...props} />));
  const state = () => {
    const approvals = [
      ask('t1', 'npm install left-pad'),
      { id: 'lead-1', kind: 'command' as const, summary: 'git push' },
    ];
    return session(
      [task('t1')],
      { approvals },
      approvals.map((request) => ({ kind: 'approval', request })),
    );
  };

  it('without it the transcript keeps the approvals of tasks, as before', () => {
    chat(state(), { onOpenTasks: () => {} });
    expect($('.gc-strip')).toBeNull();
    expect($$('.gc-approval')).toHaveLength(2);
  });

  it("with it a task's approval is on the strip above the message box; the lead's stays inline", () => {
    const onApprove = vi.fn();
    chat(state(), { onOpenTasks: () => {}, missionStrip: { onOpenGroup: () => {} }, onApprove });
    expect($('.gc-composer > .gc-strip')).not.toBeNull();
    expect($$('.gc-approval')).toHaveLength(1);
    expect($('.gc-approval').textContent).toContain('git push');
    expect($('.gc-strip-ask code').textContent).toBe('npm install left-pad');
    settle();
    click(button('Approve for t1'));
    expect(onApprove).toHaveBeenCalledWith('t1:ap-t1', 'approve');
    // The strip never takes the keyboard.
    expect(host.contains(document.activeElement) && document.activeElement?.closest('.gc-strip')).toBeFalsy();
  });

  it('a strip that opens nothing keeps the approvals of tasks in the transcript too', () => {
    chat(state(), { onOpenTasks: () => {}, missionStrip: {} });
    expect($('.gc-strip-ask code').textContent).toBe('npm install left-pad');
    expect($$('.gc-approval')).toHaveLength(2);
  });

  it('a chat without delegated work has no strip', () => {
    chat({ ...session([]), status: 'idle' }, { missionStrip: {} });
    expect($('.gc-strip')).toBeNull();
  });
});

describe('Live tab', () => {
  let view: WorkPanelView;
  let current: SessionState;
  let props: Partial<WorkPanelProps>;
  const draw = () =>
    act(() =>
      root.render(
        <WorkPanel
          state={current}
          view={view}
          onView={(next) => {
            view = next;
            draw();
          }}
          {...props}
        />,
      ),
    );
  const show = (state: SessionState, extra: Partial<WorkPanelProps> = {}, start: Partial<WorkPanelView> = {}) => {
    current = state;
    props = extra;
    view = { tab: 'live', ...start };
    draw();
  };
  /** The feed's lines: how long ago, then what happened. */
  const feedLines = () =>
    $$('.gc-live-feed li').map(
      (item) => `${item.querySelector('time')!.textContent} ${item.querySelector('.gc-live-x')!.textContent}`,
    );
  const sections = () => $$('.gc-live > section').map((item) => item.getAttribute('aria-label'));
  const at = t0 + 100_000;
  const busy = () =>
    session(
      [
        task('t1', {
          text: 'tool Bash: npm test -- cart',
          steps: [
            { kind: 'tool', name: 'Read', text: `${cwd}/t1/src/cart.ts`, at: at, endedAt: at + 200 },
            { kind: 'tool', name: 'Read', text: `${cwd}/t1/src/price.ts`, at: at + 1000, endedAt: at + 1200 },
            { kind: 'tool', name: 'Edit', text: `${cwd}/t1/src/cart.test.ts`, at: at + 2000, endedAt: at + 3000 },
            { kind: 'message', text: 'The total skips discounts.', at: at + 10_000 },
            { kind: 'tool', name: 'Bash', text: 'npm run lint', at: at + 20_000, endedAt: at + 32_000, failed: true },
            { kind: 'tool', name: 'Bash', text: 'npm test -- cart', at: NOW - 14_000 },
          ],
          steers: [
            { text: 'Skip snapshots.', from: 'user', at: at + 40_000, settledAt: at + 40_900, delivery: 'delivered' },
            { text: 'Lint again.', from: 'lead', at: at + 50_000, delivery: 'sending' },
          ],
        }),
        task('t2', { agent: 'gemini' }),
        task('t3'),
        task('t4'),
        task('t5', { steps: [{ kind: 'approval', text: 'npm install left-pad', at: NOW - 5_000 }] }),
        done('t6', { status: 'failed', state: undefined, error: 'Out of its daily quota.', endedAt: NOW - 120_000 }),
        done('t7', { state: 'unmerged', changes: ['M\ta.ts', 'M\tb.ts'], endedAt: NOW - 300_000 }),
      ],
      { approvals: [ask('t5', 'npm install left-pad')] },
      [
        {
          kind: 'progress',
          message: 'Handing out',
          plan: [
            { step: 'Split the work', status: 'completed' },
            { step: 'Wait for the tasks', status: 'in_progress' },
            { step: 'Merge and report', status: 'pending' },
          ],
        },
        { kind: 'tool', name: 'Bash', input: { command: 'git status --short' }, done: false },
      ],
    );

  it('needs you, the lead with its plan, three watched tasks and one feed', () => {
    const onApprove = vi.fn();
    const onOpen = vi.fn();
    show(busy(), { onApprove, needsYou: { total: 4, onOpen } });
    expect(texts('[role="tab"]')).toEqual(['Tasks 7', 'Live', 'Changes 2', 'Artifacts']);
    expect($('[role="tab"][aria-selected="true"]').textContent).toBe('Live');
    expect($('[role="tabpanel"]').getAttribute('aria-label')).toBe('Live');
    expect(sections()).toEqual(['Needs you', 'Lead', 'Watching', 'Team feed']);

    // Needs you: this chat's own count, the way to the whole queue, and the approval itself.
    const needs = $('section[aria-label="Needs you"]');
    expect(needs.querySelector('.gc-work-label')!.textContent).toBe('Needs you 1 in this chatall 4 ›');
    expect(needs.querySelector('.gc-work-card')!.textContent).toContain('codex wants to run a command · t5');
    expect(needs.querySelector('.gc-work-box')!.textContent).toBe('npm install left-pad');
    click(button('all 4 ›'));
    expect(onOpen).toHaveBeenCalled();
    click(button('Approve'));
    expect(onApprove).toHaveBeenCalledWith('t5:ap-t5', 'approve');

    // Lead: the plan and what it does now, nothing else.
    const lead = $('section[aria-label="Lead"]');
    expect(lead.querySelector('.gc-work-label')!.textContent).toBe('Lead claude · its plan');
    expect(Array.from(lead.querySelectorAll('.gc-live-plan li')).map((item) => item.textContent)).toEqual([
      'Split the workcompleted',
      'Wait for the tasksin progress',
      'Merge and reportpending',
    ]);
    expect(lead.querySelector('[aria-current="step"]')!.textContent).toContain('Wait for the tasks');
    expect(lead.querySelector('.gc-work-now')!.textContent).toBe('Running git status --short');

    // Watching: three running tasks, the one the person messaged first, then the newest. t5 waits above.
    expect(texts('.gc-live-watch .gc-work-ref')).toEqual(['t1', 't4', 't3']);
    const card = $('.gc-live-watch');
    expect(card.querySelector('.gc-work-doing')!.textContent).toBe('Running npm test -- cart · 14s so far');
    expect(card.querySelector('.gc-live-say')!.textContent).toBe('“The total skips discounts.”');
    expect(card.querySelector('.gc-live-mine')!.textContent).toBe('Your last message: ✓ Delivered · 0.9s');
    // A task that has said nothing yet.
    expect($$('.gc-live-watch')[1]!.textContent).toBe('t4Task t4codexStarting…');

    // The feed, newest first: highlights, and one line for a task's routine steps.
    expect(feedLines()).toEqual([
      '5s t5 codex · asked to approve npm install left-pad',
      '2m t6 codex · failed: Out of its daily quota.',
      '5m t7 codex · finished: 2 files changed · Done.',
      '7m You → t1: ✓ Delivered · 0.9s',
      '7m t1 codex · ran npm run lint · failed · 12s',
      '8m t1 codex · said: “The total skips discounts.”',
      '8m t1 codex · 2 reads, 1 edit in src',
    ]);
    expect($$('.gc-live-feed li[data-quiet]')).toHaveLength(1);
  });

  it('Everything shows each routine step, a start and the lead’s messages; the choice is kept', () => {
    show(busy());
    click(button('Everything'));
    expect(view.feed).toBe('all');
    const lines = feedLines();
    expect(lines).toContain('8m t1 codex · read src/cart.ts · <1s');
    expect(lines).toContain('8m t1 codex · edited src/cart.test.ts · 1s');
    expect(lines).toContain('7m Lead → t1: Sending…');
    expect(lines.filter((line) => /started by claude$/.test(line ?? ''))).toHaveLength(7);
    expect(lines.some((line) => /reads/.test(line ?? ''))).toBe(false);
    click(button('Highlights'));
    expect(view.feed).toBeUndefined();
  });

  it('a pinned task keeps its card; a task id opens its detail, and Back returns to Live', () => {
    show(busy());
    click(button('Pin t3'));
    expect(view.pinned).toEqual(['7:t3']);
    expect(texts('.gc-live-watch .gc-work-ref')).toEqual(['t3', 't1', 't4']);
    expect(button('Unpin t3')!.getAttribute('aria-pressed')).toBe('true');
    click(button('Unpin t3'));
    expect(texts('.gc-live-watch .gc-work-ref')).toEqual(['t1', 't4', 't3']);

    click($('.gc-live-feed .gc-work-ref'));
    expect(view).toMatchObject({ tab: 'live', task: '7:t5' });
    expect($('.gc-work-detail h3').textContent).toBe('t5 Task t5');
    expect($('.gc-work-back').textContent).toBe('Live');
    click($('.gc-work-back'));
    expect(sections()).toContain('Watching');
    // The Tasks tab is one click away and keeps its list.
    click($('[data-tab="tasks"]'));
    expect(view.tab).toBe('tasks');
    expect($('[role="tabpanel"]').getAttribute('aria-label')).toBe('Tasks');
    expect($$('.gc-work-group').length).toBeGreaterThan(0);
    expect($('.gc-live')).toBeNull();
  });

  it('more approvals than fit point to Tasks, on the ones that wait', () => {
    const tasks = ['t1', 't2', 't3', 't4'].map((id) => task(id));
    show(session(tasks, { approvals: tasks.map((item) => ask(item.id, `npm test -- ${item.id}`)) }));
    expect($$('section[aria-label="Needs you"] .gc-work-card')).toHaveLength(2);
    expect($('section[aria-label="Watching"] .gc-work-note').textContent).toBe('No task is running.');
    click(button('Show 2 more in Tasks'));
    expect(view).toMatchObject({ tab: 'tasks', filter: 'ask' });
  });

  it('a finished turn: the plan stays, nothing runs', () => {
    const state = ended(
      session([done('t1')], {}, [
        { kind: 'progress', message: 'Done', plan: [{ step: 'Split the work', status: 'completed' }] },
      ]),
    );
    show(state);
    expect(sections()).toEqual(['Lead', 'Watching', 'Team feed']);
    expect($('section[aria-label="Lead"] .gc-work-note').textContent).toMatch(/^The turn is finished\./);
    expect($('.gc-work-now')).toBeNull();
    expect(feedLines()).toEqual(['8m t1 codex · finished: Done.']);
  });

  it('remembers the tab, the pinned tasks and the feed per chat', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readWorkView(storage, 'a').tab).toBe('tasks');
    writeWorkView(storage, 'a', { tab: 'live', pinned: ['7:t2'], feed: 'all' });
    expect(readWorkView(storage, 'a')).toEqual({ tab: 'live', pinned: ['7:t2'], feed: 'all' });
    expect(readWorkView(storage, 'b')).toEqual({ tab: 'tasks' });
  });
});

describe('live data', () => {
  it('what the lead does now', () => {
    expect(leadNow(ended(session([task('t1')])))).toBeUndefined();
    expect(leadNow(null)).toBeUndefined();
    expect(leadNowText(leadNow(session([task('t1')]))!)).toBe('claude: waiting for 1 task');
    expect(leadNowText(leadNow(session([]))!)).toBe('claude: working');
    const reading = session([task('t1')], {}, [
      { kind: 'tool', name: 'Read', input: { file_path: '/work/app/src/cart.ts' }, done: false },
    ]);
    expect(leadNow(reading)).toEqual({ lead: 'claude', verb: 'Reading', object: 'src/cart.ts' });
  });

  it('watches pinned tasks in the order they were pinned, and never more than three', () => {
    const tasks = workTasks(session(['t1', 't2', 't3', 't4', 't5'].map((id) => task(id))));
    expect(watchedTasks(tasks).map((item) => item.task.id)).toEqual(['t5', 't4', 't3']);
    expect(watchedTasks(tasks, ['7:t2', '7:t1', '7:gone']).map((item) => item.task.id)).toEqual(['t2', 't1', 't5']);
  });

  it('the feed keeps the newest lines and says how long ago', () => {
    const steps = Array.from({ length: 30 }, (_, index) => ({
      kind: 'message' as const,
      text: `m${index}`,
      at: t0 + index,
    }));
    const tasks = workTasks(session([task('t1', { steps }), task('t2', { steps }), task('t3', { steps })]));
    const feed = teamFeed(tasks);
    expect(feed).toHaveLength(60);
    expect(feed[0]!.text).toBe('said: “m29”');
    expect(new Set(feed.map((entry) => entry.id)).size).toBe(60);
    expect([5_000, 59_400, 60_000, 3_600_000, 90_000_000].map((ms) => agoText(NOW - ms, NOW))).toEqual([
      '5s',
      '59s',
      '1m',
      '1h',
      '1d',
    ]);
  });
});
