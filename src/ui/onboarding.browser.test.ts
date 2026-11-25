import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { BUG_REPORT_URL, SUPPORT_URL } from '../support.js';
import type { AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

function fakeDriver(name: string, command: string, onRun?: () => AgentResult): CodingAgent {
  return {
    name,
    command,
    capabilities: { mcp: true, resume: true },
    run() {
      const result: AgentResult = onRun?.() ?? {
        status: 'completed',
        ok: true,
        exitCode: 0,
        signal: null,
        text: `reply from ${name}`,
      };
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          if (!result.ok && result.error) yield { type: 'error', message: result.error };
          else if (result.text) yield { type: 'message', text: result.text };
          yield { type: 'done', result };
        },
      };
    },
  };
}

function writeScript(dir: string, name: string, body: string) {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

async function bundleClient(): Promise<string> {
  const bundle = await build({
    entryPoints: ['src/ui/web/client.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return bundle.outputFiles[0].text;
}

it('shows onboarding with no agents, moves through signed-out to Ready on Check again, then opens home', async () => {
  const browser = await chromium.launch();
  const root = mkdtempSync(join(tmpdir(), 'genaicode-onboard-browser-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const stop = new AbortController();
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
      argv: ['ui', '--sessions', '--no-artifacts'],
      cwd: root,
      env: { PATH: bin, HOME: root, GENAICODE_HOME: root },
      agents: [fakeDriver('claude', 'claude'), fakeDriver('codex', 'codex')],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());
    const page = await browser.newPage();
    const secondTab = await browser.newPage();
    await page.goto(opened!);
    await secondTab.goto(opened!);

    // Onboarding screen is shown and prompt box is disabled with the setup hint in both tabs.
    await page.getByRole('heading', { name: 'Connect a coding agent' }).waitFor();
    await secondTab.getByRole('heading', { name: 'Connect a coding agent' }).waitFor();
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const support = page.getByRole('menu', { name: 'Help' });
    expect(await support.getByRole('menuitem', { name: 'Get help' }).getAttribute('href')).toBe(SUPPORT_URL);
    expect(await support.getByRole('menuitem', { name: 'Report a bug' }).getAttribute('href')).toBe(BUG_REPORT_URL);
    await page.keyboard.press('Escape');
    const claudeCard = page.locator('li[data-agent="claude"]');
    await claudeCard.waitFor();
    expect(await claudeCard.getAttribute('data-state')).toBe('missing');
    expect(await claudeCard.textContent()).toContain('Not installed');
    expect(await claudeCard.textContent()).toContain('npm i -g @anthropic-ai/claude-code');
    const messageBox = page.getByRole('combobox', { name: 'Message' });
    expect(await messageBox.getAttribute('placeholder')).toBe('Connect an agent to start');
    expect(await messageBox.isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Send' }).isDisabled()).toBe(true);

    // Session view still works while in setup state.
    await page.getByRole('button', { name: 'All sessions', exact: true }).click();
    await page.locator('main.sessions').waitFor();
    await page.locator('header.topbar').getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('heading', { name: 'Connect a coding agent' }).waitFor();

    // Fake signed-out claude appears on PATH -> Check again -> Installed, not signed in.
    writeScript(
      bin,
      'claude',
      `if [ "$1" = "--version" ]; then echo "2.1.330"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn":false,"authMethod":"none"}'; exit 1; fi`,
    );
    await page.getByRole('button', { name: 'Check again' }).click();
    await page.locator('li[data-agent="claude"][data-state="signed-out"]').waitFor();
    expect(await claudeCard.textContent()).toContain('Installed, not signed in');
    expect(await claudeCard.textContent()).toContain('/login');
    expect(await page.getByRole('button', { name: 'Send' }).isDisabled()).toBe(true);

    // Fake claude signs in -> Check again -> Ready -> collapses into normal home.
    writeScript(
      bin,
      'claude',
      `if [ "$1" = "--version" ]; then echo "2.1.330"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}'; exit 0; fi`,
    );
    await page.getByRole('button', { name: 'Check again' }).click();
    await page.getByRole('heading', { name: 'What should claude work on?' }).waitFor();
    expect(await messageBox.isDisabled()).toBe(false);
    await messageBox.fill('hello');
    expect(await page.getByRole('button', { name: 'Send' }).isDisabled()).toBe(false);
    // The second tab also exits setup via SSE without needing its own Check again click.
    await secondTab.getByRole('heading', { name: 'What should claude work on?' }).waitFor();
    expect(await secondTab.getByRole('combobox', { name: 'Message' }).isDisabled()).toBe(false);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it('shows agent picker states and renders an auth error on first prompt as a sign-in card', async () => {
  const browser = await chromium.launch();
  const root = mkdtempSync(join(tmpdir(), 'genaicode-picker-browser-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeScript(
    bin,
    'claude',
    `if [ "$1" = "--version" ]; then echo "2.1.330"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}'; exit 0; fi`,
  );
  writeScript(
    bin,
    'codex',
    `if [ "$1" = "--version" ]; then echo "codex-cli 0.170.0"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Not logged in" >&2; exit 1; fi`,
  );
  writeScript(bin, 'gemini', `if [ "$1" = "--version" ]; then echo "0.12.0"; exit 0; fi`);

  const stop = new AbortController();
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
    const geminiAuthFail = fakeDriver('gemini', 'gemini', () => ({
      status: 'failed',
      ok: false,
      exitCode: 1,
      signal: null,
      error: 'RAW CLI STDERR: GEMINI_API_KEY environment variable not set',
      failure: { kind: 'auth' },
    }));
    running = main({
      argv: ['ui', '--no-artifacts'],
      cwd: root,
      env: { PATH: bin, HOME: root, GENAICODE_HOME: root },
      agents: [
        fakeDriver('codex', 'codex'),
        fakeDriver('claude', 'claude'),
        geminiAuthFail,
        fakeDriver('copilot', 'copilot'),
      ],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());
    const page = await browser.newPage();
    await page.goto(opened!);

    // Even though codex came first in agents[], it is signed out so claude (Ready) is auto-selected.
    await page.getByRole('heading', { name: 'What should claude work on?' }).waitFor();

    // Open the agent chip and inspect Ready, signed-out, unknown, and More agents rows.
    await page.getByRole('button', { name: /^Agent:/ }).click();
    const menu = page.getByRole('dialog', { name: 'Agent, model, effort and fallback' });
    await menu.waitFor();
    expect(await menu.getByRole('radio', { name: /Claude Code/ }).count()).toBe(1);
    expect(await menu.getByRole('radio', { name: /Gemini CLI/ }).count()).toBe(1);
    // Codex is signed-out: not a choosable radio item, shows Sign in button.
    expect(await menu.getByRole('radio', { name: /Codex/ }).count()).toBe(0);
    expect(await menu.textContent()).toContain('Not signed in');
    expect(await menu.textContent()).toContain('More agents');
    expect(await menu.getByRole('button', { name: 'Install' }).count()).toBe(1);

    // Clicking Sign in on Codex opens Settings › Agents at Codex, with `codex login`.
    await menu.getByRole('button', { name: 'Sign in' }).click();
    const codexCard = page.getByRole('region', { name: 'Agents' }).locator('[data-agent="codex"]');
    await codexCard.waitFor();
    expect(await codexCard.textContent()).toContain('Installed, not signed in');
    expect(await codexCard.textContent()).toContain('codex login');
    await page.locator('header.topbar').getByRole('button', { name: 'Chat', exact: true }).click();

    // Switch to Gemini CLI (unknown auth) and send a prompt -> auth error becomes a Sign-in card instead of raw stderr.
    await page.getByRole('button', { name: /^Agent:/ }).click();
    await page.getByRole('radio', { name: /Gemini CLI/ }).click();
    await page.getByRole('combobox', { name: 'Message' }).fill('hello gemini');
    await page.getByRole('button', { name: 'Send' }).click();

    const signInCard = page.getByRole('region', { name: 'Sign in to Gemini CLI' });
    await signInCard.waitFor();
    expect(await signInCard.textContent()).toContain('Gemini CLI is not signed in');
    expect(await signInCard.getByRole('button', { name: 'Check again' }).count()).toBe(1);
    expect(await page.locator('.gc-thread').textContent()).not.toContain('RAW CLI STDERR');
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it('keeps onboarding accessible after continuing an existing session during setup', async () => {
  const browser = await chromium.launch();
  const root = mkdtempSync(join(tmpdir(), 'genaicode-setup-history-browser-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const stop = new AbortController();
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
    const projectDir = '/work/billing-app';
    const pastSession = {
      source: 'claude',
      agent: 'claude',
      id: 'past-session-1',
      where: 'local' as const,
      cwd: projectDir,
      title: 'Fix billing retry',
      firstPrompt: 'Check the billing retry loop',
      lastReply: 'Found the missing backoff guard.',
      updatedAt: Date.now() - 60_000,
      state: 'waiting' as const,
    };
    const claudeWithHistory: CodingAgent = {
      ...fakeDriver('claude', 'claude'),
      sessions: {
        name: 'claude',
        where: 'local',
        list: async () => [pastSession],
        read: async () => [
          {
            id: 1,
            agent: 'claude',
            prompt: 'Check the billing retry loop',
            startedAt: Date.now() - 60_000,
            endedAt: Date.now() - 59_000,
            entries: [{ kind: 'text', text: 'Found the missing backoff guard.', streaming: false }],
            result: {
              status: 'completed',
              ok: true,
              exitCode: 0,
              signal: null,
              text: 'Found the missing backoff guard.',
            },
          },
        ],
      },
    };
    running = main({
      argv: ['ui', '--sessions', '--no-artifacts'],
      cwd: projectDir,
      env: { PATH: bin, HOME: root, GENAICODE_HOME: root },
      agents: [claudeWithHistory, fakeDriver('codex', 'codex')],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());
    const page = await browser.newPage();
    await page.goto(opened!);

    await page.getByRole('heading', { name: 'Connect a coding agent' }).waitFor();

    // Open Sessions and continue the previous conversation while still in setup mode.
    await page.getByRole('button', { name: 'All sessions', exact: true }).click();
    await page.locator('main.sessions').waitFor();
    // The sidebar lists it too, under the other agents' sessions: the row meant is the page's.
    const listed = page.locator('main.sessions');
    await listed.getByText('Fix billing retry').waitFor();
    await listed.getByRole('button', { name: 'Continue here' }).click();

    // The loaded turn is visible, and onboarding + Check again remain accessible without clearing history.
    await page.getByText('Found the missing backoff guard.').waitFor();
    const banner = page.getByRole('region', { name: 'Connect a coding agent' });
    await banner.waitFor();
    expect(await banner.textContent()).toContain('Connect an agent to continue this conversation');
    expect(await banner.getByRole('button', { name: 'Check again' }).count()).toBe(1);
    expect(await page.getByRole('combobox', { name: 'Message' }).isDisabled()).toBe(true);

    // The banner opens Settings › Agents, with the commands; the top bar leads back to the conversation.
    await banner.getByRole('button', { name: 'Connect agent' }).click();
    const agents = page.getByRole('main', { name: 'Settings' }).getByRole('region', { name: 'Agents' });
    await agents.waitFor();
    expect(await agents.locator('[data-agent="codex"]').textContent()).toContain('npm i -g @openai/codex');
    // Nothing to switch to yet: no agent can be used.
    expect(await agents.getByRole('button', { name: /^Use / }).count()).toBe(0);
    expect(await page.locator('header.topbar').getByRole('button', { name: 'Chat', exact: true }).count()).toBe(1);

    // Install and sign in to codex -> Check again -> returns directly to the loaded conversation ready to send.
    writeScript(
      bin,
      'codex',
      `if [ "$1" = "--version" ]; then echo "codex-cli 0.170.0"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT" >&2; exit 0; fi`,
    );
    await agents.getByRole('button', { name: 'Check again' }).click();
    await page.getByText('Found the missing backoff guard.').waitFor();
    await agents.waitFor({ state: 'detached' });
    await vi.waitFor(async () => {
      expect(await page.getByRole('combobox', { name: 'Message' }).isDisabled()).toBe(false);
    });
    expect(await page.getByRole('region', { name: 'Connect a coding agent' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: /^Agent:/ }).textContent()).toContain('codex');
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
