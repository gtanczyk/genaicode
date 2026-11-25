// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import { AgentChat, WorkPanel, type PackActionHandler, type WorkPanelProps, type WorkPanelView } from '../react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t0 = Date.parse('2026-10-06T10:00:00Z');
const base = { agent: 'codex', cwd: '/work/app/.genaicode/worktrees/t1', mode: 'worktree' as const };

function session(tasks: PackTask[], patch: Partial<SessionState> = {}): SessionState {
  return {
    agent: 'claude',
    cwd: '/work/app',
    status: 'running',
    canSteer: true,
    usage: { inputTokens: 25_000, outputTokens: 5_000 },
    costUsd: 43.35,
    queued: [],
    approvals: [],
    turns: [
      {
        id: 7,
        agent: 'claude',
        prompt: 'Add tests, delegate what you can.',
        startedAt: t0,
        costUsd: 43.35,
        entries: [],
        pack: { lead: 'claude', maxParallel: 4, interactive: true, tasks },
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

/** Shows the panel on `tasks`, with the detail of the first one open unless `list`. */
function show(
  tasks: PackTask[],
  options: { list?: boolean; props?: Partial<WorkPanelProps>; state?: Partial<SessionState> } = {},
) {
  state = session(tasks, options.state);
  view = { tab: 'tasks', ...(options.list ? {} : { task: `7:${tasks[0]!.id}` }) };
  props = options.props ?? {};
  draw();
}

const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const $$ = (selector: string) => Array.from(host.querySelectorAll<HTMLElement>(selector));
const text = (selector: string) => $(selector)?.textContent ?? '';
const button = (name: string) => $$('button').find((item) => item.textContent?.trim() === name);
const click = (element: Element | undefined) => act(() => (element as HTMLElement).click());
/** Types `value` into the field, as React hears it. */
const type = (selector: string, value: string) =>
  act(() => {
    const field = $<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
const labels = () => $$('.gc-work-label').map((item) => item.firstChild?.textContent?.trim());

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

describe('<WorkPanel> task detail', () => {
  it('running: what it was asked, who does it, what it does now, its messages with receipts, steer and stop', async () => {
    const onAction = vi.fn<PackActionHandler>(async () => 'ok');
    show(
      [
        {
          ...base,
          id: 't1',
          title: 'Cover the cart total',
          prompt: 'Write tests for total() in src/cart.ts.',
          model: 'gpt-6.2-astra',
          effort: 'high',
          status: 'running',
          canSteer: true,
          text: 'tool shell: npm test -- cart',
          startedAt: t0 + 505_000,
          steers: [
            { text: 'Skip the snapshot tests.', from: 'user', at: t0 + 520_000, delivery: 'delivered' },
            { text: 'Use vitest.', from: 'lead', at: t0 + 530_000, delivery: 'sending' },
          ],
        },
      ],
      { props: { onPackAction: onAction } },
    );
    expect($('.gc-work-detail').getAttribute('aria-label')).toBe('Task t1');
    expect(text('.gc-work-head h3')).toBe('t1 Cover the cart total');
    expect(text('.gc-work-pill')).toBe('Running');
    expect($('.gc-work-pill').getAttribute('data-tone')).toBe('run');
    expect(text('.gc-work-meta')).toContain(
      'codex · gpt-6.2-astra · effort high · works in its own copy (a git worktree)',
    );
    expect(text('.gc-work-meta')).toMatch(/started \d\d:\d\d(?: [AP]M)? · running for 1m 35s/);
    expect(text('.gc-work-meta')).toContain('.genaicode/worktrees/t1');
    expect(text('.gc-work-now')).toBe('Shell npm test -- cart1m 35s');
    expect(text('.gc-work-asked')).toBe('Write tests for total() in src/cart.ts.');
    expect(
      $$('.gc-work-steers li').map((item) => [
        item.querySelector('p')!.textContent,
        item.querySelector('small')!.textContent,
      ]),
    ).toEqual([
      ['Skip the snapshot tests.', 'Your message: Seen by codex'],
      ['Use vitest.', 'Lead’s message: Sending…'],
    ]);
    expect(labels()).toEqual(['What it was asked', 'Messages sent while it ran']);
    // Nothing to merge or discard while it runs.
    expect(button('Merge locally')).toBeUndefined();
    expect(button('Discard')).toBeUndefined();

    const box = $<HTMLInputElement>('.gc-work-field');
    expect(box.getAttribute('aria-label')).toBe('Message to codex');
    expect(button('Steer')!.hasAttribute('disabled')).toBe(true);
    await vi.waitFor(() => undefined);
    await actAsync(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(box, '  keep it short ');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await actAsync(() => button('Steer')!.click());
    expect(onAction).toHaveBeenCalledWith(7, 't1', { type: 'steer', text: 'keep it short' });
    expect($<HTMLInputElement>('.gc-work-field').value).toBe('');
    expect(text('.gc-work-steer small')).toContain('codex reads your message between two steps');

    // Stop asks first.
    click(button('Stop task'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(text('.gc-work-steer')).toContain('Stop this task?');
    await actAsync(() => button('Confirm stop')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't1', { type: 'stop' });
  });

  it('running without steering: says what the person can do instead', () => {
    show([{ ...base, id: 't1', prompt: 'Review it.', status: 'running', startedAt: t0 }], {
      props: { onPackAction: vi.fn(async () => '') },
    });
    expect($('.gc-work-field')).toBeNull();
    expect(button('Steer')).toBeUndefined();
    expect(button('Stop task')).toBeDefined();
    expect(text('.gc-work-steer small')).toBe(
      'codex cannot take messages while it works. Stop the task, or wait until it finishes.',
    );
    expect(text('.gc-work-now')).toContain('Starting…');
  });

  it('done: the verdict and the final reply, and no actions', () => {
    show(
      [
        {
          ...base,
          id: 't2',
          mode: 'shared',
          cwd: '/work/app',
          prompt: 'Review the cart change.',
          status: 'completed',
          text: 'Read it all.\n\n**VERDICT: LGTM**',
          verdict: '**VERDICT: LGTM**',
          startedAt: t0,
          endedAt: t0 + 65_000,
        },
      ],
      { props: { onPackAction: vi.fn(async () => '') } },
    );
    expect(text('.gc-work-pill')).toBe('Done');
    expect($('.gc-work-pill').getAttribute('data-tone')).toBe('ok');
    expect(text('.gc-work-meta')).toContain('works in your folder');
    expect(text('.gc-work-meta')).toMatch(/took 1m 05s$/);
    expect(text('.gc-work-verdict')).toBe('VERDICT: LGTM');
    expect(text('.gc-work-result')).toContain('Read it all.');
    expect(labels()).toEqual(['What it was asked', 'Result']);
    expect($('.gc-work-steer')).toBeNull();
    expect($('.gc-work-merge')).toBeNull();
    expect($$('.gc-work-detail button').map((item) => item.textContent?.trim())).toEqual(['Tasks']);
  });

  it('failed: the error in its own card', () => {
    show([
      {
        ...base,
        id: 't3',
        prompt: 'Open the checkout page.',
        status: 'failed',
        error: 'The dev server did not start.',
        startedAt: t0,
        endedAt: t0 + 10_000,
      },
    ]);
    expect(text('.gc-work-pill')).toBe('Failed');
    expect($('.gc-work-pill').getAttribute('data-tone')).toBe('err');
    expect($('.gc-work-card[data-tone="err"]').textContent).toBe('FailedThe dev server did not start.');
    expect($('.gc-work-result')).toBeNull();
  });

  it('stopped: who stopped it, without the runtime notice as an error', () => {
    show([
      {
        ...base,
        id: 't4',
        prompt: 'Finish the redesign.',
        status: 'aborted',
        error: 'codex was stopped.',
        text: 'codex was stopped.',
        stoppedBy: 'user',
        startedAt: t0,
        endedAt: t0 + 30_000,
      },
    ]);
    expect(text('.gc-work-pill')).toBe('Stopped');
    expect($('.gc-work-pill').getAttribute('data-tone')).toBe('idle');
    expect(text('.gc-work-stopped')).toBe('Stopped by you.');
    expect($('.gc-work-card[data-tone="err"]')).toBeNull();
    expect($('.gc-work-result')).toBeNull();
  });

  it('ended in a pull request it opened: "PR #N · merged" with its link in place of Merge locally', async () => {
    const onAction = vi.fn<PackActionHandler>(async () => 'Discarded');
    const task: PackTask = {
      ...base,
      id: 't5',
      prompt: 'Implement the work panel and open a pull request.',
      status: 'completed',
      state: 'unmerged',
      text: 'Opened https://github.com/acme/app/pull/351',
      pullRequest: { url: 'https://github.com/acme/app/pull/351', number: 351 },
      changes: ['M\tsrc/react/work-panel.tsx', 'A\tsrc/react/work.ts'],
      checks: {},
      startedAt: t0,
      endedAt: t0 + 60_000,
    };
    show([task], {
      props: { onPackAction: onAction, pullRequests: { '7:t5': { state: 'merged', ours: true } } },
    });
    expect(text('.gc-work-pill')).toBe('PR #351 · merged');
    expect($('.gc-work-pill').getAttribute('data-tone')).toBe('ok');
    const link = $<HTMLAnchorElement>('.gc-work-pr a');
    expect(link.textContent).toBe('PR #351 · merged');
    expect(link.getAttribute('href')).toBe('https://github.com/acme/app/pull/351');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(button('Merge locally')).toBeUndefined();
    expect(text('.gc-work-detail')).toContain(
      'The work is in the pull request, so there is nothing to merge here. Discard removes the local worktree copy only.',
    );
    // No checks before a merge that does not happen here.
    expect($('.gc-work-checks')).toBeNull();
    click(button('Discard worktree'));
    // The confirmation says what goes: the folder, files Git ignores included.
    expect(text('.gc-work-merge')).toContain('Its folder is deleted, files Git ignores (logs, build output) included.');
    await actAsync(() => button('Confirm discard')!.click());
    // Sent as the pull request's: the host checks again that it still holds the work.
    expect(onAction).toHaveBeenCalledWith(7, 't5', { type: 'discard' }, { pullRequest: true });

    // The worktree is found edited while the confirmation is open: what was confirmed was a discard
    // the pull request covers, so it still goes as one, for the host to refuse.
    onAction.mockClear();
    show([task], {
      props: { onPackAction: onAction, pullRequests: { '7:t5': { state: 'merged', ours: true } } },
    });
    click(button('Discard worktree'));
    props = { ...props, pullRequests: { '7:t5': { state: 'merged', ours: false } } };
    draw();
    await actAsync(() => button('Confirm discard')!.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(7, 't5', { type: 'discard' }, { pullRequest: true });

    // Open, closed, and not looked up yet.
    for (const [state, label] of [
      ['open', 'PR #351 · open'],
      ['closed', 'PR #351 · closed'],
      [undefined, 'PR #351'],
    ] as const) {
      show([task], { props: { pullRequests: { '7:t5': { ...(state ? { state } : {}), ours: true } } } });
      expect(text('.gc-work-pill')).toBe(label);
      expect(text('.gc-work-pr a')).toBe(label);
    }
  });

  it('a pull request its reply only links to is a link: Merge locally and Discard stay as for any worktree', async () => {
    const task: PackTask = {
      ...base,
      id: 't5',
      prompt: 'Fix the importer locally.',
      status: 'completed',
      state: 'unmerged',
      text: 'Fixed locally, see https://github.com/acme/app/pull/12 for the original bug.',
      pullRequest: { url: 'https://github.com/acme/app/pull/12', number: 12 },
      changes: ['M\tsrc/import.ts'],
      checks: { revision: 'abc' },
    };
    // Not looked up yet, and looked up: the pull request's head is not the task's branch.
    for (const pullRequests of [undefined, { '7:t5': { state: 'merged' as const, ours: false } }]) {
      show([task], { props: { onPackAction: vi.fn(async () => ''), pullRequests } });
      expect(text('.gc-work-pill')).toBe('Unmerged');
      expect(button('Merge locally')).toBeDefined();
      expect(button('Discard')).toBeDefined();
      expect(labels()).toContain('Pull request in its reply');
      expect(text('.gc-work-pr a')).toBe(pullRequests ? 'PR #12 · merged' : 'PR #12');
      expect(text('.gc-work-detail')).not.toContain('The work is in the pull request');
    }
    show([task], { list: true, props: { pullRequests: { '7:t5': { state: 'merged', ours: false } } } });
    expect($$('.gc-work-group').map((group) => group.getAttribute('aria-label'))).toEqual(['Unmerged']);
  });

  it('changed no files: nothing to merge, Discard worktree cleans up; files not listed: Show diff stays', async () => {
    const onAction = vi.fn<PackActionHandler>(async () => '@@ -1 +1 @@\n-a\n+b');
    const empty: PackTask = {
      ...base,
      id: 't4',
      prompt: 'Look around.',
      status: 'completed',
      state: 'unmerged',
      changes: [],
      checks: {},
    };
    show([empty], { props: { onPackAction: onAction } });
    expect(text('.gc-work-pill')).toBe('No changes');
    expect(button('Merge locally')).toBeUndefined();
    expect(button('Discard worktree')).toBeDefined();
    expect(text('.gc-work-detail')).toContain('It changed no files. There is nothing to merge.');
    // The worktree is still there: its diff shows any edit made since the task ended.
    await actAsync(() => button('Show diff')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't4', { type: 'diff' });
    // A discard of an "empty" worktree asks the host to check it is still clean first.
    click(button('Discard worktree'));
    await actAsync(() => button('Confirm discard')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't4', { type: 'discard', empty: true });
    // Reading the diff listed an edit: Merge locally is back, and a discard is an ordinary one.
    show([{ ...empty, changes: ['A\tlate.txt'], checks: { revision: 'abc' } }], { props: { onPackAction: onAction } });
    // The diff was read before the revision was known: it is read again for the one now reported.
    await actAsync(async () => undefined);
    expect(onAction).toHaveBeenLastCalledWith(7, 't4', { type: 'diff', revision: 'abc' });
    expect(button('Merge locally')).toBeDefined();
    click(button('Discard'));
    await actAsync(() => button('Confirm discard')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't4', { type: 'discard' });
    show([empty], { list: true });
    expect($$('.gc-work-group').map((group) => group.getAttribute('aria-label'))).toEqual(['Done']);

    // The files could not be listed: the diff is still there to read before a merge.
    show([{ ...empty, changes: undefined, checks: { revision: 'abc' } }], { props: { onPackAction: onAction } });
    expect(text('.gc-work-pill')).toBe('Unmerged');
    expect(button('Merge locally')).toBeDefined();
    expect(text('.gc-work-detail')).toContain('The changed files could not be listed.');
    await actAsync(() => button('Show diff')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't4', { type: 'diff', revision: 'abc' });
    expect($$('.gc-work-diff span')).toHaveLength(3);
  });

  it('merges the revision whose diff was read, through a review; a stale merge reloads the diff first', async () => {
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);
    const stale = Object.assign(new Error('The worktree changed. Open the updated diff before merging.'), {
      reason: 'stale',
    });
    const onAction = vi.fn<PackActionHandler>(async (_turn, _id, action) => {
      if (action.type === 'diff') return `diff of ${action.revision}`;
      if (action.type === 'merge' && action.revision !== B) throw stale;
      return action.type === 'merge' ? 'Merged t6' : '';
    });
    const task: PackTask = {
      ...base,
      id: 't6',
      prompt: 'Change it.',
      status: 'completed',
      state: 'unmerged',
      changes: ['M\ta.ts'],
      checks: { reviewer: 'claude', revision: A },
    };
    show([task], { props: { onPackAction: onAction } });
    await actAsync(() => button('Show diff')!.click());
    expect(text('.gc-work-diff')).toBe(`diff of ${A}`);
    await actAsync(() => button('Request review')!.click());
    // The review ran on a newer revision B: A is still what was read, and what Merge sends.
    state.turns[0]!.pack!.tasks[0] = {
      ...task,
      checks: { reviewer: 'claude', revision: B, review: { revision: B, status: 'completed', detail: 'LGTM' } },
    };
    draw();
    await actAsync(() => button('Merge locally')!.click());
    expect(onAction).toHaveBeenCalledWith(7, 't6', { type: 'merge', revision: A });
    // Refused: the diff of B loads, and nothing merges until another click.
    await actAsync(async () => undefined);
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'diff', revision: B });
    expect(text('.gc-work-diff')).toBe(`diff of ${B}`);
    expect(onAction.mock.calls.filter((call) => call[2].type === 'merge')).toHaveLength(1);
    await actAsync(() => button('Merge locally')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'merge', revision: B });
    expect(text('.gc-work-feedback')).toBe('Merged t6');
  });

  it('a diff refused as stale reads the newer revision by itself, with the files the pack now lists', async () => {
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);
    const task: PackTask = {
      ...base,
      id: 't7',
      prompt: 'Look.',
      status: 'completed',
      state: 'unmerged',
      changes: [],
      checks: { revision: A },
    };
    const onAction = vi.fn<PackActionHandler>(async (_turn, _id, action) => {
      if (action.type !== 'diff') return '';
      if (action.revision === B) return '+late';
      // Someone added a file: the pack refreshed the task (revision B, its files) before refusing.
      state.turns[0]!.pack!.tasks[0] = { ...task, changes: ['A\tlate.txt'], checks: { revision: B } };
      draw();
      throw Object.assign(new Error('The worktree changed.'), { reason: 'stale' });
    });
    show([task], { props: { onPackAction: onAction } });
    expect(text('.gc-work-detail')).toContain('It changed no files.');
    await actAsync(() => button('Show diff')!.click());
    await actAsync(async () => undefined);
    expect(onAction.mock.calls.map((call) => call[2])).toEqual([
      { type: 'diff', revision: A },
      { type: 'diff', revision: B },
    ]);
    expect(text('.gc-work-diff')).toBe('+late');
    expect(text('.gc-work-detail')).not.toContain('It changed no files.');
    expect(text('.gc-work-detail')).toContain('late.txt');
    expect($('.gc-work-feedback')).toBeNull();
  });

  it('leaving the detail keeps the revision that was read: Merge after reopening reloads a newer one first', async () => {
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);
    const onAction = vi.fn<PackActionHandler>(async (_turn, _id, action) => {
      if (action.type === 'diff') return `diff of ${action.revision}`;
      if (action.type === 'merge' && action.revision !== B)
        throw Object.assign(new Error('The worktree changed.'), { reason: 'stale' });
      return 'Merged t6';
    });
    const task: PackTask = {
      ...base,
      id: 't6',
      prompt: 'Change it.',
      status: 'completed',
      state: 'unmerged',
      changes: ['M\ta.ts'],
      checks: { reviewer: 'claude', revision: A },
    };
    show([task], { props: { onPackAction: onAction, chatId: 'chat-a' } });
    await actAsync(() => button('Show diff')!.click());
    expect(text('.gc-work-diff')).toBe(`diff of ${A}`);
    click(button('Tasks'));
    // A review moved the worktree on to B while the person was on the list.
    state.turns[0]!.pack!.tasks[0] = {
      ...task,
      checks: { reviewer: 'claude', revision: B, review: { revision: B, status: 'completed', detail: 'LGTM' } },
    };
    draw();
    click($('[data-task="7:t6"] .gc-work-row'));
    await actAsync(() => button('Merge locally')!.click());
    expect(onAction).toHaveBeenCalledWith(7, 't6', { type: 'merge', revision: A });
    await actAsync(async () => undefined);
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'diff', revision: B });
    expect(text('.gc-work-diff')).toBe(`diff of ${B}`);
    expect(onAction.mock.calls.filter((call) => call[2].type === 'merge')).toHaveLength(1);
    // Another chat's task with the same key has its own: nothing read there yet.
    props = { ...props, chatId: 'chat-b' };
    draw();
    await actAsync(() => button('Merge locally')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'merge', revision: B });
  });

  it('a failed reload after a stale merge keeps Merge locally off, across leaving the task, until the new diff shows', async () => {
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);
    let diffFails = false;
    const onAction = vi.fn<PackActionHandler>(async (_turn, _id, action) => {
      if (action.type === 'diff') {
        if (action.revision === B && diffFails) throw new Error('git diff failed');
        return `diff of ${action.revision}`;
      }
      if (action.type === 'merge' && action.revision !== B)
        throw Object.assign(new Error('The worktree changed.'), { reason: 'stale' });
      return 'Merged t6';
    });
    const task: PackTask = {
      ...base,
      id: 't6',
      prompt: 'Change it.',
      status: 'completed',
      state: 'unmerged',
      changes: ['M\ta.ts'],
      checks: { reviewer: 'claude', revision: A },
    };
    show([task], { props: { onPackAction: onAction } });
    await actAsync(() => button('Show diff')!.click());
    state.turns[0]!.pack!.tasks[0] = { ...task, checks: { reviewer: 'claude', revision: B } };
    draw();
    diffFails = true;
    await actAsync(() => button('Merge locally')!.click());
    await actAsync(async () => undefined);
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'diff', revision: B });
    expect(text('.gc-work-feedback')).toBe('git diff failed');
    // B was never shown: Merge locally stays off and offers a retry, not a merge of B.
    expect(button('Merge locally')!.hasAttribute('disabled')).toBe(true);
    expect(button('Retry diff')).toBeDefined();
    // Leaving the task and coming back does not forget it.
    click(button('Tasks'));
    click($('[data-task="7:t6"] .gc-work-row'));
    await actAsync(async () => undefined);
    expect(button('Merge locally')!.hasAttribute('disabled')).toBe(true);
    // Reopened, the reload is tried again; it fails again, and the retry button is back.
    expect(button('Retry diff')).toBeDefined();
    diffFails = false;
    await actAsync(() => button('Retry diff')!.click());
    await actAsync(async () => undefined);
    expect(text('.gc-work-diff')).toBe(`diff of ${B}`);
    expect(button('Merge locally')!.hasAttribute('disabled')).toBe(false);
    expect(onAction.mock.calls.filter((call) => call[2].type === 'merge')).toHaveLength(1);
    await actAsync(() => button('Merge locally')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'merge', revision: B });
  });

  it('a newer diff that arrives after the detail closed is not marked read: reopening loads it again first', async () => {
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);
    let answerB: ((text: string) => void) | undefined;
    const onAction = vi.fn<PackActionHandler>(async (_turn, _id, action) => {
      if (action.type === 'diff' && action.revision === B && !answerB)
        return new Promise<string>((resolve) => (answerB = resolve));
      if (action.type === 'diff') return `diff of ${action.revision}`;
      if (action.type === 'merge' && action.revision !== B)
        throw Object.assign(new Error('The worktree changed.'), { reason: 'stale' });
      return 'Merged t6';
    });
    const task: PackTask = {
      ...base,
      id: 't6',
      prompt: 'Change it.',
      status: 'completed',
      state: 'unmerged',
      changes: ['M\ta.ts'],
      checks: { reviewer: 'claude', revision: A },
    };
    show([task], { props: { onPackAction: onAction } });
    await actAsync(() => button('Show diff')!.click());
    state.turns[0]!.pack!.tasks[0] = { ...task, checks: { reviewer: 'claude', revision: B } };
    draw();
    // Merge of A is refused; the diff of B is asked for, and the person leaves before it arrives.
    await actAsync(() => button('Merge locally')!.click());
    await actAsync(async () => undefined);
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'diff', revision: B });
    click(button('Tasks'));
    await actAsync(async () => answerB!(`diff of ${B}`));
    // Reopened: B was never on screen, so Merge locally waits for it and nothing merges yet.
    click($('[data-task="7:t6"] .gc-work-row'));
    expect(button('Merge locally')!.hasAttribute('disabled')).toBe(true);
    await actAsync(async () => undefined);
    expect(onAction.mock.calls.filter((call) => call[2].type === 'diff' && call[2].revision === B)).toHaveLength(2);
    expect(text('.gc-work-diff')).toBe(`diff of ${B}`);
    expect(button('Merge locally')!.hasAttribute('disabled')).toBe(false);
    expect(onAction.mock.calls.filter((call) => call[2].type === 'merge')).toHaveLength(1);
    await actAsync(() => button('Merge locally')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'merge', revision: B });
  });

  it('a diff read before the revision was known is read again for the revision the server reports', async () => {
    const R = 'c'.repeat(40);
    const onAction = vi.fn<PackActionHandler>(async (_turn, _id, action) =>
      action.type === 'diff' ? `diff of ${action.revision ?? 'the worktree'}` : 'Merged t6',
    );
    // The first snapshot of the files failed: no revision yet.
    const task: PackTask = {
      ...base,
      id: 't6',
      prompt: 'Change it.',
      status: 'completed',
      state: 'unmerged',
      changes: ['M\ta.ts'],
      checks: {},
    };
    show([task], { props: { onPackAction: onAction } });
    await actAsync(() => button('Show diff')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'diff' });
    // Reading the diff took a snapshot: the task now has the revision the server read.
    state.turns[0]!.pack!.tasks[0] = { ...task, checks: { revision: R } };
    draw();
    await actAsync(async () => undefined);
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'diff', revision: R });
    expect(text('.gc-work-diff')).toBe(`diff of ${R}`);
    expect(button('Hide diff')).toBeDefined();
    await actAsync(() => button('Merge locally')!.click());
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'merge', revision: R });
  });

  it("a task's detail belongs to its conversation: what was typed for one chat's 7:t1 is not in another's", () => {
    const running: PackTask = { ...base, id: 't1', prompt: 'Go.', status: 'running', canSteer: true };
    show([running], { props: { onPackAction: vi.fn(async () => ''), chatId: 'chat-a' } });
    type('.gc-work-field', 'half a thought');
    click(button('Stop task'));
    expect(button('Confirm stop')).toBeDefined();
    props = { ...props, chatId: 'chat-b' };
    draw();
    expect(button('Confirm stop')).toBeUndefined();
    expect($<HTMLInputElement>('.gc-work-field').value).toBe('');
  });

  it('Escape in the message field clears what was typed, and the next one is left to the host', () => {
    show([{ ...base, id: 't1', prompt: 'Go.', status: 'running', canSteer: true }], {
      props: { onPackAction: vi.fn(async () => '') },
    });
    type('.gc-work-field', 'draft');
    const escape = () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      act(() => void $('.gc-work-field').dispatchEvent(event));
      return event.defaultPrevented;
    };
    expect(escape()).toBe(true);
    expect($<HTMLInputElement>('.gc-work-field').value).toBe('');
    expect(escape()).toBe(false);
  });

  it('worktree with unmerged changes: diff, checks, and Merge locally with what it does', async () => {
    const onAction = vi.fn<PackActionHandler>(async (_turn, _id, action) =>
      action.type === 'diff' ? '@@ -1 +1 @@\n-old\n+new' : 'Merged t6',
    );
    show(
      [
        {
          ...base,
          id: 't6',
          cwd: '/work/app/.genaicode/worktrees/t6',
          prompt: 'Add a changelog line.',
          status: 'completed',
          state: 'unmerged',
          text: 'Added one line.',
          changes: ['M\tdocs/CHANGELOG.md', 'A\tsrc/new.ts'],
          checks: { revision: 'abc1234def' },
          startedAt: t0,
          endedAt: t0 + 50_000,
        },
      ],
      { props: { onPackAction: onAction } },
    );
    expect(text('.gc-work-pill')).toBe('Unmerged');
    expect($('.gc-work-pill').getAttribute('data-tone')).toBe('merge');
    expect($$('.gc-work-files li').map((item) => item.textContent)).toEqual(['Mdocs/CHANGELOG.md', 'Asrc/new.ts']);
    expect(text('.gc-work-merge .gc-work-note')).toBe(
      'Merge locally copies this task’s changes from its worktree into your project folder. Nothing is staged, committed or pushed.',
    );
    // What the person can do without a reviewer or a test command, in plain words.
    const notes = $$('.gc-work-check .gc-work-note').map((item) => item.textContent);
    expect(notes[0]).toMatch(/^No second agent can review these changes: .* Read the changes yourself with Show diff/);
    expect(notes[1]).toMatch(
      /^No test command is set for this chat, so tests cannot run from here\. Run them yourself in \.genaicode\/worktrees\/t6, or start genaicode with --verify/,
    );
    expect(host.textContent).not.toMatch(/Requires another agent|Choose the test command/);

    await actAsync(() => button('Show diff')!.click());
    expect(onAction).toHaveBeenCalledWith(7, 't6', { type: 'diff', revision: 'abc1234def' });
    expect($$('.gc-work-diff span').map((item) => item.getAttribute('data-line'))).toEqual(['hunk', 'del', 'add']);
    await actAsync(() => button('Merge locally')!.click());
    // The revision that was looked at is the one merged.
    expect(onAction).toHaveBeenLastCalledWith(7, 't6', { type: 'merge', revision: 'abc1234def' });
    expect(text('.gc-work-feedback')).toBe('Merged t6');
  });

  it('a merged task still shows what its review said', () => {
    show([
      {
        ...base,
        id: 't8',
        prompt: 'Rewrite the importer.',
        status: 'completed',
        state: 'merged',
        changes: ['M\tsrc/import.ts'],
        checks: {
          reviewer: 'claude',
          revision: 'abc',
          review: { revision: 'abc', status: 'completed', detail: '[P1] drops rows\n\nVERDICT: CHANGES REQUESTED' },
        },
      },
    ]);
    expect($$('.gc-work-check-head').map((item) => item.textContent)[0]).toContain('Blocker');
  });

  it('review and tests: request them, read the notes, and a blocker takes the emphasis off Merge', async () => {
    const onAction = vi.fn<PackActionHandler>(async () => '');
    show(
      [
        {
          ...base,
          id: 't7',
          prompt: 'Rewrite the importer.',
          status: 'completed',
          state: 'unmerged',
          changes: ['M\tsrc/import.ts'],
          checks: {
            reviewer: 'claude',
            command: 'npm test',
            revision: 'abc',
            review: { revision: 'abc', status: 'completed', detail: 'BLOCKER: drops rows without an id' },
            verify: { revision: 'old', status: 'completed', detail: '12 passed' },
          },
        },
      ],
      { props: { onPackAction: onAction } },
    );
    expect(text('.gc-work-pill')).toBe('Review blocker');
    expect($$('.gc-work-check-head').map((item) => item.textContent)).toEqual([
      'Code reviewby claudeBlockerRequest review',
      'Testsnpm testOutdatedRun tests',
    ]);
    expect($$('.gc-work-check .gc-work-note')).toHaveLength(0);
    expect(text('.gc-work-check details pre')).toBe('BLOCKER: drops rows without an id');
    expect(button('Merge locally')!.className).not.toContain('gc-work-primary');
    expect(text('.gc-work-merge .gc-work-note')).toContain('The review found a blocker: read its notes first.');
    await actAsync(() => button('Request review')!.click());
    await actAsync(() => button('Run tests')!.click());
    expect(onAction.mock.calls.map((call) => call[2])).toEqual([{ type: 'review' }, { type: 'verify' }]);
  });

  it('an approval the task waits for is answered in its detail', () => {
    const onApprove = vi.fn();
    const onAutoApprove = vi.fn();
    show([{ ...base, id: 't8', prompt: 'Install it.', status: 'running', startedAt: t0 }], {
      props: { onApprove, onAutoApprove },
      state: {
        approvals: [{ id: 't8:ap-1', kind: 'command', subtaskId: 't8', summary: '[codex t8] npm install left-pad' }],
      },
    });
    expect(text('.gc-work-pill')).toBe('Needs approval');
    expect($('.gc-work-card[data-tone="ask"]').getAttribute('aria-label')).toBe('codex wants to run a command');
    expect(text('.gc-work-card[data-tone="ask"] pre')).toBe('npm install left-pad');
    click(button('Approve'));
    click(button('Deny'));
    click(button('Auto-approve all'));
    expect(onApprove.mock.calls).toEqual([
      ['t8:ap-1', 'approve'],
      ['t8:ap-1', 'deny'],
    ]);
    expect(onAutoApprove).toHaveBeenCalledOnce();
  });

  it('read-only without onPackAction, and when the host keeps the person from acting', () => {
    const task: PackTask = {
      ...base,
      id: 't9',
      prompt: 'Change it.',
      status: 'completed',
      state: 'unmerged',
      changes: ['M\ta.ts'],
      checks: {},
    };
    show([task]);
    expect(button('Merge locally')).toBeUndefined();
    expect(button('Show diff')).toBeUndefined();
    show([task], { props: { onPackAction: vi.fn(async () => ''), disabled: true } });
    expect(button('Merge locally')).toBeUndefined();
    expect($('.gc-work').getAttribute('data-disabled')).toBe('true');
  });

  it('a long instruction shows its start until it is opened', () => {
    const prompt = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of the instructions.`).join('\n');
    show([{ ...base, id: 't1', prompt, status: 'completed' }]);
    expect($('.gc-work-asked p').getAttribute('data-clipped')).toBe('true');
    click(button('Show all of it'));
    expect($('.gc-work-asked p').hasAttribute('data-clipped')).toBe(false);
    expect(text('.gc-work-asked p')).toBe(prompt);
  });
});

describe('<WorkPanel> task list', () => {
  const tasks: PackTask[] = [
    {
      ...base,
      id: 't1',
      title: 'Old review',
      prompt: 'x',
      mode: 'shared',
      status: 'completed',
      text: 'VERDICT: LGTM',
      verdict: 'VERDICT: LGTM',
      startedAt: t0,
      endedAt: t0 + 5_000,
    },
    {
      ...base,
      id: 't2',
      title: 'Changelog',
      prompt: 'x',
      status: 'completed',
      state: 'unmerged',
      changes: ['M\ta'],
      startedAt: t0,
      endedAt: t0 + 5_000,
    },
    { ...base, id: 't3', title: 'Checkout', prompt: 'x', status: 'failed', error: 'The dev server did not start.' },
    {
      ...base,
      id: 't4',
      title: 'Cart tests',
      prompt: 'x',
      status: 'running',
      text: 'tool shell: npm test',
      startedAt: t0 + 540_000,
    },
    { ...base, id: 't5', title: 'Install', prompt: 'x', status: 'running', startedAt: t0 + 540_000 },
    {
      ...base,
      id: 't6',
      title: 'Panel',
      prompt: 'x',
      status: 'completed',
      state: 'unmerged',
      pullRequest: { url: 'https://github.com/acme/app/pull/9', number: 9 },
      text: 'Opened it.',
    },
  ];
  const approvals: SessionState['approvals'] = [
    { id: 't5:ap-1', kind: 'command', subtaskId: 't5', summary: '[codex t5] npm install left-pad' },
  ];

  it("another chat's list starts where that chat's list was scrolled", () => {
    show(tasks, { list: true, props: { chatId: 'chat-a' } });
    view = { ...view, scroll: 120 };
    draw();
    const scroller = () => $('.gc-work-scroll');
    act(() => {
      scroller().scrollTop = 120;
    });
    // The host keeps a view per chat: chat B was left at 300.
    props = { ...props, chatId: 'chat-b' };
    view = { tab: 'tasks', scroll: 300 };
    draw();
    expect(scroller().scrollTop).toBe(300);
    props = { ...props, chatId: 'chat-a' };
    view = { tab: 'tasks', scroll: 120 };
    draw();
    expect(scroller().scrollTop).toBe(120);
  });

  it('groups rows by what to do next, with Done folded, and opens a task', () => {
    const onApprove = vi.fn();
    show(tasks, {
      list: true,
      state: { approvals },
      props: { onApprove, pullRequests: { '7:t6': { state: 'open', ours: true } } },
    });
    expect(text('.gc-work-tab')).toBe('Tasks 6');
    expect($$('.gc-work-group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'Needs you',
      'Failed',
      'Running',
      'Unmerged',
      'Done',
    ]);
    expect(
      $$('.gc-work-group-head button').map((item) => [item.textContent, item.getAttribute('aria-expanded')]),
    ).toEqual([
      ['Needs you 1', 'true'],
      ['Failed 1', 'true'],
      ['Running 1', 'true'],
      ['Unmerged 1', 'true'],
      ['Done 2', 'false'],
    ]);
    expect($$('.gc-work-row').map((row) => row.textContent)).toEqual([
      't5Installcodex · 1m 00snpm install left-padNeeds approval',
      't3CheckoutcodexThe dev server did not start.Failed',
      't4Cart testscodex · 1m 00sShell npm testRunning',
      't2Changelogcodex · 5s1 file changedUnmerged',
    ]);
    // The whole panel says nothing of money or of packs.
    expect(host.textContent).not.toMatch(/\$|Pack tasks|\bpack\b/i);

    click($$('.gc-work-group-head button')[4]);
    expect(view.folded).toEqual({ done: false });
    expect(
      $$('.gc-work-row')
        .slice(4)
        .map((row) => row.textContent),
    ).toEqual(['t6PanelcodexPR #9 · open · Opened it.PR #9 · open', 't1Old reviewcodex · 5sVERDICT: LGTMDone']);

    click(button('Approve'));
    expect(onApprove).toHaveBeenCalledWith('t5:ap-1', 'approve');

    click($$('.gc-work-row')[3]);
    expect(view.task).toBe('7:t2');
    expect($('.gc-work-detail').getAttribute('aria-label')).toBe('Task t2');
    // Opened from its row: the back button has the focus, and going back returns it to the row.
    expect(document.activeElement?.textContent).toBe('Tasks');
    click(button('Tasks'));
    expect(view.task).toBeUndefined();
    expect(document.activeElement?.closest('.gc-work-task')?.getAttribute('data-task')).toBe('7:t2');
  });

  it('says so when nothing was delegated, and has a close button only when the host takes it', () => {
    const onClose = vi.fn();
    show([{ ...base, id: 't1', prompt: 'x', status: 'completed' }], { list: true, props: { onClose } });
    click($('[aria-label="Close work panel"]'));
    expect(onClose).toHaveBeenCalledOnce();
    state = session([]);
    props = {};
    draw();
    expect(text('.gc-work-empty')).toMatch(/^No delegated tasks in this conversation\./);
    expect($('[aria-label="Close work panel"]')).toBeNull();
  });

  it('is docked at its width with a resize edge, or a full view without one', () => {
    show(tasks, { list: true, props: { width: 440, bounds: () => [380, 572], onWidth: vi.fn() } });
    expect($('.gc-work').getAttribute('data-mode')).toBe('docked');
    expect($('.gc-work').style.width).toBe('440px');
    const edge = $('.gc-work-resize');
    expect(edge.getAttribute('role')).toBe('separator');
    expect(edge.getAttribute('aria-valuemin')).toBe('380');
    expect(edge.getAttribute('aria-valuemax')).toBe('572');
    expect(edge.getAttribute('aria-valuenow')).toBe('440');
    act(() => edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(props.onWidth).toHaveBeenCalledWith(456, true);

    show(tasks, { list: true, props: { mode: 'full', width: 440, bounds: () => [380, 572], onWidth: vi.fn() } });
    expect($('.gc-work').getAttribute('data-mode')).toBe('full');
    expect($('.gc-work').style.width).toBe('');
    expect($('.gc-work-resize')).toBeNull();
  });
});

describe('<AgentChat onOpenTasks>', () => {
  it("shows a turn's delegated tasks as one line that opens the panel, with their approvals in the transcript", () => {
    const onOpenTasks = vi.fn();
    const onApprove = vi.fn();
    const tasks: PackTask[] = [
      { ...base, id: 't1', prompt: 'x', status: 'running' },
      { ...base, id: 't2', prompt: 'x', status: 'completed' },
      { ...base, id: 't3', prompt: 'x', status: 'failed' },
    ];
    const state = session(tasks, {
      approvals: [{ id: 't1:ap-1', kind: 'command', subtaskId: 't1', summary: '[codex t1] npm install' }],
    });
    state.turns[0]!.entries = [
      {
        kind: 'approval',
        request: { id: 't1:ap-1', kind: 'command', subtaskId: 't1', summary: '[codex t1] npm install' },
      },
    ];
    act(() =>
      root.render(<AgentChat state={state} onSend={() => undefined} onOpenTasks={onOpenTasks} onApprove={onApprove} />),
    );
    expect($('.gc-pack')).toBeNull();
    expect(text('.gc-workline')).toBe('3 delegated tasks1 needs you · 1 running · 1 failed · 1 finishedOpen ›');
    click($('.gc-workline'));
    expect(onOpenTasks).toHaveBeenCalledWith(state.turns[0]);
    expect(text('.gc-approval')).toContain('codex wants to run:');
    click($$('.gc-approval button').find((item) => item.textContent === 'Approve'));
    expect(onApprove).toHaveBeenCalledWith('t1:ap-1', 'approve');

    // Without the prop the card is inline, as before.
    act(() => root.render(<AgentChat state={state} onSend={() => undefined} onApprove={onApprove} />));
    expect($('.gc-workline')).toBeNull();
    expect($('.gc-pack').getAttribute('aria-label')).toBe('Delegated tasks');
  });
});

async function actAsync(run: () => void) {
  await act(async () => {
    run();
    await Promise.resolve();
  });
}
