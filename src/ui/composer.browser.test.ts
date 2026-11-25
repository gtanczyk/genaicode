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

    // Plan is a toggle; the permission switch names both states and covers the session.
    const plan = card.getByRole('button', { name: 'Plan', exact: true });
    await plan.click();
    await vi.waitFor(async () => expect(await plan.getAttribute('aria-pressed')).toBe('true'));
    await plan.click();
    await vi.waitFor(async () => expect(await plan.getAttribute('aria-pressed')).toBe('false'));
    const permission = card.getByRole('group', { name: 'Permission requests in this session' });
    const ask = permission.getByRole('button', { name: 'Ask first' });
    const auto = permission.getByRole('button', { name: 'Auto-approve all' });
    expect(await ask.getAttribute('aria-pressed')).toBe('true');
    await auto.click();
    await vi.waitFor(async () => expect(await auto.getAttribute('aria-pressed')).toBe('true'));
    await ask.click();
    await vi.waitFor(async () => expect(await ask.getAttribute('aria-pressed')).toBe('true'));

    // The project line: a folder by its path, then a new worktree of it for this chat.
    const worktree = starts.getByRole('button', { name: 'New worktree' });
    expect(await worktree.isDisabled()).toBe(true);
    await project.click();
    const projects = card.getByRole('dialog', { name: 'Project' });
    expect(await projects.getByRole('radio', { name: /Home folder/ }).getAttribute('aria-checked')).toBe('true');
    expect(await projects.getByRole('button', { name: 'Choose…' }).count()).toBe(0);
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
    await vi.waitFor(async () => expect(await worktree.isDisabled()).toBe(false));
    await worktree.click();
    expect(await starts.locator('.starts-where').textContent()).toBe('a copy of main, merged when you say');

    // The first prompt makes the worktree and runs there. While it runs, Stop sits beside the submit
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
    await log.getByRole('status', { name: /Your message: (Seen by|Sent to) helper/ }).waitFor({ timeout: 4000 });
    // The agent stays as it is while its turn runs.
    await chip.click();
    expect(await agents.getByRole('radio', { name: /backup/ }).isDisabled()).toBe(true);
    await page.keyboard.press('Escape');
    helper.release();
    const ran = log.getByText(/Ran in .*\.genaicode[\\/]chats[\\/]knights-[0-9a-f]{8}$/);
    await ran.waitFor();
    expect(await ran.textContent()).toContain(join(knights, '.genaicode', 'chats', 'knights-'));
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
