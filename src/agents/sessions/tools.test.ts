import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { outputText, type McpTool } from '../mcp-tools.js';
import type { SessionTurn } from '../session.js';
import { asksDir } from './answer.js';
import { archiveSessions } from './archive.js';
import { liveRecord, recordHook } from './live.js';
import { serveMcpStdio, sessionTools } from './tools.js';
import type { SessionInfo, SessionSource } from './types.js';

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A home with no hook reports, so only the sources speak. */
function env(): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'genaicode-session-tools-'));
  dirs.push(home);
  return { HOME: home, PATH: '' };
}

function session(source: string, id: string, extra: Partial<SessionInfo>): SessionInfo {
  return { source, agent: source, id, where: 'local', updatedAt: NOW - HOUR, ...extra };
}

function source(name: string, sessions: SessionInfo[], turns: SessionTurn[] = []): SessionSource {
  return {
    name,
    where: 'local',
    list: async (query) => sessions.filter((one) => query?.since === undefined || one.updatedAt >= query.since),
    read: async () => turns,
  };
}

const claude = source(
  'claude',
  [
    session('claude', 'aaaaaaaa-1111', {
      cwd: '/work/api',
      title: 'Fix the login',
      lastPrompt: 'now add a test',
      lastReply: 'Added the test.\nShall I push?',
      state: 'waiting',
    }),
    session('claude', 'bbbbbbbb-2222', {
      cwd: '/work/site',
      lastPrompt: 'restyle the header',
      state: 'waiting',
      waitingFor: 'approval',
      waitingTool: 'Bash',
      updatedAt: NOW - 2 * HOUR,
    }),
    session('claude', 'cccccccc-3333', { cwd: '/work/api', lastPrompt: 'old work', updatedAt: NOW - 30 * 24 * HOUR }),
  ],
  [
    {
      id: 1,
      agent: 'claude',
      prompt: 'now add a test',
      startedAt: NOW - HOUR,
      entries: [
        { kind: 'tool', name: 'Read', done: true },
        { kind: 'tool', name: 'Bash', done: true, isError: true, output: 'secret output' },
        { kind: 'text', text: 'Added the test.', streaming: false },
      ],
    },
  ],
);
const codex = source('codex', [
  session('codex', 'dddddddd-4444', { cwd: '/work/api', firstPrompt: 'migrate the schema', state: 'unfinished' }),
]);

function tools(sources: SessionSource[] = [claude, codex], home = env()): Record<string, McpTool> {
  return Object.fromEntries(sessionTools(sources, { env: home, now: () => NOW }).map((tool) => [tool.name, tool]));
}

async function call(tool: McpTool, args: Record<string, unknown> = {}): Promise<string> {
  return outputText(await tool.call(args));
}

describe('sessionTools', () => {
  it('sessions_projects counts sessions per project, agent and state', async () => {
    const text = await call(tools().sessions_projects!);
    expect(text).toContain('2 projects, last 14 days:');
    expect(text).toMatch(/api {2}\/work\/api {2}last 1h ago {2}\[claude 1, codex 1\] {2}1 waiting, 1 unfinished/);
    expect(text).toMatch(/site {2}\/work\/site .*\[claude 1\] {2}1 approval/);
    expect(await call(tools([]).sessions_projects!, { days: 2 })).toBe('No sessions in the last 2 days.');
  });

  it('sessions_list shows what each session waits for, and filters', async () => {
    const list = tools().sessions_list!;
    const all = await call(list);
    expect(all).toContain(
      '- claude aaaaaaaa-1111  waiting [ends with: question]  1h ago  /work/api\n    Fix the login',
    );
    expect(all).toContain('latest prompt: now add a test');
    expect(all).toContain('agent: Added the test. Shall I push?');
    expect(all).toContain('- claude bbbbbbbb-2222  approval (Bash)  2h ago  /work/site');
    expect(all).not.toContain('cccccccc');

    expect(await call(list, { state: 'approval' })).toMatch(/^- claude bbbbbbbb-2222/);
    expect(await call(list, { state: 'waiting' })).not.toContain('bbbbbbbb');
    expect(await call(list, { agent: 'Codex' })).toMatch(/^- codex dddddddd-4444 {2}unfinished/);
    expect((await call(list, { project: 'API' })).match(/^- /gm)).toHaveLength(2);
    expect(await call(list, { text: 'schema' })).toContain('migrate the schema');
    expect(await call(list, { days: 60, text: 'old work' })).toContain('cccccccc-3333  no state  30d ago');
    expect(await call(list, { limit: 1 })).toContain('(2 more match.)');
    expect(await call(list, { text: 'nothing like it' })).toBe('No matching sessions in the last 7 days.');
  });

  it('names a store that could not be read', async () => {
    const broken: SessionSource = {
      name: 'muse',
      where: 'local',
      list: async () => {
        throw new Error('locked');
      },
    };
    const { sessions_list: list, sessions_waiting: waiting } = tools([codex, broken]);
    expect(await call(list!)).toContain('(Could not read: muse.)');
    expect(await call(waiting!)).toBe('Nothing waits for you in the last 7 days.\n(Could not read: muse.)');
    // One agent asked for: the other stores are not opened.
    expect(await call(list!, { agent: 'codex' })).not.toContain('Could not read');
  });

  it('sessions_read gives prompts, messages and tool names, not tool output', async () => {
    const read = tools().sessions_read!;
    const text = await call(read, { id: 'aaaaaaaa' });
    expect(text).toContain('claude aaaaaaaa-1111  waiting  /work/api\nFix the login');
    expect(text).toContain('## User\nnow add a test\n(tools: Read, Bash failed)\n## claude\nAdded the test.');
    expect(text).not.toContain('secret output');
    await expect(read.call({ id: 'zzzzzzzz' })).rejects.toThrow('No session with id zzzzzzzz.');
    await expect(read.call({})).rejects.toThrow('needs the id');
  });
});

describe('sessionTools with hook reports', () => {
  it('lists approvals before replies across projects, applying filters and limits to the waiting sessions', async () => {
    const home = env();
    const archived = session('codex', 'archived', { state: 'waiting' });
    const reply = session('codex', 'codex-reply', { cwd: '/work/docs', state: 'waiting', lastReply: 'Which example?' });
    const recent = source('codex', [
      archived,
      reply,
      session('codex', 'busy', { state: 'active' }),
      session('codex', 'unfinished', { state: 'unfinished' }),
      session('codex', 'old-reply', { state: 'waiting', updatedAt: NOW - 8 * 24 * HOUR }),
    ]);
    await archiveSessions([archived], true, { env: home, now: NOW });
    const index = tools([claude, recent], home);
    const waiting = index.sessions_waiting!;
    const result = await call(waiting);
    expect(result.match(/^- \S+ (\S+)/gm)).toEqual([
      '- claude bbbbbbbb-2222',
      '- claude aaaaaaaa-1111',
      '- codex codex-reply',
    ]);
    expect(result).toContain('/work/docs');
    expect(result).toContain('Which example?');
    expect(await call(waiting, { limit: 1 })).toContain('(1 of 3):\n- claude bbbbbbbb-2222  approval (Bash)');
    expect(await call(waiting, { days: 9, agent: 'Codex' })).toContain('old-reply');
    expect(await call(waiting, { project: 'DOCS' })).toMatch(/\(1 of 1\):\n- codex codex-reply/);
    expect(await call(index.sessions_list!, { agent: 'codex' })).toContain('archived  waiting [archived]');
    expect(await call(index.sessions_read!, { id: archived.id })).toContain('archived  waiting [archived]');
  });

  it('shows open questions for the matching session and leaves stale hook and question files alone', async () => {
    const home = env();
    const hook = { session_id: 'aaaaaaaa-1111', hook_event_name: 'PermissionRequest', tool_name: 'Bash' };
    await recordHook('claude', hook, { env: home, now: NOW });
    await recordHook('claude', { ...hook, session_id: 'expired' }, { env: home, now: NOW - 30 * 24 * HOUR });
    const dir = asksDir(home);
    mkdirSync(dir, { recursive: true });
    const question = { agent: 'claude', session: hook.session_id, tool: 'Bash', at: NOW, pid: process.pid };
    const questions = [
      { ...question, id: '000000000001', preview: 'npm test' },
      { ...question, id: '000000000002', preview: 'private to another agent', agent: 'codex' },
      { ...question, id: '000000000003', preview: 'private to another session', session: 'different' },
      { ...question, id: '000000000004', preview: 'expired question', pid: 2147483647 },
    ];
    for (const ask of questions) writeFileSync(join(dir, `${ask.id}.json`), JSON.stringify(ask));
    const result = await call(tools([claude], home).sessions_waiting!, { project: 'api' });
    expect(result).toContain('aaaaaaaa-1111  approval (Bash)');
    expect(result).toContain('open question 000000000001: Bash: npm test');
    expect(result).not.toMatch(/private to another|expired question/);
    expect(existsSync(join(dir, '000000000004.json'))).toBe(true);
    expect(await liveRecord('claude', 'expired', home)).toBeDefined();
  });

  it('sessions_read shows the state the hooks reported, as sessions_list does', async () => {
    const home = env();
    await recordHook(
      'claude',
      { session_id: 'aaaaaaaa-1111', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} },
      { env: home, now: NOW - 1000 },
    );
    const [, list, read] = sessionTools([claude], { env: home, now: () => NOW });
    expect(outputText(await list!.call({}))).toContain('aaaaaaaa-1111  approval (Bash)');
    expect(outputText(await read!.call({ id: 'aaaaaaaa' }))).toContain('aaaaaaaa-1111  approval  /work/api');
  });
});

describe('serveMcpStdio', () => {
  it('answers MCP messages line by line until the input ends', async () => {
    const input = new PassThrough();
    let written = '';
    const served = serveMcpStdio(sessionTools([claude, codex], { env: env(), now: () => NOW }), {
      input,
      output: { write: (text: string) => (written += text) },
    });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write('not json\n\n');
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    input.end(
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sessions_waiting' } })}\n`,
    );
    await served;
    const replies = written
      .trim()
      .split('\n')
      .map(
        (line) => JSON.parse(line) as { id: number | null; result?: Record<string, unknown>; error?: { code: number } },
      );
    const byId = (id: number | null) => replies.find((reply) => reply.id === id)!;
    expect(replies).toHaveLength(4);
    expect(byId(1).result).toMatchObject({
      serverInfo: { name: 'genaicode-sessions', version: '1' },
      instructions: expect.stringContaining('before your own session or agent listing'),
    });
    expect(byId(null).error?.code).toBe(-32700);
    expect(byId(2).result).toMatchObject({
      tools: [
        { name: 'sessions_projects' },
        { name: 'sessions_list' },
        { name: 'sessions_read' },
        { name: 'sessions_waiting', _meta: { 'anthropic/alwaysLoad': true } },
      ],
    });
    expect(JSON.stringify(byId(3).result)).toContain('bbbbbbbb-2222  approval (Bash)');
  });

  it('stops when its signal aborts, though the input stays open', async () => {
    const controller = new AbortController();
    const input = new PassThrough();
    let written = '';
    const served = serveMcpStdio(sessionTools([codex], { env: env(), now: () => NOW }), {
      input,
      output: { write: (text: string) => (written += text) },
      signal: controller.signal,
    });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await served;
    expect(JSON.parse(written)).toMatchObject({ id: 1 });
    // Stopped before it started: nothing is served.
    await serveMcpStdio([], {
      input: new PassThrough(),
      output: { write: () => undefined },
      signal: controller.signal,
    });
  });
});
