import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { BUG_REPORT_URL, SUPPORT_URL } from '../support.js';
import { neutralHomeDir, writeTopics, type SessionInfo } from '../agents/sessions/index.js';
import type { AgentEvent, AgentResult, AgentTask, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

async function callMcp(task: AgentTask, serverName: string, toolName: string, args: Record<string, unknown>) {
  const server = task.mcpServers?.find((candidate) => candidate.name === serverName);
  if (!server || !('url' in server)) throw new Error(`Missing MCP server ${serverName}`);
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }),
  });
  const body = (await response.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  if (body.result.isError) throw new Error(body.result.content[0]!.text);
  return body.result.content[0]!.text;
}

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

it('runs home questions in neutral home, topic New chat in topic dir, and moves via open_project question card', async () => {
  const browser = await chromium.launch();
  // Outside os.tmpdir() so sessions here are not treated as scratch runs.
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'home-ui-'));
  const knights = join(root, 'src', 'knights');
  const projectX = join(root, 'src', 'x');
  mkdirSync(knights, { recursive: true });
  mkdirSync(projectX, { recursive: true });
  writeFileSync(join(knights, 'README.md'), '# Knights\nTactical game.\n');
  writeFileSync(join(projectX, 'notes.txt'), 'Project X notes\n');

  const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
  const homeDir = neutralHomeDir(env);
  const stop = new AbortController();

  await writeTopics(
    {
      topics: [{ id: 't1', name: 'Knights' }],
      sessions: { 'helper:knights-1': 't1' },
    },
    env,
  );

  const existingSession: SessionInfo = {
    source: 'helper',
    agent: 'helper',
    id: 'knights-1',
    where: 'local',
    cwd: knights,
    title: 'Combat turn order',
    state: 'waiting',
    updatedAt: Date.now() - 60_000,
  };

  const runs: Array<{ cwd: string; prompt: string; servers: string[]; resume?: string }> = [];
  let seq = 0;
  const helper: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true },
    sessions: {
      name: 'helper',
      where: 'local',
      list: async () => [existingSession],
      read: async () => [{ id: 1, agent: 'helper', prompt: 'Combat turn order', entries: [], startedAt: 1 }],
    },
    run(task) {
      const servers = (task.mcpServers ?? []).map((server) => server.name);
      runs.push({ cwd: task.cwd, prompt: task.prompt, servers, resume: task.resume });
      const events: AgentEvent[] = [];
      const done = (async (): Promise<AgentResult> => {
        const sid = `sess-${++seq}`;
        events.push({ type: 'session', sessionId: sid });
        let reply = `Ran in ${task.cwd}`;
        if (realpathSync(task.cwd) === realpathSync(projectX)) {
          reply = 'Checked [notes.txt](./notes.txt) in X.';
        } else if (realpathSync(task.cwd) === realpathSync(knights)) {
          reply = 'Updated [README.md](./README.md) in Knights.';
        } else if (task.prompt.includes('w ~/src/x')) {
          reply = await callMcp(task, 'genaicode_project', 'open_project', { path: '~/src/x' });
        } else if (task.prompt.includes('co tam?')) {
          const listing = await callMcp(task, 'sessions', 'sessions_list', {});
          reply = `Status from sessions:\n${listing}`;
        }
        events.push({ type: 'message', text: reply });
        return { status: 'completed', ok: true, exitCode: 0, signal: null, sessionId: sid, text: reply };
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

    const page = await browser.newPage();
    await page.goto(opened!);

    // 1. Home screen: no folder name in header, Knights topic card visible, "co tam?" runs in ~/.genaicode/home.
    await page.getByRole('button', { name: 'New chat in Knights' }).waitFor();
    expect(await page.locator('header.bar .cwd').count()).toBe(0);
    expect(await page.locator('header.bar').textContent()).not.toContain('knights');

    const chat = page.getByRole('log');
    const composer = page.locator('textarea');
    await composer.fill('co tam?');
    const support = page.getByRole('navigation', { name: 'Support' });
    expect(await support.getByRole('link', { name: 'Get help' }).getAttribute('href')).toBe(SUPPORT_URL);
    await page.context().route(BUG_REPORT_URL, (route) => route.fulfill({ body: 'Bug report' }), { times: 1 });
    const [report] = await Promise.all([
      page.waitForEvent('popup'),
      support.getByRole('link', { name: 'Report a bug' }).click(),
    ]);
    expect(report.url()).toBe(BUG_REPORT_URL);
    await report.close();
    expect(await composer.inputValue()).toBe('co tam?');
    await composer.press('Enter');
    await chat.getByText('Status from sessions:').waitFor();
    expect(realpathSync(runs[0]!.cwd)).toBe(realpathSync(homeDir));
    expect(runs[0]!.servers).toContain('sessions');
    expect(runs[0]!.servers).toContain('genaicode_project');

    // 2. Topic card -> New chat runs in the Knights directory without any folder step; file panel follows cwd.
    await page.locator('header.bar').getByRole('button', { name: 'New chat' }).click();
    await page.getByRole('button', { name: 'New chat in Knights' }).click();
    await chat.getByText('What should helper work on in Knights?').waitFor();
    expect(await page.locator('header.bar .conv-head').getAttribute('title')).toBe(knights);
    expect(await page.locator('header.bar').textContent()).not.toContain(knights);

    await composer.fill('Zmień README');
    await composer.press('Enter');
    await chat.getByRole('button', { name: 'README.md', exact: true }).click();
    expect(realpathSync(runs[1]!.cwd)).toBe(realpathSync(knights));
    expect(runs[1]!.servers).not.toContain('genaicode_project');

    await page.locator('.file-panel').getByText('Tactical game.').waitFor();
    await page.locator('.file-panel').getByRole('button', { name: 'Close' }).click();

    await composer.fill('/where');
    await composer.press('Enter');
    await chat.getByText(`Working directory: ${knights} · topic: Knights`).waitFor();

    // 3. "w ~/src/x" -> open_project question card -> Yes -> next turn runs in ~/src/x with recap and file root.
    await page.locator('header.bar').getByRole('button', { name: 'New chat' }).click();
    await chat.getByText('What should helper look into?').waitFor();

    await composer.fill('w ~/src/x sprawdź notatki');
    await composer.press('Enter');
    await chat.getByText('Continue this conversation in ~/src/x?').waitFor();
    await chat.getByRole('button', { name: /Yes/ }).click();
    await chat.getByText('Moved this conversation to ~/src/x').waitFor();

    await composer.fill('pokaż notes.txt');
    await composer.press('Enter');
    await chat.getByRole('button', { name: 'notes.txt', exact: true }).click();
    expect(realpathSync(runs[3]!.cwd)).toBe(realpathSync(projectX));
    expect(runs[3]!.resume).toBeUndefined();
    expect(runs[3]!.prompt).toContain('w ~/src/x sprawdź notatki');
    expect(runs[3]!.servers).not.toContain('genaicode_project');

    await page.locator('.file-panel').getByText('Project X notes').waitFor();
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it('keeps genaicode ui --cwd showing the project folder in the header as before', async () => {
  const browser = await chromium.launch();
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'cwd-ui-'));
  const dir = join(root, 'my-project');
  mkdirSync(dir);
  const stop = new AbortController();
  const helper: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { mcp: true, resume: true },
    run() {
      const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
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
      argv: ['ui', '--cwd', dir, '--no-artifacts'],
      cwd: root,
      env: { HOME: root, GENAICODE_HOME: join(root, '.genaicode') },
      agents: [helper],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());
    const page = await browser.newPage();
    await page.goto(opened!);
    await page.locator('header.bar .cwd').waitFor();
    expect(await page.locator('header.bar .cwd').textContent()).toBe('my-project');
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
