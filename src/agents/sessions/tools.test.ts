import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { outputText, type McpTool } from '../mcp-tools.js';
import type { SessionTurn } from '../session.js';
import { serveMcpStdio, sessionTools } from './tools.js';
import type { SessionInfo, SessionSource } from './types.js';

const NOW = Date.UTC(2026, 10, 19, 12);
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

function tools(sources: SessionSource[] = [claude, codex]): Record<string, McpTool> {
  return Object.fromEntries(sessionTools(sources, { env: env(), now: () => NOW }).map((tool) => [tool.name, tool]));
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
    expect(all).toContain('- claude aaaaaaaa-1111  waiting  1h ago  /work/api\n    Fix the login');
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
    expect(await call(tools([codex, broken]).sessions_list!)).toContain('(Could not read: muse.)');
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
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sessions_list', arguments: { state: 'approval' } } })}\n`,
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
    expect(byId(1).result).toMatchObject({ serverInfo: { name: 'genaicode-sessions' } });
    expect(byId(null).error?.code).toBe(-32700);
    expect(byId(2).result).toMatchObject({
      tools: [{ name: 'sessions_projects' }, { name: 'sessions_list' }, { name: 'sessions_read' }],
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
  });
});
