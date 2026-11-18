import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EventQueue } from './event-queue.js';
import { pack } from './pack.js';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent, McpServer } from './types.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-pack-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });

let repos = 0;
function repo(): string {
  const dir = join(root, `repo-${++repos}`);
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const ok = (extra: Partial<AgentResult> = {}): AgentResult => ({
  status: 'completed',
  ok: true,
  exitCode: 0,
  signal: null,
  ...extra,
});

type Body = (
  task: AgentTask,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
) => Promise<Partial<AgentResult> | void>;

/** An agent whose run is `body`. The executable is node, so it counts as installed. */
function fake(name: string, body: Body, capabilities: CodingAgent['capabilities'] = {}): CodingAgent {
  return {
    name,
    command: process.execPath,
    capabilities,
    run(task): AgentRun {
      const events = new EventQueue<AgentEvent>();
      const stop = new AbortController();
      const result = body(task, (event) => events.push(event), stop.signal)
        .then(
          (extra): AgentResult => (stop.signal.aborted ? { ...ok(), status: 'aborted', ok: false } : ok(extra ?? {})),
        )
        .catch((error: Error): AgentResult => ({ ...ok(), status: 'failed', ok: false, error: error.message }))
        .then((final) => {
          events.push({ type: 'done', result: final });
          events.close();
          return final;
        });
      return { result, abort: () => stop.abort(), [Symbol.asyncIterator]: () => events.iterate() };
    },
  };
}

/** Call a tool of the `pack` MCP server a lead was given. */
async function tool(task: AgentTask, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const server = task.mcpServers?.find((candidate) => candidate.name === 'pack') as Extract<McpServer, { url: string }>;
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const answer = (await response.json()) as { result: { content: [{ text: string }]; isError?: boolean } };
  if (answer.result.isError) throw new Error(answer.result.content[0].text);
  return answer.result.content[0].text;
}

const writer = (name: string, file: string, content: string) =>
  fake(name, async (task, emit) => {
    writeFileSync(join(task.cwd, file), content);
    emit({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } });
    return { text: `wrote ${file}`, usage: { inputTokens: 10, outputTokens: 5 } };
  });

async function collect(run: AgentRun): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

describe('pack', () => {
  it('delegates in parallel worktrees and merges the results', async () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'draft.txt'), 'uncommitted\n');
    const seen: string[] = [];
    const lead = fake(
      'lead',
      async (task) => {
        expect(task.prompt).toContain('You lead a pack');
        expect(task.prompt.endsWith('build it')).toBe(true);
        const agents = JSON.parse(await tool(task, 'agents')) as Array<{ name: string; installed: boolean }>;
        expect(agents.map((agent) => [agent.name, agent.installed])).toEqual([
          ['b', true],
          ['c', true],
        ]);
        const first = JSON.parse(await tool(task, 'delegate', { agent: 'b', prompt: 'write b' })) as {
          id: string;
          cwd: string;
        };
        const second = JSON.parse(await tool(task, 'delegate', { agent: 'c', prompt: 'write c' })) as { id: string };
        // The worktree starts from the files as they are, uncommitted ones included.
        expect(readFileSync(join(first.cwd, 'draft.txt'), 'utf8')).toBe('uncommitted\n');
        const reports = JSON.parse(await tool(task, 'wait')) as Array<{
          id: string;
          status: string;
          changes: string[];
          text: string;
        }>;
        expect(reports.map((report) => [report.id, report.status, report.changes, report.text])).toEqual([
          ['t1', 'completed', ['A\tb.txt'], 'wrote b.txt'],
          ['t2', 'completed', ['A\tc.txt'], 'wrote c.txt'],
        ]);
        // Nothing reaches the lead's directory before a merge.
        expect(existsSync(join(task.cwd, 'b.txt'))).toBe(false);
        expect(await tool(task, 'diff', { id: first.id })).toContain('+from b');
        seen.push(await tool(task, 'merge', { id: first.id }), await tool(task, 'discard', { id: second.id }));
        return { text: 'done', sessionId: 's1', usage: { inputTokens: 100, outputTokens: 1 } };
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [writer('b', 'b.txt', 'from b\n'), writer('c', 'c.txt', 'from c\n')] });
    const run = team.run({ prompt: 'build it', cwd });
    const events = await collect(run);
    const result = await run.result;

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true, text: 'done', sessionId: 's1' });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 11 });
    expect(seen).toEqual(['Merged t1:\nA\tb.txt', 'Discarded t2.']);
    expect(readFileSync(join(cwd, 'b.txt'), 'utf8')).toBe('from b\n');
    expect(existsSync(join(cwd, 'c.txt'))).toBe(false);
    // Merging stages nothing, and the worktrees are gone.
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(cwd, 'status', '--porcelain').trim().split('\n').sort()).toEqual(['?? b.txt', '?? draft.txt']);
    expect(readdirSync(join(cwd, '.genaicode', 'worktrees'))).toEqual(['.gitignore']);
    expect(git(cwd, 'worktree', 'list').trim().split('\n')).toHaveLength(1);

    const kinds = events.map((event) =>
      event.type === 'subtask' ? `subtask:${event.id}:${event.event.type}` : event.type,
    );
    expect(kinds.filter((kind) => kind.startsWith('subtask-start'))).toHaveLength(2);
    expect(kinds).toContain('subtask:t1:done');
    expect(kinds).toContain('subtask:t2:done');
    expect(events).toContainEqual({ type: 'subtask-update', id: 't1', agent: 'b', state: 'merged', paths: ['b.txt'] });
    expect(events).toContainEqual({ type: 'subtask-update', id: 't2', agent: 'c', state: 'discarded' });
    expect(events).toContainEqual({ type: 'file-change', paths: ['b.txt'] });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(team.tasks().map((task) => task.state)).toEqual(['merged', 'discarded']);
  });

  it('refuses a merge that does not apply, and merges three-way on request', async () => {
    const cwd = repo();
    const answers: string[] = [];
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'b', prompt: 'edit' });
        await tool(task, 'wait');
        writeFileSync(join(task.cwd, 'a.txt'), 'one\nMINE\nthree\n');
        answers.push(await tool(task, 'merge', { id: 't1' }).catch((error: Error) => error.message));
        expect(readFileSync(join(task.cwd, 'a.txt'), 'utf8')).toBe('one\nMINE\nthree\n');
        git(task.cwd, 'commit', '-qam', 'mine');
        answers.push(await tool(task, 'merge', { id: 't1', threeWay: true }));
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [writer('b', 'a.txt', 'one\nTHEIRS\nthree\n')] });
    await team.run({ prompt: 'go', cwd }).result;
    expect(answers[0]).toContain('do not apply cleanly');
    expect(answers[1]).toContain('with conflicts');
    expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toContain('<<<<<<<');
    expect(team.tasks()[0]!.state).toBe('merged');
  });

  it('runs shared tasks in the lead directory and forwards approvals and permissions', async () => {
    const cwd = mkdtempSync(join(root, 'plain-'));
    const asked: string[] = [];
    const member = fake('b', async (task) => {
      expect(task.cwd).toBe(cwd);
      expect(task.permissions).toEqual({ approval: 'ask' });
      const decision = await task.onApproval!({ id: 'a1', kind: 'command', summary: 'rm -rf x' });
      return { text: decision };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await expect(tool(task, 'delegate', { agent: 'b', prompt: 'x' })).rejects.toThrow('not a git repository');
        await expect(tool(task, 'delegate', { agent: 'nobody', prompt: 'x' })).rejects.toThrow('No agent nobody');
        await tool(task, 'delegate', { agent: 'b', prompt: 'review', mode: 'shared' });
        const [report] = JSON.parse(await tool(task, 'wait', { ids: ['t1'] })) as [{ text: string; state?: string }];
        expect(report).toMatchObject({ text: 'approve' });
        expect(report.state).toBeUndefined();
        await expect(tool(task, 'merge', { id: 't1' })).rejects.toThrow('nothing to merge');
      },
      { mcp: true },
    );
    const result = await pack({ lead, members: [member] }).run({
      prompt: 'go',
      cwd,
      permissions: { approval: 'ask' },
      onApproval: (request) => {
        asked.push(`${request.id} ${request.summary}`);
        return 'approve';
      },
    }).result;
    expect(result.ok).toBe(true);
    expect(asked).toEqual(['t1:a1 [b t1] rm -rf x']);
  });

  it('stops running tasks when the lead finishes, and limits how many run at once', async () => {
    const cwd = repo();
    const slow = fake(
      'slow',
      (_task, _emit, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve())),
      {
        steer: false,
      },
    );
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'slow', prompt: 'x', mode: 'shared' });
        await expect(tool(task, 'delegate', { agent: 'slow', prompt: 'y', mode: 'shared' })).rejects.toThrow(
          'running already',
        );
        const [report] = JSON.parse(await tool(task, 'wait', { timeoutSeconds: 0.05 })) as [{ status: string }];
        expect(report.status).toBe('running');
        await expect(tool(task, 'steer', { id: 't1', text: 'hi' })).rejects.toThrow('cannot take input');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [slow], maxParallel: 1 });
    const result = await team.run({ prompt: 'go', cwd }).result;
    expect(result.ok).toBe(true);
    expect(team.tasks()[0]!.status).toBe('aborted');
  });

  it('caps the whole pack with the task budget', async () => {
    const cwd = repo();
    const lead = fake(
      'lead',
      async (task, _emit, signal) => {
        expect(task.budget).toBeUndefined();
        await tool(task, 'delegate', { agent: 'b', prompt: 'x' });
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      },
      { mcp: true },
    );
    const run = pack({ lead, members: [writer('b', 'b.txt', 'x')] }).run({
      prompt: 'go',
      cwd,
      budget: { maxTokens: 10 },
    });
    const result = await run.result;
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'budget' } });
    expect(result.error).toContain('token budget (15 of 10)');
  });

  it('counts usage the lead reports only at the end against the budget', async () => {
    const lead = fake('lead', async () => ({ usage: { inputTokens: 100 }, costUsd: 5 }), { mcp: true });
    const result = await pack({ lead, members: [] }).run({
      prompt: 'go',
      cwd: repo(),
      budget: { maxTokens: 1, maxCostUsd: 1 },
    }).result;
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'budget' }, costUsd: 5 });
  });

  it('needs a lead that takes MCP servers, and keeps the briefing off resumed turns', async () => {
    const cwd = repo();
    const refused = await pack({ lead: fake('lead', async () => {}), members: [] }).run({ prompt: 'go', cwd }).result;
    expect(refused.error).toContain('cannot attach MCP servers');
    let prompt = '';
    const lead = fake('lead', async (task) => void (prompt = task.prompt), { mcp: true });
    await pack({ lead, members: [] }).run({ prompt: 'again', cwd, resume: 's1' }).result;
    expect(prompt).toBe('again');
  });
});
