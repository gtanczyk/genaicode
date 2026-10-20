import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { createAppAgent, type AppAgent, type AppAgentOptions } from './app-agent.js';
import { PROMPT_MARKER, userText } from './state.js';
import { commitTree, snapshotTree, treeChanges } from './git.js';
import { createAppAgentHandler, type AppAgentHandlerOptions } from './http.js';

type Step = (task: AgentTask) => Promise<string>;

/** An agent whose turns run `steps` in order; each step's text is the reply. Calls MCP like a CLI would. */
function fakeAgent(steps: Step[], name = 'fake'): { agent: CodingAgent; tasks: AgentTask[] } {
  const tasks: AgentTask[] = [];
  const agent: CodingAgent = {
    name,
    command: process.execPath,
    capabilities: { resume: true, mcp: true },
    run(task): AgentRun {
      tasks.push(task);
      const step = steps.shift() ?? (async (t: AgentTask) => `echo: ${userText(t.prompt)}`);
      const done = step(task).then((text) => {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, sessionId: 's1' };
        return { text, result };
      });
      return {
        result: done.then(({ result }) => result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          const { text, result } = await done;
          const events: AgentEvent[] = [
            { type: 'session', sessionId: 's1' },
            { type: 'message', text },
            { type: 'done', result },
          ];
          yield* events;
        },
      };
    },
  };
  return { agent, tasks };
}

/** What a CLI agent sends to the app's MCP endpoint. */
async function mcp(task: AgentTask, method: string, params: Record<string, unknown> = {}) {
  const server = task.mcpServers![0] as { url: string; headers?: Record<string, string> };
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await response.json()) as {
    result?: { content?: Array<{ text: string }>; isError?: boolean; tools?: unknown[] };
  };
}

const callTool = async (task: AgentTask, name: string, args: Record<string, unknown> = {}) =>
  (await mcp(task, 'tools/call', { name, arguments: args })).result!;

let servers: Server[] = [];
let agents: AppAgent[] = [];
afterEach(async () => {
  for (const agent of agents) agent.close();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  servers = [];
  agents = [];
});

async function serve(
  options: Omit<AppAgentOptions, 'mcpUrl'>,
  handlerOptions: AppAgentHandlerOptions = {},
): Promise<{ agent: AppAgent; base: string }> {
  let base = '';
  const agent = createAppAgent({ ...options, mcpUrl: () => `${base}/api/agent/mcp` });
  const handle = createAppAgentHandler(agent, handlerOptions);
  const server = createServer((req, res) => {
    void handle(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end('app');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  servers.push(server);
  agents.push(agent);
  return { agent, base };
}

const post = (base: string, route: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/agent${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

async function settle(agent: AppAgent) {
  for (let i = 0; i < 200; i++) {
    const state = agent.get();
    if (state.session?.status !== 'running' && !state.actions.some((a) => a.status === 'running')) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('agent did not settle');
}

const lastText = (agent: AppAgent) => {
  const entries = agent.get().session!.turns.at(-1)!.entries;
  return entries
    .filter((e) => e.kind === 'text')
    .map((e) => (e as { text: string }).text)
    .join('');
};

describe('createAppAgent', () => {
  it('briefs the first prompt, adds the open page, and keeps the user text recoverable', async () => {
    const { agent: fake, tasks } = fakeAgent([]);
    const { agent, base } = await serve({
      name: 'the test console',
      agents: () => [fake],
      pages: () => ['/admin/jobs', '/admin/costs'],
      instructions: 'Costs are in USD.',
    });
    await post(base, '/view', { path: '/admin/jobs' });
    await post(base, '/send', { text: 'how many jobs?' });
    await settle(agent);
    await post(base, '/send', { text: 'and now?' });
    await settle(agent);

    expect(tasks[0]!.prompt).toContain('You are the assistant inside the test console');
    expect(tasks[0]!.prompt).toContain('Costs are in USD.');
    expect(tasks[0]!.prompt).toContain(`[The user has /admin/jobs open]${PROMPT_MARKER}how many jobs?`);
    expect(tasks[1]!.prompt).toBe(`[The user has /admin/jobs open]${PROMPT_MARKER}and now?`);
    expect(tasks[0]!.mcpServers![0]!.name).toBe('app');
    expect(lastText(agent)).toBe('echo: and now?');
  });

  it('runs read tools at once and turns write tools into actions the user approves', async () => {
    const written: unknown[] = [];
    const { agent: fake } = fakeAgent([
      async (task) => {
        const listed = await mcp(task, 'tools/list');
        const read = await callTool(task, 'jobs_count');
        const write = await callTool(task, 'retry_job', { id: 'j1', approval_summary: 'Retry job j1' });
        return `${listed.result!.tools!.length} tools; ${read.content![0]!.text}; ${write.content![0]!.text}`;
      },
    ]);
    const { agent, base } = await serve({
      name: 'app',
      agents: () => [fake],
      tools: [
        { name: 'jobs_count', description: 'Count jobs.', run: () => '3 jobs' },
        {
          name: 'retry_job',
          description: 'Retry a job.',
          write: true,
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          run: (args) => {
            written.push(args);
            return 'retried';
          },
        },
      ],
    });
    await post(base, '/send', { text: 'retry the failed one' });
    await settle(agent);

    expect(lastText(agent)).toBe(
      '2 tools; 3 jobs; Waiting for the user as action #1. You will get a message with the outcome.',
    );
    expect(written).toEqual([]);
    const [action] = agent.get().actions;
    expect(action).toMatchObject({ id: '1', kind: 'tool', summary: 'Retry job j1', status: 'pending' });
    expect(action!.tool).toEqual({ name: 'retry_job', args: { id: 'j1' } });

    const decided = await post(base, '/actions/1', { decision: 'approve' });
    expect(decided.status).toBe(200);
    await settle(agent);
    expect(written).toEqual([{ id: 'j1' }]);
    expect(agent.get().actions[0]).toMatchObject({ status: 'done', result: 'retried' });
    expect(agent.get().session!.turns.at(-1)!.prompt).toContain(
      'The user approved action #1 (Retry job j1). Result:\nretried',
    );

    expect((await post(base, '/actions/1', { decision: 'reject' })).status).toBe(409);
  });

  it('tells the agent about a rejection and refuses writes the tool does not validate', async () => {
    const { agent: fake } = fakeAgent([
      async (task) => {
        const bad = await callTool(task, 'delete', { id: 'root', approval_summary: 'x' });
        await callTool(task, 'delete', { id: 'a', approval_summary: 'Delete a' });
        return bad.isError ? `refused: ${bad.content![0]!.text}` : 'accepted';
      },
    ]);
    const { agent, base } = await serve({
      name: 'app',
      agents: () => [fake],
      tools: [
        {
          name: 'delete',
          description: 'Delete.',
          write: true,
          validate: (args) => {
            if (args.id === 'root') throw new Error('root cannot be deleted');
          },
          run: () => 'deleted',
        },
      ],
    });
    await post(base, '/send', { text: 'go' });
    await settle(agent);
    expect(lastText(agent)).toBe('refused: root cannot be deleted');
    expect(agent.get().actions).toHaveLength(1);

    await post(base, '/actions/1', { decision: 'reject' });
    await settle(agent);
    expect(agent.get().actions[0]!.status).toBe('rejected');
    expect(userText(agent.get().session!.turns.at(-1)!.prompt)).toBe('[app] The user rejected action #1 (Delete a).');
  });

  it('offers page chips and opens known pages only', async () => {
    const { agent: fake } = fakeAgent([
      async (task) => {
        await callTool(task, 'app_links', { links: [{ label: 'Costs', path: '/admin/costs' }] });
        const bad = await callTool(task, 'app_open', { path: 'https://evil.example' });
        await callTool(task, 'app_open', { path: '/admin/costs' });
        return String(bad.isError);
      },
    ]);
    const { agent, base } = await serve({ name: 'app', agents: () => [fake], pages: () => ['/admin/costs'] });
    await post(base, '/send', { text: 'where are costs?' });
    const state = await settle(agent);
    expect(lastText(agent)).toBe('true');
    expect(state.links).toEqual([{ turnId: 1, label: 'Costs', path: '/admin/costs' }]);
    expect(state.navigation).toEqual({ id: 1, path: '/admin/costs' });
  });

  it('switches mode and agent between turns and starts a fresh conversation', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'app-agent-dev-'));
    const use = fakeAgent([], 'one');
    const dev = fakeAgent([], 'one');
    const { agent, base } = await serve({
      name: 'app',
      agents: (mode) => [mode === 'dev' ? dev.agent : use.agent],
      dev: { cwd: dir, commands: ['npm test'] },
    });
    expect(agent.get().modes).toEqual(['use', 'dev']);
    expect((await post(base, '/config', { mode: 'nope' })).status).toBe(400);
    expect((await post(base, '/config', { agent: 'missing' })).status).toBe(400);
    await post(base, '/config', { mode: 'dev' });
    await post(base, '/send', { text: 'fix it' });
    await settle(agent);
    expect(dev.tasks[0]!.cwd).toBe(dir);
    expect(dev.tasks[0]!.prompt).toContain('You may run: npm test.');
    expect(use.tasks).toHaveLength(0);
  });

  it('picks an agent the target mode offers when only the mode changes', async () => {
    const use = fakeAgent([], 'reader');
    const dev = fakeAgent([], 'editor');
    const { agent, base } = await serve({
      name: 'app',
      agents: (mode) => [mode === 'dev' ? dev.agent : use.agent],
      dev: { cwd: mkdtempSync(path.join(tmpdir(), 'app-agent-dev-')) },
    });
    expect((await post(base, '/config', { mode: 'dev' })).status).toBe(200);
    expect(agent.get()).toMatchObject({ mode: 'dev', agent: 'editor' });
    await post(base, '/config', { mode: 'use' });
    expect(agent.get()).toMatchObject({ mode: 'use', agent: 'reader' });
  });

  it('streams view changes and never drops pending actions at the cap', async () => {
    const { agent: fake } = fakeAgent([
      async (task) => {
        for (let i = 0; i < 55; i++) await callTool(task, 'retry_job', { id: `j${i}`, approval_summary: `Retry ${i}` });
        return 'proposed';
      },
    ]);
    const { agent, base } = await serve({
      name: 'app',
      agents: () => [fake],
      tools: [{ name: 'retry_job', description: 'Retry a job', write: true, run: () => 'ok' }],
    });
    const seen: Array<string | null> = [];
    agent.subscribe((state) => seen.push(state.view));
    expect((await post(base, '/view', { path: '/jobs' })).status).toBe(204);
    expect(seen.at(-1)).toBe('/jobs');
    await post(base, '/send', { text: 'retry all' });
    await settle(agent);
    expect(agent.get().actions).toHaveLength(55);
    expect(agent.get().actions[0]!.id).toBe('1');
  });

  it('refuses tool names that are taken', () => {
    const tool = { name: 'propose_commit', description: 'x', run: () => 'ok' };
    expect(() => createAppAgent({ name: 'app', mcpUrl: 'http://127.0.0.1:1/mcp', tools: [tool] })).toThrow(/taken/);
    const twice = [
      { ...tool, name: 'jobs' },
      { ...tool, name: 'jobs' },
    ];
    expect(() => createAppAgent({ name: 'app', mcpUrl: 'http://127.0.0.1:1/mcp', tools: twice })).toThrow(/taken/);
  });

  it('refuses a write tool that declares the reserved approval_summary argument', () => {
    expect(() =>
      createAppAgent({
        name: 'app',
        mcpUrl: 'http://127.0.0.1:1/mcp',
        tools: [
          {
            name: 'file',
            description: 'x',
            write: true,
            inputSchema: { type: 'object', properties: { approval_summary: { type: 'string' } } },
            run: () => 'ok',
          },
        ],
      }),
    ).toThrow(/approval_summary/);
  });

  it('keeps prompts queued behind a running turn when a commit is approved', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'app-agent-queue-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    let release = () => {};
    const { agent: fake, tasks } = fakeAgent([
      async (task) => {
        writeFileSync(path.join(repo, 'a.txt'), 'two\n');
        await callTool(task, 'propose_commit', { message: 'Change a' });
        await new Promise<void>((resolve) => (release = resolve));
        return 'proposed';
      },
    ]);
    const { agent, base } = await serve({ name: 'app', agents: () => [fake], dev: { cwd: repo } });
    await post(base, '/config', { mode: 'dev' });
    await post(base, '/send', { text: 'change a' });
    for (let i = 0; i < 200 && !agent.get().actions.length; i++) await new Promise((r) => setTimeout(r, 10));
    await post(base, '/send', { text: 'and then this' });
    expect(agent.get().session!.queued).toHaveLength(1);
    await post(base, '/actions/1', { decision: 'approve' });
    for (let i = 0; i < 200 && agent.get().actions[0]!.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    release();
    await settle(agent);
    expect(agent.get().actions[0]!.status).toBe('done');
    expect(tasks.map((task) => userText(task.prompt))).toContain('and then this');
  });

  it('commits exactly the reviewed tree in dev mode', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'app-agent-repo-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-qm', 'init');

    const { agent: fake } = fakeAgent([
      async (task) => {
        writeFileSync(path.join(repo, 'a.txt'), 'two\n');
        const proposed = await callTool(task, 'propose_commit', { message: 'Change a\n\nBody.' });
        return proposed.content![0]!.text;
      },
      // The commit outcome arrives as a turn of its own.
      async () => 'noted',
      async (task) => {
        writeFileSync(path.join(repo, 'a.txt'), 'three\n');
        await callTool(task, 'propose_commit', { message: 'Change a again' });
        // Edited after proposing: the reviewed tree no longer matches.
        writeFileSync(path.join(repo, 'a.txt'), 'four\n');
        return 'done';
      },
    ]);
    const { agent, base } = await serve({ name: 'app', agents: () => [fake], dev: { cwd: repo } });
    await post(base, '/config', { mode: 'dev' });
    await post(base, '/send', { text: 'change a' });
    await settle(agent);

    const changes = (await (await fetch(`${base}/api/agent/actions/1/changes`)).json()) as {
      files: unknown[];
      diff: string;
    };
    expect(changes.files).toEqual([{ status: 'M', path: 'a.txt' }]);
    expect(changes.diff).toContain('+two');

    await post(base, '/actions/1', { decision: 'approve' });
    await settle(agent);
    expect(agent.get().actions[0]!.status).toBe('done');
    expect(git('log', '-1', '--format=%s')).toBe('Change a\n');
    expect(git('status', '--porcelain')).toBe('');

    await post(base, '/send', { text: 'again' });
    await settle(agent);
    await post(base, '/actions/2', { decision: 'approve' });
    await settle(agent);
    expect(agent.get().actions[1]).toMatchObject({ status: 'failed' });
    expect(agent.get().actions[1]!.result).toContain('changed after they were reviewed');
    expect(git('log', '-1', '--format=%s')).toBe('Change a\n');
    expect(readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('four\n');
  });
});

describe('commitTree', () => {
  it('undoes a commit whose hook rewrote the reviewed files', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'app-agent-hook-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho hooked > a.txt\ngit add a.txt\n', {
      mode: 0o755,
    });
    writeFileSync(path.join(repo, 'a.txt'), 'two\n');
    const result = await commitTree(repo, await snapshotTree(repo), 'Change a');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('commit hook changed the files');
    expect(git('log', '--format=%s')).toBe('init\n');
    expect(git('diff', '--cached', '--name-only')).toBe('');
    expect(readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('hooked\n');
  });

  it("keeps the user's index when the commit fails", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'app-agent-hook-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    writeFileSync(path.join(repo, 'b.txt'), 'one\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(path.join(repo, 'a.txt'), 'two\n');
    writeFileSync(path.join(repo, 'b.txt'), 'two\n');
    git('add', 'a.txt');
    const result = await commitTree(repo, await snapshotTree(repo), 'Change');
    expect(result.ok).toBe(false);
    expect(git('diff', '--cached', '--name-only')).toBe('a.txt\n');
    expect(git('log', '--format=%s')).toBe('init\n');
  });
});

describe('first commit', () => {
  it('works in a repository without commits', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'app-agent-unborn-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    const tree = await snapshotTree(repo);
    expect((await treeChanges(repo, tree)).files).toEqual([{ status: 'A', path: 'a.txt' }]);
    expect((await commitTree(repo, tree, 'First')).ok).toBe(true);
    expect(git('log', '--format=%s')).toBe('First\n');
    expect(git('status', '--porcelain')).toBe('');
  });
});

describe('conversation across switches', () => {
  it('keeps earlier turns as history, carries a transcript to the next agent, and reset clears it', async () => {
    const one = fakeAgent([], 'one');
    const two = fakeAgent([], 'two');
    const records: Array<{ kind: string }> = [];
    const { agent, base } = await serve({
      name: 'app',
      agents: () => [one.agent, two.agent],
      pages: () => ['/a'],
      trace: (record) => records.push(record),
    });
    one.tasks.length = 0;
    await post(base, '/send', { text: 'first question' });
    await settle(agent);
    await post(base, '/config', { agent: 'two' });
    let state = agent.get();
    expect(state.session).toBeNull();
    expect(state.history.map((turn) => [turn.id, turn.agent])).toEqual([[-1, 'one']]);

    await post(base, '/send', { text: 'second' });
    await settle(agent);
    expect(two.tasks[0]!.prompt).toContain(
      'Earlier in this conversation, with another agent or mode:\nUser: first question\none: echo: first question',
    );
    expect(userText(two.tasks[0]!.prompt)).toBe('second');

    expect(records.map((record) => record.kind)).toEqual(['prompt', 'session', 'turn', 'prompt', 'session', 'turn']);

    await post(base, '/reset');
    state = agent.get();
    expect(state.history).toEqual([]);
    await post(base, '/send', { text: 'fresh' });
    await settle(agent);
    expect(two.tasks.at(-1)!.prompt).not.toContain('Earlier in this conversation');
  });

  it('tells the next agent how an action proposed before a switch ended', async () => {
    const one = fakeAgent(
      [
        async (task) => {
          await callTool(task, 'retry_job', { id: 'j1', approval_summary: 'Retry j1' });
          return 'proposed';
        },
      ],
      'one',
    );
    const two = fakeAgent([], 'two');
    const { agent, base } = await serve({
      name: 'app',
      agents: () => [one.agent, two.agent],
      tools: [{ name: 'retry_job', description: 'Retry a job', write: true, run: () => 'retried' }],
    });
    await post(base, '/send', { text: 'retry j1' });
    await settle(agent);
    await post(base, '/config', { agent: 'two' });
    await post(base, '/actions/1', { decision: 'approve' });
    await settle(agent);
    await post(base, '/send', { text: 'done?' });
    await settle(agent);
    expect(two.tasks[0]!.prompt).toContain('The user approved action #1 (Retry j1). Result:\nretried');
  });

  it('answers the agent CLI permission prompts through the handler', async () => {
    let resolveApproval: (decision: string) => void = () => {};
    const asked: CodingAgent = {
      name: 'asker',
      command: process.execPath,
      capabilities: { approvals: true },
      run(task): AgentRun {
        const decision = task.onApproval!({ id: 'ap1', kind: 'command', summary: 'npm test' });
        const result = Promise.resolve(decision).then((answer) => {
          resolveApproval(answer);
          return { status: 'completed', ok: true, exitCode: 0, signal: null } as AgentResult;
        });
        return {
          result,
          abort() {},
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'approval-request',
              request: { id: 'ap1', kind: 'command', summary: 'npm test' },
            } as AgentEvent;
            yield { type: 'done', result: await result } as AgentEvent;
          },
        };
      },
    };
    const answered = new Promise<string>((resolve) => (resolveApproval = resolve));
    const { agent, base } = await serve({ name: 'app', agents: () => [asked] });
    await post(base, '/send', { text: 'test it' });
    for (let i = 0; i < 100 && !agent.get().session?.approvals.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(agent.get().session!.approvals.map((request) => request.id)).toEqual(['ap1']);
    expect((await post(base, '/approvals/ap1', { decision: 'maybe' })).status).toBe(400);
    expect((await post(base, '/approvals/ap1', { decision: 'approve' })).status).toBe(200);
    expect(await answered).toBe('approve');
    expect((await post(base, '/approvals/ap1', { decision: 'approve' })).status).toBe(404);
  });
});

describe('createAppAgentHandler', () => {
  it('guards the MCP endpoint and refuses cross-site requests', async () => {
    const { agent: fake } = fakeAgent([]);
    const { agent, base } = await serve({ name: 'app', agents: () => [fake] });
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await post(base, '/mcp', rpc)).status).toBe(401);
    expect((await post(base, '/mcp', rpc, { authorization: 'Bearer nope' })).status).toBe(401);
    const bearer = { authorization: `Bearer ${agent.mcpToken}` };
    expect((await post(base, '/mcp', rpc, { ...bearer, origin: base })).status).toBe(403);
    expect((await post(base, '/mcp', rpc, bearer)).status).toBe(200);
    expect((await post(base, '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, bearer)).status).toBe(
      202,
    );

    expect((await post(base, '/send', { text: 'x' }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(base, '/send', { text: 'x' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await fetch(`${base}/api/agent/state`, { headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403);
    expect((await post(base, '/send', { text: '  ' })).status).toBe(400);
    expect((await fetch(`${base}/other`)).status).toBe(404);

    // DNS rebinding: the attacker's name still arrives as Host.
    const status = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const url = new URL(`${base}/api/agent/state`);
        request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        })
          .on('error', reject)
          .end();
      });
    expect(await status('rebind.example:80')).toBe(403);
    expect(await status(`localhost:${new URL(base).port}`)).toBe(200);
  });

  it('refuses switching or starting over while an action runs', async () => {
    let finish = () => {};
    const { agent: fake } = fakeAgent([
      async (task) => {
        await callTool(task, 'retry_job', { id: 'j1', approval_summary: 'Retry j1' });
        return 'proposed';
      },
    ]);
    const other = fakeAgent([], 'other');
    const { agent, base } = await serve({
      name: 'app',
      agents: () => [fake, other.agent],
      tools: [
        {
          name: 'retry_job',
          description: 'Retry a job',
          write: true,
          run: () => new Promise<string>((resolve) => (finish = () => resolve('retried'))),
        },
      ],
    });
    await post(base, '/send', { text: 'retry j1' });
    await settle(agent);
    await post(base, '/actions/1', { decision: 'approve' });
    expect(agent.get().actions[0]!.status).toBe('running');
    expect((await post(base, '/config', { agent: 'other' })).status).toBe(409);
    expect((await post(base, '/reset')).status).toBe(409);
    finish();
    await settle(agent);
    expect((await post(base, '/config', { agent: 'other' })).status).toBe(200);
  });

  it('drops pending actions when the user starts over', async () => {
    const { agent: fake } = fakeAgent([
      async (task) => {
        await callTool(task, 'retry_job', { id: 'j1', approval_summary: 'Retry j1' });
        return 'proposed';
      },
    ]);
    const { agent, base } = await serve({
      name: 'app',
      agents: () => [fake],
      tools: [{ name: 'retry_job', description: 'Retry a job', write: true, run: () => 'retried' }],
    });
    await post(base, '/send', { text: 'retry j1' });
    await settle(agent);
    await post(base, '/reset');
    expect(agent.get().actions[0]).toMatchObject({ status: 'rejected' });
    expect((await post(base, '/actions/1', { decision: 'approve' })).status).toBe(409);
  });

  it('asks the app to authorize everything but MCP, and streams state', async () => {
    const { agent: fake } = fakeAgent([]);
    const { agent, base } = await serve(
      { name: 'app', agents: () => [fake] },
      { authorize: (req) => req.headers.cookie === 'session=ok' },
    );
    expect((await fetch(`${base}/api/agent/state`)).status).toBe(403);
    const ok = { cookie: 'session=ok' };
    expect((await fetch(`${base}/api/agent/state`, { headers: ok })).status).toBe(200);
    const rpc = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await post(base, '/mcp', rpc, { authorization: `Bearer ${agent.mcpToken}` })).status).toBe(200);

    const controller = new AbortController();
    const response = await fetch(`${base}/api/agent/events`, { headers: ok, signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.replace(/^data: /, '').trim())).toMatchObject({ name: 'app', mode: 'use', agent: 'fake' });
    controller.abort();
  });
});
