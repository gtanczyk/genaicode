import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { expect, it, vi } from 'vitest';
import type { SessionInfo } from '../agents/sessions/index.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

async function bundleClient() {
  const bundle = await build({
    entryPoints: ['src/ui/web/client.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return bundle.outputFiles[0]!.text;
}

/** ⌘K on a Mac, Ctrl+K elsewhere: the page decides by the platform it runs on. */
const SEARCH_KEY = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

/** What has the focus: a class or role that names it. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return '';
    if (element.closest('.gc-composer') && element.tagName === 'TEXTAREA') return 'composer';
    if (element.closest('.palette')) return 'palette';
    return element.getAttribute('aria-label') ?? element.tagName;
  });

it('⌘K opens Search over the page: a typed title opens its chat, Escape puts the focus back', async () => {
  const browser = await chromium.launch();
  // Outside os.tmpdir() so sessions here are not treated as scratch runs.
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'palette-ui-'));
  const knights = join(root, 'src', 'knights');
  const bakery = join(root, 'src', 'bakery');
  mkdirSync(knights, { recursive: true });
  mkdirSync(bakery, { recursive: true });
  const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
  const stop = new AbortController();

  // A session another program started: it is not one of this app's chats.
  const theirs: SessionInfo[] = [
    {
      source: 'helper',
      agent: 'helper',
      id: 'bakery-1',
      where: 'local',
      cwd: bakery,
      title: 'Sourdough schedule',
      lastPrompt: 'when does the levain peak',
      state: 'waiting',
      updatedAt: Date.now() - 60_000,
    },
  ];
  const made: SessionInfo[] = [];
  const ran: Array<{ prompt: string; resume?: string }> = [];
  let seq = 0;
  const helper: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true },
    sessions: {
      name: 'helper',
      where: 'local',
      list: async () => [...theirs, ...made],
      read: async (session) => [
        {
          id: 1,
          agent: 'helper',
          prompt: session.title ?? '',
          entries: [],
          startedAt: session.updatedAt,
          endedAt: session.updatedAt,
        },
      ],
    },
    run(task) {
      const events: AgentEvent[] = [];
      const done = (async (): Promise<AgentResult> => {
        const id = task.resume ?? `sess-${++seq}`;
        ran.push({ prompt: task.prompt, resume: task.resume });
        events.push({ type: 'session', sessionId: id });
        if (![...theirs, ...made].some((session) => session.id === id)) {
          made.push({
            source: 'helper',
            agent: 'helper',
            id,
            where: 'local',
            cwd: task.cwd,
            title: task.prompt,
            state: 'waiting',
            updatedAt: Date.now(),
          });
        }
        const text = `Ran in ${task.cwd}`;
        events.push({ type: 'message', text });
        return { status: 'completed', ok: true, exitCode: 0, signal: null, sessionId: id, text };
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

  let running: Promise<number> | undefined;
  try {
    const clientScript = await bundleClient();
    let opened: string | undefined;
    const launch = (options: UiLaunch) =>
      runWeb({
        ...options,
        stderr: new PassThrough().resume(),
        openUrl(url) {
          opened = url;
        },
        clientScript,
      });
    running = main({
      argv: ['ui', '--sessions', '--home', '--no-artifacts'],
      cwd: knights,
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
    // What the page asks the server to do with the chat.
    const commands: Array<{ type: string; id?: string; source?: string; order?: { seq: number } }> = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/command') commands.push(request.postDataJSON());
    });
    await page.goto(opened!);

    const side = page.getByRole('complementary', { name: 'Sidebar' });
    const chats = side.getByRole('navigation', { name: 'Chats' });
    const composer = page.locator('.gc-composer textarea');
    const title = page.locator('header.topbar h1');
    const palette = page.getByRole('dialog', { name: 'Search chats and sessions' });
    const field = palette.getByRole('combobox');
    const options = palette.getByRole('option');
    const selected = palette.locator('[role=option][aria-selected=true] .grow');

    // Two chats of this app, the second one open.
    await composer.fill('Count the loaves');
    await composer.press('Enter');
    await chats.getByRole('button', { name: /Count the loaves/ }).waitFor();
    await side.getByRole('button', { name: 'New chat', exact: true }).click();
    await vi.waitFor(async () => expect(await title.textContent()).toBe('New chat'));
    await composer.fill('Polish the armour');
    await composer.press('Enter');
    await chats.getByRole('button', { name: /Polish the armour/ }).waitFor();
    await vi.waitFor(async () => expect(await title.textContent()).toBe('Polish the armour'));
    await page.locator('.gc-chat[data-status="idle"]').waitFor();

    // ⌘K from the message field, a draft in it: the palette is over the page with the focus.
    await composer.fill('a draft');
    expect(await focused(page)).toBe('composer');
    expect(await palette.count()).toBe(0);
    await page.keyboard.press(SEARCH_KEY);
    await palette.waitFor();
    expect(await focused(page)).toBe('palette');
    // The chats newest first, the other agent's session, then the commands.
    await vi.waitFor(async () =>
      expect((await options.locator('.grow').allTextContents()).slice(0, 5)).toEqual([
        'Polish the armour',
        'Count the loaves',
        'Sourdough schedule',
        'New chat',
        'Needs you',
      ]),
    );
    expect(await selected.textContent()).toBe('Polish the armour');
    // Each result names its project and agent, and what it is.
    expect(await options.nth(1).locator('.tag').allTextContents()).toEqual(['Home folder', 'helper']);
    expect(await options.nth(1).locator('small').textContent()).toBe('chat');
    expect(await options.nth(2).locator('.tag').allTextContents()).toEqual(['bakery', 'helper']);
    expect(await options.nth(2).locator('small').textContent()).toBe('session');
    // It covers the page: the palette is in the upper middle of the window.
    const box = (await palette.boundingBox())!;
    expect(Math.round(box.x + box.width / 2)).toBe(640);
    expect(box.width).toBe(600);

    // Escape closes it and the focus is back in the message field; the draft and the chat are as they were.
    await field.fill('loaves');
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
    expect(await focused(page)).toBe('composer');
    expect(await composer.inputValue()).toBe('a draft');
    expect(await title.textContent()).toBe('Polish the armour');
    expect(commands.filter((one) => one.type === 'continue')).toEqual([]);

    // Typed words narrow the list; the arrows move, and Enter opens the chat under the selection.
    await page.keyboard.press(SEARCH_KEY);
    // It starts empty again.
    expect(await field.inputValue()).toBe('');
    await page.keyboard.type('the');
    // Titles first; then a command by its other words ("other agents"), then a session by its prompt.
    await vi.waitFor(async () =>
      expect(await options.locator('.grow').allTextContents()).toEqual([
        'Polish the armour',
        'Count the loaves',
        'All sessions',
        'Sourdough schedule',
      ]),
    );
    await page.keyboard.press('ArrowDown');
    expect(await selected.textContent()).toBe('Count the loaves');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await selected.textContent()).toBe('Sourdough schedule');
    await page.keyboard.press('ArrowDown');
    expect(await selected.textContent()).toBe('Polish the armour');
    await page.keyboard.press('ArrowDown');
    expect(await selected.textContent()).toBe('Count the loaves');
    await page.keyboard.press('Enter');
    await palette.waitFor({ state: 'detached' });
    await vi.waitFor(async () => expect(await title.textContent()).toBe('Count the loaves'));
    // It went the way a row of the sidebar goes: an ordered request for that session in its store.
    const asked = commands.filter((one) => one.type === 'continue');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ id: made[0]!.id, source: 'helper' });
    expect(asked[0]!.order!.seq).toBeGreaterThan(0);
    await vi.waitFor(async () =>
      expect(await chats.getByRole('button', { name: /Count the loaves/ }).getAttribute('aria-current')).toBe('page'),
    );
    // The next key goes to the message field, and the prompt to that chat.
    await vi.waitFor(async () => expect(await focused(page)).toBe('composer'));
    await vi.waitFor(async () => expect(await composer.isEnabled()).toBe(true));
    await composer.fill('And the rolls');
    await composer.press('Enter');
    await vi.waitFor(() => expect(ran.at(-1)).toMatchObject({ prompt: 'And the rolls', resume: made[0]!.id }));
    await page.locator('.gc-chat[data-status="idle"]').waitFor();

    // The sidebar's Search opens it too, and Escape goes back to that button.
    const search = side.getByRole('button', { name: 'Search', exact: true });
    await search.click();
    await palette.waitFor();
    expect(await focused(page)).toBe('palette');
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
    expect(await focused(page)).toBe('Search');

    // Another agent's session is found by its last prompt and shown among all sessions.
    await page.keyboard.press(SEARCH_KEY);
    await page.keyboard.type('levain');
    await vi.waitFor(async () =>
      expect(await options.locator('.grow').allTextContents()).toEqual(['Sourdough schedule']),
    );
    await page.keyboard.press('Enter');
    await palette.waitFor({ state: 'detached' });
    await vi.waitFor(async () => expect(await title.textContent()).toBe('All sessions'));
    await page.locator('.session-row', { hasText: 'Sourdough schedule' }).waitFor();
    expect(commands.filter((one) => one.type === 'continue')).toHaveLength(1);

    // A command: Escape first closes the palette only, the page stays; then New chat by name.
    await page.keyboard.press(SEARCH_KEY);
    await page.keyboard.type('new ch');
    await vi.waitFor(async () => expect(await selected.textContent()).toBe('New chat'));
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
    expect(await title.textContent()).toBe('All sessions');
    await page.keyboard.press(SEARCH_KEY);
    await page.keyboard.type('new ch');
    await page.keyboard.press('Enter');
    await vi.waitFor(async () => expect(await title.textContent()).toBe('New chat'));
    await vi.waitFor(async () => expect(await focused(page)).toBe('composer'));
    expect(commands.at(-1)).toMatchObject({ type: 'home-chat' });

    // A press beside the palette closes it.
    await page.keyboard.press(SEARCH_KEY);
    await palette.waitFor();
    await page.mouse.click(40, 780);
    await palette.waitFor({ state: 'detached' });

    // The session index may answer before the list of this app's chats: until that list is there,
    // no session is taken for another agent's (an app chat would open All sessions).
    {
      const slow = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const late = await slow.newPage();
      late.on('pageerror', (error) => errors.push(error.message));
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await late.route(/\/api\/sessions\?.*own=1/, async (route) => {
        await held;
        await route.continue();
      });
      const general = late.waitForResponse((response) => /\/api\/sessions\?days=7$/.test(response.url()));
      await late.goto(opened!);
      await general;
      const lateSide = late.getByRole('complementary', { name: 'Sidebar' });
      await lateSide.getByRole('button', { name: 'Search', exact: true }).click();
      const latePalette = late.getByRole('dialog', { name: 'Search chats and sessions' });
      await latePalette.waitFor();
      expect(await latePalette.locator('[role=option] small', { hasText: 'session' }).count()).toBe(0);
      await lateSide.getByText('Count the loaves').waitFor();
      release();
      // Then this app's chats are chats, and only the other agent's session is a session.
      await vi.waitFor(async () =>
        expect(
          await latePalette
            .getByRole('option')
            .evaluateAll((rows) =>
              rows
                .filter(
                  (row) =>
                    row.querySelector('small')?.textContent !== 'command' &&
                    row.querySelector('.grow')?.textContent !== 'New chat',
                )
                .map((row) => `${row.querySelector('.grow')?.textContent} ${row.querySelector('small')?.textContent}`),
            ),
        ).toEqual(['Count the loaves chat', 'Polish the armour chat', 'Sourdough schedule session']),
      );
      await slow.close();
    }

    // It fits a wide and a narrow window, in both themes, the list scrolling inside it.
    for (const width of [1440, 900]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        const sized = await browser.newContext({ viewport: { width, height: 700 }, colorScheme });
        const other = await sized.newPage();
        other.on('pageerror', (error) => errors.push(error.message));
        await other.goto(opened!);
        await other.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Search' }).click();
        const shown = other.getByRole('dialog', { name: 'Search chats and sessions' });
        await shown.getByRole('option', { name: /Count the loaves/ }).waitFor();
        const size = (await shown.boundingBox())!;
        expect(size.width).toBe(600);
        expect(Math.round(size.x + size.width / 2)).toBe(width / 2);
        expect(size.y).toBe(84);
        expect(size.y + size.height).toBeLessThan(700);
        // No row is wider than the list, also with long titles cut short.
        expect(
          await shown
            .getByRole('listbox')
            .evaluate((element) => element.scrollWidth <= element.clientWidth && element.clientHeight <= 320),
        ).toBe(true);
        // The selected row and its text are told apart from the panel.
        const colors = await shown.locator('[aria-selected=true]').evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.backgroundColor, style.color, getComputedStyle(element.closest('.palette')!).backgroundColor];
        });
        expect(new Set(colors).size).toBe(3);
        await sized.close();
      }
    }

    expect(errors).toEqual([]);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
