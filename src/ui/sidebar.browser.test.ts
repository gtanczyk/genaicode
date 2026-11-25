import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { expect, it, vi } from 'vitest';
import { SUPPORT_URL } from '../support.js';
import type { SessionInfo } from '../agents/sessions/index.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';
import { TERMS_URL } from './web/sidebar.js';

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

const sideWidth = (page: Page) =>
  page.locator('aside.side').evaluate((element) => Math.round(element.getBoundingClientRect().width));

it('lists chats by project, selects the open one, and folds to a rail that is remembered', async () => {
  const browser = await chromium.launch();
  // Outside os.tmpdir() so sessions here are not treated as scratch runs.
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'sidebar-ui-'));
  const knights = join(root, 'src', 'knights');
  const bakery = join(root, 'src', 'bakery');
  mkdirSync(knights, { recursive: true });
  mkdirSync(bakery, { recursive: true });
  const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
  const stop = new AbortController();

  // A session another program started: it is not one of this app's chats.
  const foreign: SessionInfo = {
    source: 'helper',
    agent: 'helper',
    id: 'bakery-1',
    where: 'local',
    cwd: bakery,
    title: 'Sourdough schedule',
    state: 'waiting',
    updatedAt: Date.now() - 60_000,
  };
  // A second one, in another folder and listed later: taking it over gives the list a second project.
  const roster: SessionInfo = { ...foreign, id: 'knights-1', cwd: knights, title: 'Round table' };
  const theirs: SessionInfo[] = [foreign];
  const made: SessionInfo[] = [];
  // Every prompt that reached the agent, with the folder and the session it ran in.
  const ran: Array<{ prompt: string; cwd?: string; resume?: string }> = [];
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
        ran.push({ prompt: task.prompt, cwd: task.cwd, resume: task.resume });
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
    await page.goto(opened!);

    const side = page.getByRole('complementary', { name: 'Sidebar' });
    const chats = side.getByRole('navigation', { name: 'Chats' });
    const composer = page.locator('.gc-composer textarea');
    const topbar = page.locator('header.topbar');

    // The shell: a full sidebar beside the chat, one top bar, and no second row of controls.
    await side.getByRole('button', { name: 'New chat', exact: true }).waitFor();
    expect(await sideWidth(page)).toBe(268);
    expect(await page.locator('header.bar').count()).toBe(0);
    expect(await topbar.locator('h1').textContent()).toBe('New chat');
    expect(await side.getByRole('button', { name: 'Search' }).getAttribute('aria-disabled')).toBeNull();
    // What this app did not start sits under the other agents' sessions, tagged with its agent.
    const other = chats.getByRole('region', { name: "Other agents' sessions" });
    await other.getByRole('button', { name: /Sourdough schedule/ }).waitFor();
    expect(await other.locator('.tag').first().textContent()).toBe('helper');
    expect(await chats.locator('details.proj').count()).toBe(0);

    // A chat is listed from its first prompt, under the folder it runs in, and is the one selected.
    await composer.fill('What is waiting for me?');
    await composer.press('Enter');
    await page.getByRole('log').getByText('Ran in').waitFor();
    const home = chats.locator('details.proj', { hasText: 'Home folder' });
    const first = home.getByRole('button', { name: /What is waiting for me\?/ });
    await first.waitFor();
    expect(await first.getAttribute('aria-current')).toBe('page');
    expect(await first.getByRole('img').getAttribute('aria-label')).toBe('Done');
    expect(await topbar.locator('h1').textContent()).toBe('What is waiting for me?');
    expect(await topbar.locator('.crumb').count()).toBe(0);

    // "New chat" leaves the chat in the list and selects nothing.
    await side.getByRole('button', { name: 'New chat', exact: true }).click();
    await vi.waitFor(async () => expect(await chats.locator('[aria-current="page"]').count()).toBe(0));
    await first.waitFor();

    // Taking a session over makes its folder a project of the list, with a "new chat here" button.
    await side.getByRole('button', { name: 'All sessions', exact: true }).click();
    expect(await side.getByRole('button', { name: 'All sessions', exact: true }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await topbar.locator('h1').textContent()).toBe('All sessions');
    await page
      .locator('.session-row', { hasText: 'Sourdough schedule' })
      .getByRole('button', { name: 'Continue here' })
      .click();
    const project = chats.locator('details.proj', { hasText: 'bakery' });
    await composer.fill('Plan the next bake');
    await composer.press('Enter');
    const second = project.getByRole('button', { name: /Sourdough schedule|Plan the next bake/ });
    await second.waitFor();
    await vi.waitFor(async () => expect(await second.getAttribute('aria-current')).toBe('page'));
    expect(await project.locator('summary').getAttribute('title')).toBe(bakery);
    expect(await topbar.locator('.crumb').textContent()).toBe('bakery');
    expect(await topbar.locator('.crumb').getAttribute('title')).toBe(bakery);
    expect(await chats.getByRole('region', { name: "Other agents' sessions" }).count()).toBe(0);

    // Selecting another chat opens it; the selection follows.
    await first.click();
    await vi.waitFor(async () => expect(await first.getAttribute('aria-current')).toBe('page'));
    expect(await second.getAttribute('aria-current')).toBeNull();
    await page.getByRole('log').getByText('What is waiting for me?').first().waitFor();

    // "New chat here" starts an empty chat in that project's folder.
    await project.locator('summary').hover();
    await project.getByRole('button', { name: 'New chat here, bakery' }).click();
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('bakery'));
    expect(await topbar.locator('h1').textContent()).toBe('New chat');
    expect(await project.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
    await composer.fill('Order flour');
    await composer.press('Enter');
    await page.getByRole('log').getByText(`Ran in ${bakery}`).waitFor();
    await project.getByRole('button', { name: /Order flour/ }).waitFor();
    expect(await project.locator('button.nav.chat').count()).toBe(2);

    // Help holds what the header's links were; Escape closes the menu and nothing else.
    await side.getByRole('button', { name: 'Help', exact: true }).click();
    const help = side.getByRole('menu', { name: 'Help' });
    expect(await help.getByRole('menuitem', { name: 'Get help' }).getAttribute('href')).toBe(SUPPORT_URL);
    expect(await help.getByRole('menuitem', { name: 'Terms' }).getAttribute('href')).toBe(TERMS_URL);
    await side.getByRole('button', { name: 'All sessions', exact: true }).click();
    await side.getByRole('button', { name: 'Help', exact: true }).click();
    await help.waitFor();
    await page.keyboard.press('Escape');
    await help.waitFor({ state: 'detached' });
    expect(await topbar.locator('h1').textContent()).toBe('All sessions');
    // The next Escape leaves the page: back in the chat, with the focus in the message field.
    await page.keyboard.press('Escape');
    await vi.waitFor(async () => expect(await topbar.locator('h1').textContent()).toBe('Order flour'));
    await vi.waitFor(async () =>
      expect(await composer.evaluate((element) => element === document.activeElement)).toBe(true),
    );

    // ⌘B folds the sidebar to the 56 px rail; the chat keeps the rest, and a reload remembers it.
    await page.keyboard.press('ControlOrMeta+b');
    await page.locator('.shell.side-collapsed').waitFor();
    expect(await sideWidth(page)).toBe(56);
    expect(await chats.locator('details.proj').first().isVisible()).toBe(false);
    await side.getByRole('button', { name: 'New chat', exact: true }).waitFor();
    await page.reload();
    await page.locator('.shell.side-collapsed').waitFor();
    await topbar.getByRole('button', { name: 'Show sidebar' }).click();
    await vi.waitFor(async () => expect(await sideWidth(page)).toBe(268));
    await side.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.locator('.shell.side-collapsed').waitFor();
    await page.keyboard.press('ControlOrMeta+b');
    await vi.waitFor(async () => expect(await sideWidth(page)).toBe(268));

    // "All chats" ends the list: every chat of this app in the Sessions view, of all time, and the
    // archived ones under their state.
    const allChats = chats.getByRole('button', { name: 'All chats', exact: true });
    await allChats.click();
    await vi.waitFor(async () => expect(await topbar.locator('h1').textContent()).toBe('All chats'));
    expect(await allChats.getAttribute('aria-current')).toBe('page');
    expect(
      await side.getByRole('button', { name: 'All sessions', exact: true }).getAttribute('aria-current'),
    ).toBeNull();
    const list = page.locator('main.sessions');
    expect(await list.getByRole('combobox', { name: 'Period' }).inputValue()).toBe('0');
    const flour = list.locator('.session-row', { hasText: 'Order flour' });
    await flour.getByRole('button', { name: 'Archive', exact: true }).click();
    await flour.waitFor({ state: 'detached' });
    await list.getByRole('combobox', { name: 'State' }).selectOption('archived');
    await flour.getByRole('button', { name: 'Unarchive' }).click();
    await flour.waitFor({ state: 'detached' });
    await list.getByRole('combobox', { name: 'State' }).selectOption('');
    await flour.waitFor();
    await list.getByRole('button', { name: /Chats of this app/ }).click();
    await vi.waitFor(async () => expect(await topbar.locator('h1').textContent()).toBe('All sessions'));

    // "New chat here" while the server still looks the folder up: nothing can be sent meanwhile,
    // and when it fails the draft is still in the message field, in the chat that was open.
    await first.click();
    await vi.waitFor(async () => expect(await first.getAttribute('aria-current')).toBe('page'));
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').count()).toBe(0));
    let answer: ((ok: boolean) => void) | undefined;
    await page.route('**/api/command', async (route) => {
      if ((route.request().postDataJSON() as { type?: string }).type !== 'project-chat') return route.fallback();
      const go = await new Promise<boolean>((resolve) => (answer = resolve));
      return go ? route.fallback() : route.fulfill({ json: { ok: false } });
    });
    const sentBefore = made.length;
    const newHere = async () => {
      answer = undefined;
      await project.locator('summary').hover();
      await project.getByRole('button', { name: 'New chat here, bakery' }).click();
      await vi.waitFor(() => expect(answer).toBeDefined());
    };
    await composer.fill('Feed the starter');
    await newHere();
    expect(await composer.getAttribute('aria-disabled')).toBe('true');
    await composer.press('Enter');
    expect(await composer.inputValue()).toBe('Feed the starter');
    answer!(false);
    await vi.waitFor(async () => expect(await composer.getAttribute('aria-disabled')).toBeNull());
    expect(await composer.inputValue()).toBe('Feed the starter');
    expect(await topbar.locator('.crumb').count()).toBe(0);
    expect(made.length).toBe(sentBefore);
    // Once the chat is in the folder, the same draft goes there.
    await newHere();
    answer!(true);
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('bakery'));
    await vi.waitFor(async () => expect(await composer.getAttribute('aria-disabled')).toBeNull());
    await composer.press('Enter');
    await project.getByRole('button', { name: /Feed the starter/ }).waitFor();
    expect(made.at(-1)).toMatchObject({ title: 'Feed the starter', cwd: bakery });
    await page.unroute('**/api/command');

    // A second project, to move between two.
    theirs.push(roster);
    await side.getByRole('button', { name: 'All sessions', exact: true }).click();
    await page
      .locator('.session-row', { hasText: 'Round table' })
      .getByRole('button', { name: 'Continue here' })
      .click();
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('knights'));
    await composer.fill('Polish the armour');
    await composer.press('Enter');
    const castle = chats.locator('details.proj', { hasText: 'knights' });
    await castle.getByRole('button', { name: /Round table|Polish the armour/ }).waitFor();

    // Every request for another chat is held until the test lets it through (or refuses it).
    type Asked = {
      type: string;
      id?: string;
      source?: string;
      takeover?: boolean;
      order?: { window: string; seq: number };
    };
    const held: Array<Asked & { answer: (ok: boolean) => void; answered: Promise<unknown> }> = [];
    await page.route('**/api/command', async (route) => {
      const asked = route.request().postDataJSON() as Asked;
      if (asked.type !== 'project-chat' && asked.type !== 'continue') return route.fallback();
      let done!: () => void;
      const answered = new Promise<void>((resolve) => (done = resolve));
      const go = await new Promise<boolean>((answer) => held.push({ ...asked, answer, answered }));
      await (go ? route.fallback() : route.fulfill({ json: { ok: false } }));
      // The page has the answer a moment after the route is done with it.
      setTimeout(done, 200);
    });
    const disabled = () => composer.getAttribute('aria-disabled');

    // "New chat here" for one project, then for another while the first is still looked up: both
    // are asked for, the first answer does not give the message field back, and the window ends in
    // the project asked for last.
    await composer.fill('Sharpen the swords');
    await project.locator('summary').hover();
    await project.getByRole('button', { name: 'New chat here, bakery' }).click();
    await vi.waitFor(() => expect(held.length).toBe(1));
    await castle.locator('summary').hover();
    await castle.getByRole('button', { name: 'New chat here, knights' }).click();
    await vi.waitFor(() => expect(held.length).toBe(2));
    expect(held.map((one) => one.type)).toEqual(['project-chat', 'project-chat']);
    held[0]!.answer(true);
    await held[0]!.answered;
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('bakery'));
    expect(await disabled()).toBe('true');
    await composer.press('Enter');
    held[1]!.answer(true);
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('knights'));
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    expect(await topbar.locator('h1').textContent()).toBe('New chat');
    expect(await composer.inputValue()).toBe('Sharpen the swords');

    // A chat picked in the sidebar is looked up first: nothing is sent meanwhile, so the draft
    // cannot start in the chat that is left. When the lookup fails the draft is still there.
    const sent = ran.length;
    held.length = 0;
    await first.click();
    await vi.waitFor(() => expect(held.length).toBe(1));
    expect(held[0]!.type).toBe('continue');
    expect(await disabled()).toBe('true');
    await composer.press('Enter');
    expect(await composer.inputValue()).toBe('Sharpen the swords');
    held[0]!.answer(false);
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    expect(await composer.inputValue()).toBe('Sharpen the swords');
    expect(await topbar.locator('.crumb').textContent()).toBe('knights');
    expect(ran.length).toBe(sent);
    // Once that chat is the open one, the draft goes to it.
    await first.click();
    await vi.waitFor(() => expect(held.length).toBe(2));
    await composer.press('Enter');
    held[1]!.answer(true);
    await vi.waitFor(async () => expect(await first.getAttribute('aria-current')).toBe('page'));
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    expect(ran.length).toBe(sent);
    await composer.press('Enter');
    await vi.waitFor(() => expect(ran.length).toBe(sent + 1));
    expect(ran.at(-1)).toMatchObject({ cwd: made[0]!.cwd, resume: made[0]!.id });
    expect(ran.at(-1)!.prompt).toContain('Sharpen the swords');
    expect(ran.at(-1)!.cwd).not.toBe(knights);

    // With this chat (A) open, another (B) is picked and then A again before B is there: A is
    // asked for too, as the later choice, with the store of its row and a higher number.
    const round = castle.getByRole('button', { name: /Round table|Polish the armour/ });
    const pickBThenA = async () => {
      held.length = 0;
      await round.click();
      await vi.waitFor(() => expect(held.length).toBe(1));
      await first.click();
      await vi.waitFor(() => expect(held.length).toBe(2));
      expect(held.map((one) => [one.type, one.id, one.source])).toEqual([
        ['continue', roster.id, 'helper'],
        ['continue', made[0]!.id, 'helper'],
      ]);
      expect(held[1]!.order!.window).toBe(held[0]!.order!.window);
      expect(held[1]!.order!.seq).toBeGreaterThan(held[0]!.order!.seq);
      expect(await disabled()).toBe('true');
    };
    const inA = async () => {
      expect(await first.getAttribute('aria-current')).toBe('page');
      expect(await topbar.locator('.crumb').count()).toBe(0);
    };
    await composer.fill('Count the loaves');
    // B's request arrives first: the window is in B for a moment, still locked, and ends in A.
    await pickBThenA();
    held[0]!.answer(true);
    await held[0]!.answered;
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('knights'));
    expect(await disabled()).toBe('true');
    held[1]!.answer(true);
    await vi.waitFor(inA);
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    // A's request arrives first and B's after it: the server drops B's by its number, so the
    // window stays in A, where the message field was given back.
    await pickBThenA();
    held[1]!.answer(true);
    await held[1]!.answered;
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    await inA();
    const late = page.waitForResponse((response) => response.url().endsWith('/api/command'));
    held[0]!.answer(true);
    expect(await (await late).json()).toEqual({ ok: false, superseded: true });
    await held[0]!.answered;
    await inA();
    expect(await disabled()).toBeNull();
    // The draft goes to A.
    await composer.press('Enter');
    await vi.waitFor(() => expect(ran.at(-1)!.prompt).toContain('Count the loaves'));
    expect(ran.at(-1)).toMatchObject({ cwd: made[0]!.cwd, resume: made[0]!.id });

    // B asked for by id in the message field (`/continue`), then A's row before B is there: the
    // command is numbered like a row's request, so A, picked later, is asked for too and wins
    // although B's request arrives after it.
    held.length = 0;
    await composer.fill(`/continue ${roster.id}`);
    await composer.press('Enter');
    await vi.waitFor(() => expect(held.length).toBe(1));
    expect(held[0]).toMatchObject({ type: 'continue', id: roster.id, takeover: true });
    expect(held[0]!.order!.seq).toBeGreaterThan(0);
    expect(await disabled()).toBe('true');
    await first.click();
    await vi.waitFor(() => expect(held.length).toBe(2));
    expect(held[1]).toMatchObject({ type: 'continue', id: made[0]!.id, source: 'helper' });
    expect(held[1]!.order!.window).toBe(held[0]!.order!.window);
    expect(held[1]!.order!.seq).toBeGreaterThan(held[0]!.order!.seq);
    held[1]!.answer(true);
    await held[1]!.answered;
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    const overtaken = page.waitForResponse((response) => response.url().endsWith('/api/command'));
    held[0]!.answer(true);
    expect(await (await overtaken).json()).toEqual({ ok: false, superseded: true });
    await held[0]!.answered;
    await inA();
    await page.unroute('**/api/command');

    // A window under 980 px starts with the rail until the person chooses.
    const narrow = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const small = await narrow.newPage();
    await small.goto(opened!);
    await small.locator('.shell.side-collapsed').waitFor();
    expect(await sideWidth(small)).toBe(56);
    expect(await small.locator('.gc-chat').evaluate((element) => element.getBoundingClientRect().width)).toBe(844);

    expect(errors).toEqual([]);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
