import { describe, expect, it } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import type { SessionTurn } from '../agents/session.js';
import {
  messageReceipt,
  packActivity,
  packLatestMessage,
  packRunningStep,
  packStepLine,
  packSteerReceipt,
  packMetrics,
  packTaskElapsed,
  packTaskError,
  packTaskList,
  packTaskOutcome,
  packTaskStopped,
  packTaskTitle,
  packWorkCount,
  packWorkLine,
  toolDiff,
  visibleReply,
} from './format.js';

const shown = (input: unknown) => toolDiff(input)?.lines.map((line) => `${line.sign}${line.text}`);

describe('visibleReply', () => {
  const trailer =
    '<oai-mem-citation>\n<citation_entries>MEMORY.md:5|note=[why]</citation_entries>\n</oai-mem-citation>';

  it('hides the footer at every stream boundary and on completion', () => {
    for (let length = 1; length <= trailer.length; length++) {
      expect(visibleReply('codexLive', 'Reply.' + trailer.slice(0, length), true)).toBe('Reply.');
    }
    expect(visibleReply('codex', 'Reply.' + trailer + '\n')).toBe('Reply.');
  });

  it('preserves literal mentions, code samples, other agents and text following a block', () => {
    for (const sample of ['Use <oai-mem-citation>', '`' + trailer + '`', '~~~xml\n' + trailer, trailer + '\nMore.']) {
      expect(visibleReply('codex', sample)).toBe(sample);
    }
    expect(visibleReply('claude', trailer)).toBe(trailer);
  });
});

describe('toolDiff', () => {
  it('reads one replacement, keeping the lines both ends share', () => {
    expect(shown({ file_path: 'a', old_string: 'x\ny\nz', new_string: 'x\nY\nz' })).toEqual([' x', '-y', '+Y', ' z']);
    expect(toolDiff({ oldString: 'a', newString: 'a\nb' })).toMatchObject({ added: 1, removed: 0, more: 0 });
    // Text taken out, down to nothing, and put into nothing.
    expect(shown({ old_string: 'remove me', new_string: '' })).toEqual(['-remove me']);
    expect(shown({ old_string: '', new_string: 'new' })).toEqual(['+new']);
    expect(shown({ old_str: 'a\nb', new_str: 'a' })).toEqual([' a', '-b']);
  });

  it('reads several replacements, a written file and a patch', () => {
    expect(
      shown({
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    ).toEqual(['-a', '+b', ' ⋯', '-c', '+d']);
    expect(shown({ file_path: 'new.txt', content: 'one\ntwo' })).toEqual(['+one', '+two']);
    const patch = '*** Begin Patch\n*** Update File: a.ts\n@@\n keep\n-old\n+new\n*** End Patch';
    expect(shown({ patch })).toEqual([' *** Update File: a.ts', ' @@', ' keep', '-old', '+new']);
    expect(shown(patch)).toEqual(shown({ patch }));
    expect(shown('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toEqual([' @@ -1 +1 @@', '-a', '+b']);
  });

  it('keeps changed lines that look like file headers, and survives a huge file', () => {
    const sql = 'diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1 +1 @@\n--- old comment\n+++ plus';
    expect(shown(sql)).toEqual([' @@ -1 +1 @@', '--- old comment', '+++ plus']);
    expect(toolDiff(sql)).toMatchObject({ added: 1, removed: 1 });
    const huge = 'x\n'.repeat(200_000);
    expect(toolDiff({ path: 'large.txt', content: huge })?.added).toBe(200_000);
    expect(toolDiff({ old_string: huge, new_string: `y\n${huge}` })?.added).toBe(1);
  });

  it('is nothing for a call that changes no file', () => {
    expect(toolDiff({ command: 'ls -la' })).toBeUndefined();
    expect(toolDiff({ content: 'no path' })).toBeUndefined();
    expect(toolDiff('just words')).toBeUndefined();
    expect(toolDiff(undefined)).toBeUndefined();
    expect(toolDiff(['a'])).toBeUndefined();
  });

  it('tells the next file of a patch from a changed line that looks like a header', () => {
    const two = [
      '--- a/one.txt',
      '+++ b/one.txt',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '--- a/two.txt',
      '+++ b/two.txt',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '--- old',
      '+++ new',
    ].join('\n');
    const diff = toolDiff(two);
    expect(diff).toMatchObject({ added: 2, removed: 2 });
    expect(diff?.lines.filter((line) => line.sign !== ' ').map((line) => line.text)).toEqual([
      'a',
      'b',
      '-- old',
      '++ new',
    ]);
  });

  it('keeps the change in view when a long text around it stays the same', () => {
    const shared = Array.from({ length: 500 }, (_, i) => `l${i}`);
    const diff = toolDiff({
      old_string: [...shared, 'old', ...shared].join('\n'),
      new_string: [...shared, 'new', ...shared].join('\n'),
    });
    expect(diff).toMatchObject({ added: 1, removed: 1, more: 0 });
    expect(diff?.lines.map((line) => `${line.sign}${line.text}`)).toEqual([
      ' ⋯',
      ' l497',
      ' l498',
      ' l499',
      '-old',
      '+new',
      ' l0',
      ' l1',
      ' l2',
      ' ⋯',
    ]);
  });

  it('counts no line for the newline that ends a text', () => {
    expect(toolDiff({ path: 'a.txt', content: 'one\n' })).toMatchObject({ added: 1, removed: 0 });
    expect(toolDiff({ path: 'a.txt', content: '' })).toBeUndefined();
    expect(toolDiff({ old_string: 'one\n', new_string: '' })).toMatchObject({ added: 0, removed: 1 });
    expect(toolDiff({ old_string: 'one\n', new_string: 'one\ntwo\n' })).toMatchObject({ added: 1, removed: 0 });
    expect(toolDiff('@@ -1 +1 @@\n-a\n+b\n')?.lines).toHaveLength(3);
    // Dropping only that newline is still a change to the last line.
    expect(toolDiff({ old_string: 'a\none\n', new_string: 'a\none' })?.lines).toEqual([
      { sign: ' ', text: 'a' },
      { sign: '-', text: 'one' },
      { sign: '+', text: 'one (no newline at end)' },
    ]);
  });

  it('reads a patch of several files with whole files added and removed', () => {
    const patch = [
      '--- /w/a.txt',
      '+++ /w/a.txt',
      '@@ -1 +1 @@',
      '-first',
      '+hello',
      '--- /dev/null',
      '+++ /w/new.txt',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n');
    expect(toolDiff(patch)).toMatchObject({ added: 3, removed: 1 });
  });

  it('cuts a long change and says how much is left out', () => {
    const long = toolDiff({ path: 'big', content: Array.from({ length: 450 }, (_, i) => `l${i}`).join('\n') });
    expect(long).toMatchObject({ added: 450, more: 50 });
    expect(long?.lines).toHaveLength(400);
  });
});

describe('packTaskTitle', () => {
  it('uses the title, else the first sentence of the prompt without a "Task:" label', () => {
    expect(packTaskTitle({ title: ' Visual uplift ', prompt: 'x' })).toBe('Visual uplift');
    expect(packTaskTitle({ prompt: 'Task: give the game a visual upgrade. Then stop.' })).toBe(
      'Give the game a visual upgrade.',
    );
    expect(packTaskTitle({ prompt: 'a'.repeat(100) })).toHaveLength(80);
  });
});

const packTask = (patch: Partial<PackTask> = {}): PackTask => ({
  id: 't1',
  agent: 'codex',
  prompt: 'Review it',
  mode: 'shared',
  status: 'completed',
  cwd: '/w',
  ...patch,
});

describe('packMetrics', () => {
  it('says how many tasks were delegated and how many run, without slots, the lead or a dollar figure', () => {
    const turn = {
      id: 1,
      agent: 'claude',
      prompt: 'x',
      startedAt: 0,
      entries: [],
      usage: { inputTokens: 3_000_000, outputTokens: 300_000 },
      costUsd: 36.26,
      pack: {
        lead: 'claude',
        maxParallel: 4,
        interactive: true,
        tasks: [packTask({ status: 'running' }), packTask(), packTask(), packTask()],
      },
    } satisfies SessionTurn;
    expect(packMetrics(turn)).toBe('4 tasks delegated · 1 running');
    expect(packMetrics(turn)).not.toContain('$');
    expect(packMetrics(turn)).not.toMatch(/slots|leads/);
    turn.pack.tasks = [packTask()];
    expect(packMetrics(turn)).toBe('1 task delegated');
    const budgeted = { ...turn, pack: { ...turn.pack, budget: { maxTokens: 5_000_000, maxCostUsd: 50 } } };
    expect(packMetrics(budgeted)).toBe('1 task delegated · budget 3.3M/5.0M tokens');
  });
});

describe('packWorkLine', () => {
  const task = (id: string, status: PackTask['status']): PackTask => ({
    id,
    agent: 'codex',
    prompt: 'x',
    mode: 'shared',
    cwd: '/w',
    status,
  });
  it("counts a turn's delegated tasks by where they stand", () => {
    const tasks = [task('t1', 'running'), task('t2', 'running'), task('t3', 'failed'), task('t4', 'completed')];
    expect(packWorkCount(tasks.length)).toBe('4 delegated tasks');
    expect(packWorkCount(1)).toBe('1 delegated task');
    expect(packWorkLine(tasks, [{ subtaskId: 't2' }, {}])).toBe('1 needs you · 2 running · 1 failed · 1 finished');
    expect(packWorkLine(tasks, [{ subtaskId: 't1' }, { subtaskId: 't2' }])).toMatch(/^2 need you/);
    expect(packWorkLine([task('t1', 'aborted'), task('t2', 'timeout')])).toBe('1 failed · 1 finished');
    expect(packWorkLine([])).toBe('');
  });
});

describe('packActivity', () => {
  it('splits a tool call into its friendly name and argument', () => {
    expect(packActivity('tool shell: npm test')).toEqual({
      tool: 'Shell',
      argument: 'npm test',
      text: 'Shell: npm test',
    });
    expect(packActivity('tool Bash')).toEqual({ tool: 'Shell', text: 'Running Shell' });
    expect(packActivity('## Looking at **pack.ts**\nmore')).toEqual({ text: 'Looking at pack.ts' });
    expect(packActivity('edited src/a.ts')).toEqual({ text: 'Edited src/a.ts' });
  });
});

describe('packStepLine', () => {
  const at = 1_000_000;
  it('words a tool call by what it does: running with the time so far, finished with how long it took', () => {
    expect(packStepLine({ kind: 'tool', name: 'Bash', text: 'npm test', at }, at + 14_000)).toEqual({
      verb: 'Running',
      object: 'npm test',
      detail: '14s so far',
      running: true,
      failed: false,
    });
    expect(packStepLine({ kind: 'tool', name: 'shell', text: 'npm test', at, endedAt: at + 65_000 })).toMatchObject({
      verb: 'Ran',
      detail: '1m 05s',
      running: false,
    });
    // Under a second says nothing of time; a failure says so.
    // Under a second still says it returned quickly.
    expect(packStepLine({ kind: 'tool', name: 'Read', text: 'a.ts', at, endedAt: at + 20 }).detail).toBe('<1s');
    // A call the task's end cut short is not worded as done.
    expect(
      packStepLine({ kind: 'tool', name: 'Write', text: 'a.ts', at, endedAt: at + 2_000, interrupted: true }),
    ).toMatchObject({ verb: 'Writing', detail: 'interrupted · 2s', running: false });
    // An edit whose call failed did not happen.
    expect(packStepLine({ kind: 'edit', text: 'a.ts', at, failed: true })).toMatchObject({
      verb: 'Could not edit',
      detail: 'failed',
    });
    expect(packStepLine({ kind: 'tool', name: 'Bash', text: 'x', at, endedAt: at + 20, failed: true })).toMatchObject({
      detail: 'failed · <1s',
      failed: true,
    });
  });
  it('knows the tools drivers report, and names an unknown one', () => {
    const verbs = (name: string) => [
      packStepLine({ kind: 'tool', name, text: 'x', at }).verb,
      packStepLine({ kind: 'tool', name, text: 'x', at, endedAt: at }).verb,
    ];
    expect(verbs('Edit')).toEqual(['Editing', 'Edited']);
    expect(verbs('apply_patch')).toEqual(['Editing', 'Edited']);
    expect(verbs('Write')).toEqual(['Writing', 'Wrote']);
    expect(verbs('Grep')).toEqual(['Searching', 'Searched']);
    expect(verbs('WebSearch')).toEqual(['Searching', 'Searched']);
    expect(verbs('WebFetch')).toEqual(['Fetching', 'Fetched']);
    expect(verbs('Glob')).toEqual(['Listing', 'Listed']);
    expect(verbs('TodoWrite')).toEqual(['Planning', 'Planned']);
    expect(verbs('exec_command')).toEqual(['Running', 'Ran']);
    expect(packStepLine({ kind: 'tool', name: 'mcp__docs__lookup', text: 'react', at })).toMatchObject({
      verb: 'Using',
      object: 'mcp__docs__lookup react',
    });
    // A known tool that names nothing it works on is named itself.
    expect(packStepLine({ kind: 'tool', name: 'TodoWrite', at }).object).toBe('Plan');
  });
  it('shows paths relative to the task directory, and words edits, approvals and errors', () => {
    expect(packStepLine({ kind: 'tool', name: 'Read', text: '/work/t1/src/a.ts', at }, at, '/work/t1').object).toBe(
      'src/a.ts',
    );
    expect(packStepLine({ kind: 'edit', text: 'src/a.ts, src/b.ts', at })).toMatchObject({ verb: 'Edited' });
    expect(packStepLine({ kind: 'approval', text: 'npm install', at }).verb).toBe('Asked to approve');
    expect(packStepLine({ kind: 'error', text: 'rate limited', at })).toMatchObject({ verb: 'Error', failed: true });
  });
  it('finds the call a running task is in and what it said last', () => {
    const task = (patch: Partial<PackTask>): PackTask => ({
      id: 't1',
      agent: 'codex',
      prompt: 'x',
      mode: 'shared',
      cwd: '/work',
      status: 'running',
      ...patch,
    });
    const steps: PackTask['steps'] = [
      { kind: 'message', text: 'First.', at },
      { kind: 'tool', name: 'Bash', text: 'sleep 9', at },
      { kind: 'message', text: 'Second.', at },
      { kind: 'tool', name: 'Read', text: 'a.ts', at, endedAt: at },
    ];
    expect(packRunningStep(task({ steps }))).toBe(steps[1]);
    expect(packRunningStep(task({ steps, status: 'completed' }))).toBeUndefined();
    expect(packRunningStep(task({}))).toBeUndefined();
    expect(packLatestMessage(task({ steps }))).toBe('Second.');
  });
});

describe('messageReceipt', () => {
  const sent = { at: 10_000, settledAt: 10_900 };
  it('words every state of a message sent to a working agent', () => {
    expect(messageReceipt({ delivery: 'sending', at: 1 }, 'claude')).toMatchObject({
      state: 'sending',
      text: 'Sending…',
      spoken: 'Sending',
    });
    expect(messageReceipt({ delivery: 'delivered', ...sent }, 'claude')).toEqual({
      state: 'delivered',
      text: '✓ Delivered · 0.9s',
      spoken: 'Delivered after 0.9s',
      title: 'claude took the message after 0.9s, between two steps of its work.',
    });
    expect(messageReceipt({ delivery: 'delivered', ...sent }, 'claude', { answered: true })).toMatchObject({
      state: 'answered',
      text: '✓✓ Delivered · answered',
    });
    expect(messageReceipt({ delivery: 'sent', at: 0, settledAt: 75_000 }, 'gemini')).toMatchObject({
      state: 'sent',
      text: 'Sent to gemini · 1m 15s',
    });
    expect(messageReceipt({ delivery: 'queued', ...sent }, 'claude').text).toBe('Queued for the next turn');
    expect(messageReceipt({ delivery: 'dropped', ...sent }, 'claude')).toMatchObject({
      state: 'failed',
      text: 'Not delivered',
      title: 'The turn was stopped before claude took it.',
    });
    // Recorded before delivery or its time was tracked.
    expect(messageReceipt({ delivery: 'delivered' }, 'claude').text).toBe('✓ Delivered');
    expect(messageReceipt({}, '')).toMatchObject({ state: 'unknown', text: 'Sent while working' });
  });
  it('a steer is answered once the task said something after it took it', () => {
    const steer = { text: 'x', from: 'user' as const, delivery: 'delivered' as const, ...sent };
    expect(packSteerReceipt(steer, 'codex').state).toBe('delivered');
    expect(packSteerReceipt({ ...steer, answeredAt: 12_000 }, 'codex').state).toBe('answered');
    // Only a task known to have ended is said to have ended first.
    expect(packSteerReceipt({ ...steer, delivery: 'dropped' }, 'codex', true).title).toBe(
      'The task ended before codex took it.',
    );
    expect(packSteerReceipt({ ...steer, delivery: 'dropped' }, 'codex').title).toBe(
      'codex did not confirm that it took the message, so it may not have read it.',
    );
  });
});

describe('packTaskOutcome', () => {
  it('prefers a verdict line, then the error, then the first line, after the changed-file count', () => {
    expect(
      packTaskOutcome(packTask({ text: 'Looked at 3 files.\n\n**VERDICT: LGTM**', verdict: '**VERDICT: LGTM**' })),
    ).toBe('VERDICT: LGTM');
    expect(packTaskOutcome(packTask({ text: '# Summary\nAll good' }))).toBe('Summary');
    expect(packTaskOutcome(packTask({ status: 'failed', error: 'exit 1\nstack', text: 'partial' }))).toBe('exit 1');
    expect(packTaskOutcome(packTask({ mode: 'worktree', changes: ['M\ta.ts', 'A\tb.ts'], text: 'Added b.' }))).toBe(
      '2 files changed · Added b.',
    );
    expect(packTaskOutcome(packTask({ mode: 'worktree', changes: [] }))).toBe('No file changes');
    expect(packTaskOutcome(packTask({ status: 'running', text: 'tool shell: npm test' }))).toBe('Shell: npm test');
    expect(packTaskOutcome(packTask())).toBe('');
  });

  it('says why a stopped task stopped instead of the bare "was stopped" error', () => {
    const stopped = packTask({
      status: 'aborted',
      agent: 'claude',
      error: 'claude was stopped.',
      text: 'claude was stopped.',
    });
    expect(packTaskOutcome(stopped)).toBe('');
    expect(packTaskStopped(stopped)).toBe('Stopped');
    expect(packTaskError(stopped)).toBeUndefined();
    expect(packTaskOutcome({ ...stopped, stoppedBy: 'user' })).toBe('Stopped by you');
    expect(packTaskOutcome({ ...stopped, stoppedBy: 'lead-finished' })).toBe('Stopped when the lead agent finished');
    expect(packTaskStopped({ ...stopped, stoppedBy: 'budget' })).toBe('Stopped: over budget');
    expect(packTaskStopped(packTask())).toBeUndefined();
    expect(packTaskError(packTask({ status: 'failed', error: 'exit 1' }))).toBe('exit 1');
  });

  it('takes the verdict pack read from the whole reply, not a quoted one in the clipped text', () => {
    const quoted = packTask({ text: 'The brief said:\n> VERDICT: LGTM\nI disagree.' });
    expect(packTaskOutcome(quoted)).toBe('The brief said:');
    expect(packTaskOutcome({ ...quoted, verdict: 'VERDICT: CHANGES' })).toBe('VERDICT: CHANGES');
  });

  it('keeps diagnostics verbatim and drops only the runtime stop message of a stopped task', () => {
    const failed = packTask({ status: 'failed', error: 'PostgreSQL was stopped.' });
    expect(packTaskOutcome(failed)).toBe('PostgreSQL was stopped.');
    expect(packTaskError(failed)).toBe('PostgreSQL was stopped.');
    const aborted = packTask({ status: 'aborted', agent: 'codex', error: 'PostgreSQL was stopped.' });
    expect(packTaskOutcome(aborted)).toBe('PostgreSQL was stopped.');
    expect(packTaskError(aborted)).toBe('PostgreSQL was stopped.');
    expect(packTaskOutcome(packTask({ status: 'failed', error: 'Error in __main__: `x` **failed**' }))).toBe(
      'Error in __main__: `x` **failed**',
    );
    expect(packTaskOutcome(packTask({ status: 'failed', error: 'claude was stopped.' }))).toBe('claude was stopped.');
  });
});

describe('packTaskList', () => {
  const ids = (list: { shown: PackTask[]; hidden: number }) => [list.shown.map((task) => task.id), list.hidden];
  const tasks = [
    packTask({ id: 't1' }),
    packTask({ id: 't2', status: 'running' }),
    packTask({ id: 't3' }),
    packTask({ id: 't4', mode: 'worktree', state: 'unmerged' }),
    packTask({ id: 't5', status: 'failed' }),
    packTask({ id: 't6' }),
    packTask({ id: 't7' }),
    packTask({ id: 't8', status: 'running' }),
  ];

  it('puts asking and running tasks first, then ready to merge, then finished newest first, folding older ones', () => {
    expect(ids(packTaskList(tasks))).toEqual([['t8', 't2', 't4', 't7', 't6', 't5'], 2]);
    expect(ids(packTaskList(tasks, { asking: (task) => task.id === 't1' }))).toEqual([
      ['t8', 't2', 't1', 't4', 't7', 't6', 't5', 't3'],
      0,
    ]);
  });

  it('orders ended tasks by when they ended, latest first, and keeps delegation order without end times', () => {
    const ended = [
      packTask({ id: 't1', endedAt: 500 }),
      packTask({ id: 't2', endedAt: 100 }),
      packTask({ id: 't3', endedAt: 200 }),
      packTask({ id: 't4', endedAt: 300 }),
      packTask({ id: 't5', endedAt: 400 }),
    ];
    // t1 was delegated first but finished last: it is shown, not folded away.
    expect(ids(packTaskList(ended))).toEqual([['t1', 't5', 't4'], 2]);
    expect(ids(packTaskList(ended, { expanded: true }))).toEqual([['t1', 't5', 't4', 't3', 't2'], 0]);
    expect(
      ids(
        packTaskList(
          ended.map((task) => ({ ...task, endedAt: undefined })),
          { expanded: true },
        ),
      ),
    ).toEqual([['t5', 't4', 't3', 't2', 't1'], 0]);
  });

  it('keeps the selected task, unfolds when expanded, and never folds a single task', () => {
    expect(ids(packTaskList(tasks, { keep: 't1' }))).toEqual([['t8', 't2', 't4', 't7', 't6', 't5', 't1'], 1]);
    expect(ids(packTaskList(tasks, { expanded: true }))[1]).toBe(0);
    expect(ids(packTaskList(tasks.slice(2, 7)))).toEqual([['t4', 't7', 't6', 't5', 't3'], 0]);
  });
});

describe('packTaskElapsed', () => {
  it('measures to the end, or to now while running, and is empty without times', () => {
    expect(packTaskElapsed(packTask({ startedAt: 0, endedAt: 75_000 }))).toBe('1m 15s');
    expect(packTaskElapsed(packTask({ status: 'running', startedAt: 0 }), 4_000)).toBe('4s');
    expect(packTaskElapsed(packTask({ startedAt: 0 }))).toBe('');
    expect(packTaskElapsed(packTask())).toBe('');
  });
});
