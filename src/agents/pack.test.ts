import { execFileSync, spawnSync } from 'node:child_process';
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
  it('reviews the complete patch and tests the worker directory before accepting a new revision', async () => {
    const cwd = repo();
    const correct = 'module.exports = (n) => n ?? 1;\n';
    const latin1 = Buffer.from('caf\u00e9\n', 'latin1');
    writeFileSync(join(cwd, 'seats.cjs'), correct);
    writeFileSync(join(cwd, '.gitignore'), 'worker.cache\n');
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'seats.cjs'), 'module.exports = (n) => n || 1;\n');
      writeFileSync(join(task.cwd, 'menu.txt'), latin1);
      writeFileSync(join(task.cwd, 'worker.cache'), 'local scratch note');
      writeFileSync(join(task.cwd, 'extra.txt'), 'a'.repeat(70_000) + ' end of new file\n');
    });
    let reviewDir = '';
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'Change the default.' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    lead.runText = fake('lead', async (task) => {
      reviewDir = task.cwd;
      expect(readdirSync(reviewDir)).toEqual([]);
      expect(task.mcpServers).toBeUndefined();
      expect(task.prompt).toContain('Patch encoding: latin1.');
      expect(Buffer.from(task.prompt, 'latin1').includes(latin1)).toBe(true);
      expect(task.prompt).toContain(' end of new file');
      expect(task.prompt).toContain('+module.exports');
      return { text: 'Check how zero seats are handled.', usage: { totalTokens: 8 } };
    }).run;
    const testSeats = (dir: string) =>
      spawnSync(process.execPath, ['-e', "require('node:assert/strict').equal(require('./seats.cjs')(0), 0)"], {
        cwd: dir,
      });
    const team = pack({
      lead,
      members: [worker],
      verification: {
        label: 'test zero seats',
        run(dir) {
          expect(dir).not.toBe(cwd);
          expect(existsSync(join(dir, 'worker.cache'))).toBe(false);
          expect(existsSync(join(dir, '.git'))).toBe(false);
          const result = testSeats(dir);
          return { ok: result.status === 0, detail: result.stderr.toString() };
        },
      },
    });
    const session = createAgentSession({ cwd, agent: team, budget: { maxTokens: 8 } });
    const task = () => session.get().turns[0].pack!.tasks[0];
    try {
      session.send('Delegate and leave the change for review.');
      await session.idle();
      await session.actOnPackTask!(1, 't1', { type: 'review' });
      await session.actOnPackTask!(1, 't1', { type: 'verify' });
      const before = task().checks!;
      expect(before.review).toMatchObject({
        revision: before.revision,
        status: 'completed',
        detail: 'Check how zero seats are handled.',
      });
      expect(before.verify).toMatchObject({ revision: before.revision, status: 'failed' });
      expect(existsSync(reviewDir)).toBe(false);
      expect(testSeats(cwd).status).toBe(0);
      expect(session.get().usage.totalTokens).toBe(8);
      await expect(session.actOnPackTask!(1, 't1', { type: 'review' })).rejects.toMatchObject({ reason: 'budget' });
      writeFileSync(join(task().cwd, 'seats.cjs'), correct);
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge', revision: before.revision })).rejects.toMatchObject(
        { reason: 'stale' },
      );
      expect(existsSync(join(cwd, 'extra.txt'))).toBe(false);
      await session.actOnPackTask!(1, 't1', { type: 'verify' });
      expect(task().checks!.verify).toMatchObject({ revision: task().checks!.revision, status: 'completed' });
      expect(task().checks!.review!.revision).not.toBe(task().checks!.revision);
      const last = task().checks!.revision;
      writeFileSync(join(task().cwd, 'extra.txt'), 'correction\n');
      await vi.waitFor(() => expect(task().checks!.revision).not.toBe(last), { timeout: 5000 });
      await session.actOnPackTask!(1, 't1', { type: 'merge', revision: task().checks!.revision });
      expect(readFileSync(join(cwd, 'extra.txt'), 'utf8')).toBe('correction\n');
      expect(readFileSync(join(cwd, 'menu.txt'))).toEqual(latin1);
    } finally {
      session.close();
      await team.close();
    }
  });

  it('keeps the worktree until an in-flight check stops and refuses an unavailable reviewer', async () => {
    const cwd = repo();
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'Make a change.' });
        await tool(task, 'delegate', { agent: 'worker', prompt: 'Make another change.' });
        await tool(task, 'wait');
      },
      { mcp: true, permissions: { approval: ['deny'], sandbox: ['read-only'] } },
    );
    const team = pack({
      lead,
      members: [writer('worker', 'b.txt', 'b\n')],
      verification: {
        label: 'slow test',
        run: (_dir, signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ ok: false, detail: 'Stopped' }), { once: true });
          }),
      },
    });
    const run = team.run({ cwd, prompt: 'go' });
    try {
      await run.result;
      const controls = run.pack!;
      await expect(controls.act('t1', { type: 'review' })).rejects.toMatchObject({ reason: 'reviewer' });
      const verify = controls.act('t1', { type: 'verify' });
      await vi.waitFor(() => expect(controls.task('t1')?.checks?.verify?.status).toBe('running'));
      await expect(controls.act('t2', { type: 'verify' })).rejects.toMatchObject({ reason: 'checking' });
      for (const type of ['verify', 'merge', 'discard'] as const)
        await expect(controls.act('t1', { type })).rejects.toMatchObject({ reason: 'checking' });
      await team.close();
      await verify;
      expect(controls.task('t1')?.checks?.verify).toMatchObject({ status: 'failed' });
    } finally {
      await team.close();
    }
  });

  it('keeps an edit made after the operator opens the diff out of a merge without checks', async () => {
    const cwd = repo();
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'Write a greeting.' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [writer('worker', 'new.txt', 'first\n')] });
    try {
      const run = team.run({ cwd, prompt: 'Leave the greeting for the operator.' });
      await run.result;
      const controls = run.pack!;
      const worker = controls.task('t1')!;
      const revision = worker.checks!.revision;
      expect(revision).toMatch(/^[0-9a-f]+$/);
      expect(await controls.act('t1', { type: 'diff', revision })).toContain('+first');
      writeFileSync(join(worker.cwd, 'new.txt'), 'second\n');
      await expect(controls.act('t1', { type: 'merge' })).rejects.toMatchObject({ reason: 'stale' });
      const latest = controls.task('t1')!.checks!.revision;
      expect(latest).not.toBe(revision);
      expect(await controls.act('t1', { type: 'diff', revision: latest })).toContain('+second');
      // Another client viewed the correction, but the first client's click still carries the old tree.
      await expect(controls.act('t1', { type: 'merge', revision })).rejects.toMatchObject({ reason: 'stale' });
      expect(existsSync(join(cwd, 'new.txt'))).toBe(false);
      await controls.act('t1', { type: 'merge', revision: latest });
      expect(readFileSync(join(cwd, 'new.txt'), 'utf8')).toBe('second\n');
    } finally {
      await team.close();
    }
  });

  it('lets the lead ask a different member to review and accounts for the review in the pack budget', async () => {
    const cwd = repo();
    const reviewer = fake('reader', async (task) => {
      expect(task.budget?.maxTokens).toBe(5);
      expect(task.prompt).toContain('Patch encoding: utf8.');
      expect(task.prompt).toContain('+hello');
      return { text: 'No findings.', usage: { totalTokens: 5 } };
    });
    reviewer.runText = reviewer.run;
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'writer', prompt: 'Write the greeting.' });
        await tool(task, 'wait');
        const checks = JSON.parse(await tool(task, 'review', { id: 't1' }));
        expect(checks).toMatchObject({
          reviewer: 'reader',
          review: { detail: 'No findings.', revision: checks.revision },
        });
        await expect(tool(task, 'review', { id: 't1' })).rejects.toThrow('used its token budget');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [writer('writer', 'new.txt', 'hello\n'), reviewer] });
    try {
      const run = team.run({ cwd, prompt: 'Request an independent review.', budget: { maxTokens: 20 } });
      expect(await run.result).toMatchObject({ ok: true, usage: { totalTokens: 20 } });
    } finally {
      await team.close();
    }
  });

  it('reserves a session budget for one operator review and gives a queued turn the remainder', async () => {
    const caps: number[] = [];
    let release!: () => void;
    const reviewer = fake('reader', async (task) => {
      caps.push(task.budget!.maxTokens!);
      if (caps.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { text: 'Reviewed.', usage: { totalTokens: Math.min(8, task.budget!.maxTokens!) } };
    });
    reviewer.runText = reviewer.run;
    const lead = fake(
      'lead',
      async (task) => {
        if (task.prompt.endsWith('next')) return;
        for (const prompt of ['one', 'two']) await tool(task, 'delegate', { agent: 'worker', prompt });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, task.prompt), 'fixture');
    });
    const team = pack({ lead, members: [worker, reviewer] });
    const session = createAgentSession({ agent: team, cwd: repo(), budget: { maxTokens: 10 } });
    try {
      session.send('delegate');
      await session.idle();
      const first = session.actOnPackTask!(1, 't1', { type: 'review' });
      await vi.waitFor(() => expect(caps).toEqual([10]));
      await expect(session.actOnPackTask!(1, 't2', { type: 'review' })).rejects.toMatchObject({
        reason: 'budget-busy',
      });
      session.send('next');
      expect(session.get().queued).toEqual(['next']);
      release();
      await first;
      await session.idle();
      expect(session.get().turns[1].pack?.budget?.maxTokens).toBe(2);
      await session.actOnPackTask!(1, 't2', { type: 'review' });
      expect(caps).toEqual([10, 2]);
      expect(session.get().usage.totalTokens).toBe(10);
    } finally {
      release?.();
      session.close();
      await team.close();
    }
  });

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

  it('propagates Plan mode to capable workers, refuses incompatible delegates and blocks merge', async () => {
    const cwd = repo();
    const seenWorkerModes: Array<string | undefined> = [];
    const plannerWorker = fake(
      'codex',
      async (task) => {
        seenWorkerModes.push(task.mode);
        return { text: `mode:${task.mode}` };
      },
      { plan: true },
    );
    const plainWorker = fake('opencode', async (task) => {
      seenWorkerModes.push(task.mode);
      return { text: 'edited' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        const listed = JSON.parse(await tool(task, 'agents')) as { name: string; plan?: boolean }[];
        expect(listed.map((m) => [m.name, m.plan])).toEqual([
          ['codex', true],
          ['opencode', undefined],
        ]);
        await expect(tool(task, 'delegate', { agent: 'opencode', prompt: 'research', mode: 'shared' })).rejects.toThrow(
          /does not support Plan mode/,
        );
        const started = JSON.parse(
          await tool(task, 'delegate', { agent: 'codex', prompt: 'research', mode: 'shared' }),
        ) as { id: string };
        await tool(task, 'wait', { ids: [started.id] });
        await expect(tool(task, 'merge', { id: started.id })).rejects.toThrow(
          /Cannot merge changes while in Plan mode/,
        );
        return { text: 'planned' };
      },
      { mcp: true, plan: true },
    );
    const team = pack({ lead, members: [plannerWorker, plainWorker] });
    try {
      const result = await team.run({ prompt: 'plan it', cwd, mode: 'plan' }).result;
      expect(result).toMatchObject({ status: 'completed', ok: true, text: 'planned' });
      expect(seenWorkerModes).toEqual(['plan']);
    } finally {
      await team.close();
    }

    const nonPlanLead = fake('plain-lead', async () => ({ text: 'should not run' }), { mcp: true });
    const plainTeam = pack({ lead: nonPlanLead, members: [plannerWorker] });
    try {
      const refused = await plainTeam.run({ prompt: 'plan it', cwd, mode: 'plan' }).result;
      expect(refused).toMatchObject({
        status: 'failed',
        error: 'plain-lead does not support Plan mode in this driver.',
      });
    } finally {
      await plainTeam.close();
    }
  });
});
