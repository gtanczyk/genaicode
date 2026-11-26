import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
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

/** An agent whose turn waits while its prompt says "hold", until `release()` or a stop. */
function agent(name: string, options: { steer?: boolean; sessions?: SessionInfo[] } = {}) {
  let let_go: (() => void) | undefined;
  const steered: string[] = [];
  let seq = 0;
  const driver: CodingAgent = {
    name,
    command: process.execPath,
    capabilities: {
      mcp: true,
      resume: true,
      effort: ['low', 'high'],
      plan: true,
      ...(options.steer ? { steer: true } : {}),
    },
    // A folder is a project once a session worked in it.
    sessions: options.sessions
      ? { name, where: 'local', list: async () => options.sessions!, read: async () => [] }
      : null,
    run(task) {
      const events: AgentEvent[] = [];
      let aborted = false;
      const held = /hold/.test(task.prompt)
        ? new Promise<void>((resolve) => {
            let_go = resolve;
          })
        : Promise.resolve();
      const done = (async (): Promise<AgentResult> => {
        const sessionId = task.resume ?? `${name}-${++seq}`;
        events.push({ type: 'session', sessionId });
        await held;
        const text = aborted ? 'Stopped.' : `Ran in ${task.cwd}`;
        events.push({ type: 'message', text });
        return aborted
          ? { status: 'aborted', ok: false, exitCode: null, signal: null, sessionId, text }
          : { status: 'completed', ok: true, exitCode: 0, signal: null, sessionId, text };
      })();
      return {
        result: done,
        abort() {
          aborted = true;
          let_go?.();
        },
        ...(options.steer
          ? {
              async steer(text: string) {
                steered.push(text);
              },
            }
          : {}),
        async *[Symbol.asyncIterator]() {
          const result = await done;
          yield* events;
          yield { type: 'done', result };
        },
      };
    },
  };
  return { driver, steered, release: () => let_go?.() };
}

it('composes in one card: two buttons, the agent chip, the project line of a new chat, and files without text', async () => {
  const browser = await chromium.launch();
  // Outside os.tmpdir() so sessions here are not treated as scratch runs.
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = realpathSync(mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'composer-ui-')));
  const knights = join(root, 'src', 'knights');
  mkdirSync(knights, { recursive: true });
  writeFileSync(join(knights, 'README.md'), '# knights\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: knights });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
  const stop = new AbortController();
  const bakery = join(root, 'src', 'bakery');
  mkdirSync(bakery, { recursive: true });
  const helper = agent('helper', {
    steer: true,
    sessions: [
      {
        source: 'helper',
        agent: 'helper',
        id: 'knights-1',
        where: 'local',
        cwd: knights,
        title: 'Shield wall',
        state: 'waiting',
        updatedAt: Date.now() - 60_000,
      },
    ],
  });
  const backup = agent('backup');

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
      argv: ['ui', '--home', '--no-artifacts'],
      cwd: knights,
      env,
      agents: [helper.driver, backup.driver],
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
    // What the page asks the server to do.
    const commands: Array<Record<string, unknown>> = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/command')
        commands.push(request.postDataJSON() as Record<string, unknown>);
    });
    await page.goto(opened!);

    const card = page.locator('.gc-card');
    const message = card.getByRole('combobox', { name: 'Message' });
    const submit = card.locator('.gc-submit');
    const stopButton = card.getByRole('button', { name: 'Stop', exact: true });
    const log = page.getByRole('log');
    const focused = () => message.evaluate((element) => element === document.activeElement);

    // A new chat: the composer is there and focused, with the line that says where it starts.
    await message.waitFor();
    await vi.waitFor(async () => expect(await focused()).toBe(true));
    const starts = card.locator('.gc-composer-header');
    await starts.getByText('Starts in').waitFor();
    const project = starts.getByRole('button', { name: /^Starts in/ });
    await vi.waitFor(async () => expect(await project.textContent()).toContain('Home folder'));
    // In a narrow window the popovers stay inside it, with their buttons where they can be clicked.
    await page.setViewportSize({ width: 430, height: 800 });
    const inside = async (locator: ReturnType<typeof page.locator>) => {
      const box = (await locator.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(430);
    };
    await project.click();
    const narrowProjects = card.getByRole('dialog', { name: 'Project' });
    await inside(narrowProjects);
    await inside(narrowProjects.getByRole('button', { name: 'Open' }));
    // A long path that is no folder, with no place to break: the complaint wraps, and the path's
    // buttons stay inside the popover, also with the host's Choose… beside Open (added here, as
    // this server has no folder dialog).
    await narrowProjects.getByLabel('Folder path').fill(`/${'x'.repeat(200)}`);
    await narrowProjects.getByLabel('Folder path').press('Enter');
    await narrowProjects.getByRole('alert').waitFor();
    const overflow = () =>
      narrowProjects.evaluate((dialog) => {
        const right = dialog.getBoundingClientRect().right;
        return Array.from(dialog.querySelectorAll('.starts-path .btn'), (button) =>
          Math.round(button.getBoundingClientRect().right - right),
        );
      });
    expect((await overflow()).every((past) => past <= 0)).toBe(true);
    await narrowProjects.evaluate((dialog) => {
      const choose = document.createElement('button');
      choose.className = 'btn';
      choose.textContent = 'Choose…';
      dialog.querySelector('.starts-path')!.append(choose);
    });
    expect(await overflow()).toHaveLength(2);
    expect((await overflow()).every((past) => past <= 0)).toBe(true);
    await narrowProjects.evaluate((dialog) => dialog.querySelector('.starts-path .btn:last-child')!.remove());
    await inside(narrowProjects.getByRole('button', { name: 'Open' }));
    await narrowProjects.getByLabel('Folder path').fill('');
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: /^Agent: helper/ }).click();
    await inside(card.getByRole('dialog', { name: 'Agent, model, effort and fallback' }));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    await message.focus();
    // Nothing to send yet; no Stop while nothing runs; the plan's limits are not in the composer.
    expect(await submit.textContent()).toBe('Send↵');
    expect(await submit.isDisabled()).toBe(true);
    expect(await submit.getAttribute('title')).toBe('Type a message or attach a file');
    expect(await stopButton.count()).toBe(0);
    expect(await page.locator('.gc-composer .chip').count()).toBe(0);
    expect(await page.locator('.gc-under').count()).toBe(0);

    // One chip for what the prompt runs with: agent, model, effort and fallback in its popover.
    const chip = card.getByRole('button', { name: /^Agent: helper/ });
    await chip.click();
    const pop = card.getByRole('dialog', { name: 'Agent, model, effort and fallback' });
    const agents = pop.getByRole('radiogroup', { name: 'Agent' });
    expect(await agents.getByRole('radio', { name: /helper/ }).getAttribute('aria-checked')).toBe('true');
    expect(await agents.getByRole('radio', { name: /backup/ }).getAttribute('aria-checked')).toBe('false');
    await pop.getByLabel('Model').fill('model-9');
    await pop.getByLabel('Model').press('Enter');
    await vi.waitFor(async () => expect(await chip.textContent()).toContain('model-9'));
    await pop.getByRole('group', { name: 'Effort' }).getByRole('button', { name: 'high' }).click();
    await vi.waitFor(async () =>
      expect(await pop.getByRole('button', { name: 'high' }).getAttribute('aria-pressed')).toBe('true'),
    );
    await pop.getByLabel('Fallback when it runs out').fill('backup');
    await pop.getByLabel('Fallback when it runs out').press('Enter');
    await log.getByText(/Failover/).waitFor();
    // Escape closes the popover and nothing else; the focus is back on the chip.
    await page.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });
    expect(await chip.evaluate((element) => element === document.activeElement)).toBe(true);
    await chip.click();
    expect(await pop.getByLabel('Fallback when it runs out').inputValue()).toBe('backup');
    // A click outside closes it too.
    await message.click();
    await pop.waitFor({ state: 'detached' });
    // A field that click leaves keeps what was typed in it.
    await chip.click();
    await pop.getByLabel('Model').fill('model-10');
    await message.click();
    await pop.waitFor({ state: 'detached' });
    await vi.waitFor(async () => expect(await chip.textContent()).toContain('model-10'));
    await chip.click();
    await pop.getByLabel('Fallback when it runs out').fill('');
    await message.click();
    await pop.waitFor({ state: 'detached' });
    await log.getByText('Failover off.').waitFor();

    // Plan is a toggle; the permission switch names both states and covers the chat.
    const plan = card.getByRole('button', { name: 'Plan', exact: true });
    await plan.click();
    await vi.waitFor(async () => expect(await plan.getAttribute('aria-pressed')).toBe('true'));
    await plan.click();
    await vi.waitFor(async () => expect(await plan.getAttribute('aria-pressed')).toBe('false'));
    const permission = card.getByRole('group', { name: 'Permission requests in this chat' });
    const ask = permission.getByRole('button', { name: 'Ask first' });
    const auto = permission.getByRole('button', { name: 'Auto-approve all' });
    expect(await ask.getAttribute('aria-pressed')).toBe('true');
    await auto.click();
    await vi.waitFor(async () => expect(await auto.getAttribute('aria-pressed')).toBe('true'));
    await ask.click();
    await vi.waitFor(async () => expect(await ask.getAttribute('aria-pressed')).toBe('true'));
    // Typed, `/auto on` and the bare toggle go the same way.
    await message.fill('/auto on');
    await message.press('Enter');
    await vi.waitFor(async () => expect(await auto.getAttribute('aria-pressed')).toBe('true'));
    await message.fill('/auto');
    await message.press('Enter');
    await vi.waitFor(async () => expect(await ask.getAttribute('aria-pressed')).toBe('true'));
    // Each names the conversation shown when it was clicked: the server refuses it in another one.
    expect(commands.filter((command) => command.type === 'auto')).toEqual([
      { type: 'auto', on: true, generation: expect.any(Number) },
      { type: 'auto', on: false, generation: expect.any(Number) },
      { type: 'auto', on: true, generation: expect.any(Number) },
      { type: 'auto', on: false, generation: expect.any(Number) },
    ]);
    expect(commands.filter((command) => /^\/auto/.test(String(command.text ?? '')))).toEqual([]);

    // A field marked waiting (aria-disabled) still takes what is typed: Playwright's fill does not.
    const retype = async (text: string) => {
      await message.focus();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type(text);
    };
    // The project line: a folder by its path. There is no worktree choice in it.
    expect(await starts.getByRole('button', { name: 'New worktree' }).count()).toBe(0);
    await project.click();
    const projects = card.getByRole('dialog', { name: 'Project' });
    expect(await projects.getByRole('radio', { name: /Home folder/ }).getAttribute('aria-checked')).toBe('true');
    expect(await projects.getByRole('button', { name: 'Choose…' }).count()).toBe(0);
    // A typed folder found only after the chat stayed where it is (its folder picked again, `/clear`)
    // does not move it.
    for (const stay of ['picked again', '/clear']) {
      let letGo!: () => void;
      const held = new Promise<void>((resolve) => (letGo = resolve));
      await page.route(/\/api\/folder\?path=/, async (route) => {
        await held;
        await route.continue();
      });
      await message.fill('Plan the siege');
      if (!(await projects.count())) await project.click();
      await projects.getByLabel('Folder path').fill(knights);
      await projects.getByLabel('Folder path').press('Enter');
      // While the folder is looked up a prompt waits: it may be meant for that folder.
      await message.press('Enter');
      expect(await message.inputValue()).toBe('Plan the siege');
      expect(await message.getAttribute('aria-disabled')).toBe('true');
      if (stay === '/clear') {
        await retype('/clear');
        await message.press('Enter');
      } else await projects.getByRole('radio', { name: /Home folder/ }).click();
      // The later choice decides: the field is given back before the old lookup answers.
      await vi.waitFor(async () => expect(await message.getAttribute('aria-disabled')).toBeNull());
      const looked = page.waitForResponse(/\/api\/folder\?path=/);
      letGo();
      await looked;
      await page.waitForTimeout(300);
      await page.unroute(/\/api\/folder\?path=/);
      expect(commands.filter((command) => command.type === 'project-chat')).toEqual([]);
      expect(await project.textContent()).toContain('Home folder');
      await vi.waitFor(async () => expect(await message.getAttribute('aria-disabled')).toBeNull());
      if (stay !== '/clear') expect(await message.inputValue()).toBe('Plan the siege');
    }
    expect(commands.filter((command) => command.text === 'Plan the siege')).toEqual([]);
    // The chat in the folder is asked for and the server has not answered: `/clear` and `/new` go
    // all the same, after it, and the window stays where they leave it. A prompt still waits.
    for (const move of ['/clear', '/new']) {
      let letGo!: () => void;
      const held = new Promise<void>((resolve) => (letGo = resolve));
      let asked = false;
      await page.route('**/api/command*', async (route) => {
        if ((route.request().postDataJSON() as { type?: string }).type !== 'project-chat') return route.fallback();
        asked = true;
        await held;
        await route.fallback();
      });
      const before = commands.length;
      await message.fill('Plan the siege');
      if (!(await projects.count())) await project.click();
      await projects.getByLabel('Folder path').fill(knights);
      await projects.getByLabel('Folder path').press('Enter');
      await vi.waitFor(() => expect(asked).toBe(true));
      await message.press('Enter');
      expect(await message.inputValue()).toBe('Plan the siege');
      expect(await message.getAttribute('aria-disabled')).toBe('true');
      await retype(move);
      await message.press('Enter');
      const moves = () =>
        commands
          .slice(before)
          .filter((command) => ['project-chat', 'home-chat', 'stay-chat', 'submit'].includes(String(command.type)))
          .map((command) => (command.type === 'submit' ? command.text : command.type));
      await vi.waitFor(() =>
        expect(moves()).toEqual(
          move === '/clear' ? ['project-chat', 'home-chat'] : ['project-chat', 'stay-chat', '/new'],
        ),
      );
      const answered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/command' &&
          (response.request().postDataJSON() as { type?: string }).type === 'project-chat',
      );
      letGo();
      expect(await (await answered).json()).toMatchObject({ ok: false });
      await page.waitForTimeout(300);
      await page.unroute('**/api/command*');
      expect(await project.textContent()).toContain('Home folder');
      await vi.waitFor(async () => expect(await message.getAttribute('aria-disabled')).toBeNull());
    }
    expect(commands.filter((command) => command.text === 'Plan the siege')).toEqual([]);
    if (!(await projects.count())) await project.click();
    await projects.getByLabel('Folder path').fill(join(root, 'nowhere'));
    await projects.getByLabel('Folder path').press('Enter');
    await projects
      .getByRole('alert')
      .getByText(/No folder/)
      .waitFor();
    // A folder nobody worked in is not opened by typing its path.
    await projects.getByLabel('Folder path').fill(bakery);
    await projects.getByLabel('Folder path').press('Enter');
    await projects
      .getByRole('alert')
      .getByText(/Could not start in .*bakery/)
      .waitFor();
    await projects.getByLabel('Folder path').fill(knights);
    await projects.getByRole('button', { name: 'Open' }).click();
    // Closed once the chat runs there; a refusal would stay open and say why.
    await vi.waitFor(
      async () =>
        expect({
          open: await projects.count(),
          said: await projects.getByRole('alert').allTextContents(),
          chat: await log.locator('.gc-notice').allTextContents(),
        }).toEqual({ open: 0, said: [], chat: expect.any(Array) }),
      { timeout: 15_000, interval: 100 },
    );
    await vi.waitFor(async () => expect(await project.textContent()).toContain('knights'));
    await vi.waitFor(async () => expect(await project.textContent()).toContain('main'));
    await vi.waitFor(async () => expect(await focused()).toBe(true));
    expect(await starts.locator('.starts-where').textContent()).toBe(knights);

    // The first prompt runs in the folder. While it runs, Stop sits beside the submit
    // button, which says what Enter does for this agent: it takes input mid-turn, so Steer.
    await message.fill('hold the gate');
    expect(await submit.textContent()).toBe('Send↵');
    await message.press('Enter');
    await stopButton.waitFor();
    await vi.waitFor(async () => expect(await submit.textContent()).toBe('Steer↵'));
    expect(await starts.count()).toBe(0);
    const row = card.locator('.gc-card-row');
    const sameLine = async () => {
      const a = await stopButton.boundingBox();
      const b = await submit.boundingBox();
      return !!a && !!b && Math.abs(a.y - b.y) < 2 && a.x < b.x;
    };
    expect(await sameLine()).toBe(true);
    await message.fill('and the tower');
    await message.press('Enter');
    await vi.waitFor(() => expect(helper.steered).toEqual(['and the tower']));
    await log.getByRole('status', { name: /Your message: (Delivered|Sent to helper)/ }).waitFor({ timeout: 4000 });
    // The agent stays as it is while its turn runs.
    await chip.click();
    expect(await agents.getByRole('radio', { name: /backup/ }).isDisabled()).toBe(true);
    await page.keyboard.press('Escape');
    helper.release();
    const ran = log.getByText(/^Ran in /);
    await ran.waitFor();
    expect(await ran.textContent()).toContain(knights);
    await stopButton.waitFor({ state: 'detached' });
    expect(await submit.textContent()).toBe('Send↵');

    // An agent that cannot take input mid-turn: Enter queues, and Stop is still its own button.
    await chip.click();
    await agents.getByRole('radio', { name: /backup/ }).click();
    await card.getByRole('button', { name: /^Agent: backup/ }).waitFor();
    await message.fill('hold again');
    await message.press('Enter');
    await stopButton.waitFor();
    await vi.waitFor(async () => expect(await submit.textContent()).toBe('Queue↵'));
    expect(await submit.getAttribute('data-action')).toBe('queue');
    await message.fill('then this');
    await message.press('Enter');
    await page.locator('.gc-queued').getByText('then this').waitFor();
    // ⌘. (Ctrl+. elsewhere) stops the turn from anywhere, and drops what was queued.
    await page.keyboard.press('ControlOrMeta+.');
    await stopButton.waitFor({ state: 'detached' });
    expect(await page.locator('.gc-queued').count()).toBe(0);
    expect(await submit.textContent()).toBe('Send↵');

    // Files send without text.
    await card.locator('input[type=file]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('the plan'),
    });
    await card.getByText('notes.txt').waitFor();
    expect(await message.inputValue()).toBe('');
    expect(await submit.isDisabled()).toBe(false);
    await submit.click();
    await log.locator('.gc-prompt .sent-files').getByText('notes.txt').waitFor();
    await vi.waitFor(async () => expect(await log.getByText(/^Ran in /).count()).toBe(2));

    // A narrow window keeps Stop and the submit button on one line: the switch shows one state.
    const narrow = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const small = await narrow.newPage();
    small.on('pageerror', (error) => errors.push(error.message));
    await small.goto(opened!);
    const smallCard = small.locator('.gc-card');
    await smallCard.getByRole('button', { name: 'Auto-approve all' }).waitFor();
    expect(await smallCard.getByRole('button', { name: 'Ask first' }).isVisible()).toBe(false);
    await smallCard.getByRole('combobox', { name: 'Message' }).fill('hold once more');
    await smallCard.getByRole('combobox', { name: 'Message' }).press('Enter');
    await smallCard.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    expect(
      await smallCard.locator('.gc-card-row').evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThan(48);
    await smallCard.getByRole('button', { name: 'Stop', exact: true }).click();
    await smallCard.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached' });
    expect(await row.count()).toBe(1);

    expect(errors).toEqual([]);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
