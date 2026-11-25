import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';
import { THEME_KEY } from './web/theme.js';

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

it('opens Settings from the sidebar, changes settings, and goes back to the chat on Escape', async () => {
  const browser = await chromium.launch();
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'settings-ui-'));
  const project = join(root, 'app');
  mkdirSync(project);
  const stop = new AbortController();
  const helper: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true },
    run() {
      const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Done.' };
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
          yield { type: 'message', text: 'Done.' };
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
        version: '3.4.0',
        stderr: new PassThrough().resume(),
        openUrl(url) {
          opened = url;
        },
        clientScript,
      });
    running = main({
      argv: ['ui', '--no-artifacts'],
      cwd: project,
      env: { HOME: root, GENAICODE_HOME: join(root, '.genaicode') },
      agents: [helper],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());

    // The system says light; what the person picks in Settings wins over it.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(opened!);

    const side = page.getByRole('complementary', { name: 'Sidebar' });
    const topbar = page.locator('header.topbar');
    const composer = page.locator('.gc-composer textarea');
    const settings = page.getByRole('main', { name: 'Settings' });
    const sections = settings.getByRole('navigation', { name: 'Settings sections' });
    const entry = side.getByRole('button', { name: 'Settings', exact: true });
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const themeOf = (selector: string) =>
      page.evaluate((one) => {
        // The page's choice is `data-gc-theme` on <html>; the chat's own is its `theme` prop.
        const found = document.querySelector<HTMLElement>(one);
        return (one === 'html' ? found?.dataset.gcTheme : found?.dataset.theme) ?? null;
      }, selector);

    await composer.waitFor();
    await composer.fill('a draft that stays');
    expect(await settings.count()).toBe(0);
    const light = await background();

    // The page takes the chat's place: the sidebar stays and marks it, the top bar names it.
    await entry.click();
    await settings.waitFor();
    expect(await entry.getAttribute('aria-current')).toBe('page');
    expect(await entry.getAttribute('aria-haspopup')).toBeNull();
    expect(await topbar.locator('h1').textContent()).toBe('Settings');
    expect(await page.locator('.workspace').isVisible()).toBe(false);
    expect(await side.isVisible()).toBe(true);
    expect(await sections.getByRole('button', { name: 'General', exact: true }).getAttribute('aria-current')).toBe(
      'true',
    );
    // The old menu and its dialogs are gone.
    expect(await page.getByRole('menu', { name: 'Settings' }).count()).toBe(0);

    // Theme: follows the system until chosen, then applies at once, to the page and to the chat.
    const theme = settings.getByRole('group', { name: 'Theme' });
    expect(await theme.getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe('true');
    expect(await themeOf('html')).toBeNull();
    await theme.getByRole('button', { name: 'Dark' }).click();
    expect(await theme.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(await themeOf('html')).toBe('dark');
    expect(await themeOf('.gc-chat')).toBe('dark');
    const dark = await background();
    expect(dark).not.toBe(light);
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('dark');

    // Bark: the server's own setting (`/bark`), changed with the switch.
    const bark = settings.getByRole('switch', { name: 'Bark when an agent needs you' });
    expect(await bark.getAttribute('aria-checked')).toBe('true');
    await bark.click();
    await vi.waitFor(async () => expect(await bark.getAttribute('aria-checked')).toBe('false'));

    // The sections: the agents this machine has, and the app itself.
    await sections.getByRole('button', { name: 'Agents', exact: true }).click();
    const agents = settings.getByRole('region', { name: 'Agents' });
    await agents.getByRole('button', { name: 'Check again' }).waitFor();
    await sections.getByRole('button', { name: 'About and updates', exact: true }).click();
    const about = settings.getByRole('region', { name: 'About and updates' });
    expect(await about.getByRole('link', { name: 'Get help' }).count()).toBe(1);

    await about.getByRole('button', { name: 'Read' }).click();
    const dialog = page.getByRole('dialog', { name: 'What’s new in Genaicode 3.4.0' });
    await dialog.getByText('The new window layout', { exact: false }).waitFor();
    const change = dialog
      .locator('li')
      .filter({ has: page.getByText('Read file changes and published artifacts in the work panel.', { exact: true }) });
    const detail = change.getByText('Artifacts replaces', { exact: false });
    expect(await detail.isVisible()).toBe(false);
    await change.locator('summary').click();
    await detail.waitFor();
    expect(await dialog.getByText('workChanges', { exact: false }).count()).toBe(0);
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Escape goes back to the chat: the draft is as it was left, and the next key goes to it.
    await page.keyboard.press('Escape');
    await settings.waitFor({ state: 'detached' });
    expect(await page.locator('.workspace').isVisible()).toBe(true);
    expect(await entry.getAttribute('aria-current')).toBeNull();
    expect(await composer.inputValue()).toBe('a draft that stays');
    await vi.waitFor(async () => expect(await composer.evaluate((one) => one === document.activeElement)).toBe(true));
    // The bark was turned off in the chat, as `/bark off` does.
    await page.getByText('The wolf is quiet.').waitFor();

    // ⌘, opens it again; the back arrow of the top bar leaves it too.
    await page.keyboard.press('ControlOrMeta+,');
    await settings.waitFor();
    expect(await bark.getAttribute('aria-checked')).toBe('false');
    await topbar.getByRole('button', { name: 'Chat', exact: true }).click();
    await settings.waitFor({ state: 'detached' });

    // The theme is kept for the next visit; choosing System follows the system again.
    await page.reload();
    await composer.waitFor();
    expect(await themeOf('html')).toBe('dark');
    expect(await background()).toBe(dark);
    await entry.click();
    await theme.getByRole('button', { name: 'System' }).click();
    expect(await themeOf('html')).toBeNull();
    expect(await themeOf('.gc-chat')).toBeNull();
    expect(await background()).toBe(light);
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBeNull();

    // Light forced over a dark system.
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await background()).toBe(dark);
    await theme.getByRole('button', { name: 'Light' }).click();
    expect(await background()).toBe(light);

    expect(errors).toEqual([]);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
