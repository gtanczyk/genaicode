import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

it('says while a turn runs that other chats open when it finishes, and offers to stop it', async () => {
  const browser = await chromium.launch();
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'switch-held-'));
  const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
  const stop = new AbortController();
  const made: SessionInfo[] = [];
  // Turns whose prompt says "slow" run until released or stopped.
  const slow: Array<() => void> = [];
  let aborted = 0;
  let seq = 0;
  const helper: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true, models: ['fast', 'smart'] },
    sessions: {
      name: 'helper',
      where: 'local',
      list: async () => [...made],
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
      const id = task.resume ?? `sess-${++seq}`;
      // A model it does not have fails the turn, as CLIs do, before any session starts.
      const rejected = task.model === 'bogus';
      if (!rejected && !made.some((session) => session.id === id)) {
        made.push({
          source: 'helper',
          agent: 'helper',
          id,
          where: 'local',
          cwd: task.cwd,
          title: task.prompt,
          state: 'waiting',
          model: task.model ?? 'fast',
          updatedAt: Date.now(),
        });
      }
      let finish!: (status: 'completed' | 'aborted') => void;
      const ended = new Promise<'completed' | 'aborted'>((resolve) => (finish = resolve));
      if (/slow/.test(task.prompt)) slow.push(() => finish('completed'));
      else finish(rejected ? 'aborted' : 'completed');
      const queue: AgentEvent[] = rejected ? [] : [{ type: 'session', sessionId: id }];
      const result = ended.then(
        (status): AgentResult =>
          rejected
            ? { status: 'failed', ok: false, exitCode: 1, signal: null, error: 'Unknown model: bogus' }
            : {
                status,
                ok: status === 'completed',
                exitCode: status === 'completed' ? 0 : null,
                signal: null,
                sessionId: id,
                text: status === 'completed' ? 'Finished.' : '',
              },
      );
      return {
        result,
        abort() {
          aborted += 1;
          finish('aborted');
        },
        async *[Symbol.asyncIterator]() {
          yield* queue;
          const done = await result;
          if (done.ok) yield { type: 'message', text: 'Finished.' };
          yield { type: 'done', result: done };
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
    const chats = side.getByRole('navigation', { name: 'Chats' });
    const composer = page.locator('.gc-composer textarea');
    const title = page.locator('header.topbar h1');
    const newChat = side.getByRole('button', { name: 'New chat', exact: true });
    const held = page.getByRole('status', { name: 'Another chat waits' });

    await composer.fill('Count the sheep');
    await composer.press('Enter');
    const sheep = chats.getByRole('button', { name: /Count the sheep/ });
    await sheep.waitFor();
    await page.getByRole('log').getByText('Finished.').waitFor();

    // A second chat with a turn that keeps running.
    await newChat.click();
    await vi.waitFor(async () => expect(await title.textContent()).toBe('New chat'));
    await composer.fill('Paint the fence, slow');
    await composer.press('Enter');
    await vi.waitFor(() => expect(slow.length).toBe(1));
    const fence = chats.getByRole('button', { name: /Paint the fence/ });
    await fence.waitFor();

    // Other chats and New chat look unavailable and say when they open; the running one does not.
    await vi.waitFor(async () => expect(await sheep.getAttribute('aria-disabled')).toBe('true'));
    expect(await sheep.getAttribute('title')).toBe('Opens when “Paint the fence, slow” finishes');
    expect(await newChat.getAttribute('aria-disabled')).toBe('true');
    expect(await fence.getAttribute('aria-disabled')).toBeNull();

    // A click says why, and the focus does not jump to the message field.
    await sheep.click({ force: true });
    await held.waitFor();
    expect(await held.textContent()).toContain('A turn is running in “Paint the fence, slow”');
    expect(await composer.evaluate((element) => element === document.activeElement)).toBe(false);
    expect(await title.textContent()).toBe('Paint the fence, slow');

    // Wait: the chat opens once the turn finishes.
    await held.getByRole('button', { name: 'Wait' }).click();
    expect(await held.textContent()).toContain('opens when “Paint the fence, slow” finishes');
    slow.shift()!();
    await vi.waitFor(async () => expect(await title.textContent()).toBe('Count the sheep'));
    await held.waitFor({ state: 'detached' });
    expect(await newChat.getAttribute('aria-disabled')).toBeNull();

    // ⌘N while a turn runs: Stop and open stops it, then starts the new chat.
    await composer.fill('Shear them, slow');
    await composer.press('Enter');
    await vi.waitFor(() => expect(slow.length).toBe(1));
    await vi.waitFor(async () => expect(await newChat.getAttribute('aria-disabled')).toBe('true'));
    await page.keyboard.press('ControlOrMeta+n');
    await held.waitFor();
    expect(await held.textContent()).toContain('open a new chat now');
    expect(await title.textContent()).toBe('Count the sheep');
    await held.getByRole('button', { name: 'Stop and open' }).click();
    await vi.waitFor(() => expect(aborted).toBe(1));
    await vi.waitFor(async () => expect(await title.textContent()).toBe('New chat'));
    await held.waitFor({ state: 'detached' });

    // The Model field suggests what the agent ran and the names it knows, and still takes any name.
    const chip = page.getByRole('button', { name: /^Agent: helper/ });
    await chip.click();
    const model = page.getByRole('combobox', { name: 'Model' });
    await model.waitFor();
    await model.click();
    const options = () =>
      page
        .locator('#agent-models [role="option"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-value') ?? ''));
    expect(await options()).toEqual(['', 'fast', 'smart']);
    expect(await page.locator('#agent-models [role="option"]').nth(1).textContent()).toMatch(
      /ran in \d+ sessions?, last today/,
    );
    await model.fill('bogus');
    await model.press('Enter');
    await model.click();
    await vi.waitFor(async () => expect(await options()).toEqual(['', 'bogus', 'fast', 'smart']));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // A name the agent does not take: said with the model and the agent, and one click back to its default.
    await composer.fill('Count again');
    await composer.press('Enter');
    const rejected = page.getByRole('region', { name: 'Model not accepted' });
    await rejected.waitFor();
    expect(await rejected.textContent()).toContain('helper did not accept the model “bogus”');
    await rejected.getByRole('button', { name: "Use helper's default and retry" }).click();
    await rejected.waitFor({ state: 'detached' });
    await vi.waitFor(async () => expect(await page.getByRole('log').getByText('Finished.').count()).toBeGreaterThan(0));
    await chip.click();
    await model.click();
    await vi.waitFor(async () => expect(await options()).toEqual(['', 'fast', 'smart']));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
