import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { pendingAsks, waitForAnswer } from '../agents/sessions/answer.js';
import type { SessionInfo } from '../agents/sessions/index.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

const MINUTE = 60_000;

it('opens Needs you from the sidebar, answers in place until nothing waits, and goes back on Escape', async () => {
  const browser = await chromium.launch();
  // Outside os.tmpdir() so sessions here are not treated as scratch runs.
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'needs-you-'));
  const knights = join(root, 'src', 'knights');
  const bakery = join(root, 'src', 'bakery');
  mkdirSync(knights, { recursive: true });
  mkdirSync(bakery, { recursive: true });
  const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
  const stop = new AbortController();

  // Two sessions another program started. One ended its message with a question.
  const question: SessionInfo = {
    source: 'helper',
    agent: 'helper',
    id: 'bakery-1',
    where: 'local',
    cwd: bakery,
    title: 'Sourdough schedule',
    state: 'waiting',
    lastReply: 'The starter is ready.\n\nShould I bake today or wait until Friday?',
    updatedAt: Date.now() - 40 * MINUTE,
  };
  // The other waits on a tool, and its hook holds the question open for an answer from here.
  const deploy: SessionInfo = {
    ...question,
    id: 'deploy-1',
    cwd: knights,
    title: 'Deploy the round table',
    lastReply: undefined,
    waitingFor: 'approval',
    waitingTool: 'Bash',
    updatedAt: Date.now() - 5 * MINUTE,
  };
  const theirs = [question, deploy];
  const ran: Array<{ prompt: string; cwd?: string; resume?: string }> = [];
  const helper: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true },
    sessions: { name: 'helper', where: 'local', list: async () => theirs.map((session) => ({ ...session })) },
    run(task) {
      const events: AgentEvent[] = [];
      const done = (async (): Promise<AgentResult> => {
        const id = task.resume ?? 'sess-1';
        ran.push({ prompt: task.prompt, cwd: task.cwd, resume: task.resume });
        events.push({ type: 'session', sessionId: id });
        // The session took the reply: its last message asks nothing.
        const session = theirs.find((one) => one.id === id);
        if (session) Object.assign(session, { lastReply: 'Baking today.', updatedAt: Date.now() });
        events.push({ type: 'message', text: 'Baking today.' });
        return { status: 'completed', ok: true, exitCode: 0, signal: null, sessionId: id, text: 'Baking today.' };
      })();
      return {
        result: done,
        abort() {},
        async *[Symbol.asyncIterator]() {
          const result = await done;
          yield* events;
          yield { type: 'done', result };
        },
      };
    },
  };
  const hook = waitForAnswer(
    'helper',
    {
      hook_event_name: 'PermissionRequest',
      session_id: deploy.id,
      cwd: knights,
      tool_name: 'Bash',
      tool_input: { command: 'npm run deploy' },
    },
    { env, signal: stop.signal, pollMs: 10 },
  ).then((answer) => {
    // Answered: the session works again.
    Object.assign(deploy, { state: 'active', waitingFor: undefined, waitingTool: undefined, updatedAt: Date.now() });
    return answer;
  });

  let running: Promise<number> | undefined;
  try {
    await vi.waitFor(async () => expect(await pendingAsks(env)).toHaveLength(1));
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
      argv: ['ui', '--sessions', '--home', '--no-artifacts'],
      cwd: root,
      env,
      agents: [helper],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(opened!);

    const side = page.getByRole('complementary', { name: 'Sidebar' });
    const needsYou = side.locator('.side-actions').getByRole('button', { name: /^Needs you/ });
    const topbar = page.locator('header.topbar');
    const queue = page.getByRole('main', { name: 'Needs you' });
    const composer = page.locator('.gc-composer textarea');

    // The count: one session that asks a question, one that asks for a tool.
    await vi.waitFor(async () => expect(await needsYou.locator('.count').textContent()).toBe('2'));
    expect(await needsYou.getAttribute('title')).toBe('Needs you: 2 across all projects');

    // The page takes the chat's place; the sidebar stays and marks it.
    await needsYou.click();
    await queue.waitFor();
    expect(await topbar.locator('h1').textContent()).toBe('Needs you');
    expect(await needsYou.getAttribute('aria-current')).toBe('page');
    expect(await page.locator('.workspace').isVisible()).toBe(false);
    expect(await queue.locator('.pill').textContent()).toBe('2 open');
    expect(await queue.getByRole('article').count()).toBe(2);

    // Each item says its project, agent, what it asks and for how long.
    const asked = queue.getByRole('article').filter({ hasText: 'Sourdough schedule' });
    expect(await asked.locator('.needs-meta b').textContent()).toBe('Answer a question');
    expect(await asked.locator('.tag').allTextContents()).toEqual(['bakery', 'helper']);
    expect(await asked.locator('.tag').first().getAttribute('title')).toBe(bakery);
    expect(await asked.locator('.needs-text').textContent()).toBe('“Should I bake today or wait until Friday?”');
    expect(await asked.locator('time').textContent()).toBe('40m ago');
    const permission = queue.getByRole('article').filter({ hasText: 'Deploy the round table' });
    expect(await permission.locator('.needs-meta b').textContent()).toBe('Permission request');
    expect(await permission.locator('pre').textContent()).toBe('Bash\nnpm run deploy');
    expect(await permission.locator('.tag').allTextContents()).toEqual(['knights', 'helper']);

    // The filters count what they hold.
    await queue.getByRole('button', { name: 'Approvals 1' }).click();
    expect(await queue.getByRole('article').count()).toBe(1);
    await permission.waitFor();
    await queue.getByRole('button', { name: 'All 2' }).click();

    // Approving in place answers the hook: the item leaves, and the count drops with it.
    await permission.getByRole('button', { name: 'Approve' }).click();
    expect(await hook).toEqual({ behavior: 'allow' });
    await permission.waitFor({ state: 'detached' });
    await vi.waitFor(async () => expect(await needsYou.locator('.count').textContent()).toBe('1'));
    expect(await queue.locator('.pill').textContent()).toBe('1 open');

    // A reply goes to the session from here. Escape first clears what is typed, not the page.
    await asked.getByRole('button', { name: 'Reply' }).click();
    const reply = asked.getByRole('textbox', { name: 'Message to helper' });
    await reply.fill('Bake today.');
    await reply.press('Escape');
    await queue.waitFor();
    await asked.getByRole('button', { name: 'Send' }).click();
    await asked.waitFor({ state: 'detached' });
    expect(ran).toEqual([{ prompt: 'Bake today.', cwd: bakery, resume: 'bakery-1' }]);

    // Nothing waits: the page says so, and the sidebar agrees.
    await queue.getByText('Nothing needs you now').waitFor();
    expect(await queue.getByRole('article').count()).toBe(0);
    expect(await queue.locator('.pill').count()).toBe(0);
    await vi.waitFor(async () => expect(await needsYou.locator('.count').count()).toBe(0));
    expect(await needsYou.getAttribute('title')).toBe('Nothing needs you now');

    // Escape goes back to the chat, with the focus in the message field.
    await page.keyboard.press('Escape');
    await queue.waitFor({ state: 'detached' });
    expect(await topbar.locator('h1').textContent()).toBe('New chat');
    expect(await page.locator('.workspace').isVisible()).toBe(true);
    await vi.waitFor(async () =>
      expect(await composer.evaluate((field) => field === document.activeElement)).toBe(true),
    );
    expect(await needsYou.getAttribute('aria-current')).toBeNull();

    // The back arrow does the same.
    await needsYou.click();
    await queue.waitFor();
    await topbar.getByRole('button', { name: 'Chat' }).click();
    await queue.waitFor({ state: 'detached' });
    expect(errors).toEqual([]);
  } finally {
    stop.abort();
    await browser.close();
    await hook.catch(() => undefined);
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
