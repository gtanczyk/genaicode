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
    capabilities: { mcp: true, resume: true, approvals: true, permissions: { sandbox: ['read-only'] } },
    sessions: {
      name: 'helper',
      where: 'local',
      list: async () => theirs.map((session) => ({ ...session })),
      read: async (session) => [
        {
          id: 1,
          agent: 'helper',
          startedAt: 0,
          prompt: 'Read the recipe for ' + session.id,
          entries: [{ kind: 'text', streaming: false, text: 'The recipe uses rye flour.' }],
        },
      ],
    },
    run(task) {
      const events: AgentEvent[] = [];
      const done = (async (): Promise<AgentResult> => {
        const id = task.resume ?? 'sess-1';
        ran.push({ prompt: task.prompt, cwd: task.cwd, resume: task.resume });
        if (task.prompt === 'Bake now?')
          return { ok: false, status: 'failed', signal: null, exitCode: 1, error: 'Could not resume ' + id + '.' };
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
    // The newest index entry supplies the queue card; the underlying agent store reads and resumes it.
    await page.route('**/api/sessions?days=7', async (route) => {
      const response = await route.fetch();
      const listing = await response.json();
      const source = listing.sessions.find((row: SessionInfo) => row.id === question.id);
      const sessions = source
        ? [{ ...source, source: 'index', updatedAt: source.updatedAt + 1 }, ...listing.sessions]
        : listing.sessions;
      await route.fulfill({
        json: {
          ...listing,
          sessions,
          topics: [{ id: 'bread', name: 'Bread' }],
          topicOf: { ['index:' + question.id]: 'bread' },
        },
      });
    });
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

    // Open the exact store row without taking over. Back preserves the queue filter.
    await queue.getByRole('button', { name: 'Questions 1' }).click();
    await asked.getByRole('button', { name: 'Open session' }).click();
    const detail = page.getByRole('main', { name: 'Session transcript' });
    await detail.getByText('Read the recipe for bakery-1').waitFor();
    await detail.getByText('The recipe uses rye flour.').waitFor();
    expect(await composer.isVisible()).toBe(false);
    expect(await detail.locator('textarea').count()).toBe(0);
    expect(await detail.getByRole('button').allTextContents()).toEqual([
      'Reply',
      'Continue here',
      'Copy resume command',
      'Archive',
    ]);
    await detail.getByRole('button', { name: 'Reply' }).click();
    await detail.getByRole('textbox').fill('Save this draft');
    await detail.getByLabel('Sandbox').selectOption('read-only');
    await topbar.getByRole('button', { name: 'Needs you' }).click();
    expect(await queue.getByRole('button', { name: 'Questions 1' }).getAttribute('aria-pressed')).toBe('true');

    expect(await asked.getByRole('textbox').inputValue()).toBe('Save this draft');
    await asked.getByRole('button', { name: 'Open session' }).click();
    await detail.getByRole('textbox').waitFor();
    expect(await detail.getByRole('textbox').inputValue()).toBe('Save this draft');
    expect(await detail.getByLabel('Sandbox').inputValue()).toBe('read-only');
    await detail.getByRole('button', { name: 'Cancel' }).click();
    await topbar.getByRole('button', { name: 'Needs you' }).click();
    await side.getByRole('button', { name: 'All sessions', exact: true }).click();
    const list = page.locator('main.sessions:visible');
    const search = list.getByRole('searchbox');
    await list.locator('.session-row').first().waitFor();
    await search.fill('sourdough');
    expect(await list.locator('.project summary b').textContent()).toBe('Bread');
    const row = list.locator('.session-row');
    expect(await row.getByRole('button').allTextContents()).toEqual(['Open', '⋯']);
    await row.getByRole('button', { name: 'Open', exact: true }).click();
    await detail.getByText('Read the recipe for bakery-1').waitFor();
    await detail.getByRole('button', { name: 'Reply' }).click();
    await detail.getByRole('textbox').fill('Bake now?');
    await detail.getByLabel('Sandbox').selectOption('read-only');
    await detail.getByRole('button', { name: 'Send', exact: true }).click();
    await detail
      .getByRole('alert')
      .getByText('Could not resume bakery-1. Delivery to this session is unconfirmed.')
      .waitFor();
    await topbar.getByRole('button', { name: 'All sessions' }).click();
    expect(await list.getByRole('textbox').inputValue()).toBe('Bake now?');
    expect(await list.getByLabel('Sandbox').inputValue()).toBe('read-only');
    expect(await list.getByRole('alert').textContent()).toContain('Could not resume bakery-1.');
    await list.getByRole('textbox').fill('A revised reply');
    await row.getByRole('button', { name: 'Open', exact: true }).click();
    expect(await detail.getByRole('textbox').inputValue()).toBe('A revised reply');
    await detail.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Escape');
    expect(await search.inputValue()).toBe('sourdough');
    expect(await row.count()).toBe(1);
    await needsYou.click();

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
    expect(ran).toEqual(['Bake now?', 'Bake today.'].map((prompt) => ({ prompt, cwd: bakery, resume: 'bakery-1' })));

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
