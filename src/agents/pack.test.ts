import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { EventQueue } from './event-queue.js';
import { createArtifactStore } from './artifacts.js';
import { pack, PackActionError } from './pack.js';
import { createAgentSession } from './session.js';
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

  it('delegates from a linked subdirectory and reports merged files relative to the lead', async () => {
    const project = repo();
    const nested = join(project, 'nested');
    mkdirSync(nested);
    writeFileSync(join(nested, 'fixture.txt'), 'original');
    const link = join(root, 'linked-subdirectory');
    symlinkSync(nested, link, 'junction');
    const member = fake('b', async (task) => {
      expect(readFileSync(join(task.cwd, 'fixture.txt'), 'utf8')).toBe('original');
      writeFileSync(join(task.cwd, 'fixture.txt'), 'changed');
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'b', prompt: 'edit the fixture' });
        await tool(task, 'wait');
        expect(readFileSync(join(link, 'fixture.txt'), 'utf8')).toBe('original');
        rmSync(link);
        await tool(task, 'merge', { id: 't1' });
      },
      { mcp: true },
    );

    const team = pack({ lead, members: [member] });
    try {
      const run = team.run({ prompt: 'go', cwd: link });
      const events = await collect(run);
      expect(await run.result).toMatchObject({ ok: true });
      expect(team.tasks()[0]).toMatchObject({ status: 'completed', state: 'merged' });
      expect(events).toContainEqual({ type: 'file-change', paths: ['fixture.txt'] });
      expect(readFileSync(join(nested, 'fixture.txt'), 'utf8')).toBe('changed');
    } finally {
      await team.close();
    }
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
        // Two calls at once get one slot between them.
        const both = await Promise.allSettled([
          tool(task, 'delegate', { agent: 'slow', prompt: 'x', mode: 'shared' }),
          tool(task, 'delegate', { agent: 'slow', prompt: 'x2', mode: 'shared' }),
        ]);
        expect(both.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
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

  it('drops a delegation whose worktree was still being set up when the lead finished', async () => {
    const cwd = repo();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let started = false;
    const member = fake('b', async () => void (started = true));
    const lead = fake(
      'lead',
      async (task) => {
        void tool(task, 'delegate', { agent: 'b', prompt: 'x' }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 150));
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [member], prepareWorktree: () => blocked });
    const result = team.run({ prompt: 'go', cwd }).result;
    setTimeout(release, 400);
    await result;
    expect(started).toBe(false);
    expect(team.tasks()).toEqual([]);
    expect(readdirSync(join(cwd, '.genaicode', 'worktrees'))).toEqual(['.gitignore']);
  });

  it('fails a delegated task whose agent throws on start', async () => {
    const broken: CodingAgent = {
      name: 'broken',
      command: process.execPath,
      capabilities: {},
      run() {
        throw new Error('bad config');
      },
    };
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'broken', prompt: 'x', mode: 'shared' });
        const [report] = JSON.parse(await tool(task, 'wait')) as [{ status: string; error: string }];
        expect(report).toMatchObject({ status: 'failed', error: 'bad config' });
      },
      { mcp: true },
    );
    const result = await pack({ lead, members: [broken] }).run({ prompt: 'go', cwd: repo() }).result;
    expect(result.error).toBeUndefined();
    const refused = await pack({ lead: { ...broken, capabilities: { mcp: true } }, members: [] }).run({
      prompt: 'go',
      cwd: repo(),
    }).result;
    expect(refused).toMatchObject({ status: 'failed', error: 'bad config' });
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

describe('pack chat turns', () => {
  it('steers and stops only the selected worker and drains the others on chat close', async () => {
    const messages: string[] = [];
    const base = fake(
      'worker',
      (_task, _emit, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve())),
    );
    const worker: CodingAgent = {
      ...base,
      capabilities: { steer: true },
      run(task) {
        return {
          ...base.run(task),
          steer: async (text) => {
            messages.push(`${task.prompt} ${text}`);
          },
        };
      },
    };
    const lead = fake(
      'lead',
      async (task) => {
        for (const prompt of ['one', 'two']) await tool(task, 'delegate', { agent: 'worker', prompt, mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const session = createAgentSession({ agent: pack({ lead, members: [worker] }), cwd: repo() });
    try {
      session.send('go');
      await vi.waitFor(() => expect(session.get().turns[0].pack?.tasks).toHaveLength(2));
      await session.actOnPackTask!(1, 't2', { type: 'steer', text: 'check empty input' });
      expect(messages).toEqual(['two check empty input']);
      await session.actOnPackTask!(1, 't1', { type: 'stop' });
      expect(session.get().turns[0].pack?.tasks.map((item) => item.status)).toEqual(['aborted', 'running']);
    } finally {
      session.close();
      await session.idle();
    }
    expect(session.get().turns[0].pack?.tasks[1].status).toBe('aborted');
  });
  it('routes concurrent approvals and keeps worktree actions on the owning turn after it ends', async () => {
    const cwd = repo();
    const worker = fake('worker', async (task, emit, signal) => {
      // Workers do not inherit the lead's trusted artifact server, even if a tool has its name.
      const request = {
        id: 'same',
        kind: 'other' as const,
        summary: task.prompt,
        detail: { tool_name: 'mcp__artifacts__publish_artifact' },
      };
      emit({ type: 'approval-request', request });
      const decision = await task.onApproval!(request, signal);
      emit({ type: 'approval-resolved', id: request.id, decision });
      if (decision === 'approve') writeFileSync(join(task.cwd, task.prompt), 'edited\n');
      return { text: decision };
    });
    const lead = fake(
      'lead',
      async (task) => {
        if (task.prompt.endsWith('next')) {
          await tool(task, 'discard', { id: 't2' });
          return;
        }
        for (const prompt of ['first.txt', 'second.txt']) await tool(task, 'delegate', { agent: 'worker', prompt });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker], maxParallel: 2 });
    const session = createAgentSession({
      agent: team,
      cwd,
      artifacts: {
        store: createArtifactStore({ cwd }),
        mcpServer: { name: 'artifacts', url: 'http://127.0.0.1:1' },
      },
    });
    try {
      session.send('first');
      await vi.waitFor(() => expect(session.get().approvals).toHaveLength(2));
      const { approvals, turns } = session.get();
      expect(approvals.map((request) => request.id).sort()).toEqual(['t1:same', 't2:same']);
      expect(turns[0].pack).toMatchObject({ lead: 'lead', maxParallel: 2, tasks: [{ id: 't1' }, { id: 't2' }] });
      expect(session.approve('t2:same', 'deny')).toBe(true);
      expect(session.approve('t1:same', 'approve')).toBe(true);
      await session.idle();
      const first = session.get().turns[0];
      expect(first.entries.filter((entry) => entry.kind === 'approval')).toMatchObject([
        { request: { subtaskId: 't1' }, decision: 'approve' },
        { request: { subtaskId: 't2' }, decision: 'deny' },
      ]);
      expect(first.pack?.tasks[0]).toMatchObject({ status: 'completed', state: 'unmerged', changes: ['A\tfirst.txt'] });
      expect(existsSync(join(cwd, 'first.txt'))).toBe(false);
      session.send('next');
      await session.idle();
      expect(session.get().turns[0].pack?.tasks[1].state).toBe('discarded');
      await expect(session.actOnPackTask!(2, 't1', { type: 'merge' })).rejects.toThrow(PackActionError);
      await expect(session.actOnPackTask!(2, 't1', { type: 'merge' })).rejects.toThrow('No pack task');
      expect(await session.actOnPackTask!(1, 't1', { type: 'diff' })).toContain('+edited');
      // A competing discard cannot drop the worktree from under the merge.
      const race = await Promise.allSettled([
        session.actOnPackTask!(1, 't1', { type: 'merge' }),
        session.actOnPackTask!(1, 't1', { type: 'discard' }),
      ]);
      expect(race.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect(race[1].status === 'rejected' && race[1].reason).toMatchObject({
        name: 'PackActionError',
        reason: 'merged',
        publicMessage: 'This task was already merged.',
      });
      expect(session.get().turns[0].pack?.tasks[0].state).toBe('merged');
      expect(readFileSync(join(cwd, 'first.txt'), 'utf8')).toBe('edited\n');
      session.adopt([first]);
      expect(session.get().turns.at(-1)?.pack?.interactive).toBe(false);
      await expect(session.actOnPackTask!(3, 't1', { type: 'discard' })).rejects.toThrow('No pack task');
    } finally {
      session.close();
      await team.close();
    }
  });
});
