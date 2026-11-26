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

it('runs two chats independently, restores drafts, and queues a third at the configured limit', async () => {
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
      argv: ['ui', '--sessions', '--home', '--no-artifacts', '--max-chats', '2'],
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
    const fence = chats.getByRole('button', { name: /^(?!Stop ).*Paint the fence/ });
    await fence.waitFor();

    await composer.fill('Draft for the fence');
    const fileInput = page.locator('.gc-composer input[type=file]').first();
    await fileInput.setInputFiles({ name: 'fence.txt', mimeType: 'text/plain', buffer: Buffer.from('fence') });
    await sheep.click();
    await vi.waitFor(async () => expect(await title.textContent()).toBe('Count the sheep'));
    expect(await composer.inputValue()).toBe('');
    await composer.fill('Shear them, slow');
    await composer.press('Enter');
    await vi.waitFor(() => expect(slow).toHaveLength(2));
    await fence.first().click();
    await vi.waitFor(async () => expect(await composer.inputValue()).toBe('Draft for the fence'));
    await page.getByText('fence.txt', { exact: true }).waitFor();
    expect(aborted).toBe(0);

    await newChat.click();
    await vi.waitFor(async () => expect(await title.textContent()).toBe('New chat'));
    await composer.fill('Third prompt');
    await composer.press('Enter');
    await page.getByText(/Waiting for a free slot/).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await vi.waitFor(async () => expect(await composer.inputValue()).toBe('Third prompt'));
    await composer.press('Enter');
    await page.getByText(/Waiting for a free slot/).waitFor();
    slow.shift()!();
    await page.getByRole('log').getByText('Finished.').waitFor();
    expect(aborted).toBe(0);
    slow.shift()!();

    // The Model field suggests what the agent ran and the names it knows, and still takes any name.
    const chip = page.getByRole('button', { name: /^Agent: helper/ });
    await chip.click();
    const model = page.getByRole('combobox', { name: 'Model' });
    await model.waitFor();
    const options = () =>
      page
        .locator('#agent-models option')
        .evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    expect(await options()).toEqual(['fast', 'smart']);
    expect(await page.locator('#agent-models option').first().getAttribute('label')).toMatch(
      /^ran in \d+ sessions?, last today$/,
    );
    await model.fill('bogus');
    await model.press('Enter');
    await vi.waitFor(async () => expect(await options()).toEqual(['bogus', 'fast', 'smart']));
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
    await vi.waitFor(async () => expect(await options()).toEqual(['fast', 'smart']));
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
