import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

it('lists the files changed in a chat in the work panel, and opens a file in the viewer and back', async () => {
  const browser = await chromium.launch();
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'changes-ui-'));
  const project = join(root, 'app');
  const worktree = join(project, '.genaicode', 'worktrees', 't2-k3x');
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(join(worktree, 'src'), { recursive: true });
  writeFileSync(
    join(project, 'src', 'cart.ts'),
    'export const total = (items: number[]) =>\n  items.reduce((a, b) => a + b, 0);\n',
  );
  writeFileSync(join(project, 'notes.md'), '# Notes\n\nThe total counts every item.\n');
  writeFileSync(join(worktree, 'src', 'coupon.ts'), 'export const coupon = 0.1;\n');
  const stop = new AbortController();

  const started = Date.now();
  const tasks: PackTask[] = [
    {
      agent: 'worker',
      mode: 'worktree',
      startedAt: started,
      id: 't1',
      title: 'Round the prices',
      prompt: 'Round every price to cents.',
      status: 'completed',
      state: 'merged',
      cwd: join(project, '.genaicode', 'worktrees', 't1-k3w'),
      changes: ['M\tsrc/price.ts'],
      endedAt: started + 20_000,
    },
    {
      agent: 'worker',
      mode: 'worktree',
      startedAt: started,
      id: 't2',
      title: 'Add coupons',
      prompt: 'Add a coupon to the cart.',
      status: 'completed',
      state: 'unmerged',
      cwd: worktree,
      text: 'Added the coupon.',
      changes: ['A\tsrc/coupon.ts', 'D\tsrc/old-coupon.ts'],
      checks: {},
      endedAt: started + 30_000,
    },
  ];
  const diff = [
    `--- ${join(project, 'src', 'cart.ts')}`,
    `+++ ${join(project, 'src', 'cart.ts')}`,
    '@@ -1,2 +1,2 @@',
    ' export const total = (items: number[]) =>',
    '-  items.reduce((a, b) => a + b);',
    '+  items.reduce((a, b) => a + b, 0);',
  ].join('\n');
  const lead: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true },
    run() {
      const result: AgentResult = {
        status: 'completed',
        ok: true,
        exitCode: 0,
        signal: null,
        sessionId: 'ses_changes',
        text: 'Done.',
      };
      return {
        result: Promise.resolve(result),
        abort() {},
        pack: {
          lead: 'helper',
          maxParallel: 4,
          task: (id) => tasks.find((item) => item.id === id),
          onTaskChange: () => () => undefined,
          act: async () => '',
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
          yield { type: 'session', sessionId: result.sessionId! };
          for (const item of tasks) yield { type: 'subtask-start', ...item };
          // The lead's own edits: one with its patch, one as a path only.
          yield { type: 'file-change', paths: [join(project, 'src', 'cart.ts')], diff };
          yield { type: 'file-change', paths: ['notes.md'] };
          yield { type: 'message', text: 'The cart is fixed, see [notes.md](./notes.md).' };
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
      agents: [lead],
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
    await composer.fill('Fix the cart total. Delegate what you can.');
    await page.keyboard.press('Enter');
    await page.locator('.gc-chat[data-status="idle"]').waitFor();

    const work = page.getByRole('complementary', { name: 'Work panel' });
    await work.waitFor();
    const VIEWER = 600;
    const width = () => work.boundingBox().then((box) => Math.round(box!.width));
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim());
    expect(await work.getByRole('tab').allTextContents()).toEqual(['Tasks 2', 'Live', 'Changes 5', 'Artifacts']);
    expect(await width()).toBe(420);

    // Changes: the lead's own files first, then the tasks' files with their task and whether it is merged.
    await work.getByRole('tab', { name: 'Changes' }).click();
    const rows = () =>
      work
        .locator('.gc-work-frow')
        .evaluateAll((items) => items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim()));
    await expect
      .poll(rows)
      .toEqual([
        '• editednotes.md',
        'M modifiedsrc/cart.ts+1 −1',
        'A addedsrc/coupon.tst2 unmerged',
        'D deletedsrc/old-coupon.tst2 unmerged',
        'M modifiedsrc/price.tst1 merged',
      ]);

    // The lead's file opens in the viewer on its diff, and the panel widens for it.
    const viewer = work.locator('.viewer-panel');
    await work.locator('.gc-work-frow', { hasText: 'src/cart.ts' }).click();
    await viewer.locator('.gc-work-diff').waitFor();
    expect(await viewer.locator('.gc-work-diff [data-line="add"]').textContent()).toBe(
      '+  items.reduce((a, b) => a + b, 0);',
    );
    // At 1440 px the viewer gets its full preferred width.
    await expect.poll(width).toBe(VIEWER);
    expect((await page.locator('.workspace .gc-chat').boundingBox())!.width).toBe(1440 - 268 - VIEWER);
    expect(await work.getByRole('tab', { selected: true }).textContent()).toBe('Changes 5');
    // File shows the file as it is now.
    await viewer.getByRole('button', { name: 'File', exact: true }).click();
    await viewer.locator('.file-text').waitFor();
    expect(await viewer.locator('.file-text').textContent()).toContain('items.reduce((a, b) => a + b, 0);');
    // Back returns to the list, with the keyboard on the row; the panel is 420 px again.
    expect(await viewer.locator('.viewer-back').textContent()).toBe('Changes');
    await viewer.locator('.viewer-back').click();
    await viewer.waitFor({ state: 'detached' });
    await expect.poll(width).toBe(420);
    await expect.poll(focused).toBe('M modifiedsrc/cart.ts+1 −1');

    // Escape is the same way back. A file without a patch opens as the file.
    await work.locator('.gc-work-frow', { hasText: 'notes.md' }).click();
    await viewer.locator('.viewer-markdown', { hasText: 'The total counts every item.' }).waitFor();
    expect(await viewer.getByRole('button', { name: 'Diff', exact: true }).count()).toBe(0);
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    await expect.poll(focused).toBe('• editednotes.md');
    expect(await work.count()).toBe(1);

    // Expand puts the viewer over the chat area; Escape docks it, the next one goes back to the list.
    await work.locator('.gc-work-frow', { hasText: 'src/cart.ts' }).click();
    await viewer.getByRole('button', { name: 'Expand' }).click();
    await expect.poll(() => work.getAttribute('data-mode')).toBe('full');
    await expect.poll(width).toBe(1440 - 268);
    await page.keyboard.press('Escape');
    await expect.poll(() => work.getAttribute('data-mode')).toBe('docked');
    await expect.poll(width).toBe(VIEWER);
    expect(await viewer.count()).toBe(1);
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });

    // A task's file is the way to its task; there a file opens from the task's worktree, and back is the task.
    await work.locator('.gc-work-frow', { hasText: 'src/coupon.ts' }).click();
    const detail = work.getByRole('region', { name: 'Task t2' });
    await detail.waitFor();
    expect(await work.getByRole('tab', { selected: true }).textContent()).toBe('Tasks 2');
    expect(await detail.locator('.gc-work-back').textContent()).toBe('Changes');
    expect(await detail.locator('.gc-work-filelink').allTextContents()).toEqual(['src/coupon.ts']);
    await detail.locator('.gc-work-filelink').click();
    await viewer.locator('.file-text').waitFor();
    expect(await viewer.locator('.file-text').textContent()).toContain('export const coupon = 0.1;');
    expect(await viewer.locator('.viewer-back').textContent()).toBe('t2');
    await viewer.locator('.viewer-back').click();
    await detail.waitFor();
    await detail.locator('.gc-work-back').click();
    await expect.poll(rows).toHaveLength(5);

    const fileLink = page.locator('.workspace').getByRole('button', { name: 'notes.md', exact: true });
    // A file named in the chat opens in the same viewer, over whatever tab is open; Close returns to it.
    await fileLink.click();
    await viewer.locator('.viewer-markdown', { hasText: 'The total counts every item.' }).waitFor();
    expect(await viewer.locator('.viewer-back').textContent()).toBe('Close');
    await viewer.locator('.viewer-back').click();
    await viewer.waitFor({ state: 'detached' });
    await expect.poll(rows).toHaveLength(5);

    // The panel closed: a file from the chat opens it for the viewer alone, and Escape closes both.
    await work.getByRole('button', { name: 'Close work panel' }).click();
    await expect.poll(() => work.count()).toBe(0);
    await fileLink.click();
    await viewer.waitFor();
    await page.keyboard.press('Escape');
    await expect.poll(() => work.count()).toBe(0);
    // The keyboard stays where it was, on the link in the chat.
    expect(await fileLink.evaluate((element) => element === document.activeElement)).toBe(true);

    // 1100 px: no room beside the chat. The viewer is a view in the chat's place, with nothing to dock to.
    await page.setViewportSize({ width: 1100, height: 900 });
    await fileLink.click();
    await viewer.waitFor();
    await expect.poll(() => work.getAttribute('data-mode')).toBe('full');
    expect(await viewer.getByRole('button', { name: 'Expand' }).count()).toBe(0);
    await page.keyboard.press('Escape');
    await expect.poll(() => work.count()).toBe(0);

    expect(errors).toEqual([]);
    await context.close();
  } finally {
    stop.abort();
    await running;
    await browser.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
