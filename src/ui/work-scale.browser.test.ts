import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { packApproval, type PackTask } from '../agents/pack.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

const AGENTS = ['claude', 'codex', 'gemini'];

/**
 * What a lead left after a long turn, oldest first: 100 reviews in the person's folder, 4 of them
 * failed, 8 fixes in worktrees with changes to merge, 3 merged, 30 running, 5 stopped.
 */
function manyTasks(project: string, started: number): PackTask[] {
  return Array.from({ length: 150 }, (_, index): PackTask => {
    const n = index + 1;
    const id = `t${n}`;
    const shared = { id, agent: AGENTS[n % 3]!, prompt: `Do part ${n}.`, cwd: project, mode: 'shared' as const };
    const own = { ...shared, cwd: join(project, '.genaicode', 'worktrees', id), mode: 'worktree' as const };
    const ended = { startedAt: started, endedAt: started + 65_000 };
    if (n <= 100)
      return { ...shared, title: `Review part ${n}`, status: 'completed', verdict: 'VERDICT: LGTM', ...ended };
    if (n <= 104) return { ...shared, title: `Review part ${n}`, status: 'failed', error: 'Out of quota.', ...ended };
    if (n <= 112)
      return {
        ...own,
        title: `Fix finding ${n}`,
        status: 'completed',
        state: 'unmerged',
        changes: ['M\tsrc/cart.ts'],
        checks: {},
        ...ended,
      };
    if (n <= 115) return { ...own, title: `Fix finding ${n}`, status: 'completed', state: 'merged', ...ended };
    // A worktree is there to merge or discard from the start, also if its task fails.
    if (n <= 145)
      return { ...own, title: `Fix finding ${n}`, status: 'running', state: 'unmerged', text: 'tool shell: npm test' };
    return { ...shared, title: `Review part ${n}`, status: 'aborted', stoppedBy: 'user', ...ended };
  });
}

it('keeps 150 delegated tasks readable in the work panel: groups, filters, clearing, focus', async () => {
  const browser = await chromium.launch();
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'work-scale-ui-'));
  const project = join(root, 'app');
  mkdirSync(project);
  const stop = new AbortController();

  const tasks = manyTasks(project, Date.now());
  const listeners = new Set<(id: string) => void>();
  const patch = (id: string, change: Partial<PackTask>) => {
    const index = tasks.findIndex((task) => task.id === id);
    tasks[index] = { ...tasks[index]!, ...change };
    listeners.forEach((listener) => listener(id));
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
        sessionId: 'ses_scale',
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
          maxParallel: 8,
          task: (id) => tasks.find((item) => item.id === id),
          onTaskChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          act: async () => '',
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
          yield { type: 'session', sessionId: result.sessionId! };
          for (const item of tasks) yield { type: 'subtask-start', ...item };
          yield { type: 'message', text: 'All 150 tasks are out.' };
          // Two tasks ask before they go on; the turn goes on meanwhile.
          for (const [id, command] of [
            ['t144', 'npm install left-pad'],
            ['t145', 'npm run build'],
          ] as const) {
            const asked = packApproval(id, 'worker', { id: `ap-${id}`, kind: 'command', summary: command });
            void Promise.resolve(task.onApproval?.(asked, stop.signal)).then(
              (decision) => decision && decisions.push(`${id} ${decision}`),
            );
          }
          await released;
          yield { type: 'done', result };
        },
      };
    },
  };

  let running: Promise<number> | undefined;
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
    await page.goto(opened!);
    const composer = page.locator('.workspace .gc-composer textarea');
    await composer.waitFor();
    await composer.fill('Review every module and fix what you find. Hand out all of it.');
    await page.keyboard.press('Enter');

    const work = page.getByRole('complementary', { name: 'Work panel' });
    await work.waitFor();
    const heads = () => work.locator('.gc-work-group-head > button:first-child').allTextContents();
    const ids = (section?: string) =>
      work.locator(`${section ? `[data-section="${section}"] ` : ''}.gc-work-row .gc-work-id`).allTextContents();
    await expect.poll(() => work.locator('.gc-work-tab').textContent()).toBe('Tasks 150');
    // The chat keeps one line for the 150.
    await expect
      .poll(() => page.locator('.gc-workline').textContent())
      .toBe('150 delegated tasks2 need you · 30 running · 4 failed · 116 finishedOpen ›');

    // Groups with counts in the order of what to do next; Done is one line.
    await expect.poll(heads).toEqual(['Needs you 2', 'Failed 4', 'Running 28', 'Unmerged 8', 'Done 108']);
    expect(await work.locator('[data-section="done"] .gc-work-summary').textContent()).toBe(
      '100 done · 5 stopped · 3 merged locally',
    );
    expect(await work.locator('[data-section="done"] .gc-work-row').count()).toBe(0);
    // 150 tasks are 22 rows: Running shows its newest 8.
    expect(await work.locator('.gc-work-row').count()).toBe(2 + 4 + 8 + 8);
    expect(await ids('running')).toEqual(['t143', 't142', 't141', 't140', 't139', 't138', 't137', 't136']);
    expect(await work.locator('[data-section="running"] .gc-work-more').textContent()).toBe('Show 20 more');
    // One line a row, 28 px, with nothing cut off sideways.
    const rowBox = await work.locator('[data-task="1:t143"]').boundingBox();
    expect(rowBox!.height).toBe(28);
    const lineTops = await work
      .locator('[data-task="1:t143"] .gc-work-row > span:not(.gc-work-sr)')
      .evaluateAll((spans) => spans.map((span) => Math.round(span.getBoundingClientRect().top)));
    expect(Math.max(...lineTops) - Math.min(...lineTops)).toBeLessThanOrEqual(4);
    expect(await work.locator('[data-task="1:t143"] .gc-work-row').textContent()).toBe(
      't143Fix finding 143geminiShell npm testRunning',
    );
    const scroller = work.locator('.gc-work-scroll');
    expect(await scroller.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // The keyboard is still in the message field.
    expect(await composer.evaluate((element) => element === document.activeElement)).toBe(true);

    // Show 20 more: the rest of Running, and its header stays at the top while its rows scroll.
    await work.locator('[data-section="running"] .gc-work-more').click();
    await expect.poll(async () => (await ids('running')).length).toBe(28);
    expect(await page.evaluate(() => document.activeElement?.closest('.gc-work-task')?.getAttribute('data-task'))).toBe(
      '1:t135',
    );
    await work.locator('[data-task="1:t120"]').scrollIntoViewIfNeeded();
    await scroller.evaluate((element) => (element.scrollTop += 200));
    const stuck = await work.evaluate((panel) => {
      const list = panel.querySelector('.gc-work-scroll')!.getBoundingClientRect();
      const head = panel.querySelector('[data-section="running"] .gc-work-group-head')!.getBoundingClientRect();
      return Math.round(head.top - list.top);
    });
    expect(stuck).toBe(0);

    // A row that changes state under the keyboard focus stays where it is, with its new state...
    const held = work.locator('[data-task="1:t130"] .gc-work-row');
    await held.focus();
    patch('t130', { status: 'failed', error: 'The tests did not pass.', endedAt: Date.now() });
    await expect.poll(() => held.textContent()).toContain('The tests did not pass.Failed');
    expect(await work.locator('[data-section="running"] [data-task="1:t130"]').count()).toBe(1);
    expect(await held.evaluate((element) => element === document.activeElement)).toBe(true);
    // ...and goes to its group when the focus leaves.
    await work.locator('[data-task="1:t129"] .gc-work-row').focus();
    await expect.poll(() => work.locator('[data-section="failed"] [data-task="1:t130"]').count()).toBe(1);
    await expect.poll(heads).toEqual(['Needs you 2', 'Failed 5', 'Running 27', 'Unmerged 8', 'Done 108']);

    // Approve all shows the two commands, then answers both.
    await scroller.evaluate((element) => (element.scrollTop = 0));
    await work.getByRole('button', { name: 'Approve all' }).click();
    const bulk = work.getByRole('group', { name: 'Approve all' });
    expect(await bulk.locator('li').allTextContents()).toEqual(['t145 npm run build', 't144 npm install left-pad']);
    expect(decisions).toEqual([]);
    await bulk.getByRole('button', { name: 'Approve 2' }).click();
    await expect.poll(() => decisions.slice().sort()).toEqual(['t144 approve', 't145 approve']);
    await expect.poll(heads).toEqual(['Failed 5', 'Running 29', 'Unmerged 8', 'Done 108']);

    // Filter by words of the title, agent, id or status; Escape clears the field first.
    const filter = work.getByRole('searchbox', { name: 'Filter tasks' });
    await filter.fill('codex failed');
    await expect.poll(heads).toEqual(['Failed 2']);
    expect(await ids()).toEqual(['t130', 't103']);
    await page.keyboard.press('Escape');
    await expect.poll(() => filter.inputValue()).toBe('');
    expect(await filter.evaluate((element) => element === document.activeElement)).toBe(true);
    await expect.poll(async () => (await heads()).length).toBe(4);
    // A status chip: its group alone, open, on up to 50 rows.
    await work.getByRole('button', { name: 'Done 108' }).first().click();
    await expect.poll(heads).toEqual(['Done 108']);
    expect((await ids()).length).toBe(50);
    expect(await work.locator('.gc-work-more').textContent()).toBe('Show 50 earlier of 58');
    await work.getByRole('button', { name: 'All 150' }).click();
    await expect.poll(async () => (await heads()).length).toBe(4);
    // By agent.
    await work.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect.poll(heads).toEqual(['claude 50', 'codex 50', 'gemini 50']);
    await work.getByRole('button', { name: 'Status', exact: true }).click();

    // Finished tasks with no worktree left are cleared from the list, and stay cleared after a reload.
    await work.getByRole('button', { name: 'Clear 108 finished from Done' }).click();
    await expect.poll(heads).toEqual(['Failed 5', 'Running 29', 'Unmerged 8']);
    expect(await work.locator('.gc-work-chip').first().textContent()).toBe('All 42');
    expect(await work.locator('.gc-work-foot span').textContent()).toBe('108 cleared from this list. Show them');
    expect(await work.locator('.gc-work-tab').textContent()).toBe('Tasks 150');
    await page.reload();
    await work.locator('.gc-work-foot span').waitFor();
    expect(await heads()).toEqual(['Failed 5', 'Running 29', 'Unmerged 8']);
    // One row: its own button, shown with the pointer on the row.
    const failedRow = work.locator('[data-task="1:t103"]');
    await failedRow.hover();
    await failedRow.getByRole('button', { name: 'Clear t103 from the list' }).click();
    await expect.poll(() => ids('failed')).toEqual(['t130', 't104', 't102', 't101']);
    // t130 failed in its worktree: there is something left to discard, so it cannot be cleared.
    expect(await work.getByRole('button', { name: 'Clear t130 from the list' }).count()).toBe(0);
    await work.getByRole('button', { name: 'Show them' }).click();
    await expect.poll(heads).toEqual(['Failed 5', 'Running 29', 'Unmerged 8', 'Done 108']);

    // Typing in the filter with 150 tasks keeps up: a key to its rows in well under a frame budget of a second.
    const typed = await page.evaluate(async () => {
      const field = document.querySelector<HTMLInputElement>('.gc-work-filter')!;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const before = performance.now();
      for (const value of ['r', 're', 'rev', 'revi', 'review', '']) {
        set.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
      return performance.now() - before;
    });
    expect(typed).toBeLessThan(2000);

    // 900 px: a full-width view, the same list, nothing cut off.
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(() => work.count()).toBe(0);
    await page.locator('.work-toggle').click();
    await expect.poll(() => work.getAttribute('data-mode')).toBe('full');
    expect(await heads()).toEqual(['Failed 5', 'Running 29', 'Unmerged 8', 'Done 108']);
    expect(await scroller.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await work.locator('.gc-work-tools').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );

    finish?.();
    await page.locator('.gc-chat[data-status="idle"]').waitFor();
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
