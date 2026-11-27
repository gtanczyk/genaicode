import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { expect, it, vi } from 'vitest';
import { SUPPORT_URL } from '../support.js';
import { personText } from '../agents/host-text.js';
import type { SessionInfo } from '../agents/sessions/index.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';
import { chatStore } from './chat-store.js';
import { neutralHomeDir } from '../agents/sessions/workspace.js';
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
            title: personText(task.prompt),
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
    await chats.locator('.nav.chat[aria-current=page]').waitFor();

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

    // The new, still-empty chat is selected and the prior chat stays in the list.
    await side.getByRole('button', { name: 'New chat', exact: true }).click();
    await chats
      .getByRole('button', { name: /New chat/ })
      .and(chats.locator('[aria-current="page"]'))
      .waitFor();
    await first.waitFor();

    // Taking a session over makes its folder a project of the list, with a "new chat here" button.
    await side.getByRole('button', { name: 'All sessions', exact: true }).click();
    expect(await side.getByRole('button', { name: 'All sessions', exact: true }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await topbar.locator('h1').textContent()).toBe('All sessions');
    await page
      .locator('.session-row', { hasText: 'Sourdough schedule' })
      .getByRole('button', { name: /Session actions/ })
      .click();
    await page.getByRole('menuitem', { name: 'Continue here' }).click();
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

    // Home has an empty directory key. It moves like any other folder, with its chats.
    const headings = chats.locator('details.proj > summary .grow');
    const projectNames = () => headings.allTextContents();
    const savedOrder = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/settings');
    await home.locator('summary').dragTo(project.locator('summary'));
    const saved = await savedOrder;
    expect(saved.ok()).toBe(true);
    const keys = saved.request().postDataJSON().projectOrder as string[];
    expect(keys.slice().sort()).toEqual(['', bakery]);
    expect(await chatStore(env, neutralHomeDir(env), true).readProjectOrder()).toEqual(keys);
    const customOrder = keys.map((key) => (key ? 'bakery' : 'Home folder'));
    await vi.waitFor(async () => expect(await projectNames()).toEqual(customOrder));
    expect(await second.getAttribute('aria-current')).toBe('page');

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
    expect(await projectNames()).toEqual(customOrder);

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

    const edge = page.getByRole('separator', { name: 'Resize sidebar' });
    const bounds = (await edge.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 120);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 64, bounds.y + 120);
    await page.mouse.up();
    expect(await sideWidth(page)).toBe(332);
    await edge.press('ArrowRight');
    expect(await sideWidth(page)).toBe(356);

    // ⌘B folds the sidebar to the 56 px rail; the chat keeps the rest, and a reload remembers it.
    await page.keyboard.press('ControlOrMeta+b');
    await page.locator('.shell.side-collapsed').waitFor();
    expect(await sideWidth(page)).toBe(56);
    expect(await chats.locator('details.proj').first().isVisible()).toBe(false);
    await side.getByRole('button', { name: 'New chat', exact: true }).waitFor();
    await page.reload();
    await page.locator('.shell.side-collapsed').waitFor();
    await topbar.getByRole('button', { name: 'Show sidebar' }).click();
    await vi.waitFor(async () => expect(await sideWidth(page)).toBe(356));
    await edge.press('Enter');
    expect(await sideWidth(page)).toBe(268);
    expect(await projectNames()).toEqual(customOrder);
    await home.locator('summary').press(customOrder[0] === 'Home folder' ? 'Alt+ArrowDown' : 'Alt+ArrowUp');
    await vi.waitFor(async () => expect(await projectNames()).toEqual(customOrder.slice().reverse()));
    expect(await home.locator('summary').evaluate((element) => document.activeElement === element)).toBe(true);
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
    const sidebarFlour = chats.locator('.chat-actions', { hasText: 'Order flour' });
    await sidebarFlour.hover();
    const actions = sidebarFlour.getByRole('button', { name: 'Chat actions' });
    expect(await actions.locator('..').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await actions.click();
    await sidebarFlour.getByRole('menuitem', { name: 'Archive' }).click();
    await sidebarFlour.waitFor({ state: 'detached' });
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
    await page.route('**/api/command*', async (route) => {
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
    // A new project chat has an empty composer. The original chat keeps its draft.
    await newHere();
    answer!(true);
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('bakery'));
    await vi.waitFor(async () => expect(await composer.getAttribute('aria-disabled')).toBeNull());
    expect(await composer.inputValue()).toBe('');
    await composer.fill('Start the bakery');
    await composer.press('Enter');
    await project.getByRole('button', { name: /Start the bakery/ }).waitFor();
    expect(made.at(-1)).toMatchObject({ title: 'Start the bakery', cwd: bakery });
    await page.unroute('**/api/command*');

    // A second project, to move between two.
    theirs.push(roster);
    await side.getByRole('button', { name: 'All sessions', exact: true }).click();
    await page
      .locator('.session-row', { hasText: 'Round table' })
      .getByRole('button', { name: /Session actions/ })
      .click();
    await page.getByRole('menuitem', { name: 'Continue here' }).click();
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('knights'));
    await composer.fill('Polish the armour');
    await composer.press('Enter');
    const castle = chats.locator('details.proj', { hasText: 'knights' });
    await castle.getByRole('button', { name: /Round table|Polish the armour/ }).waitFor();

    // Two keyboard moves while the first save is held must accumulate and persist in order.
    const beforeMoves = await projectNames();
    const heading = chats.locator('details.proj > summary').first();
    await heading.focus();
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const requests: string[][] = [];
    await page.route('**/api/settings*', async (route) => {
      requests.push(route.request().postDataJSON().projectOrder);
      await gate;
      await route.fallback();
    });
    await page.keyboard.press('Alt+ArrowDown');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await page.keyboard.press('Alt+ArrowDown');
    const expected = [...beforeMoves.slice(1), beforeMoves[0]!];
    try {
      expect(await projectNames()).toEqual(expected);
    } finally {
      releaseSave();
    }
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const disk = chatStore(env, neutralHomeDir(env), true);
    await vi.waitFor(async () => expect(await disk.readProjectOrder()).toEqual(requests[1]));
    expect(await projectNames()).toEqual(expected);
    await page.unroute('**/api/settings*');

    // Every request for another chat is held until the test lets it through (or refuses it).
    type Asked = {
      type: string;
      id?: string;
      source?: string;
      takeover?: boolean;
      order?: { window: string; seq: number };
    };
    const held: Array<Asked & { answer: (ok: boolean) => void; answered: Promise<unknown> }> = [];
    await page.route('**/api/command*', async (route) => {
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
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('knights'));
    expect(await disabled()).toBe('true');
    await composer.press('Enter');
    held[1]!.answer(true);
    await vi.waitFor(async () => expect(await topbar.locator('.crumb').textContent()).toBe('knights'));
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    expect(await topbar.locator('h1').textContent()).toBe('New chat');
    expect(await composer.inputValue()).toBe('');
    await composer.fill('Sharpen the swords');

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
    // Reopening the first chat restores the draft written there.
    await first.click();
    await vi.waitFor(() => expect(held.length).toBe(2));
    await composer.press('Enter');
    held[1]!.answer(true);
    await vi.waitFor(async () => expect(await first.getAttribute('aria-current')).toBe('page'));
    await vi.waitFor(async () => expect(await disabled()).toBeNull());
    expect(ran.length).toBe(sent);
    expect(await composer.inputValue()).toBe('Feed the starter');
    await composer.press('Enter');
    await vi.waitFor(() => expect(ran.length).toBe(sent + 1));
    expect(ran.at(-1)).toMatchObject({ cwd: made[0]!.cwd, resume: made[0]!.id });
    expect(ran.at(-1)!.prompt).toContain('Feed the starter');
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
    await inA();
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
    const late = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/command');
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
    const overtaken = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/command');
    held[0]!.answer(true);
    expect(await (await overtaken).json()).toEqual({ ok: false, superseded: true });
    await held[0]!.answered;
    await inA();
    await page.unroute('**/api/command*');

    // Delete has a separate confirmation. Cancelling preserves the chat; confirming erases the
    // app's history even for the current chat, while the agent's session source keeps its copy.
    const firstRow = home
      .locator('.chat-actions')
      .filter({ has: page.getByRole('button', { name: /What is waiting for me\?/ }) });
    const deleteMenu = async () => {
      await firstRow.hover();
      await firstRow.getByRole('button', { name: 'Chat actions' }).click();
      await firstRow.getByRole('menuitem', { name: 'Delete chat history…' }).click();
    };
    const confirm = page.getByRole('dialog', { name: 'Delete chat history?' });
    await deleteMenu();
    expect(await confirm.textContent()).toContain('What is waiting for me?');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await first.waitFor();
    await deleteMenu();
    await confirm.getByRole('button', { name: 'Delete history' }).click();
    await first.waitFor({ state: 'detached' });
    await vi.waitFor(async () => expect(await topbar.locator('h1').textContent()).toBe('New chat'));
    await page.reload();
    await side.getByRole('button', { name: 'All chats', exact: true }).click();
    await list.getByRole('combobox', { name: 'State' }).waitFor();
    expect(await list.getByText('What is waiting for me?', { exact: true }).count()).toBe(0);
    expect(made.some((row) => row.title === 'What is waiting for me?')).toBe(true);
    const snapshot = await chatStore(env, made[0]!.cwd!, true).index();
    // The workspace used by --home is Genaicode's home directory, the cwd of this chat's first turn.
    expect(snapshot).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('What is waiting for me?');
    const ownStore = chatStore(env, made[0]!.cwd!, true);
    const oldSnapshot = await ownStore.read(new URL(page.url()).hash.slice('#chat='.length));
    expect(JSON.stringify(oldSnapshot ?? {})).not.toContain('What is waiting for me?');

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
