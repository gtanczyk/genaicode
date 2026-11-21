import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { pendingAsks, waitForAnswer, type SessionInfo } from '../agents/sessions/index.js';
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
}

it('shares pack approvals, other sessions and individually reviewed messages between two browsers', async () => {
  const browser = await chromium.launch();
  const root = mkdtempSync(join(tmpdir(), 'genaicode-tower-'));
  const project = join(root, 'catalog');
  mkdirSync(project);
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
  const worker: CodingAgent = {
    ...workerDriver,
    sessions: {
      name: row.source,
      where: 'local',
      list: async () => [row, { ...row, id: 'native-approval', waitingFor: 'approval', waitingTool: 'Read report' }],
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
    for (const page of [desktop, mobile]) {
      await page.goto(opened!);
      await page.getByRole('button', { name: 'Tower inbox · 5' }).click();
      await page.getByText('Pack task t1').waitFor();
    }
    const draft = desktop.getByRole('article').filter({ hasText: message.split('\n')[0] });
    expect(await draft.locator('pre').textContent()).toBe(message);
    expect(await draft.textContent()).toContain(project);
    expect(await draft.textContent()).toContain('worker-store / catalog-release');
    const native = desktop.getByRole('article').filter({ hasText: 'Answer in worker' });
    expect(await native.getByRole('button').count()).toBe(0);
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
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    stop.abort();
    await browser.close();
    await hook;
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
