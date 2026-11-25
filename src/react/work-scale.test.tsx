// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import { AgentChat, WorkPanel, type WorkActionHandler, type WorkPanelProps, type WorkPanelView } from '../react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t0 = Date.parse('2026-10-06T10:00:00Z');
const REVISION = 'abc1234'.padEnd(40, '0');
const AGENTS = ['claude', 'codex', 'gemini'];

/**
 * What a lead left after a long turn: 100 reviews that worked in the person's folder, 4 of them
 * failed, 8 fixes in worktrees (2 with a review and tests that passed, 1 with a blocker), 3 merged,
 * 30 still running (2 of them ask), 5 stopped. 150 tasks, oldest first.
 */
function manyTasks(count = 150): PackTask[] {
  const tasks: PackTask[] = [];
  for (let n = 1; n <= count; n++) {
    const id = `t${n}`;
    const agent = AGENTS[n % 3]!;
    const shared = { id, agent, prompt: `Do part ${n}.`, cwd: '/work/app', mode: 'shared' as const };
    const own = { ...shared, cwd: `/work/app/.genaicode/worktrees/${id}`, mode: 'worktree' as const };
    const ended = { startedAt: t0 + n * 1000, endedAt: t0 + n * 1000 + 65_000 };
    // The same shape at any size: the share of each kind is the one of the 150.
    const at = ((n - 1) % 150) + 1;
    if (at <= 100)
      tasks.push({ ...shared, title: `Review part ${n}`, status: 'completed', verdict: 'VERDICT: LGTM', ...ended });
    else if (at <= 104)
      tasks.push({ ...shared, title: `Review part ${n}`, status: 'failed', error: 'The agent ran out of quota.' });
    else if (at <= 112)
      tasks.push({
        ...own,
        title: `Fix finding ${n}`,
        status: 'completed',
        state: 'unmerged',
        changes: ['M\tsrc/cart.ts'],
        checks:
          at <= 106
            ? {
                reviewer: 'claude',
                command: 'npm test',
                revision: REVISION,
                review: { revision: REVISION, status: 'completed', detail: 'No findings.\nVERDICT: LGTM' },
                verify: { revision: REVISION, status: 'completed' },
              }
            : at === 107
              ? {
                  reviewer: 'claude',
                  revision: REVISION,
                  review: { revision: REVISION, status: 'completed', detail: 'BLOCKER: the total is wrong.' },
                }
              : { reviewer: 'claude', revision: REVISION },
        ...ended,
      });
    else if (at <= 115)
      tasks.push({ ...own, title: `Fix finding ${n}`, status: 'completed', state: 'merged', changes: [], ...ended });
    else if (at <= 145)
      tasks.push({
        ...own,
        title: `Fix finding ${n}`,
        status: 'running',
        state: 'unmerged',
        text: 'tool shell: npm test',
        startedAt: t0 + 540_000,
      });
    else tasks.push({ ...shared, title: `Review part ${n}`, status: 'aborted', stoppedBy: 'user', ...ended });
  }
  return tasks;
}

const approvals: SessionState['approvals'] = [
  { id: 't144:ap-1', kind: 'command', subtaskId: 't144', summary: '[claude t144] npm install left-pad' },
  { id: 't145:ap-1', kind: 'command', subtaskId: 't145', summary: '[codex t145] rm -rf dist' },
];

function session(tasks: PackTask[], patch: Partial<SessionState> = {}): SessionState {
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
        id: 7,
        agent: 'claude',
        prompt: 'Review everything, delegate what you can.',
        startedAt: t0,
        entries: [],
        pack: { lead: 'claude', maxParallel: 8, interactive: true, tasks },
      },
    ],
    ...patch,
  } as SessionState;
}

let host: HTMLDivElement;
let root: Root;
let view: WorkPanelView;
let props: Partial<WorkPanelProps>;
let state: SessionState;

function draw() {
  act(() =>
    root.render(
      <WorkPanel
        state={state}
        view={view}
        onView={(next) => {
          view = next;
          draw();
        }}
        {...props}
      />,
    ),
  );
}

function show(tasks: PackTask[], options: { props?: Partial<WorkPanelProps>; state?: Partial<SessionState> } = {}) {
  state = session(tasks, options.state);
  view = { tab: 'tasks' };
  props = options.props ?? {};
  draw();
}

const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const $$ = (selector: string) => Array.from(host.querySelectorAll<HTMLElement>(selector));
const text = (selector: string) => $(selector)?.textContent ?? '';
const button = (name: string) => $$('button').find((item) => item.textContent?.trim() === name);
const click = (element: Element | undefined) => act(() => (element as HTMLElement).click());
const type = (selector: string, value: string) =>
  act(() => {
    const field = $<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
/** Each group's header: its name and count, and whether it is open. */
const heads = () =>
  $$('.gc-work-group-head > button:first-child').map((item) => [item.textContent, item.getAttribute('aria-expanded')]);
const ids = (group?: string) =>
  $$(`${group ? `[data-section="${group}"] ` : ''}.gc-work-row .gc-work-id`).map((item) => item.textContent);
const range = (from: number, to: number) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => `t${from + (to < from ? -i : i)}`);

beforeEach(() => {
  vi.useFakeTimers({ now: t0 + 600_000, toFake: ['Date'] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('<WorkPanel> with 150 tasks', () => {
  it('groups them with counts, folds Done into one line, and shows the first rows of a long group', () => {
    show(manyTasks());
    expect(text('.gc-work-tab')).toBe('Tasks 150');
    expect(heads()).toEqual([
      ['Needs you 2', 'true'],
      ['Failed 4', 'true'],
      ['Review blockers 1', 'true'],
      ['Running 28', 'true'],
      ['Unmerged 7', 'true'],
      ['Done 108', 'false'],
    ]);
    // What is behind the fold, in one line.
    expect(text('[data-section="done"] .gc-work-summary')).toBe('100 done · 5 stopped · 3 merged locally');
    expect($('.gc-work-scroll').getAttribute('data-dense')).toBe('true');
    // 150 tasks, 22 rows: every group whole but Running, which shows its newest 8.
    expect($$('.gc-work-row')).toHaveLength(2 + 4 + 1 + 8 + 7);
    expect(ids('ask')).toEqual(['t145', 't144']);
    expect(ids('running')).toEqual(range(143, 136));
    // One more row than the cut is shown rather than held back alone: Unmerged has 7 of 7.
    expect(ids('unmerged')).toEqual(['t112', 't111', 't110', 't109', 't108', 't106', 't105']);
    expect(text('[data-section="running"] .gc-work-more')).toBe('Show 20 more');
    expect(text('.gc-work-foot')).toBe(
      'claude leads · 150 tasks · 3 agents · newest first in each group · one-line rows above 15 tasks',
    );

    // Show N more adds the rows and gives the keyboard to the first of them.
    click($('[data-section="running"] .gc-work-more'));
    expect(ids('running')).toEqual(range(143, 116));
    expect($('[data-section="running"] .gc-work-more')).toBeNull();
    expect(document.activeElement?.closest('.gc-work-task')?.getAttribute('data-task')).toBe('7:t135');
    expect(view.more).toEqual({ running: 50 });

    // Done opens on its newest 8; the older ones come 50 at a time.
    click($('[data-section="done"] .gc-work-group-head button'));
    expect(view.folded).toEqual({ done: false });
    expect($('[data-section="done"] .gc-work-summary')).toBeNull();
    expect(ids('done')).toEqual([...range(150, 146), ...range(115, 113)]);
    expect(text('[data-section="done"] .gc-work-more')).toBe('Show 50 earlier of 100');
    click($('[data-section="done"] .gc-work-more'));
    expect(ids('done')).toHaveLength(58);
    expect(text('[data-section="done"] .gc-work-more')).toBe('Show 50 earlier');
    click($('[data-section="done"] .gc-work-more'));
    expect(ids('done')).toHaveLength(108);
    expect($('[data-section="done"] .gc-work-more')).toBeNull();
  });

  it('a short list keeps two-line rows and has no filters', () => {
    show(manyTasks().slice(100, 108));
    expect($('.gc-work-tools')).toBeNull();
    expect($('.gc-work-scroll').getAttribute('data-dense')).toBeNull();
    expect($('.gc-work-foot')).toBeNull();
    expect($$('.gc-work-group-head button').map((item) => item.textContent)).toEqual([
      'Failed 4',
      'Review blockers 1',
      'Unmerged 3',
    ]);
    // Nine tasks: the filters come, the rows stay two lines up to 15.
    show(manyTasks().slice(100, 109));
    expect($$('.gc-work-chip').map((item) => item.textContent)).toEqual([
      'All 9',
      'Failed 4',
      'Blockers 1',
      'Unmerged 4',
    ]);
    expect($('.gc-work-scroll').getAttribute('data-dense')).toBeNull();
  });

  it('filters by status chip and by words of the title, agent, id or status, and groups by agent', () => {
    show(manyTasks());
    const chips = () => $$('.gc-work-chip').map((item) => [item.textContent, item.getAttribute('aria-pressed')]);
    expect(chips()).toEqual([
      ['All 150', 'true'],
      ['Needs you 2', 'false'],
      ['Failed 4', 'false'],
      ['Blockers 1', 'false'],
      ['Running 28', 'false'],
      ['Unmerged 7', 'false'],
      ['Done 108', 'false'],
    ]);
    click($$('.gc-work-chip')[2]);
    expect(view.filter).toBe('failed');
    expect(heads()).toEqual([['Failed 4', 'true']]);
    expect(ids()).toEqual(range(104, 101));
    // A chip opens its group, also Done, on up to 50 rows.
    click($$('.gc-work-chip')[6]);
    expect(heads()).toEqual([['Done 108', 'true']]);
    expect(ids()).toHaveLength(50);
    expect(text('.gc-work-more')).toBe('Show 50 earlier of 58');
    // The pressed chip again: all tasks.
    click($$('.gc-work-chip')[6]);
    expect(view.filter).toBeUndefined();
    expect(heads()).toHaveLength(6);

    // Words: every one of them, in the title, the agent, the id or the status.
    type('.gc-work-filter', 'gemini running');
    expect(view.query).toBe('gemini running');
    expect(heads()).toEqual([['Running 10', 'true']]);
    expect(ids()).toEqual(['t143', 't140', 't137', 't134', 't131', 't128', 't125', 't122', 't119', 't116']);
    type('.gc-work-filter', 'T107');
    expect(heads()).toEqual([['Review blockers 1', 'true']]);
    type('.gc-work-filter', 'part 15');
    expect(heads()).toEqual([['Done 2', 'true']]);
    expect(ids()).toEqual(['t150', 't15']);
    type('.gc-work-filter', 'needs you');
    expect(ids()).toEqual(['t145', 't144']);
    type('.gc-work-filter', 'no such task');
    expect(heads()).toEqual([]);
    expect(text('.gc-work-empty')).toBe('No task matches. Show all tasks');
    click(button('Show all tasks'));
    expect(view.query).toBeUndefined();
    expect(heads()).toHaveLength(6);
    // Escape in the field clears it, and is not the host's Escape then.
    type('.gc-work-filter', 'codex');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void $('.gc-work-filter').dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(view.query).toBeUndefined();

    // By agent: one group per agent, what needs the person first.
    click(button('Agent'));
    expect(view.by).toBe('agent');
    expect(heads()).toEqual([
      ['claude 50', 'true'],
      ['codex 50', 'true'],
      ['gemini 50', 'true'],
    ]);
    expect(ids('agent:claude')).toEqual(['t144', 't102', 't141', 't138', 't135', 't132', 't129', 't126']);
    expect(text('[data-section="agent:claude"] .gc-work-more')).toBe('Show 42 more');
    click($('[data-section="agent:codex"] .gc-work-group-head button'));
    expect(view.folded).toEqual({ 'agent:codex': true });
    expect(text('[data-section="agent:codex"] .gc-work-summary')).toBe('34 done · 9 running · 3 unmerged · 4 other');
    click(button('Status'));
    expect(heads()).toHaveLength(6);
  });

  it('clears finished tasks that left nothing to do from the list, and brings them back', () => {
    show(manyTasks());
    // Done: every task there but none with a worktree to merge or discard. Failed likewise.
    const clearDone = $('[aria-label="Clear 108 finished from Done"]');
    expect(clearDone.textContent).toBe('Clear 108');
    expect($('[aria-label="Clear 4 finished from Failed"]')).not.toBeNull();
    expect($('[data-section="unmerged"] [aria-label^="Clear"]')).toBeNull();
    expect($('[data-section="running"] [aria-label^="Clear"]')).toBeNull();
    click(clearDone);
    expect(view.dismissed).toHaveLength(108);
    expect(heads().map(([name]) => name)).toEqual([
      'Needs you 2',
      'Failed 4',
      'Review blockers 1',
      'Running 28',
      'Unmerged 7',
    ]);
    expect(text('.gc-work-chip')).toBe('All 42');
    // The conversation still has them: the tab counts all, the list says how many it hides.
    expect(text('.gc-work-tab')).toBe('Tasks 150');
    expect(text('.gc-work-foot span')).toBe('108 cleared from this list. Show them');

    // One row: its own button, and the group's header takes the keyboard.
    click($('[aria-label="Clear t103 from the list"]'));
    expect(ids('failed')).toEqual(['t104', 't102', 't101']);
    expect(document.activeElement?.textContent).toBe('Failed 3');
    expect(text('.gc-work-foot span')).toBe('109 cleared from this list. Show them');

    // A cleared task that runs again is back by itself.
    state = session(manyTasks().map((task) => (task.id === 't1' ? { ...task, status: 'running' } : task)));
    draw();
    expect(heads()[3]).toEqual(['Running 29', 'true']);
    expect(text('.gc-work-foot span')).toBe('108 cleared from this list. Show them');

    click(button('Show them'));
    expect(view.dismissed).toBeUndefined();
    expect(heads().at(-1)).toEqual(['Done 107', 'false']);
    expect($('.gc-work-foot span')).toBeNull();

    // A short list has the row's button only.
    show(manyTasks().slice(96, 104));
    expect($('[aria-label^="Clear 4 finished"]')).toBeNull();
    click($('[data-section="done"] .gc-work-group-head button'));
    click($('[aria-label="Clear t97 from the list"]'));
    expect(ids('failed')).toEqual(['t104', 't103', 't102', 't101']);
    expect(ids('done')).toEqual(['t100', 't99', 't98']);
    expect(text('.gc-work-foot')).toBe('1 cleared from this list. Show them');
  });

  it('Approve all shows the requests first; Merge all takes the tasks whose review and tests passed', async () => {
    const onApprove = vi.fn();
    const merged: string[] = [];
    const onPackAction = vi.fn<WorkActionHandler>(async (_turn, id, action) => {
      if (id === 't105') throw new Error('The worktree changed. Open the updated diff before merging.');
      merged.push(`${id} ${action.type} ${'revision' in action ? action.revision?.slice(0, 7) : ''}`);
      return `Merged ${id}`;
    });
    show(manyTasks(), { props: { onApprove, onPackAction } });
    click(button('Approve all'));
    const card = () => $('.gc-work-bulk');
    expect(card().getAttribute('aria-label')).toBe('Approve all');
    expect(text('.gc-work-bulk b')).toBe('Approve these 2 requests?');
    expect($$('.gc-work-bulk li').map((item) => item.textContent)).toEqual([
      't145 rm -rf dist',
      't144 npm install left-pad',
    ]);
    expect(onApprove).not.toHaveBeenCalled();
    click(button('Approve 2'));
    expect(onApprove.mock.calls).toEqual([
      ['t145:ap-1', 'approve'],
      ['t144:ap-1', 'approve'],
    ]);
    expect(card()).toBeNull();

    click(button('Merge all'));
    expect(card().getAttribute('aria-label')).toBe('Merge all');
    expect(text('.gc-work-bulk b')).toBe(
      'Merge t106, t105 locally? Review and tests passed on the revision each has now.',
    );
    expect(text('.gc-work-bulk .gc-work-note')).toBe('Left as they are: t112, t111, t110, t109, t108.');
    await act(async () => {
      button('Merge 2')!.click();
      await Promise.resolve();
    });
    await act(async () => {});
    expect(merged).toEqual(['t106 merge abc1234']);
    expect(text('[data-section="unmerged"] .gc-work-feedback')).toBe(
      'Merged t106. Not merged: t105: The worktree changed. Open the updated diff before merging.',
    );

    // Without the callbacks, or with one request only, there is nothing to do at once.
    show(manyTasks(), { state: { approvals: approvals.slice(0, 1) } });
    expect(button('Approve all')).toBeUndefined();
    expect(button('Merge all')).toBeUndefined();
  });

  it('a row under the keyboard focus or the pointer stays in its group, with its new state, until they leave', () => {
    const onApprove = vi.fn();
    show(manyTasks(), { props: { onApprove } });
    // Approve on the row: the row takes the focus the button had.
    click($('[aria-label="Approve for t144"]'));
    expect(onApprove).toHaveBeenCalledWith('t144:ap-1', 'approve');
    const row = () => $('[data-task="7:t144"] .gc-work-row');
    expect(document.activeElement).toBe(row());
    const kept = row();
    // The approval is answered: the task runs.
    state = session(manyTasks(), { approvals: approvals.slice(1) });
    draw();
    expect(ids('ask')).toEqual(['t145', 't144']);
    expect(row()).toBe(kept);
    expect(document.activeElement).toBe(kept);
    expect(row().querySelector('.gc-work-glyph')!.getAttribute('data-tone')).toBe('run');
    expect(row().querySelector('.gc-work-sr')!.textContent).toBe('Running');
    expect($('[aria-label="Approve for t144"]')).toBeNull();
    // The focus leaves: it is with the running ones.
    act(() => row().blur());
    expect(ids('ask')).toEqual(['t145']);
    expect(heads()[3]).toEqual(['Running 29', 'true']);
    // The same for the pointer, also past the cut of a long group as newer tasks arrive.
    const over = (name: string) =>
      act(() => void $('[data-task="7:t137"]').dispatchEvent(new MouseEvent(name, { bubbles: true })));
    expect(ids('running').at(-1)).toBe('t137');
    over('mouseover');
    state = session(
      [...manyTasks(), ...manyTasks().slice(120, 125)].map((task, index) =>
        index >= 150 ? { ...task, id: `t${index + 1}` } : task,
      ),
      { approvals: approvals.slice(1) },
    );
    draw();
    expect(ids('running')).toEqual([...range(155, 151), 't144', 't143', 't142', 't137']);
    over('mouseout');
    expect(ids('running')).toEqual([...range(155, 151), 't144', 't143', 't142']);
  });

  it('renders 150 tasks, and 1500, in bounded time and rows', () => {
    const timed = (tasks: PackTask[]) => {
      const before = performance.now();
      show(tasks, { state: { approvals: [] } });
      return performance.now() - before;
    };
    timed(manyTasks(20));
    const small = timed(manyTasks());
    expect($$('.gc-work-row')).toHaveLength(4 + 1 + 8 + 7);
    // Generous for a loaded CI machine; a list that rendered every task twice over would still pass
    // here, so the row count below is the real bound.
    expect(small).toBeLessThan(1500);
    const large = timed(manyTasks(1500));
    expect(text('.gc-work-tab')).toBe('Tasks 1500');
    // Ten times the tasks, the same number of rows per group.
    expect($$('.gc-work-row')).toHaveLength(8 * 4);
    expect(large).toBeLessThan(3000);
    // Everything opened by hand is still paged: 8 + 50 rows a group at most.
    view = { tab: 'tasks', folded: { done: false }, more: { done: 50, running: 50 } };
    const before = performance.now();
    draw();
    expect($$('.gc-work-row')).toHaveLength(8 + 8 + 58 + 8 + 58);
    expect(performance.now() - before).toBeLessThan(3000);
  });
});

describe('<AgentChat> inline card with 150 tasks', () => {
  const render = (tasks: PackTask[]) =>
    act(() => root.render(<AgentChat state={session(tasks)} onSend={() => undefined} onApprove={() => undefined} />));
  const rows = () =>
    $$('.gc-pack-list button:not(.gc-pack-more)').map((row) => row.querySelector('strong')!.textContent);

  it('shows one-line rows, the first 12, a summary, a filter, and clears finished tasks', () => {
    render(manyTasks());
    expect($('.gc-pack-list').getAttribute('data-dense')).toBe('true');
    expect(text('.gc-pack-summary')).toBe('2 need you · 30 running · 4 failed · 116 finished');
    // What needs the person and what runs first, newest first.
    expect(rows()).toEqual(range(145, 134).map((id) => `Fix finding ${id.slice(1)}`));
    expect(text('.gc-pack-more')).toBe('Show 50 more of 138');
    click($('.gc-pack-more'));
    expect(rows()).toHaveLength(62);
    expect(text('.gc-pack-more')).toBe('Show 50 earlier of 88');

    type('.gc-pack-tools input', 'failed');
    expect(rows()).toEqual(['Review part 104', 'Review part 103', 'Review part 102', 'Review part 101']);
    expect($('.gc-pack-more')).toBeNull();
    type('.gc-pack-tools input', 'gemini merged');
    expect(rows()).toEqual(['Fix finding 113']);
    type('.gc-pack-tools input', 'nothing like it');
    expect(text('.gc-pack-none')).toBe('No task matches.');
    type('.gc-pack-tools input', '');

    // Finished tasks without a worktree to merge or discard: 100 reviews, 4 failed, 3 merged, 5 stopped.
    click(button('Clear 112 finished'));
    expect(rows()).toHaveLength(12);
    expect(text('.gc-pack-more')).toBe('Show 26 more');
    click($('.gc-pack-more'));
    expect(rows()).toHaveLength(38);
    expect(rows().slice(-8)).toEqual(range(112, 105).map((id) => `Fix finding ${id.slice(1)}`));
    expect(button('Clear 112 finished')).toBeUndefined();
    click(button('Show 112 cleared'));
    expect(text('.gc-pack-more')).toBe('Show 50 earlier of 88');
  });

  it('up to 15 tasks looks as it did', () => {
    render(manyTasks().slice(100, 115));
    expect($('.gc-pack-list').getAttribute('data-dense')).toBeNull();
    expect($('.gc-pack-tools')).toBeNull();
    expect(rows()).toHaveLength(8 + 3);
    expect(text('.gc-pack-more')).toBe('Show 4 earlier');
  });
});
