import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recordLimits } from '../agents/sessions/limits.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { pendingAsks, waitForAnswer, writeTopics, type SessionInfo } from '../agents/sessions/index.js';
import type { AgentResult, AgentTask, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

/** Deterministic drivers, with the actual pack MCP, hook handoff, session lock, web server and Chromium clients. */
function driver(name: string, body: (task: AgentTask) => Promise<void>): CodingAgent {
  return {
    name,
    command: process.execPath,
    capabilities: { mcp: true, resume: true, approvals: true },
    run(task) {
      const result = body(task).then((): AgentResult => ({ status: 'completed', ok: true, exitCode: 0, signal: null }));
      return {
        result,
        abort() {},
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', result: await result };
        },
      };
    },
  };
}

async function callPack(task: AgentTask, name: string, args: Record<string, unknown>) {
  const server = task.mcpServers?.find((s) => s.name === 'pack');
  if (!server || !('url' in server)) throw new Error('Missing pack MCP server');
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const answer = await response.json();
  if (answer.result.isError) throw new Error(answer.result.content[0].text);
  return String(answer.result.content[0].text);
}

it('shares pack approvals, other sessions and individually reviewed messages between two browsers', async () => {
  const browser = await chromium.launch();
  // Not a temporary directory: sessions there are runs, left out of the listing.
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'tower-'));
  const project = join(root, 'catalog');
  mkdirSync(project);
  // A folder outside the chat's own: a session there is one of "Other agents' sessions" in the sidebar.
  const elsewhere = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'tower-elsewhere-'));
  const env = { GENAICODE_HOME: root, HOME: root };
  const stop = new AbortController();
  const row: SessionInfo = {
    id: 'catalog-release',
    source: 'worker-store',
    agent: 'worker',
    where: 'local',
    cwd: project,
    state: 'waiting',
    updatedAt: Date.now(),
  };
  const received: AgentTask[] = [];
  const decisions: string[] = [];
  const workerDriver = driver('worker', async (task) => {
    expect(task.mcpServers).toBeUndefined();
    if (task.resume) received.push(task);
    const decision = await task.onApproval!(
      {
        id: 'same-native-id',
        kind: 'command',
        summary: task.resume ? 'Check catalog entries' : 'Run worker checks',
        scope: task.resume ? 'turn' : 'once',
      },
      stop.signal,
    );
    decisions.push(`${task.resume ? 'session' : 'worker'} ${decision}`);
  });
  // A session that waits on a tool in its agent's own dialog, until it is answered there.
  let nativeWaits = true;
  const worker: CodingAgent = {
    ...workerDriver,
    sessions: {
      name: row.source,
      where: 'local',
      // As the agents' stores do, it lists the sessions of one folder when asked for that folder's.
      list: async (query) =>
        [
          row,
          { ...row, id: 'ledger-audit', cwd: elsewhere },
          nativeWaits
            ? { ...row, id: 'native-approval', waitingFor: 'approval' as const, waitingTool: 'Read report' }
            : { ...row, id: 'native-approval' },
        ].filter((one) => !query?.cwd || one.cwd!.startsWith(query.cwd)),
    },
  };
  const message = 'Review the catalog.\nKeep all empty entries.';
  const lead = driver('lead', async (task) => {
    await callPack(task, 'delegate', { agent: 'worker', mode: 'shared', prompt: 'Check the catalog' });
    for (const text of [message, 'Discard this alternative.'])
      await callPack(task, 'propose_session_message', { id: row.id, text });
    await callPack(task, 'wait', {});
  });
  const hook = waitForAnswer(
    'claude',
    {
      hook_event_name: 'PermissionRequest',
      session_id: 'other-project-session',
      cwd: project,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    },
    { env, signal: stop.signal, pollMs: 10 },
  );
  let running: Promise<number> | undefined;
  try {
    await vi.waitFor(async () => expect(await pendingAsks(env)).toHaveLength(1));
    const bundle = await build({
      entryPoints: ['src/ui/web/client.tsx'],
      bundle: true,
      write: false,
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.css': 'text' },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    let opened: string | undefined;
    const launch = (options: UiLaunch) =>
      runWeb({
        ...options,
        stderr: new PassThrough().resume(),
        openUrl(url) {
          opened = url;
        },
        clientScript: bundle.outputFiles[0].text,
        firstPrompt: 'Prepare the catalog release.',
      });
    running = main({
      argv: ['ui', '--sessions', '--pack', 'lead:worker', '--no-artifacts'],
      cwd: root,
      env,
      agents: [lead, worker],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());
    const desktop = await browser.newPage();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const apiUrls: string[] = [];
    for (const page of [desktop, mobile]) {
      page.on('request', (req) => {
        if (req.url().includes('/api/')) apiUrls.push(req.url());
      });
      await page.goto(opened!);
      expect(page.url()).toBe(new URL('/', opened!).href);
      await page.reload();
      expect(page.url()).toBe(new URL('/', opened!).href);
      // Needs you counts the tower's five items, each once: the pack task's approval is also this
      // chat's own, and the session that waits on a tool is also in the list of sessions.
      const needsYou = page.locator('.side-actions').getByRole('button', { name: /^Needs you/ });
      const side = page.getByRole('complementary', { name: 'Sidebar' });
      await side.getByRole('button', { name: 'All sessions' }).waitFor();
      // The count is final only with the list of every agent's sessions: before it arrives the
      // tower's items alone also come to five. A row of that list says it is here (hidden in the
      // narrow window's rail, but in the page).
      await side.locator('section.other').getByText('ledger-audit').waitFor({ state: 'attached' });
      expect(await needsYou.locator('.count').textContent()).toBe('5');
      await needsYou.click();
      await page.getByText('Pack task t1').waitFor();
    }
    const draft = desktop.getByRole('article').filter({ hasText: message.split('\n')[0] });
    expect(await draft.locator('pre').textContent()).toBe(message);
    expect(await draft.textContent()).toContain(project);
    expect(await draft.textContent()).toContain('worker-store / catalog-release');
    const native = desktop.getByRole('article').filter({ hasText: 'Answer in worker' });
    expect(await native.getByRole('button').count()).toBe(0);
    // It is answered in the worker's own dialog: the tower's next reading of the stores drops it.
    nativeWaits = false;
    await mobile
      .getByRole('article')
      .filter({ hasText: 'Discard this alternative.' })
      .getByRole('button', { name: 'Dismiss' })
      .click();
    await desktop.getByText('Discard this alternative.').waitFor({ state: 'detached' });
    expect(received).toEqual([]);
    await draft.getByRole('button', { name: 'Send to session' }).click();
    await mobile
      .getByRole('article')
      .filter({ hasText: 'Check catalog entries' })
      .getByRole('button', { name: 'Approve for this turn' })
      .click();
    await desktop
      .getByRole('article')
      .filter({ hasText: 'Pack task t1' })
      .getByRole('button', { name: 'Deny' })
      .click();
    await mobile
      .getByRole('article')
      .filter({ hasText: 'other-project-session' })
      .getByRole('button', { name: 'Approve once' })
      .click();
    expect(await hook).toEqual({ behavior: 'allow' });
    expect(received.map((t) => [t.resume, t.cwd, t.prompt])).toEqual([[row.id, project, message]]);
    expect(decisions).toEqual(['session approve', 'worker deny']);
    await desktop.getByRole('button', { name: 'All sessions', exact: true }).click();
    await desktop.locator('main.sessions').getByText('catalog', { exact: true }).waitFor();
    // Everything is answered: nothing needs the person, in the tower or in any session.
    const badge = desktop.locator('.side-actions').getByRole('button', { name: /^Needs you/ });
    await vi.waitFor(async () => expect(await badge.locator('.count').count()).toBe(0), { timeout: 10_000 });
    expect(await badge.getAttribute('title')).toBe('Nothing needs you now');
    // Needs you is the tower's inbox also when it is empty: what the last delivery came to is read there.
    await badge.click();
    await desktop.getByRole('heading', { name: 'Tower inbox' }).waitFor();
    await desktop.locator('main.tower-inbox').getByText('No pending items.').waitFor();
    expect(await desktop.locator('main.tower-inbox').getByRole('article').count()).toBe(0);
    await desktop.locator('main.tower-inbox [role="status"]').getByText('worker-store / catalog-release').waitFor();
    await desktop
      .locator('main.tower-inbox')
      .getByRole('button', { name: /ask for you$/ })
      .click();
    await vi.waitFor(async () => expect(await desktop.locator('header.topbar h1').textContent()).toBe('Needs you'));
    await desktop.locator('main.sessions').waitFor();
    expect(apiUrls.some((url) => url.endsWith('/api/events'))).toBe(true);
    expect(apiUrls.some((url) => url.includes('/api/sessions'))).toBe(true);
    expect(apiUrls.every((url) => !url.includes('token='))).toBe(true);
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    stop.abort();
    await browser.close();
    await hook;
    await running;
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
}, 45_000);

it('turns on auto-approve from a permission prompt and approves pending and follow-up requests', async () => {
  const browser = await chromium.launch();
  const root = mkdtempSync(join(tmpdir(), 'genaicode-auto-approve-'));
  const stop = new AbortController();
  const decisions: string[] = [];
  const asker = driver('asker', async (task) => {
    decisions.push(
      `first ${await task.onApproval!({ id: 'ap-1', kind: 'command', summary: 'Bash: ls | awk ...' }, stop.signal)}`,
    );
    decisions.push(
      `second ${await task.onApproval!({ id: 'ap-2', kind: 'command', summary: 'Bash: git status' }, stop.signal)}`,
    );
  });
  let running: Promise<number> | undefined;
  try {
    const bundle = await build({
      entryPoints: ['src/ui/web/client.tsx'],
      bundle: true,
      write: false,
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.css': 'text' },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    let opened: string | undefined;
    const launch = (options: UiLaunch) =>
      runWeb({
        ...options,
        stderr: new PassThrough().resume(),
        openUrl(url) {
          opened = url;
        },
        clientScript: bundle.outputFiles[0].text,
        firstPrompt: 'Inspect the project.',
      });
    running = main({
      argv: ['ui', '--no-artifacts'],
      cwd: root,
      env: { GENAICODE_HOME: root, HOME: root },
      agents: [asker],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());
    const page = await browser.newPage();
    await page.goto(opened!);
    await page.getByRole('button', { name: 'Ask first' }).waitFor();
    await page.getByRole('button', { name: 'Auto-approve all' }).click();
    await page.getByRole('button', { name: '✓ Auto-approve' }).waitFor();
    await vi.waitFor(() => expect(decisions).toEqual(['first approve', 'second approve']));
    expect(await page.getByRole('button', { name: 'Auto-approve all' }).count()).toBe(0);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it('copies session ID, file path and transcripts and downloads files from chat header and Sessions view', async () => {
  const browser = await chromium.launch();
  mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'transcript-'));
  const env = { GENAICODE_HOME: root, HOME: root };
  const stop = new AbortController();
  const activeSessionId = 'ses_0195active123456';
  const activeSessionPath = join(root, 'active.jsonl');
  const storedSession: SessionInfo = {
    id: 'ses_0195stored654321',
    source: 'reporter',
    agent: 'reporter',
    where: 'local',
    cwd: root,
    title: 'Observed conversation',
    path: join(root, 'stored.jsonl'),
    state: 'waiting',
    updatedAt: Date.now(),
  };
  const reporter: CodingAgent = {
    name: 'reporter',
    command: process.execPath,
    capabilities: { mcp: true, resume: true },
    sessions: {
      name: 'reporter',
      where: 'local',
      list: async () => [
        { ...storedSession, id: activeSessionId, path: activeSessionPath, title: 'Active chat' },
        storedSession,
      ],
      read: async (info) => [
        {
          id: 1,
          agent: 'reporter',
          prompt: `Prompt in ${info.id}`,
          entries: [{ kind: 'text', text: `Reply in ${info.id}`, streaming: false }],
          startedAt: Date.now() - 2000,
          endedAt: Date.now() - 1000,
        },
      ],
    },
    run(task) {
      const result: AgentResult = {
        status: 'completed',
        ok: true,
        exitCode: 0,
        signal: null,
        sessionId: activeSessionId,
        text: `Observed answer for: ${task.prompt}`,
      };
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          yield { type: 'session', sessionId: activeSessionId };
          yield { type: 'message', text: result.text! };
          yield { type: 'done', result };
        },
      };
    },
  };
  let running: Promise<number> | undefined;
  try {
    const bundle = await build({
      entryPoints: ['src/ui/web/client.tsx'],
      bundle: true,
      write: false,
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.css': 'text' },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    let opened: string | undefined;
    const launch = (options: UiLaunch) =>
      runWeb({
        ...options,
        stderr: new PassThrough().resume(),
        openUrl(url) {
          opened = url;
        },
        clientScript: bundle.outputFiles[0].text,
        firstPrompt: 'Something weird happened here',
      });
    running = main({
      argv: ['ui', '--sessions', '--no-artifacts'],
      cwd: root,
      env,
      agents: [reporter],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy());
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.goto(opened!);
    await page.getByText('Observed answer for: Something weird happened here').waitFor();

    // The top bar's ⋯ opens the session and transcript menu.
    const chip = page.getByRole('button', { name: 'Session menu' });
    await chip.click();
    await page.getByText(activeSessionPath).waitFor();

    await page.getByRole('menuitem', { name: 'Copy session ID' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(activeSessionId);
    await page.getByRole('status').filter({ hasText: 'Copied session ID' }).waitFor();

    await chip.click();
    await page.getByRole('menuitem', { name: 'Copy session file path' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(activeSessionPath);

    await chip.click();
    await page.getByRole('menuitem', { name: 'Copy transcript (Markdown)' }).click();
    await page.getByRole('status').filter({ hasText: 'Copied transcript (Markdown)' }).waitFor();
    const copiedMd = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedMd).toContain('# Genaicode transcript');
    expect(copiedMd).toContain(activeSessionId);
    expect(copiedMd).toContain(activeSessionPath);
    expect(copiedMd).toContain('Something weird happened here');
    expect(copiedMd).toContain('Observed answer for: Something weird happened here');

    await chip.click();
    await page.getByRole('menuitem', { name: 'Copy raw state (JSON)' }).click();
    await page.getByRole('status').filter({ hasText: 'Copied raw state (JSON)' }).waitFor();
    const copiedJson = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
      format: string;
      sessionId: string;
      sessionPath: string;
    };
    expect(copiedJson).toMatchObject({
      format: 'genaicode-transcript',
      sessionId: activeSessionId,
      sessionPath: activeSessionPath,
    });

    await chip.click();
    const [mdDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Download Markdown (.md)' }).click(),
    ]);
    expect(mdDownload.suggestedFilename()).toBe('genaicode-reporter-ve123456.md');

    // Sessions view row menu copies ID & downloads stored session transcript.
    await page.getByRole('button', { name: 'All sessions', exact: true }).click();
    const row = page.locator('.session-row').filter({ hasText: 'Observed conversation' });
    await row.waitFor();
    await row.getByRole('button', { name: /Copy ID or transcript/ }).click();
    await page.getByRole('menuitem', { name: 'Copy session ID' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(storedSession.id);

    await row.getByRole('button', { name: /Copy ID or transcript/ }).click();
    await page.getByRole('menuitem', { name: 'Copy transcript (Markdown)' }).click();
    await page.getByRole('status').filter({ hasText: 'Copied transcript (Markdown)' }).waitFor();
    const storedMd = await page.evaluate(() => navigator.clipboard.readText());
    expect(storedMd).toContain('# Session transcript');
    expect(storedMd).toContain(`Prompt in ${storedSession.id}`);
    expect(storedMd).toContain(`Reply in ${storedSession.id}`);

    await row.getByRole('button', { name: /Copy ID or transcript/ }).click();
    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Download JSON (.json)' }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toBe('genaicode-reporter-ed654321.json');

    await context.close();
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it('saves a team from the desktop home, uses it on delegation and on a fresh project launch', async () => {
  const browser = await chromium.launch();
  const fixtures = join(process.cwd(), 'node_modules', '.genaicode-test');
  mkdirSync(fixtures, { recursive: true });
  const root = mkdtempSync(join(fixtures, 'project-pack-'));
  const project = join(root, 'catalog');
  execFileSync('git', ['init', '-q', project]);
  const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
  await writeTopics(
    { topics: [{ id: 'catalog', name: 'Catalog' }], sessions: { 'captain:catalog-work': 'catalog' } },
    env,
  );
  const prior: SessionInfo = {
    agent: 'captain',
    source: 'captain',
    id: 'catalog-work',
    where: 'local',
    cwd: project,
    title: 'Catalog work',
    state: 'waiting',
    updatedAt: Date.now(),
  };
  const ran: string[] = [];
  const rosters: string[][] = [];
  const captain = driver('captain', async (task) => {
    const members = JSON.parse(await callPack(task, 'agents', { cwd: project })) as Array<{ name: string }>;
    rosters.push(members.map((m) => m.name));
    await callPack(task, 'delegate', { agent: 'worker', prompt: 'Check the catalog', mode: 'shared', cwd: project });
    await callPack(task, 'wait', {});
  });
  const agents = [
    { ...captain, sessions: { name: 'captain', where: 'local' as const, list: async () => [prior] } },
    ...['worker', 'backup', 'spare'].map((name) =>
      driver(name, async () => {
        ran.push(name);
      }),
    ),
  ];
  const resetsAt = Date.now() + 60 * 60_000;
  recordLimits('worker', [{ window: '5h', status: 'exceeded', usedPercent: 100, resetsAt }], env);
  recordLimits('backup', [{ window: '5h', status: 'ok', usedPercent: 20, resetsAt }], env);
  const bundle = await build({
    entryPoints: ['src/ui/web/client.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  let stop = new AbortController();
  let running: Promise<number> | undefined;
  const start = async (cwd: string, argv: string[]) => {
    stop = new AbortController();
    let opened: string | undefined;
    const launch = (options: UiLaunch) =>
      runWeb({
        ...options,
        stderr: new PassThrough().resume(),
        openUrl(url) {
          opened = url;
        },
        clientScript: bundle.outputFiles[0].text,
      });
    running = main({
      argv,
      cwd,
      env,
      agents,
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(opened).toBeTruthy(), { timeout: 8000 });
    const page = await browser.newPage();
    await page.goto(opened!);
    return page;
  };
  try {
    const home = await start(root, ['ui', '--sessions', '--delegate', '--home', '--no-artifacts']);
    await home.getByRole('button', { name: 'Settings', exact: true }).click();
    await home.getByRole('menuitem', { name: 'Project team' }).click();
    await home.getByLabel('Project folder').fill(project);
    await home.getByRole('button', { name: 'Open', exact: true }).click();
    await home.getByLabel('Lead', { exact: true }).selectOption('backup');
    await home.getByRole('checkbox', { name: 'captain' }).uncheck();
    await home.getByRole('checkbox', { name: 'spare' }).uncheck();
    await home.getByRole('button', { name: 'Remember this team for the project' }).click();
    await home.getByText('Team saved in .genaicode/pack.json', { exact: false }).waitFor();
    expect(JSON.parse(readFileSync(join(project, '.genaicode', 'pack.json'), 'utf8'))).toEqual({
      lead: 'backup',
      members: ['worker', 'backup'],
    });
    await home.getByRole('button', { name: 'Close project team' }).click();
    await home.getByLabel('Message', { exact: true }).fill('Use worker in the catalog project.');
    await home.getByLabel('Message', { exact: true }).press('Enter');
    await home.getByText(/worker reported an exhausted 5h limit.*Suggested alternative: backup/).waitFor();
    expect(ran).toEqual(['worker']);
    expect(rosters).toEqual([['worker', 'backup']]);
    await home
      .getByRole('complementary', { name: 'Sidebar' })
      .getByRole('button', { name: 'New chat', exact: true })
      .click();
    await home.getByRole('button', { name: 'New chat in Catalog' }).click();
    await home.getByText('What should backup work on in Catalog?').waitFor();
    await home.getByRole('button', { name: 'Settings', exact: true }).click();
    await home.getByRole('menuitem', { name: 'Project team' }).click();
    expect(await home.getByLabel('Lead', { exact: true }).inputValue()).toBe('backup');
    expect(await home.getByLabel('Project folder').count()).toBe(0);
    await home.close();
    stop.abort();
    await running;
    const scoped = await start(project, ['ui', '--pack', '--no-artifacts']);
    await scoped.getByText('Project pack: backup leads · members: worker, backup.').waitFor();
    await scoped.getByRole('button', { name: 'Settings', exact: true }).click();
    await scoped.getByRole('menuitem', { name: 'Project team' }).click();
    expect(await scoped.getByRole('checkbox', { name: 'spare' }).isChecked()).toBe(false);
    expect(await scoped.getByRole('checkbox', { name: 'backup' }).isChecked()).toBe(true);
  } finally {
    stop.abort();
    await browser.close();
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
