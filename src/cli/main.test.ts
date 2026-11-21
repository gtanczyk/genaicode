import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { parseCli, UsageError } from './args.js';
import {
  EXIT_ABORTED,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  helpText,
  main,
  type CliEnvironment,
  type UiLaunch,
} from './main.js';

const completed: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Done.' };

function fakeAgent(
  name: string,
  attempts: Array<{ events: AgentEvent[]; result: AgentResult }>,
): CodingAgent & {
  tasks: AgentTask[];
} {
  const tasks: AgentTask[] = [];
  return {
    name,
    command: `${name}-cli`,
    capabilities: {},
    tasks,
    run(task): AgentRun {
      tasks.push(task);
      const { events, result } = attempts[Math.min(tasks.length - 1, attempts.length - 1)];
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          yield* events;
          yield { type: 'done', result };
        },
      };
    },
  };
}

function environment(overrides: Partial<CliEnvironment> & { argv: string[] }) {
  let stdout = '';
  let stderr = '';
  const cli: CliEnvironment = {
    env: { PATH: '' },
    cwd: '/work',
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
    readStdin: async () => undefined,
    ...overrides,
  };
  return { cli, out: () => stdout, err: () => stderr };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A PATH directory holding executables named `commands`. */
function pathWith(...commands: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'genaicode-cli-'));
  dirs.push(dir);
  for (const command of commands) writeFileSync(join(dir, command), '#!/bin/sh\n', { mode: 0o755 });
  return dir;
}

describe('parseCli', () => {
  it('uses the resumable interactive Codex and Muse drivers in the tower inbox', async () => {
    const inspect = async (launch: UiLaunch) => {
      expect(launch.towerInbox).toBeDefined();
      for (const name of ['codex', 'muse']) {
        expect(launch.sessionAgents?.find((agent) => agent.name === name)?.capabilities).toMatchObject({
          approvals: true,
          resume: true,
          steer: true,
        });
      }
      return 0;
    };
    const { cli } = environment({
      argv: ['tower', '--pack', 'claude:codex'],
      interactive: true,
      loadUi: async () => ({ runWeb: inspect, runChat: inspect }),
    });
    expect(await main(cli)).toBe(EXIT_OK);
  });
  it('opens the requested pack in either chat and keeps the original session sources', async () => {
    const lead = { ...fakeAgent('lead', []), capabilities: { mcp: true } };
    const worker = fakeAgent('worker', []);
    const agents = [lead, worker];
    const inspect = async (launch: UiLaunch) => {
      expect(launch.agent).toBe('pack');
      expect(launch.agents[0]).toMatchObject({ name: 'pack', command: lead.command });
      expect(launch.sessionAgents).toBe(agents);
      if (launch.sessionTools) {
        expect(launch.towerInbox?.proposalTool.name).toBe('propose_session_message');
        expect(launch.sessionTools.map((t) => t.name)).not.toContain('propose_session_message');
      } else expect(launch.towerInbox).toBeUndefined();
      return 0;
    };
    const loadUi = async () => ({ runChat: inspect, runWeb: inspect });
    for (const kind of ['chat', 'ui', 'tower']) {
      const argv = [kind, '--pack', 'lead:worker,worker', '--max-parallel', '2'];
      expect(parseCli(argv)).toMatchObject({ pack: { lead: 'lead', members: ['worker'], maxParallel: 2 } });
      expect(await main(environment({ argv, agents, interactive: true, loadUi }).cli)).toBe(EXIT_OK);
    }
    for (const args of [
      ['--pack', 'a:'],
      ['--pack', 'a:b:extra'],
      ['--pack', 'a:b', '-a', 'c'],
      ['--max-parallel', '2'],
      ['--pack', 'a:b', '--max-parallel', '0'],
      ['--verify', 'npm test'],
      ['--pack', '--verify', '  '],
    ])
      expect(() => parseCli(['ui', ...args])).toThrow(UsageError);
    for (const spec of ['lead:unknown', 'worker:lead']) {
      expect(await main(environment({ argv: ['ui', '--pack', spec], agents, loadUi }).cli)).toBe(EXIT_USAGE);
    }
  });

  it('auto-assembles a pack from installed agents when --pack is passed without a value', async () => {
    expect(parseCli(['ui', '--pack', '--verify', 'node --test'])).toMatchObject({
      pack: { auto: true },
      verify: 'node --test',
    });
    expect(parseCli(['ui', '--pack'])).toMatchObject({ kind: 'ui', pack: { auto: true } });
    expect(parseCli(['chat', '--pack', '--web', '--max-parallel', '3'])).toMatchObject({
      kind: 'chat',
      web: true,
      pack: { auto: true, maxParallel: 3 },
    });
    expect(parseCli(['tower', '--pack', '-a', 'second'])).toMatchObject({
      kind: 'tower',
      agent: 'second',
      pack: { auto: true },
    });
    expect(parseCli(['ui', '-a', 'second', '--pack'])).toMatchObject({
      kind: 'ui',
      agent: 'second',
      pack: { auto: true },
    });
    // `--pack` as the value of another string flag stays a value, not bare `--pack`.
    expect(parseCli(['ui', '--model=--pack'])).toMatchObject({ kind: 'ui', model: '--pack' });
    expect(parseCli(['ui', '--model=--pack'])).not.toHaveProperty('pack');
    expect(parseCli(['ui', '-ym--pack'])).toMatchObject({ kind: 'ui', approveAll: true, model: '--pack' });
    expect(parseCli(['ui', '-ym--pack'])).not.toHaveProperty('pack');
    for (const args of [
      ['-m', '--pack'],
      ['-ym', '--pack'],
      ['--pack='],
      ['--pack', 'onlylead'],
      ['--pack', '--max-parallel', '0'],
      ['--pack', 'a:b', '--pack'],
      ['--pack', '--pack', 'a:b'],
    ])
      expect(() => parseCli(['ui', ...args])).toThrow(UsageError);

    const plain = fakeAgent('plain', []);
    const lead = { ...fakeAgent('lead', []), capabilities: { mcp: true } };
    const second = { ...fakeAgent('second', []), capabilities: { mcp: true } };
    const missing = { ...fakeAgent('missing', []), capabilities: { mcp: true } };
    const agents = [plain, lead, second, missing];
    const bin = pathWith(plain.command, lead.command, second.command);

    const launches: UiLaunch[] = [];
    const loadUi = async () => {
      const capture = async (launch: UiLaunch) => {
        launches.push(launch);
        return 0;
      };
      return { runChat: capture, runWeb: capture };
    };

    expect(await main(environment({ argv: ['ui', '--pack'], agents, env: { PATH: bin }, loadUi }).cli)).toBe(EXIT_OK);
    expect(launches[0]).toMatchObject({
      agent: 'pack',
      startupNotice: 'Pack: lead leads · members: plain, lead, second.',
    });
    expect(launches[0]!.agents[0]).toMatchObject({ name: 'pack', command: lead.command });

    expect(
      await main(
        environment({ argv: ['chat', '--pack', '-a', 'second'], agents, env: { PATH: bin }, interactive: true, loadUi })
          .cli,
      ),
    ).toBe(EXIT_OK);
    expect(launches[1]).toMatchObject({
      agent: 'pack',
      startupNotice: 'Pack: second leads · members: plain, lead, second.',
    });
    expect(launches[1]!.agents[0]).toMatchObject({ name: 'pack', command: second.command });

    const nonMcpLead = environment({ argv: ['ui', '--pack', '-a', 'plain'], agents, env: { PATH: bin }, loadUi });
    expect(await main(nonMcpLead.cli)).toBe(EXIT_USAGE);
    expect(nonMcpLead.err()).toContain('does not support MCP');

    const unknownLead = environment({ argv: ['ui', '--pack', '-a', 'ghost'], agents, env: { PATH: bin }, loadUi });
    expect(await main(unknownLead.cli)).toBe(EXIT_USAGE);
    expect(unknownLead.err()).toContain('Unknown agent "ghost"');

    const onlyPlain = pathWith(plain.command);
    const noMcp = environment({ argv: ['ui', '--pack'], agents, env: { PATH: onlyPlain }, loadUi });
    expect(await main(noMcp.cli)).toBe(EXIT_USAGE);
    expect(noMcp.err()).toContain('No installed agent with MCP support found for --pack');
  });
  it('parses run options', () => {
    expect(
      parseCli(['run', '-a', 'codex', '--timeout', '90', '--max-turns', '5', '--verify', 'npm test', 'fix', 'it']),
    ).toEqual({
      kind: 'run',
      prompt: 'fix it',
      agent: 'codex',
      cwd: undefined,
      model: undefined,
      effort: undefined,
      maxTurns: 5,
      resume: undefined,
      timeoutMs: 90_000,
      verify: 'npm test',
      maxRepairs: 2,
      json: false,
    });
  });

  it('parses --resume', () => {
    expect(parseCli(['run', '-r', 'abc', 'go on'])).toMatchObject({ resume: 'abc', prompt: 'go on' });
    // `--help` after any command: the help.
    expect(parseCli(['sessions', '--help'])).toEqual({ kind: 'help' });
    expect(parseCli(['hooks', 'install', '-h'])).toEqual({ kind: 'help' });
    // After `--` it is the prompt's.
    expect(parseCli(['run', '--', 'explain', '-h'])).toMatchObject({ kind: 'run', prompt: 'explain -h' });
  });

  it('streams sessions send using the original agent and directory, including a prompt from stdin', async () => {
    const dir = pathWith('owner-cli');
    const agent = {
      ...fakeAgent('owner', [{ events: [{ type: 'message', text: 'Done.' }], result: completed }]),
      capabilities: { resume: true, permissions: { sandbox: ['read-only'] as const } },
      sessions: {
        name: 'owner',
        where: 'local' as const,
        list: async () => [
          {
            source: 'owner',
            agent: 'owner',
            where: 'local' as const,
            id: 'abcdefgh-1',
            cwd: dir,
            state: 'waiting' as const,
            updatedAt: 1,
          },
        ],
      },
    };
    const { cli, out } = environment({
      argv: ['sessions', 'send', 'abcdefgh', '--sandbox', 'read-only'],
      agents: [agent],
      env: { GENAICODE_HOME: dir },
      readStdin: async () => 'Go\non.',
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(agent.tasks[0]).toMatchObject({
      cwd: dir,
      resume: 'abcdefgh-1',
      prompt: 'Go\non.',
      permissions: { sandbox: 'read-only' },
    });
    expect(out()).toBe('Done.\n');
    expect(() => parseCli(['sessions', 'send', 'id', '--sandbox', 'other'])).toThrow(UsageError);
    expect(parseCli(['sessions', 'send', '--detach', '--', 'id', '-h'])).toMatchObject({
      kind: 'send',
      detach: true,
      prompt: '-h',
    });
  });

  it('parses chat --web and its port, and keeps --web off ui', () => {
    expect(parseCli(['chat', '--web', '--port', '4000'])).toMatchObject({ kind: 'chat', web: true, port: 4000 });
    expect(parseCli(['ui', '--no-open'])).toMatchObject({ kind: 'ui', web: false, open: false });
    expect(() => parseCli(['ui', '--web'])).toThrow(UsageError);
    expect(parseCli(['tower', '--web', '-a', 'codex', '--port', '4000'])).toMatchObject({
      kind: 'tower',
      sessions: true,
      web: true,
      agent: 'codex',
      port: 4000,
    });
    expect(() => parseCli(['tower', '--exit-with-stdin'])).toThrow(UsageError);
  });

  it('opens the tower in the terminal with the same local and MCP index, leaving ordinary chats opt-in', async () => {
    const launches: UiLaunch[] = [];
    const loadUi = async () => ({
      runChat: async (launch: UiLaunch) => {
        launches.push(launch);
        return 0;
      },
      runWeb: async () => {
        throw new Error('expected the terminal');
      },
    });
    const agent = { ...fakeAgent('alpha', []), capabilities: { mcp: true } };
    const options = { interactive: true, agents: [agent], loadUi };
    for (const argv of [['tower'], ['chat', '--sessions'], ['chat']]) {
      expect(await main(environment({ ...options, argv }).cli)).toBe(EXIT_OK);
    }
    const [tower, indexed, plain] = launches;
    expect(tower!.waitingOnStart).toBe(true);
    expect(tower!.task?.mcpServers).toMatchObject([{ name: 'sessions' }]);
    expect(tower!.sessionTools?.map((tool) => tool.name)).toContain('sessions_waiting');
    expect(indexed!.sessionTools?.map((tool) => tool.name)).toContain('sessions_read');
    expect(indexed!.waitingOnStart).toBeUndefined();
    expect(plain!.sessionTools).toBeUndefined();
    const batch = environment({ ...options, interactive: false, argv: ['tower'] });
    expect(await main(batch.cli)).toBe(EXIT_USAGE);
    expect(batch.err()).toContain('tower needs a terminal');
  });

  it('parses --mcp name=url for chat and ui', () => {
    expect(parseCli(['ui', '--mcp', 'game=http://127.0.0.1:7777/mcp', '--mcp', 'b=https://x.dev/mcp'])).toMatchObject({
      mcpServers: [
        { name: 'game', url: 'http://127.0.0.1:7777/mcp' },
        { name: 'b', url: 'https://x.dev/mcp' },
      ],
    });
    expect(parseCli(['chat'])).toMatchObject({ mcpServers: [] });
    expect(parseCli(['ui', '--exit-with-stdin'])).toMatchObject({ exitWithStdin: true });
    expect(() => parseCli(['chat', '--exit-with-stdin'])).toThrow(UsageError);
    expect(() => parseCli(['ui', '--mcp', 'game'])).toThrow(UsageError);
  });

  it('gives ui --mcp servers to the MCP-capable agents only', async () => {
    const launches: UiLaunch[] = [];
    const loadUi = async () => ({
      runChat: async () => 0,
      runWeb: async (launch: UiLaunch) => (launches.push(launch), 0),
    });
    const stub = (name: string, mcp: boolean): CodingAgent => ({
      name,
      command: name,
      capabilities: { mcp },
      run: () => {
        throw new Error('not run');
      },
    });
    const [plain, mcp] = [stub('plain', false), stub('mcp', true)];
    const argv = ['ui', '--mcp', 'game=http://127.0.0.1:7777/mcp'];
    const { cli } = environment({ argv, agents: [plain, mcp], loadUi });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(launches[0]!.agents.map((agent) => agent.name)).toEqual(['mcp']);
    expect(launches[0]!.task).toEqual({ mcpServers: [{ name: 'game', url: 'http://127.0.0.1:7777/mcp' }] });

    const refused = environment({ argv: [...argv, '-a', 'plain'], agents: [plain, mcp], loadUi });
    expect(await main(refused.cli)).toBe(EXIT_USAGE);
    expect(refused.err()).toContain('does not support MCP servers');
  });

  it('gives chat --sessions the session index of every agent as an MCP server', async () => {
    expect(parseCli(['chat', '--sessions'])).toMatchObject({ sessions: true });
    expect(parseCli(['ui'])).not.toHaveProperty('sessions');
    const launches: UiLaunch[] = [];
    let listed: string | undefined;
    let told: string | undefined;
    const loadUi = async () => ({
      runChat: async () => 0,
      runWeb: async (launch: UiLaunch) => {
        launches.push(launch);
        const server = launch.task!.mcpServers![0] as { url: string; headers: Record<string, string> };
        const response = await fetch(server.url, {
          method: 'POST',
          headers: { ...server.headers, 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sessions_waiting' } }),
        });
        const hello = await fetch(server.url, {
          method: 'POST',
          headers: { ...server.headers, 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
        });
        told = ((await hello.json()) as { result: { instructions?: string } }).result.instructions;
        listed = ((await response.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]!.text;
        return 0;
      },
    });
    const home = mkdtempSync(join(tmpdir(), 'genaicode-index-'));
    dirs.push(home);
    const stub = (name: string, mcp: boolean): CodingAgent => ({
      name,
      command: name,
      capabilities: { mcp },
      sessions: {
        name,
        where: 'local',
        list: async () => [
          { source: name, agent: name, id: `${name}-1`, where: 'local', state: 'waiting', updatedAt: Date.now() },
        ],
      },
      run: () => {
        throw new Error('not run');
      },
    });
    const agents = [stub('plain', false), stub('mcp', true)];
    const { cli } = environment({ argv: ['ui', '--sessions'], env: { HOME: home, PATH: '' }, agents, loadUi });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(launches[0]!.agents.map((agent) => agent.name)).toEqual(['mcp']);
    expect(launches[0]!.task!.mcpServers).toMatchObject([{ name: 'sessions' }]);
    // The Sessions view and /continue read every store too.
    expect(launches[0]!.sessionSources!.map((source) => source.name)).toEqual(['plain', 'mcp']);
    // The agent without MCP cannot be chatted with here, but its sessions are in the index.
    // The agent is told to ask the index, not its own session listing.
    expect(told).toContain('use sessions_waiting first');
    expect(listed).toContain('- plain plain-1');
    expect(listed).toContain('- mcp mcp-1');

    const refused = environment({ argv: ['ui', '--sessions', '-a', 'plain'], agents, loadUi });
    expect(await main(refused.cli)).toBe(EXIT_USAGE);
    expect(refused.err()).toContain('(--sessions)');

    const twice = environment({
      argv: ['chat', '--sessions', '--mcp', 'sessions=http://127.0.0.1:1/mcp'],
      agents,
      loadUi,
      interactive: true,
    });
    expect(await main(twice.cli)).toBe(EXIT_USAGE);
    expect(twice.err()).toContain('named "sessions"');
  });

  it('treats a missing or "-" prompt as stdin', () => {
    expect(parseCli(['run'])).toMatchObject({ prompt: undefined });
    expect(parseCli(['run', '-'])).toMatchObject({ prompt: undefined });
  });

  it('rejects unknown commands, flags, and bad numbers', () => {
    expect(() => parseCli(['serve'])).toThrow(UsageError);
    expect(() => parseCli(['run', '--nope', 'x'])).toThrow(UsageError);
    expect(() => parseCli(['run', '--timeout', 'soon', 'x'])).toThrow(/--timeout/);
    expect(() => parseCli(['agents', 'extra'])).toThrow(UsageError);
  });
});

describe('genaicode CLI', () => {
  it('prints help with the 1.x fallback', async () => {
    const { cli, out } = environment({ argv: [] });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(out()).toBe(helpText);
    expect(out()).toContain('npx genaicode@1');
    expect(out()).toContain('github.com/gtanczyk/genaicode/tree/1.x');
  });

  it('exits 2 on a usage error', async () => {
    const { cli, err } = environment({ argv: ['frobnicate'] });
    expect(await main(cli)).toBe(EXIT_USAGE);
    expect(err()).toContain('Unknown command: frobnicate');
  });

  it('lists agents with their install state', async () => {
    const { cli, out } = environment({
      argv: ['agents', '--json'],
      env: { PATH: pathWith('beta-cli') },
      agents: [fakeAgent('alpha', []), fakeAgent('beta', [])],
    });
    expect(await main(cli)).toBe(EXIT_OK);
    const rows = out()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows[0]).toEqual({ name: 'alpha', command: 'alpha-cli', path: null });
    expect(rows[1]).toMatchObject({ name: 'beta', command: 'beta-cli' });
    expect(rows[1].path).toMatch(/beta-cli$/);
  });

  it('runs the first installed agent and prints text once', async () => {
    const alpha = fakeAgent('alpha', []);
    const beta = fakeAgent('beta', [
      {
        events: [
          { type: 'tool-start', name: 'shell', input: { command: 'ls -la' } },
          { type: 'text-delta', text: 'Hel' },
          { type: 'text-delta', text: 'lo' },
          { type: 'message', text: 'Hello' },
          { type: 'file-change', paths: ['a.ts'] },
        ],
        result: completed,
      },
    ]);
    const { cli, out, err } = environment({
      argv: ['run', '--timeout', '5', 'say', 'hi'],
      env: { PATH: pathWith('beta-cli') },
      agents: [alpha, beta],
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(alpha.tasks).toEqual([]);
    expect(beta.tasks[0]).toMatchObject({ prompt: 'say hi', cwd: '/work', timeoutMs: 5000 });
    expect(out()).toBe('Hello\n');
    expect(err()).toContain('› shell ls -la');
    expect(err()).toContain('✎ a.ts');
    expect(err()).toContain('beta: completed');
  });

  it('reads the prompt from stdin and streams JSON events', async () => {
    const agent = fakeAgent('alpha', [{ events: [{ type: 'message', text: 'ok' }], result: completed }]);
    const { cli, out, err } = environment({
      argv: ['run', '--agent', 'alpha', '--json', '-C', 'sub'],
      agents: [agent],
      readStdin: async () => '  from stdin \n',
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(agent.tasks[0]).toMatchObject({ prompt: 'from stdin', cwd: '/work/sub' });
    expect(
      out()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).type),
    ).toEqual(['message', 'done']);
    expect(err()).toBe('');
  });

  it('fails clearly without a prompt, an unknown agent, or any installed agent', async () => {
    const none = environment({ argv: ['run'], agents: [fakeAgent('alpha', [])] });
    expect(await main(none.cli)).toBe(EXIT_USAGE);
    expect(none.err()).toContain('No prompt');

    const unknown = environment({ argv: ['run', '-a', 'zeta', 'x'], agents: [fakeAgent('alpha', [])] });
    expect(await main(unknown.cli)).toBe(EXIT_USAGE);
    expect(unknown.err()).toContain('Unknown agent "zeta". Known agents: alpha.');

    const missing = environment({ argv: ['run', 'x'], agents: [fakeAgent('alpha', [])] });
    expect(await main(missing.cli)).toBe(EXIT_USAGE);
    expect(missing.err()).toContain('Install one of: alpha-cli');
  });

  it('maps failed and aborted results to exit codes', async () => {
    const failed = environment({
      argv: ['run', '-a', 'alpha', 'x'],
      agents: [
        fakeAgent('alpha', [{ events: [], result: { ...completed, status: 'failed', ok: false, error: 'boom' } }]),
      ],
    });
    expect(await main(failed.cli)).toBe(EXIT_FAILED);
    expect(failed.err()).toContain('boom');

    const aborted = environment({
      argv: ['run', '-a', 'alpha', 'x'],
      agents: [fakeAgent('alpha', [{ events: [], result: { ...completed, status: 'aborted', ok: false } }])],
    });
    expect(await main(aborted.cli)).toBe(EXIT_ABORTED);
  });

  it('sends a failed check back to the agent', async () => {
    const agent = fakeAgent('alpha', [{ events: [], result: completed }]);
    const checks: string[] = [];
    const { cli, err } = environment({
      argv: ['run', '-a', 'alpha', '--verify', 'npm test', 'add feature'],
      agents: [agent],
      runCheck: async (command, cwd) => {
        checks.push(`${command}@${cwd}`);
        return checks.length === 1 ? { exitCode: 1, output: 'expected 2, got 3' } : { exitCode: 0, output: '' };
      },
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(checks).toEqual(['npm test@/work', 'npm test@/work']);
    expect(agent.tasks).toHaveLength(2);
    expect(agent.tasks[1].prompt).toContain('expected 2, got 3');
    expect(err()).toContain('verify: failed (exit 1)');
    expect(err()).toContain('verify: passed');
  });

  it('gives up after --max-repairs', async () => {
    const agent = fakeAgent('alpha', [{ events: [], result: completed }]);
    const { cli, out } = environment({
      argv: ['run', '-a', 'alpha', '--verify', 'false', '--max-repairs', '0', '--json', 'x'],
      agents: [agent],
      runCheck: async () => ({ exitCode: 1, output: 'nope' }),
    });
    expect(await main(cli)).toBe(EXIT_FAILED);
    expect(agent.tasks).toHaveLength(1);
    expect(out()).toContain('{"type":"verify","attempt":0,"ok":false,"exitCode":1}');
  });

  it('runs the default --verify command in a shell', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genaicode-verify-'));
    dirs.push(dir);
    const agent = fakeAgent('alpha', [{ events: [], result: completed }]);
    const { cli } = environment({
      argv: ['run', '-a', 'alpha', '--verify', 'echo checked > marker && exit 3', '--max-repairs', '0', 'x'],
      cwd: dir,
      env: process.env,
      agents: [agent],
    });
    expect(await main(cli)).toBe(EXIT_FAILED);
    expect(readFileSync(join(dir, 'marker'), 'utf8').trim()).toBe('checked');
  });

  it.skipIf(process.platform === 'win32')('stops the shell runner and its test process on cancellation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genaicode-check-stop-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'test.cjs'),
      "require('node:fs').writeFileSync('pid', String(process.pid)); setInterval(() => {}, 1000);",
    );
    const stop = new AbortController();
    const { cli } = environment({
      argv: ['run', '-a', 'alpha', '--verify', 'node test.cjs && echo done', '--max-repairs', '0', 'x'],
      agents: [fakeAgent('alpha', [{ events: [], result: completed }])],
      cwd: dir,
      env: process.env,
      signal: stop.signal,
    });
    const running = main(cli);
    try {
      const pid = await vi.waitFor(() => Number(readFileSync(join(dir, 'pid'), 'utf8')));
      expect(pid).toBeGreaterThan(1);
      stop.abort();
      await running;
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    } finally {
      stop.abort();
      await running;
    }
  });
});

describe('acp', () => {
  it('parses its options', () => {
    expect(parseCli(['acp', '-a', 'codex', '--effort', 'high', '-y'])).toEqual({
      kind: 'acp',
      agent: 'codex',
      model: undefined,
      effort: 'high',
      approveAll: true,
    });
    expect(() => parseCli(['acp', '--cwd', '/x'])).toThrow(UsageError);
  });

  it('serves the protocol on its input and output', async () => {
    const { PassThrough } = await import('node:stream');
    const input = new PassThrough();
    const { cli, out } = environment({ argv: ['acp'], input, agents: [fakeAgent('claude', [])] });
    const done = main(cli);
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`);
    expect(await done).toBe(EXIT_OK);
    expect(JSON.parse(out())).toMatchObject({
      id: 1,
      result: { protocolVersion: 1, agentInfo: { name: 'genaicode' } },
    });
  });

  it('rejects an unknown agent', async () => {
    const { cli, err } = environment({ argv: ['acp', '-a', 'nope'], agents: [fakeAgent('claude', [])] });
    expect(await main(cli)).toBe(EXIT_USAGE);
    expect(err()).toContain('Unknown agent "nope"');
  });
});

describe('genaicode sessions doctor', () => {
  it('parses doctor and refuses options of the listing', () => {
    expect(parseCli(['sessions', 'doctor', '-a', 'codex', '--json'])).toEqual({
      kind: 'doctor',
      json: true,
      api: false,
      agent: 'codex',
    });
    expect(() => parseCli(['sessions', 'doctor', '--limit', '3'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'nurse'])).toThrow(UsageError);
    expect(parseCli(['sessions', 'doctor', '--api'])).toMatchObject({ kind: 'doctor', api: true });
    expect(() => parseCli(['sessions', '--api'])).toThrow(UsageError);
  });

  it('prints counts per store and fails when one looks broken', async () => {
    const home = mkdtempSync(join(tmpdir(), 'genaicode-doctor-'));
    dirs.push(home);
    const listed = (prompt?: string) =>
      Array.from({ length: 6 }, (_, at) => ({
        source: 'alpha',
        agent: 'alpha',
        id: `s${at}`,
        where: 'local' as const,
        updatedAt: Date.now(),
        cwd: '/work',
        ...(prompt ? { lastPrompt: prompt } : {}),
      }));
    const run = async (prompt?: string) => {
      const agent = {
        ...fakeAgent('alpha', []),
        sessions: { name: 'alpha', where: 'local' as const, list: async () => listed(prompt) },
      };
      const { cli, out } = environment({
        argv: ['sessions', 'doctor'],
        env: { HOME: home, PATH: '' },
        agents: [agent],
      });
      return { code: await main(cli), out: out() };
    };
    const fine = await run('do it');
    expect(fine.code).toBe(EXIT_OK);
    expect(fine.out).toContain('alpha  not installed  ok');
    expect(fine.out).toContain('6 sessions: 6 with a prompt or title, 6 with a directory');
    const broken = await run();
    expect(broken.code).toBe(EXIT_FAILED);
    expect(broken.out).toContain('! only 0 of the 6 newest sessions have a prompt or a title');
  });
});

describe('genaicode sessions --waiting', () => {
  it('parses, and belongs to the listing only', () => {
    expect(parseCli(['sessions', '-w', '-n', '5'])).toMatchObject({ kind: 'sessions', waiting: true, limit: 5 });
    expect(parseCli(['sessions'])).not.toHaveProperty('waiting');
    expect(() => parseCli(['sessions', 'doctor', '--waiting'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'mcp', '--waiting'])).toThrow(UsageError);
    expect(parseCli(['sessions', 'approve', 'abc'])).toEqual({ kind: 'answer', id: 'abc', behavior: 'allow' });
    expect(parseCli(['sessions', 'deny', 'abc', '-m', 'no'])).toEqual({
      kind: 'answer',
      id: 'abc',
      behavior: 'deny',
      message: 'no',
    });
    expect(() => parseCli(['sessions', 'approve'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'approve', 'abc', '-m', 'x'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', '-m', 'x'])).toThrow(UsageError);
  });

  it('lists what waits for you, approvals first, with the command that continues it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'genaicode-waiting-'));
    dirs.push(home);
    const now = Date.now();
    const listed = [
      { id: 'busy', state: 'active' as const, updatedAt: now - 1000, title: 'Working on it' },
      {
        id: 'reply',
        state: 'waiting' as const,
        updatedAt: now - 10 * 60 * 1000,
        title: 'Add CSV export',
        lastReply: 'Done.\nPush it?',
      },
      {
        id: 'asks',
        state: 'waiting' as const,
        waitingFor: 'approval' as const,
        waitingTool: 'Bash',
        updatedAt: now - 60 * 60 * 1000,
        lastPrompt: 'deploy',
      },
      { id: 'stale', state: 'waiting' as const, updatedAt: now - 30 * 24 * 60 * 60 * 1000, title: 'Old' },
    ].map((one) => ({ source: 'alpha', agent: 'alpha', where: 'local' as const, cwd: '/work/app', ...one }));
    const agent = {
      ...fakeAgent('alpha', []),
      sessions: {
        name: 'alpha',
        where: 'local' as const,
        list: async (query?: { since?: number }) =>
          listed.filter((one) => query?.since === undefined || one.updatedAt >= query.since),
      },
    };
    const run = async (...argv: string[]) => {
      const { cli, out } = environment({ argv: ['sessions', ...argv], env: { HOME: home, PATH: '' }, agents: [agent] });
      return { code: await main(cli), out: out() };
    };
    // A question its hook holds open for an answer from here.
    const asks = join(home, '.genaicode', 'asks');
    mkdirSync(asks, { recursive: true });
    const open = { id: '0123456789ab', agent: 'alpha', session: 'asks', tool: 'Bash', preview: 'npm run deploy' };
    writeFileSync(join(asks, `${open.id}.json`), JSON.stringify({ ...open, at: now, pid: process.pid }));
    const { code, out } = await run('--waiting');
    expect(code).toBe(EXIT_OK);
    expect(out).toContain('  ? Bash: npm run deploy\n    genaicode sessions approve 0123456789ab   (or: sessions deny');

    const answer = async (...argv: string[]) => {
      const { cli, out, err } = environment({ argv: ['sessions', ...argv], env: { HOME: home, PATH: '' } });
      return { code: await main(cli), out: out(), err: err() };
    };
    expect(await answer('deny', open.id, '-m', 'not today')).toMatchObject({ code: EXIT_OK, out: 'Denied.\n' });
    expect(JSON.parse(readFileSync(join(asks, `${open.id}.answer`), 'utf8'))).toEqual({
      behavior: 'deny',
      message: 'not today',
    });
    const again = await answer('approve', open.id);
    expect(again.code).toBe(EXIT_FAILED);
    expect(again.err).toContain('No open question 0123456789ab');
    expect(out).toMatch(/^2 sessions wait for you in the last 7d, 1 for approval, 1 asks you something:/);
    expect(out.indexOf('asks to use Bash')).toBeLessThan(out.indexOf('Add CSV export'));
    expect(out).toContain('  asks: Done. Push it?\n  genaicode chat -a alpha -C /work/app -r reply\n');
    expect(out).not.toContain('Working on it');
    expect(out).not.toContain('Old');
    expect((await run('-w', '--since', '60d')).out).toContain('Old');
    expect((await run('-w', '-n', '1')).out).toMatch(/^1 session waits for you/);
    expect((await run('-w', '--since', '1m')).out).toBe('Nothing waits for you in the last 1m.\n');
  });

  it('limits shows what the agents last said of their plans, and keeps a status line input', async () => {
    expect(parseCli(['limits'])).toEqual({ kind: 'limits', action: 'show', json: false });
    expect(() => parseCli(['limits', 'record', '--json'])).toThrow(UsageError);
    expect(() => parseCli(['limits', 'reset'])).toThrow(UsageError);
    const home = mkdtempSync(join(tmpdir(), 'genaicode-limits-'));
    dirs.push(home);
    const env = { HOME: home, PATH: '' };
    const run = async (argv: string[], stdin?: string) => {
      const { cli, out } = environment({ argv, env });
      expect(await main({ ...cli, readStdin: async () => stdin })).toBe(0);
      return out();
    };
    expect(await run(['limits'])).toContain('No limits known yet');
    expect(await run(['limits', 'record'], 'not json')).toBe('');
    const resets = Math.round(Date.now() / 1000) + 2 * 3600;
    const line = await run(
      ['limits', 'record'],
      JSON.stringify({
        rate_limits: {
          five_hour: { used_percentage: 61.6, resets_at: resets },
          seven_day: { used_percentage: 85, resets_at: resets + 86_400 },
        },
      }),
    );
    expect(line).toBe('5h 62% · 7d 85%\n');
    const shown = await run(['limits']);
    expect(shown).toMatch(/^claude\s+5h\s+62% used\s+resets in 2 h\s+\(read just now\)$/m);
    expect(shown).toMatch(/^\s+7d\s+85% used\s+resets in 26 h\s/m);
    const { limits } = JSON.parse(await run(['limits', '--json'])) as { limits: Record<string, unknown>[] };
    expect(limits).toMatchObject([
      { agent: 'claude', window: '5h', status: 'ok', usedPercent: 61.6, resetsAt: resets * 1000 },
      { agent: 'claude', window: '7d', status: 'warning', usedPercent: 85 },
    ]);
  });

  it('--watch prints the waiting sessions again when they change, until its stdin closes', async () => {
    expect(parseCli(['sessions', '-w', '--json', '--watch', '--exit-with-stdin'])).toMatchObject({
      kind: 'sessions',
      watch: true,
      exitWithStdin: true,
    });
    expect(() => parseCli(['sessions', '--watch'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', '-w', '--watch'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'doctor', '--json', '-w', '--watch'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', '-w', '--json', '--exit-with-stdin'])).toThrow(UsageError);

    const home = mkdtempSync(join(tmpdir(), 'genaicode-watch-'));
    dirs.push(home);
    const base = { source: 'alpha', agent: 'alpha', where: 'local' as const, cwd: '/work/app' };
    const listed = [{ ...base, id: 'one', state: 'waiting' as const, updatedAt: Date.now() - 1000, title: 'First' }];
    let looks = 0;
    const agent = {
      ...fakeAgent('alpha', []),
      sessions: {
        name: 'alpha',
        where: 'local' as const,
        list: async () => {
          looks += 1;
          return [...listed];
        },
      },
    };
    const { PassThrough } = await import('node:stream');
    const input = new PassThrough();
    const { cli, out } = environment({
      argv: ['sessions', '--waiting', '--json', '--watch', '--exit-with-stdin'],
      env: { HOME: home, PATH: '' },
      agents: [agent],
    });
    const done = main({ ...cli, input, watchEveryMs: 5 });
    const lines = () =>
      out()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { sessions: { id: string }[] });
    await vi.waitFor(() => expect(looks).toBeGreaterThan(3));
    // Nothing changed: one line, however often it looked.
    expect(lines().map((line) => line.sessions.map((one) => one.id))).toEqual([['one']]);
    listed.push({ ...base, id: 'two', state: 'waiting' as const, updatedAt: Date.now(), title: 'Second' });
    await vi.waitFor(() => expect(lines()).toHaveLength(2));
    expect(
      lines()[1]!
        .sessions.map((one) => one.id)
        .sort(),
    ).toEqual(['one', 'two']);
    input.end();
    expect(await done).toBe(EXIT_OK);

    // Ctrl-C ends it too, and lets go of a stdin that is still open.
    const open = new PassThrough();
    const stop = new AbortController();
    const second = main({ ...cli, input: open, signal: stop.signal, watchEveryMs: 5 });
    const before = looks;
    await vi.waitFor(() => expect(looks).toBeGreaterThan(before + 2));
    stop.abort();
    expect(await second).toBe(EXIT_OK);
    expect(open.isPaused()).toBe(true);
    expect(open.listenerCount('end') + open.listenerCount('close')).toBe(0);
  });
});

describe('genaicode sessions archive', () => {
  it('parses, and keeps --stale and ids apart', () => {
    expect(parseCli(['sessions', 'archive', 'a', 'b'])).toEqual({
      kind: 'archive',
      ids: ['a', 'b'],
      archived: true,
      stale: false,
    });
    expect(parseCli(['sessions', 'archive', '--stale', '--older', '5d', '-a', 'codex'])).toEqual({
      kind: 'archive',
      ids: [],
      archived: true,
      stale: true,
      olderMs: 5 * 24 * 3600_000,
      agent: 'codex',
    });
    expect(parseCli(['sessions', 'unarchive', 'a'])).toMatchObject({ kind: 'archive', archived: false });
    expect(parseCli(['sessions', '--archived'])).toMatchObject({ kind: 'sessions', archived: true });
    expect(() => parseCli(['sessions', 'archive'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'archive', 'a', '--stale'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'archive', 'a', '--older', '2d'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'unarchive', '--stale'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', '--stale'])).toThrow(UsageError);
  });

  it('puts away what was left for days, hides it, and brings it back', async () => {
    const home = mkdtempSync(join(tmpdir(), 'genaicode-archive-'));
    dirs.push(home);
    const now = Date.now();
    const day = 24 * 3600_000;
    const listed = [
      { id: 'fresh-one', state: 'waiting' as const, updatedAt: now - 1000, title: 'Fresh' },
      { id: 'busy-one', state: 'active' as const, updatedAt: now - 3 * day, title: 'Busy' },
      { id: 'left-one', state: 'unfinished' as const, updatedAt: now - 3 * day, title: 'Left half way' },
      { id: 'idle-one', state: 'waiting' as const, updatedAt: now - 4 * day, title: 'Never answered' },
    ].map((one) => ({ source: 'alpha', agent: 'alpha', where: 'local' as const, cwd: '/work/app', ...one }));
    const agent = {
      ...fakeAgent('alpha', []),
      sessions: { name: 'alpha', where: 'local' as const, list: async () => listed },
    };
    const run = async (...argv: string[]) => {
      const { cli, out, err } = environment({
        argv: ['sessions', ...argv],
        env: { HOME: home, PATH: '' },
        agents: [agent],
      });
      return { code: await main(cli), out: out(), err: err() };
    };
    expect((await run()).out).toContain('genaicode sessions archive --stale');
    const archived = await run('archive', '--stale');
    expect(archived.code).toBe(EXIT_OK);
    expect(archived.out).toMatch(/^Archived 2 sessions left for 2d or more:/);
    expect(archived.out).toContain('Never answered');
    expect(archived.out).not.toContain('Busy');
    const list = await run();
    expect(list.out).toContain('Fresh');
    expect(list.out).not.toContain('Left half way');
    expect(list.out).toContain('2 archived not shown: --archived shows them.');
    expect((await run('--archived')).out).toMatch(/archived\s+Left half way/);
    expect((await run('archive', '--stale')).out).toBe('No session left for 2d or more.\n');
    expect((await run('unarchive', 'idle-one')).out).toBe('Brought back 1 session.\n');
    expect((await run()).out).toContain('Never answered');
    expect((await run('archive', 'fresh-one')).out).toBe('Archived 1 session.\n');
    expect((await run('-w')).out).not.toContain('Fresh');
    const missing = await run('archive', 'nope');
    expect(missing.code).toBe(EXIT_FAILED);
    expect(missing.err).toContain('No session "nope"');
  });
});

describe('genaicode sessions mcp', () => {
  it('parses, and refuses the options of the listing', () => {
    expect(parseCli(['sessions', 'mcp'])).toEqual({ kind: 'sessions-mcp' });
    expect(parseCli(['sessions', 'mcp', '-a', 'codex'])).toEqual({ kind: 'sessions-mcp', agent: 'codex' });
    expect(() => parseCli(['sessions', 'mcp', '--json'])).toThrow(UsageError);
    expect(() => parseCli(['sessions', 'mcp', '--since', '7d'])).toThrow(UsageError);
  });

  it('serves the tools on stdio until the input ends', async () => {
    const home = mkdtempSync(join(tmpdir(), 'genaicode-index-'));
    dirs.push(home);
    const agent = {
      ...fakeAgent('alpha', []),
      sessions: {
        name: 'alpha',
        where: 'local' as const,
        list: async () => [
          { source: 'alpha', agent: 'alpha', id: 's1', where: 'local' as const, updatedAt: Date.now(), cwd: '/work' },
        ],
      },
    };
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sessions_projects' } };
    const { cli, out } = environment({
      argv: ['sessions', 'mcp'],
      env: { HOME: home, PATH: '' },
      agents: [agent],
      input: Readable.from([`${JSON.stringify(call)}\n`]),
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(JSON.parse(out()).result.content[0].text).toContain('work  /work');

    const none = environment({ argv: ['sessions', 'mcp', '-a', 'nobody'], agents: [agent] });
    expect(await main(none.cli)).toBe(EXIT_USAGE);
  });
});

describe('genaicode notify', () => {
  it('parses its actions', () => {
    expect(parseCli(['notify'])).toEqual({ kind: 'notify', action: 'status', done: false });
    expect(parseCli(['notify', 'on', '--done'])).toEqual({ kind: 'notify', action: 'on', done: true });
    expect(() => parseCli(['notify', 'off', '--done'])).toThrow(UsageError);
    expect(() => parseCli(['notify', 'loud'])).toThrow(UsageError);
  });

  it('turns notifications on and off, says when the hooks are missing, and sends a test', async () => {
    const home = mkdtempSync(join(tmpdir(), 'genaicode-notify-'));
    dirs.push(home);
    const sent: string[] = [];
    const run = async (...argv: string[]) => {
      const { cli, out } = environment({
        argv: ['notify', ...argv],
        env: { HOME: home, PATH: '' },
        notify: (notice) => (sent.push(notice.body), true),
      });
      return { code: await main(cli), out: out() };
    };
    expect((await run()).out).toContain('Notifications off');
    const on = await run('on', '--done');
    expect(on.out).toContain('Notifications on: when a session asks for approval or finishes its turn');
    expect(on.out).toContain('run "genaicode hooks install"');
    expect((await run('off')).out).toContain('Notifications off');
    expect(await run('test')).toMatchObject({ code: EXIT_OK, out: 'Sent a test notification.\n' });
    expect(sent).toEqual(['Notifications work.']);
  });
});

describe('genaicode hooks', () => {
  it('parses the action and refuses what it does not know', () => {
    expect(parseCli(['hooks'])).toEqual({ kind: 'hooks', action: 'status' });
    expect(parseCli(['hooks', 'install', '-a', 'codex'])).toEqual({ kind: 'hooks', action: 'install', agent: 'codex' });
    expect(parseCli(['hooks', 'install', '--answer'])).toEqual({ kind: 'hooks', action: 'install', answer: true });
    expect(() => parseCli(['hooks', 'status', '--answer'])).toThrow(UsageError);
    expect(() => parseCli(['hooks', 'explode'])).toThrow(UsageError);
  });

  it('installs for the agents found, reports and removes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'genaicode-hooks-'));
    dirs.push(home);
    const env = { PATH: pathWith('claude-cli'), HOME: home };
    const agents = [fakeAgent('claude', []), fakeAgent('codex', [])];
    const run = async (...argv: string[]) => {
      const { cli, out, err } = environment({ argv, env, agents });
      return { code: await main(cli), out: out(), err: err() };
    };

    const installed = await run('hooks', 'install');
    expect(installed.code).toBe(EXIT_OK);
    expect(installed.out).toContain(`claude: hook added to ${join(home, '.claude', 'settings.json')}`);
    expect(installed.out).toContain('codex: not installed, skipped');
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PermissionRequest[0].hooks[0].command).toMatch(/ hook claude --genaicode-live$/);

    const status = await run('hooks');
    expect(status.out).toMatch(/claude: installed/);
    expect(status.out).toMatch(/codex: not installed/);
    expect(status.out).toContain('0 open sessions reported');

    const answering = await run('hooks', 'install', '--answer');
    expect(answering.out).toContain('also be answered with "genaicode sessions approve|deny"');
    expect((await run('hooks')).out).toMatch(/claude: installed, answers from here/);
    expect((await run('hooks', 'uninstall', '-a', 'claude')).out).toContain('claude: hook removed');
    expect((await run('hooks', 'install', '-a', 'muse')).code).toBe(EXIT_USAGE);
    // Asked for by name, Codex gets its hook though its CLI is not on the PATH.
    expect((await run('hooks', 'install', '-a', 'codex')).out).toContain('trust it');
  });
});
