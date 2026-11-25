import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { expect, it, vi } from 'vitest';
import { packApproval, type PackAction, type PackTask } from '../agents/pack.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

const PR = 'https://github.com/acme/app/pull/351';
/** The Git tree of a task's worktree, as the pack names it. */
const REVISION = 'abc1234def'.padEnd(40, '0');

/** The panel's box and the chat's, in CSS pixels. */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width) }
        : undefined;
    };
    return { work: box('.gc-work'), chat: box('.workspace .gc-chat'), side: box('aside.side') };
  });

it('shows delegated tasks in the work panel: one task from approval to merge, at every width', async () => {
  const browser = await chromium.launch();
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'work-ui-'));
  const project = join(root, 'app');
  mkdirSync(project);
  const stop = new AbortController();

  const started = Date.now();
  const base = { agent: 'worker', mode: 'worktree' as const, startedAt: started };
  const tasks: PackTask[] = [
    {
      ...base,
      id: 't1',
      title: 'Cover the cart total',
      prompt: 'Write tests for total() in src/cart.ts.',
      status: 'running',
      canSteer: true,
      cwd: join(project, '.genaicode', 'worktrees', 't1'),
      text: 'tool shell: npm test -- cart',
      // What it did so far, and the call it is in.
      steps: [
        {
          kind: 'tool',
          name: 'Read',
          text: join(project, '.genaicode', 'worktrees', 't1', 'src', 'cart.ts'),
          at: started,
          endedAt: started + 300,
        },
        { kind: 'message', text: 'The total skips discounts.', at: started + 400 },
        { kind: 'tool', name: 'shell', text: 'npm test -- cart', at: started + 500 },
      ],
    },
    {
      ...base,
      id: 't2',
      title: 'Update the changelog',
      prompt: 'Add a changelog line for the cart fix.',
      status: 'completed',
      state: 'unmerged',
      cwd: join(project, '.genaicode', 'worktrees', 't2'),
      text: 'Added one line under Unreleased.',
      changes: ['M\tdocs/CHANGELOG.md'],
      checks: { reviewer: 'helper', revision: REVISION },
      endedAt: started + 50_000,
    },
    {
      ...base,
      id: 't3',
      title: 'Check the checkout page',
      prompt: 'Open the checkout page and compare the total.',
      mode: 'shared',
      status: 'failed',
      cwd: project,
      error: 'The dev server did not start.',
      endedAt: started + 10_000,
    },
    {
      ...base,
      id: 't4',
      title: 'Install the date library',
      prompt: 'Add a date library and use it in the cart.',
      status: 'running',
      cwd: join(project, '.genaicode', 'worktrees', 't4'),
    },
    {
      ...base,
      id: 't5',
      title: 'Ship the price fix',
      prompt: 'Fix the price rounding and open a pull request.',
      status: 'completed',
      state: 'unmerged',
      cwd: join(project, '.genaicode', 'worktrees', 't5'),
      text: `Opened ${PR}`,
      pullRequest: { url: PR, number: 351 },
      changes: ['M\tsrc/price.ts'],
      checks: {},
      endedAt: started + 70_000,
    },
  ];
  const actions: string[] = [];
  const listeners = new Set<(id: string) => void>();
  const changed = (id: string) => listeners.forEach((listener) => listener(id));
  const patch = (id: string, change: Partial<PackTask>) => {
    const index = tasks.findIndex((task) => task.id === id);
    tasks[index] = { ...tasks[index]!, ...change };
    changed(id);
  };
  let finish: (() => void) | undefined;
  const decisions: string[] = [];
  const helper: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true },
    run(task) {
      const result: AgentResult = {
        status: 'completed',
        ok: true,
        exitCode: 0,
        signal: null,
        sessionId: 'ses_work',
        text: 'Handed out.',
      };
      const released = new Promise<void>((resolve) => (finish = resolve));
      return {
        result: released.then(() => result),
        abort() {
          finish?.();
        },
        pack: {
          lead: 'helper',
          maxParallel: 4,
          task: (id) => tasks.find((item) => item.id === id),
          onTaskChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          async act(id: string, action: PackAction) {
            actions.push(`${id} ${action.type}${'text' in action ? `: ${action.text}` : ''}`);
            const found = tasks.find((item) => item.id === id)!;
            if (action.type === 'diff') return '@@ -1,2 +1,3 @@\n ## Unreleased\n+- The cart total counts every item\n';
            if (action.type === 'steer')
              patch(id, {
                steers: [
                  ...(found.steers ?? []),
                  {
                    text: action.text,
                    from: 'user',
                    at: Date.now() - 400,
                    settledAt: Date.now(),
                    delivery: 'delivered',
                  },
                ],
              });
            if (action.type === 'stop')
              patch(id, { status: 'aborted', stoppedBy: 'user', endedAt: Date.now(), canSteer: false });
            if (action.type === 'review')
              patch(id, {
                checks: {
                  ...found.checks,
                  review: { revision: REVISION, status: 'completed', detail: 'No findings.' },
                },
              });
            if (action.type === 'merge') patch(id, { state: 'merged' });
            if (action.type === 'discard') patch(id, { state: 'discarded' });
            return action.type === 'merge' ? `Merged ${id}:\nM\tdocs/CHANGELOG.md` : '';
          },
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
          yield { type: 'session', sessionId: result.sessionId! };
          for (const item of tasks) yield { type: 'subtask-start', ...item };
          yield { type: 'message', text: 'Five tasks are out.' };
          // t4 asks before it installs; the turn goes on meanwhile.
          const asked = packApproval('t4', 'worker', { id: 'ap-1', kind: 'command', summary: 'npm install left-pad' });
          void Promise.resolve(task.onApproval?.(asked, stop.signal)).then(
            (decision) => decision && decisions.push(decision),
          );
          await released;
          yield { type: 'done', result };
        },
      };
    },
  };

  let running: Promise<number> | undefined;
  // Whether t5's worktree is still its pull request; `fresh` is the server's check before a discard.
  let t5Held: (fresh: boolean) => boolean = () => true;
  try {
    const bundle = await build({
      entryPoints: ['src/ui/web/client.tsx'],
      bundle: true,
      write: false,
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.css': 'text' },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    let opened: string | undefined;
    const launch = (options: UiLaunch) =>
      runWeb({
        ...options,
        stderr: new PassThrough().resume(),
        openUrl(url) {
          opened = url;
        },
        clientScript: bundle.outputFiles[0]!.text,
        // No `gh` in a test: t5 opened the pull request (its worktree is on the head branch), and it is merged.
        pullRequest: async (url, worktree, options) =>
          url === PR
            ? { state: 'merged', ours: worktree?.endsWith('/t5') === true && t5Held(options?.fresh === true) }
            : undefined,
      });
    running = main({
      argv: ['ui', '--no-artifacts'],
      cwd: project,
      env: { GENAICODE_HOME: join(root, '.genaicode'), HOME: root },
      agents: [helper],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Time runs as usual; the pull request's minute between checks can be skipped.
    await page.clock.install();
    await page.goto(opened!);
    const composer = page.locator('.workspace .gc-composer textarea');
    await composer.waitFor();
    // A chat without delegated tasks has no Work button and no panel.
    await expect.poll(() => page.locator('.work-toggle').count()).toBe(0);
    await composer.fill('Add tests and a changelog line. Delegate what you can.');
    await page.keyboard.press('Enter');

    // 1440 px: the panel opens by itself beside the chat, 420 px wide, and the keyboard stays in the message field.
    const work = page.getByRole('complementary', { name: 'Work panel' });
    await work.waitFor();
    await expect.poll(() => work.getAttribute('data-mode')).toBe('docked');
    expect(await boxes(page)).toMatchObject({ side: { width: 268 }, work: { width: 420, top: 0, left: 1020 } });
    expect((await boxes(page)).chat!.width).toBe(1440 - 268 - 420);
    expect(await composer.evaluate((element) => element === document.activeElement)).toBe(true);
    const toggle = page.locator('.work-toggle');
    await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => toggle.textContent()).toBe('Work1');

    // The chat keeps one line for the turn's tasks, and the approval a task waits for.
    await expect
      .poll(() => page.locator('.gc-workline').textContent())
      .toBe('5 delegated tasks1 needs you · 2 running · 1 failed · 2 finishedOpen ›');
    expect(await page.locator('.gc-pack').count()).toBe(0);
    await page.locator('.gc-approval').getByText('worker wants to run:').waitFor();

    // Groups in the order of what to do next; Done is folded.
    await expect
      .poll(() => work.locator('.gc-work-group-head button').allTextContents())
      .toEqual(['Needs you 1', 'Failed 1', 'Running 1', 'Unmerged 1', 'Done 1']);
    expect(await work.locator('.gc-work-row .gc-work-id').allTextContents()).toEqual(['t4', 't3', 't1', 't2']);
    expect(await work.locator('[data-task="1:t4"] .gc-work-line').textContent()).toBe('npm install left-pad');
    // A running task says what it does in words, with how long that call has run.
    expect(await work.locator('[data-task="1:t1"] .gc-work-line').textContent()).toMatch(
      /^Running npm test -- cart · \d+s so far$/,
    );
    // No money and no pack wording anywhere in the panel.
    expect(await work.textContent()).not.toMatch(/\$|Pack tasks/);

    // Approve on the row: the request is answered everywhere.
    await work.getByRole('button', { name: 'Approve for t4' }).click();
    await expect.poll(() => decisions).toEqual(['approve']);
    await expect.poll(() => toggle.textContent()).toBe('Work');
    await expect
      .poll(() => work.locator('.gc-work-group-head button').allTextContents())
      .toEqual(['Failed 1', 'Running 2', 'Unmerged 1', 'Done 1']);
    await expect.poll(() => page.locator('.gc-workline').textContent()).toContain('2 running');

    // One task, without leaving the panel: its detail, the diff, a review, the merge.
    await work.locator('[data-task="1:t2"] .gc-work-row').click();
    const detail = work.getByRole('region', { name: 'Task t2' });
    await detail.waitFor();
    expect(await detail.locator('h3').textContent()).toBe('t2 Update the changelog');
    expect(await detail.locator('.gc-work-pill').first().textContent()).toBe('Unmerged');
    expect(await detail.locator('.gc-work-asked').textContent()).toBe('Add a changelog line for the cart fix.');
    expect(await detail.locator('.gc-work-meta').textContent()).toMatch(
      /^worker · works in its own copy \(a git worktree\) · started .+ · took 50s\.genaicode\/worktrees\/t2$/,
    );
    expect(await detail.locator('.gc-work-result').textContent()).toBe('Added one line under Unreleased.');
    expect(await detail.locator('.gc-work-files li').allTextContents()).toEqual(['Mdocs/CHANGELOG.md']);
    // No test command in this chat: it says what the person can do.
    expect(await detail.locator('.gc-work-check .gc-work-note').textContent()).toMatch(
      /^No test command is set for this chat, so tests cannot run from here\./,
    );
    await detail.getByRole('button', { name: 'Show diff' }).click();
    await detail.locator('.gc-work-diff [data-line="add"]').waitFor();
    expect(await detail.locator('.gc-work-diff [data-line="add"]').textContent()).toBe(
      '+- The cart total counts every item',
    );
    await detail.getByRole('button', { name: 'Request review' }).click();
    await detail.locator('.gc-work-check .gc-work-pill').getByText('Reviewed').waitFor();
    expect(await detail.locator('.gc-work-merge .gc-work-note').textContent()).toBe(
      'Merge locally copies this task’s changes from its worktree into your project folder. Nothing is staged, committed or pushed.',
    );
    await detail.getByRole('button', { name: 'Merge locally' }).click();
    await detail.locator('.gc-work-pill').getByText('Merged locally').waitFor();
    expect(await detail.locator('.gc-work-feedback').textContent()).toContain('Merged t2');
    expect(await detail.getByRole('button', { name: 'Merge locally' }).count()).toBe(0);
    expect(actions).toEqual(['t2 diff', 't2 review', 't2 merge']);

    // A running task: a message with its receipt, then stop, which asks first.
    await detail.getByRole('button', { name: 'Tasks' }).click();
    await work.locator('[data-task="1:t1"] .gc-work-row').click();
    const live = work.getByRole('region', { name: 'Task t1' });
    await live.waitFor();
    expect(await live.locator('.gc-work-now').textContent()).toMatch(/^Running npm test -- cart\d+s so far$/);
    expect(await live.locator('.gc-work-say').textContent()).toBe('Latest message · workerThe total skips discounts.');
    // Its timeline, newest first: what it said, what it read, its start. The call that runs is in the card above.
    const timeline = live.getByRole('list', { name: 'Timeline' });
    const rows = () =>
      timeline
        .locator('li')
        .evaluateAll((items) =>
          items.map((item) => (item.querySelector('.gc-work-tl-x, .gc-work-bubble p') as HTMLElement).innerText),
        );
    expect(await rows()).toEqual([
      'The total skips discounts.',
      expect.stringMatching(/^Read src\/cart\.ts (<1s|\d+s)$/),
      'Started by helper in .genaicode/worktrees/t1',
    ]);
    // The time of the running call goes on by itself.
    const before = await live.locator('.gc-work-now .gc-work-elapsed').textContent();
    await page.clock.fastForward(5_000);
    await expect.poll(() => live.locator('.gc-work-now .gc-work-elapsed').textContent()).not.toBe(before);
    // The call returns and the next one starts: the card and the timeline follow, live.
    const t1 = () => tasks.find((item) => item.id === 't1')!;
    patch('t1', {
      text: 'tool edit: src/cart.test.ts',
      steps: [
        ...t1().steps!.slice(0, 2),
        // It returned a second ago, after 14 seconds.
        { ...t1().steps![2]!, at: Date.now() - 15_000, endedAt: Date.now() - 1_000, failed: true },
        { kind: 'tool', name: 'edit', text: 'src/cart.test.ts', at: Date.now() },
      ],
    });
    await expect.poll(() => live.locator('.gc-work-now').textContent()).toMatch(/^Editing src\/cart\.test\.ts/);
    await expect.poll(async () => (await rows())[0]).toBe('Ran npm test -- cart failed · 14s');
    expect(await timeline.locator('li[data-failed]').count()).toBe(1);

    // A message to the task: its receipt with how long delivery took, in the timeline, on top.
    await work.getByRole('textbox', { name: 'Message to worker' }).fill('Skip the snapshot tests.');
    await page.keyboard.press('Enter');
    const receipt = timeline.getByRole('status', { name: /^Your message:/ });
    await receipt.getByText('✓ Delivered · 0.4s').waitFor();
    expect(await receipt.getAttribute('data-state')).toBe('delivered');
    expect((await rows())[0]).toBe('Skip the snapshot tests.');
    expect(await timeline.locator('li').first().locator('time').count()).toBe(1);
    // The task's next message is its answer, shown right above.
    patch('t1', {
      steps: [...t1().steps!, { kind: 'message', text: 'Skipping them.', at: Date.now() + 1 }],
      steers: t1().steers!.map((steer) => ({ ...steer, answeredAt: Date.now() + 1 })),
    });
    await receipt.getByText('✓✓ Delivered · answered').waitFor();
    expect((await rows()).slice(0, 2)).toEqual(['Skipping them.', 'Skip the snapshot tests.']);
    expect(await live.locator('.gc-work-say').textContent()).toBe('Latest message · workerSkipping them.');
    await work.getByRole('button', { name: 'Stop task' }).click();
    expect(actions).toEqual(['t2 diff', 't2 review', 't2 merge', 't1 steer: Skip the snapshot tests.']);
    await work.getByRole('button', { name: 'Confirm stop' }).click();
    await live.locator('.gc-work-pill').getByText('Stopped').waitFor();
    expect(await live.locator('.gc-work-stopped').textContent()).toBe('Stopped by you.');
    expect(await work.locator('.gc-work-steer').count()).toBe(0);

    // A task that ended in a pull request: its state and link, and no Merge locally.
    await live.getByRole('button', { name: 'Tasks' }).click();
    await work.getByRole('button', { name: /^Done/ }).click();
    await expect
      .poll(() => work.locator('[data-task="1:t5"] .gc-work-line').textContent())
      .toBe(`PR #351 · merged · 1 file changed · Opened ${PR}`);
    await work.locator('[data-task="1:t5"] .gc-work-row').click();
    const shipped = work.getByRole('region', { name: 'Task t5' });
    expect(await shipped.locator('.gc-work-pill').textContent()).toBe('PR #351 · merged');
    expect(await shipped.getByRole('link', { name: 'PR #351 · merged' }).getAttribute('href')).toBe(PR);
    expect(await shipped.getByRole('button', { name: 'Merge locally' }).count()).toBe(0);
    expect(await shipped.getByRole('button', { name: 'Discard worktree' }).count()).toBe(1);
    // An edit in the worktree after the merge: the server checks again before it discards anything...
    t5Held = (fresh) => !fresh;
    await shipped.getByRole('button', { name: 'Discard worktree' }).click();
    await shipped.getByRole('button', { name: 'Confirm discard' }).click();
    await shipped.locator('.gc-work-feedback').getByText('no longer matches its pull request').waitFor();
    expect(actions.filter((action) => action.startsWith('t5'))).toEqual([]);
    await shipped.getByRole('button', { name: 'Cancel' }).click();
    // ...and the page asks again within a minute though the pull request merged: Merge locally is back.
    t5Held = () => false;
    await page.clock.fastForward(61_000);
    await shipped.getByRole('button', { name: 'Merge locally' }).waitFor();
    expect(await shipped.getByRole('button', { name: 'Discard', exact: true }).count()).toBe(1);
    t5Held = () => true;
    await page.clock.fastForward(61_000);
    await expect.poll(() => shipped.getByRole('button', { name: 'Merge locally' }).count()).toBe(0);

    // The edge moves with the arrow keys; the width belongs to the window, the open task to the chat.
    const edge = work.getByRole('separator');
    await edge.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await boxes(page)).work!.width).toBe(436);
    // Escape in the panel gives the keyboard back to the message field, and the panel stays.
    await page.keyboard.press('Escape');
    await expect.poll(() => composer.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await work.count()).toBe(1);
    await page.reload();
    await work.getByRole('region', { name: 'Task t5' }).waitFor();
    expect((await boxes(page)).work!.width).toBe(436);
    // Another window of the app keeps its own width.
    const other = await context.newPage();
    await other.goto(opened!);
    await other.getByRole('region', { name: 'Task t5' }).waitFor();
    expect((await boxes(other)).work!.width).toBe(420);
    await other.close();
    expect((await boxes(page)).work!.width).toBe(436);

    // Closed by hand (⌘⌥B) it stays closed for this chat, also after a reload; the button opens it again.
    const mod = (await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))) ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Alt+KeyB`);
    await expect.poll(() => work.count()).toBe(0);
    expect((await boxes(page)).chat!.width).toBe(1440 - 268);
    await page.reload();
    await composer.waitFor();
    await toggle.waitFor();
    expect(await work.count()).toBe(0);
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await toggle.click();
    await work.waitFor();
    await work.getByRole('button', { name: 'Tasks', exact: true }).click();

    // 1280 px: still beside the chat, which keeps 600 px: up to 412 px.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => boxes(page)).toMatchObject({ work: { width: 412 }, chat: { width: 600 } });

    // 900 px: the sidebar is a rail, and the panel would cover the chat: it does not open by itself.
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(() => work.count()).toBe(0);
    expect(await boxes(page)).toMatchObject({ side: { width: 56 }, chat: { width: 844 } });
    await toggle.click();
    await expect.poll(() => work.getAttribute('data-mode')).toBe('full');
    // A view under the top bar, from the sidebar to the window's edge, with a way back and Stop.
    expect(await boxes(page)).toMatchObject({ work: { left: 56, top: 46, width: 844 } });
    expect(await work.getByRole('separator').count()).toBe(0);
    await page.locator('.topbar').getByRole('button', { name: 'Stop', exact: true }).waitFor();
    // The chat under it keeps running, out of reach of the keyboard.
    expect(await page.locator('.workspace').getAttribute('inert')).not.toBeNull();
    expect(await page.locator('.topbar').getByRole('button', { name: 'Chat' }).count()).toBe(1);
    // In a running task's message field the first Escape clears what was typed, the next one goes back.
    patch('t4', { canSteer: true });
    await work.locator('[data-task="1:t4"] .gc-work-row').click();
    const field = work.getByRole('textbox', { name: 'Message to worker' });
    await field.fill('Use date-fns');
    await page.keyboard.press('Escape');
    await expect.poll(() => field.inputValue()).toBe('');
    expect(await work.count()).toBe(1);
    await page.keyboard.press('Escape');
    await expect.poll(() => work.count()).toBe(0);
    await expect.poll(() => composer.evaluate((element) => element === document.activeElement)).toBe(true);
    // Escape closes it and the message field has the keyboard again.
    await toggle.click();
    await expect.poll(() => work.getAttribute('data-mode')).toBe('full');
    await work.getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => work.count()).toBe(0);
    await expect.poll(() => composer.evaluate((element) => element === document.activeElement)).toBe(true);

    // 1100 px: the full sidebar leaves no room, so it is a full-width view; with the rail it docks.
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect.poll(async () => (await boxes(page)).side!.width).toBe(268);
    expect(await work.count()).toBe(0);
    await toggle.click();
    await expect.poll(() => work.getAttribute('data-mode')).toBe('full');
    expect(await boxes(page)).toMatchObject({ work: { left: 268, top: 46, width: 832 } });
    await page.locator('.topbar').getByRole('button', { name: 'Chat' }).click();
    await expect.poll(() => work.count()).toBe(0);
    await page.keyboard.press(`${mod}+KeyB`);
    await expect.poll(() => work.getAttribute('data-mode')).toBe('docked');
    expect(await boxes(page)).toMatchObject({ side: { width: 56 }, work: { width: 436 }, chat: { width: 608 } });

    // When the turn ends the tasks stay in the panel.
    finish?.();
    await page.locator('.gc-chat[data-status="idle"]').waitFor();
    await expect.poll(() => work.locator('.gc-work-tab').textContent()).toBe('Tasks 5');
    expect(errors).toEqual([]);
    await context.close();
  } finally {
    finish?.();
    stop.abort();
    await running;
    await browser.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
