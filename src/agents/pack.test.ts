import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  renameSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { patchCoversWorktree, snapshotTree, worktreeMatchesCommit } from './pack-git.js';
import { EventQueue } from './event-queue.js';
import { createArtifactStore } from './artifacts.js';
import { personText } from './host-text.js';
import {
  clipReview,
  delegationBrief,
  MAX_WAIT_SECONDS,
  pack,
  PackActionError,
  replyPullRequest,
  type PackTask as PackReport,
  PACK_STEPS_KEPT,
} from './pack.js';
import { claude } from './drivers/claude.js';

describe('clipReview', () => {
  it('keeps the lines that decide a long review after the clip', () => {
    const long = `${'Looked at the importer. '.repeat(900)}\n- BLOCKER: drops rows without an id\n\nVERDICT: CHANGES REQUESTED`;
    const kept = clipReview(long);
    expect(kept.length).toBeLessThan(long.length);
    expect(kept).toContain('BLOCKER: drops rows without an id');
    expect(kept.endsWith('VERDICT: CHANGES REQUESTED')).toBe(true);
    expect(clipReview('Short.\nVERDICT: LGTM')).toBe('Short.\nVERDICT: LGTM');
    // The verdict quoted inline earlier does not hide the final one the clip cut off.
    const quoted = `Expect a line like VERDICT: CHANGES REQUESTED at the end.\n${'More notes here. '.repeat(1200)}\n[P1] drops rows\nVERDICT: CHANGES REQUESTED`;
    expect(clipReview(quoted).endsWith('\nVERDICT: CHANGES REQUESTED')).toBe(true);
  });
});
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
  it('clears a recovered model’s refusal and preserves other models and measured windows', async () => {
    let finishOlder!: () => void;
    const older = new Promise<void>((resolve) => {
      finishOlder = resolve;
    });
    const worker = fake('worker', async (task, emit) => {
      if (task.prompt === 'older retry') await older;
      if (task.prompt === 'refuse') {
        if (task.model === 'b') emit({ type: 'rate-limit', limit: { window: 'quota', status: 'exceeded' } });
        return { ok: false, status: 'failed', failure: { kind: 'quota' } };
      }
      emit({ type: 'rate-limit', limit: { window: '5h', status: 'ok', usedPercent: 12 } });
      if (task.prompt === 'report weekly limit')
        emit({ type: 'rate-limit', limit: { window: '7d', status: 'exceeded', usedPercent: 100 } });
    });
    const lead = fake(
      'lead',
      async (task) => {
        const run = async (model: string, prompt: string) => {
          const { id } = JSON.parse(await tool(task, 'delegate', { agent: 'worker', mode: 'shared', model, prompt }));
          return JSON.parse(await tool(task, 'wait', { ids: [id] }))[0];
        };
        const hint = async (model: string) => JSON.parse(await tool(task, 'agents', { model }))[0].quotaHint;
        await run('a', 'refuse');
        await run('b', 'refuse');
        expect(await hint('a')).toMatchObject({ window: 'a quota' });
        expect(await hint('b')).toMatchObject({ window: 'b quota' });
        expect(await run('a', 'retry')).not.toHaveProperty('quotaHint');
        expect(await hint('a')).toBeUndefined();
        expect(await hint('b')).toMatchObject({ window: 'b quota' });
        expect(await run('a', 'another task')).not.toHaveProperty('quotaHint');
        const pending = JSON.parse(
          await tool(task, 'delegate', { agent: 'worker', mode: 'shared', model: 'b', prompt: 'older retry' }),
        );
        try {
          await run('b', 'refuse');
        } finally {
          finishOlder();
        }
        await tool(task, 'wait', { ids: [pending.id] });
        expect(await hint('b')).toMatchObject({ window: 'b quota' });
        await run('b', 'report weekly limit');
        expect(await hint('b')).toMatchObject({ window: '7d' });
      },
      { mcp: true },
    );
    const result = await pack({ lead, members: [worker] }).run({ cwd: root, prompt: 'check recovery' }).result;
    expect(result.ok, result.error).toBe(true);
  });

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
      expect(session.get().sendAction).toBe('start');
      const first = session.actOnPackTask!(1, 't1', { type: 'review' });
      await vi.waitFor(() => expect(caps).toEqual([10]));
      // No turn runs, but a prompt waits for the review that holds the budget: the state says so.
      expect(session.get()).toMatchObject({ status: 'idle', sendAction: 'queue' });
      await expect(session.actOnPackTask!(1, 't2', { type: 'review' })).rejects.toMatchObject({
        reason: 'budget-busy',
      });
      session.send('next');
      expect(session.get().queued).toEqual(['next']);
      release();
      await first;
      await session.idle();
      expect(session.get().sendAction).toBe('start');
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
        expect(task.prompt.startsWith('build it\n\n<genaicode-briefing>')).toBe(true);
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
    // Merging stages nothing, and retained worktrees stay out of the working copy.
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(cwd, 'status', '--porcelain').trim().split('\n').sort()).toEqual(['?? b.txt', '?? draft.txt']);
    expect(readFileSync(join(team.tasks()[1]!.recoveryDir!, 'c.txt'), 'utf8')).toBe('from c\n');
    expect(git(cwd, 'worktree', 'list').trim().split('\n')).toHaveLength(3);

    const kinds = events.map((event) =>
      event.type === 'subtask' ? `subtask:${event.id}:${event.event.type}` : event.type,
    );
    expect(kinds.filter((kind) => kind.startsWith('subtask-start'))).toHaveLength(2);
    expect(kinds).toContain('subtask:t1:done');
    expect(kinds).toContain('subtask:t2:done');
    expect(events).toContainEqual({ type: 'subtask-update', id: 't1', agent: 'b', state: 'merged', paths: ['b.txt'] });
    expect(events).toContainEqual({ type: 'subtask-update', id: 't2', agent: 'c', state: 'discarded' });
    expect(events).toContainEqual({ type: 'file-change', paths: ['b.txt'], mergedTask: 't1' });
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
      expect(events).toContainEqual({ type: 'file-change', paths: ['fixture.txt'], mergedTask: 't1' });
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

  it('reports a running tool call with its argument, and when a task started and ended', async () => {
    const cwd = repo();
    const busy = fake('busy', async (_task, emit, signal) => {
      emit({ type: 'tool-start', name: 'shell', input: { command: 'npm   test\n -- --run' } });
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'busy', prompt: 'x', mode: 'shared' });
        await vi.waitFor(async () => {
          const [report] = JSON.parse(await tool(task, 'wait', { timeoutSeconds: 0.05 })) as [PackReport];
          expect(report).toMatchObject({ status: 'running', text: 'tool shell: npm test -- --run' });
          expect(report.startedAt).toBeTypeOf('number');
          expect(report.endedAt).toBeUndefined();
        });
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [busy] });
    await team.run({ prompt: 'go', cwd }).result;
    await vi.waitFor(() => expect(team.tasks()[0]!.endedAt).toBeTypeOf('number'));
    const [task] = team.tasks();
    expect(task!.endedAt!).toBeGreaterThanOrEqual(task!.startedAt!);
  });

  it('reports the pull request a task ended in: the last one its whole reply links', async () => {
    const cwd = repo();
    const reply = [
      'Builds on https://github.com/acme/app/pull/349.',
      'x'.repeat(5_000),
      'Opened https://github.com/acme/app/pull/351 for review.',
    ].join('\n');
    const worker = fake('worker', async () => ({ text: reply }));
    const quiet = fake('quiet', async () => ({ text: 'Done, see https://example.com/pull/7.' }));
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'ship it', mode: 'shared' });
        await tool(task, 'delegate', { agent: 'quiet', prompt: 'look', mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker, quiet] });
    await team.run({ prompt: 'go', cwd }).result;
    const [shipped, looked] = team.tasks();
    expect(shipped!.text).not.toContain('pull/351');
    expect(shipped!.pullRequest).toEqual({ url: 'https://github.com/acme/app/pull/351', number: 351 });
    expect(looked!.pullRequest).toBeUndefined();
    expect(replyPullRequest('no link here')).toBeUndefined();
  });

  it('reads the verdict from the whole reply, outside quotations and code, before clipping it', async () => {
    const cwd = repo();
    const reply = [
      '> VERDICT: LGTM',
      '```',
      'VERDICT: sample',
      '```',
      '    VERDICT: indented',
      'x'.repeat(5_000),
      '**VERDICT:** CHANGES - fix the tests',
      '> VERDICT: LGTM (quoted after)',
    ].join('\n');
    const reviewer = fake('reviewer', async () => ({ text: reply }));
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'reviewer', prompt: 'review', mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [reviewer] });
    await team.run({ prompt: 'go', cwd }).result;
    const [task] = team.tasks();
    expect(task!.text!.length).toBeLessThan(reply.length);
    expect(task!.text).not.toContain('CHANGES');
    expect(task!.verdict).toBe('**VERDICT:** CHANGES - fix the tests');
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
    expect(team.tasks()[0]!.stoppedBy).toBe('lead-finished');
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

  it('needs a lead that takes MCP servers', async () => {
    const refused = await pack({ lead: fake('lead', async () => {}), members: [] }).run({ prompt: 'go', cwd: repo() })
      .result;
    expect(refused.error).toContain('cannot attach MCP servers');
  });

  it("puts the briefing after the person's words, tagged, on the first turn only", async () => {
    const cwd = repo();
    const prompts: string[] = [];
    const lead = fake('lead', async (task) => void prompts.push(task.prompt), { mcp: true });
    const team = pack({ lead, members: [], brief: delegationBrief });
    await team.run({ prompt: 'fix the header', cwd }).result;
    await team.run({ prompt: 'again', cwd, resume: 's1' }).result;
    expect(prompts[0]!.startsWith('fix the header\n\n<genaicode-briefing>')).toBe(true);
    expect(prompts[0]).toContain('Other coding agents on this machine');
    expect(prompts[0]!.endsWith('</genaicode-briefing>')).toBe(true);
    // The resumed session has it from its first turn.
    expect(prompts[1]).toBe('again');
    expect(prompts.map(personText)).toEqual(['fix the header', 'again']);
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
      expect(session.get().turns[0].pack?.tasks[0].stoppedBy).toBe('user');
    } finally {
      session.close();
      await session.idle();
    }
    expect(session.get().turns[0].pack?.tasks[1].status).toBe('aborted');
  });
  it('records input sent to a worker and whether the worker took it', async () => {
    const pendingSteers: { text: string; resolve(receipt?: 'taken'): void; reject(error: Error): void }[] = [];
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
          steer: (text) =>
            new Promise((resolve, reject) =>
              pendingSteers.push({ text, resolve: (receipt) => resolve(receipt), reject }),
            ),
        };
      },
    };
    let leadSteer: Promise<string> | undefined;
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'one', mode: 'shared' });
        leadSteer = tool(task, 'steer', { id: 't1', text: 'from the lead' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const session = createAgentSession({ agent: pack({ lead, members: [worker] }), cwd: repo() });
    const steers = () => session.get().turns[0]?.pack?.tasks[0]?.steers ?? [];
    try {
      session.send('go');
      await vi.waitFor(() => expect(steers()).toHaveLength(1));
      expect(steers()[0]).toMatchObject({ text: 'from the lead', from: 'lead', delivery: 'sending' });
      pendingSteers[0]!.resolve('taken');
      await expect(leadSteer).resolves.toBe('t1 took the input.');
      await vi.waitFor(() => expect(steers()[0]!.delivery).toBe('delivered'));
      // The receipt has its times: sent, then taken.
      expect(steers()[0]!.settledAt).toBeGreaterThanOrEqual(steers()[0]!.at);

      const user = session.actOnPackTask!(1, 't1', { type: 'steer', text: 'from you' });
      await vi.waitFor(() => expect(steers()[1]).toMatchObject({ from: 'user', delivery: 'sending' }));
      pendingSteers[1]!.resolve();
      await expect(user).resolves.toBe('Sent to t1.');
      await vi.waitFor(() => expect(steers()[1]!.delivery).toBe('sent'));

      const late = session.actOnPackTask!(1, 't1', { type: 'steer', text: 'too late' });
      await vi.waitFor(() => expect(pendingSteers).toHaveLength(3));
      pendingSteers[2]!.reject(new Error('ended before it took the input'));
      await expect(late).rejects.toThrow('ended before');
      await vi.waitFor(() => expect(steers()[2]).toMatchObject({ text: 'too late', delivery: 'dropped' }));
      expect(steers().map((steer) => steer.delivery)).toEqual(['delivered', 'sent', 'dropped']);
    } finally {
      session.close();
      await session.idle();
    }
  });

  it('keeps the latest steps of a task with their outcome, and marks a steer its next message answers', async () => {
    let next = () => {};
    const step = () => new Promise<void>((resolve) => (next = resolve));
    const base = fake('worker', async (_task, emit, signal) => {
      emit({ type: 'tool-start', id: 'c1', name: 'Bash', input: { command: 'npm test' } });
      emit({ type: 'tool-start', id: 'c2', name: 'Read', input: { file_path: '/work/a.ts' } });
      emit({ type: 'tool-end', id: 'c1', isError: true });
      emit({ type: 'file-change', paths: ['src/a.ts', 'src/b.ts'] });
      emit({ type: 'error', message: 'rate limited,\nretrying' });
      await step();
      emit({ type: 'message', text: 'Skipping them.' });
      await step();
      for (let i = 0; i < 40; i += 1) emit({ type: 'message', text: `note ${i}` });
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
    });
    const worker: CodingAgent = {
      ...base,
      capabilities: { steer: true },
      run: (task) => ({ ...base.run(task), steer: async () => 'taken' as const }),
    };
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'x', mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const session = createAgentSession({ agent: pack({ lead, members: [worker] }), cwd: repo() });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await vi.waitFor(() => expect(task()?.steps).toHaveLength(4));
      expect(task()!.steps).toEqual([
        {
          kind: 'tool',
          name: 'Bash',
          text: 'npm test',
          at: expect.any(Number),
          endedAt: expect.any(Number),
          failed: true,
        },
        { kind: 'tool', name: 'Read', text: '/work/a.ts', at: expect.any(Number) },
        { kind: 'edit', text: 'src/a.ts, src/b.ts', at: expect.any(Number) },
        { kind: 'error', text: 'rate limited, retrying', at: expect.any(Number) },
      ]);
      await session.actOnPackTask!(1, 't1', { type: 'steer', text: 'Skip the snapshot tests.' });
      expect(task()!.steers![0]).toMatchObject({ delivery: 'delivered', settledAt: expect.any(Number) });
      expect(task()!.steers![0]!.answeredAt).toBeUndefined();
      next();
      await vi.waitFor(() => expect(task()!.steers![0]!.answeredAt).toBeTypeOf('number'));
      next();
      // Only the latest are kept, and never without the call that still runs.
      await vi.waitFor(() => expect(task()!.steps!.at(-1)!.text).toBe('note 39'));
      expect(task()!.steps).toHaveLength(PACK_STEPS_KEPT);
      expect(task()!.steps![0]).toMatchObject({ kind: 'tool', name: 'Read' });
      expect(task()!.steps![0]!.endedAt).toBeUndefined();
    } finally {
      session.close();
      await session.idle();
    }
  });

  it('takes back the live line of an edit whose call failed', async () => {
    let next = () => {};
    const step = () => new Promise<void>((resolve) => (next = resolve));
    const worker = fake('worker', async (_task, emit, signal) => {
      emit({ type: 'message', text: 'Looking.' });
      emit({ type: 'tool-start', id: 'e1', name: 'Edit', input: { file_path: 'src/a.ts' } });
      emit({ type: 'file-change', paths: ['src/a.ts'], toolId: 'e1' });
      await step();
      emit({ type: 'tool-end', id: 'e1', isError: true });
      await step();
      emit({ type: 'tool-start', id: 'e2', name: 'Edit', input: { file_path: 'src/b.ts' } });
      emit({ type: 'file-change', paths: ['src/b.ts'], toolId: 'e2' });
      emit({ type: 'tool-end', id: 'e2' });
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'x', mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const session = createAgentSession({ agent: pack({ lead, members: [worker] }), cwd: repo() });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await vi.waitFor(() => expect(task()?.text).toBe('edited src/a.ts'));
      next();
      await vi.waitFor(() => expect(task()?.steps?.at(-1)).toMatchObject({ kind: 'tool', failed: true }));
      expect(task()!.text).toBe('Looking.');
      expect(task()!.steps!.some((item) => item.kind === 'edit')).toBe(false);
      next();
      // A call that succeeded keeps its edit.
      await vi.waitFor(() =>
        expect(task()?.steps?.find((item) => item.kind === 'tool' && item.text === 'src/b.ts')?.endedAt).toBeTypeOf(
          'number',
        ),
      );
      expect(task()!.text).toBe('edited src/b.ts');
    } finally {
      session.close();
      await session.idle();
    }
  });

  it('does not take the end of a reply that streamed when a steer was taken for its answer', async () => {
    let next = () => {};
    const step = () => new Promise<void>((resolve) => (next = resolve));
    const base = fake('worker', async (_task, emit, signal) => {
      emit({ type: 'text-delta', text: 'Running npm' });
      await step();
      emit({ type: 'message', text: 'Running npm install' });
      await step();
      emit({ type: 'message', text: 'Switching to pnpm.' });
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
    });
    // The pack asks for the event after the delta once it has followed the delta.
    let streamed = () => {};
    const deltaFollowed = new Promise<void>((resolve) => (streamed = resolve));
    const worker: CodingAgent = {
      ...base,
      capabilities: { steer: true },
      run: (task) => {
        const inner = base.run(task);
        return {
          ...inner,
          [Symbol.asyncIterator]: () => {
            const events = inner[Symbol.asyncIterator]();
            let asked = 0;
            return {
              next: () => {
                if (++asked === 2) streamed();
                return events.next();
              },
            };
          },
          steer: async () => 'taken' as const,
        };
      },
    };
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'x', mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const session = createAgentSession({ agent: pack({ lead, members: [worker] }), cwd: repo() });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await deltaFollowed;
      await session.actOnPackTask!(1, 't1', { type: 'steer', text: 'Use pnpm.' });
      expect(task()!.steers![0]).toMatchObject({ delivery: 'delivered' });
      next();
      await vi.waitFor(() => expect(task()!.steps?.at(-1)?.text).toBe('Running npm install'));
      expect(task()!.steers![0]!.answeredAt).toBeUndefined();
      next();
      await vi.waitFor(() => expect(task()!.steers![0]!.answeredAt).toBeTypeOf('number'));
    } finally {
      session.close();
      await session.idle();
    }
  });

  it('hides credentials in tool arguments, drops edits of failed calls and keeps a long call that just ended', async () => {
    let next = () => {};
    const step = () => new Promise<void>((resolve) => (next = resolve));
    const worker = fake('worker', async (_task, emit, signal) => {
      emit({
        type: 'tool-start',
        id: 'curl',
        name: 'Bash',
        input: { command: `curl -H "Authorization: Bearer ${'a'.repeat(190)}" https://api.example.com` },
      });
      emit({
        type: 'tool-start',
        id: 'env',
        name: 'Bash',
        input: { command: 'GITHUB_TOKEN=ghp_abcdefghijkl12 gh pr list' },
      });
      emit({ type: 'tool-end', id: 'env' });
      // An edit announced as its call starts, and the call fails: nothing was edited.
      emit({ type: 'tool-start', id: 'e1', name: 'Edit', input: { file_path: 'src/a.ts' } });
      emit({ type: 'file-change', paths: ['src/a.ts'], toolId: 'e1' });
      emit({ type: 'tool-start', id: 'e2', name: 'Edit', input: { file_path: 'src/b.ts' } });
      emit({ type: 'file-change', paths: ['src/b.ts'], toolId: 'e2' });
      emit({ type: 'tool-end', id: 'e1', isError: true });
      emit({ type: 'tool-end', id: 'e2' });
      await step();
      // Many messages while the curl call runs, then it fails: it stays, older and shorter steps go.
      for (let i = 0; i < PACK_STEPS_KEPT; i += 1) emit({ type: 'message', text: `note ${i}` });
      emit({ type: 'tool-end', id: 'curl', isError: true });
      emit({ type: 'message', text: 'after' });
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'x', mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const session = createAgentSession({ agent: pack({ lead, members: [worker] }), cwd: repo() });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    // Every event a millisecond after the one before.
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1));
    try {
      session.send('go');
      await vi.waitFor(() => expect(task()?.steps).toHaveLength(5));
      const steps = task()!.steps!;
      expect(steps[0]!.text).toBe('curl -H "Authorization: ***" https://api.example.com');
      expect(steps[1]!.text).toBe('GITHUB_TOKEN=*** gh pr list');
      expect(JSON.stringify(task())).not.toMatch(/aaaaaaaa|ghp_abcdef/);
      expect(steps.filter((item) => item.kind === 'edit').map((item) => item.text)).toEqual(['src/b.ts']);
      expect(steps.find((item) => item.text === 'src/a.ts')).toMatchObject({ kind: 'tool', failed: true });
      next();
      await vi.waitFor(() => expect(task()!.steps!.at(-1)!.text).toBe('after'));
      const kept = task()!.steps!;
      expect(kept).toHaveLength(PACK_STEPS_KEPT);
      expect(kept[0]).toMatchObject({ kind: 'tool', failed: true, text: expect.stringContaining('curl') });
      expect(kept.some((item) => item.text === 'note 0')).toBe(false);
    } finally {
      now.mockRestore();
      session.close();
      await session.idle();
    }
  });

  it('shows the running tool call until it ends, reads string-array commands and never fails on odd input', async () => {
    let next = () => {};
    const step = () => new Promise<void>((resolve) => (next = resolve));
    const worker = fake('worker', async (_task, emit, signal) => {
      emit({ type: 'message', text: 'Reading the code' });
      // A null-prototype object has no toString: joining it throws.
      emit({ type: 'tool-start', id: 'c1', name: 'search', input: { query: [Object.create(null)] } });
      await step();
      emit({ type: 'tool-end', id: 'c1', name: 'search' });
      await step();
      emit({ type: 'tool-start', id: 'c2', name: 'shell', input: { commands: ['npm test'] } });
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'x', mode: 'shared' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const session = createAgentSession({ agent: pack({ lead, members: [worker] }), cwd: repo() });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await vi.waitFor(() => expect(task()).toMatchObject({ status: 'running', text: 'tool search' }));
      // Its steps, oldest first: what it said, and the call that runs now with when it started.
      expect(task()!.steps).toEqual([
        { kind: 'message', text: 'Reading the code', at: expect.any(Number) },
        { kind: 'tool', name: 'search', at: expect.any(Number) },
      ]);
      next();
      await vi.waitFor(() => expect(task()?.text).toBe('Reading the code'));
      expect(task()!.steps![1]).toMatchObject({ kind: 'tool', name: 'search', endedAt: expect.any(Number) });
      next();
      await vi.waitFor(() => expect(task()?.text).toBe('tool shell: npm test'));
      expect(task()!.steps![2]).toEqual({ kind: 'tool', name: 'shell', text: 'npm test', at: expect.any(Number) });
      await session.actOnPackTask!(1, 't1', { type: 'stop' });
      expect(task()).toMatchObject({ status: 'aborted', stoppedBy: 'user' });
      // A call the task never ended is over with the task, and says it was cut short.
      expect(task()!.steps![2]!.endedAt).toBe(task()!.endedAt);
      expect(task()!.steps![2]!.interrupted).toBe(true);
      expect(task()!.steps![1]!.interrupted).toBeUndefined();
    } finally {
      session.close();
      await session.idle();
    }
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
        if (task.prompt.startsWith('next')) {
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

  it('refuses to discard a worktree shown as unchanged once it has changes, and its diff lists them', async () => {
    const cwd = repo();
    const worker = fake('worker', async () => ({ text: 'Nothing to change.' }));
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'look' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()).toMatchObject({ status: 'completed', state: 'unmerged', changes: [] });
      // Someone edits the retained worktree after the task ended.
      writeFileSync(join(task()!.cwd, 'late.txt'), 'kept\n');
      await expect(session.actOnPackTask!(1, 't1', { type: 'discard', empty: true })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
        publicMessage: 'The worktree has changes now. Open its diff first.',
      });
      expect(task()).toMatchObject({ state: 'unmerged', changes: ['A\tlate.txt'] });
      expect(existsSync(join(task()!.cwd, 'late.txt'))).toBe(true);
      // Reading the diff also lists what changed since.
      rmSync(join(task()!.cwd, 'late.txt'));
      writeFileSync(join(task()!.cwd, 'other.txt'), 'x\n');
      expect(await session.actOnPackTask!(1, 't1', { type: 'diff' })).toContain('+x');
      expect(task()?.changes).toEqual(['A\tother.txt']);
      // Clean again, it discards as before.
      rmSync(join(task()!.cwd, 'other.txt'));
      expect(await session.actOnPackTask!(1, 't1', { type: 'discard', empty: true })).toBe('Discarded t1.');
      expect(task()?.state).toBe('discarded');
      expect(await session.actOnPackTask!(1, 't1', { type: 'restore' })).toBe('Restored t1.');
      expect(task()?.state).toBe('unmerged');
    } finally {
      session.close();
      await team.close();
    }
  });

  it('refuses to discard as unchanged a worktree with staged work, and a stale diff still lists the files', async () => {
    const cwd = repo();
    const worker = fake('worker', async () => ({ text: 'Nothing to change.' }));
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'look' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()).toMatchObject({ status: 'completed', state: 'unmerged', changes: [] });
      const dir = task()!.cwd;
      const revision = task()!.checks?.revision;
      expect(revision).toBeTruthy();
      // A file added after the task ended: a diff asked for the old revision is stale, and the task
      // lists the file already, so the detail does not keep saying it changed nothing.
      writeFileSync(join(dir, 'late.txt'), 'late\n');
      await expect(session.actOnPackTask!(1, 't1', { type: 'diff', revision })).rejects.toMatchObject({
        reason: 'stale',
      });
      expect(task()?.changes).toEqual(['A\tlate.txt']);
      expect(task()?.checks?.revision).not.toBe(revision);
      // Staged in the worktree's own index, then deleted from the working copy: still work.
      execFileSync('git', ['add', 'late.txt'], { cwd: dir });
      rmSync(join(dir, 'late.txt'));
      await expect(session.actOnPackTask!(1, 't1', { type: 'discard', empty: true })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      expect(task()).toMatchObject({ state: 'unmerged', changes: ['A\tlate.txt'] });
      expect(existsSync(dir)).toBe(true);
      // Reading the diff keeps the staged file listed and says where it is: the worktree is not empty.
      expect(await session.actOnPackTask!(1, 't1', { type: 'diff' })).toContain(
        "Staged in the worktree's index only: late.txt.",
      );
      expect(task()?.changes).toEqual(['A\tlate.txt']);
      execFileSync('git', ['reset', '-q'], { cwd: dir });
      expect(await session.actOnPackTask!(1, 't1', { type: 'discard', empty: true })).toBe('Discarded t1.');
    } finally {
      session.close();
      await team.close();
    }
  });

  it.each([
    [
      'staged, then deleted',
      (dir: string) => {
        writeFileSync(join(dir, 'late.txt'), 'late\n');
        execFileSync('git', ['add', 'late.txt'], { cwd: dir });
        rmSync(join(dir, 'late.txt'));
      },
    ],
    [
      'committed, then deleted',
      (dir: string) => {
        writeFileSync(join(dir, 'late.txt'), 'late\n');
        execFileSync('git', ['add', 'late.txt'], { cwd: dir });
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'late'], { cwd: dir });
        rmSync(join(dir, 'late.txt'));
      },
    ],
  ])('keeps a worktree whose snapshot shows nothing but which holds a file %s', async (_, edit) => {
    const cwd = repo();
    const worker = fake('worker', async () => ({ text: 'Nothing to change.' }));
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'look' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()).toMatchObject({ status: 'completed', state: 'unmerged', changes: [] });
      const dir = task()!.cwd;
      edit(dir);
      await expect(session.actOnPackTask!(1, 't1', { type: 'discard', empty: true })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      // The patch is empty, but merging must not remove the worktree and the work in it.
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge' })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      expect(task()?.state).toBe('unmerged');
      expect(existsSync(dir)).toBe(true);
      expect(execFileSync('git', ['show', ':late.txt'], { cwd: dir, encoding: 'utf8' })).toBe('late\n');
      expect(existsSync(join(cwd, 'late.txt'))).toBe(false);
    } finally {
      session.close();
      await team.close();
    }
  });

  it('does not merge a patch that leaves out a file staged in the worktree and gone from its working copy', async () => {
    const cwd = repo();
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'a.txt'), 'one\ntwo\nthree\nfour\n');
      return { text: 'Added a line.' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'edit' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()).toMatchObject({ status: 'completed', state: 'unmerged', changes: ['M\ta.txt'] });
      const dir = task()!.cwd;
      writeFileSync(join(dir, 'notes.txt'), 'notes\n');
      execFileSync('git', ['add', 'notes.txt'], { cwd: dir });
      rmSync(join(dir, 'notes.txt'));
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge' })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      // Nothing applied, and the only copy of notes.txt is still staged in the kept worktree.
      expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
      expect(task()?.state).toBe('unmerged');
      expect(execFileSync('git', ['show', ':notes.txt'], { cwd: dir, encoding: 'utf8' })).toBe('notes\n');
      const patch = await session.actOnPackTask!(1, 't1', { type: 'diff' });
      expect(patch).toContain('+four');
      expect(patch).toContain("Staged in the worktree's index only: notes.txt.");
      await session.actOnPackTask!(1, 't1', { type: 'discard' });
      await session.actOnPackTask!(1, 't1', { type: 'restore' });
      expect(git(dir, 'show', ':notes.txt')).toBe('notes\n');
      // Staging everything the working copy has makes the index match the snapshot: it merges.
      execFileSync('git', ['add', '-A'], { cwd: dir });
      expect(await session.actOnPackTask!(1, 't1', { type: 'merge' })).toContain('Merged t1');
      expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\n');
      expect(existsSync(join(cwd, 'notes.txt'))).toBe(false);
    } finally {
      session.close();
      await team.close();
    }
  });

  it('does not discard as unchanged a worktree whose edit git status hides (assume-unchanged)', async () => {
    const cwd = repo();
    const worker = fake('worker', async () => ({ text: 'Nothing to change.' }));
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'look' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()).toMatchObject({ status: 'completed', state: 'unmerged', changes: [] });
      const dir = task()!.cwd;
      execFileSync('git', ['update-index', '--assume-unchanged', 'a.txt'], { cwd: dir });
      writeFileSync(join(dir, 'a.txt'), 'edited\n');
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('');
      await expect(session.actOnPackTask!(1, 't1', { type: 'discard', empty: true })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      expect(task()).toMatchObject({ state: 'unmerged', changes: ['M\ta.txt'] });
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('edited\n');
    } finally {
      session.close();
      await team.close();
    }
  });

  it.skipIf(process.platform === 'win32')(
    'compares filesystem case, mode and symlinks despite local Git settings',
    async () => {
      const cwd = repo();
      symlinkSync('a.txt', join(cwd, 'link'));
      git(cwd, 'add', 'link');
      git(cwd, 'commit', '-qm', 'link');
      const head = git(cwd, 'rev-parse', 'HEAD').trim();
      const hidden = async () => {
        const tree = await snapshotTree(cwd);
        expect(await patchCoversWorktree(cwd, head, tree, { empty: true })).toBe(false);
        expect(await worktreeMatchesCommit(cwd, head)).toBe(false);
      };
      git(cwd, 'config', 'core.ignoreCase', 'true');
      renameSync(join(cwd, 'a.txt'), join(cwd, 'A.txt'));
      await hidden();
      renameSync(join(cwd, 'A.txt'), join(cwd, 'a.txt'));
      git(cwd, 'config', 'core.fileMode', 'false');
      chmodSync(join(cwd, 'a.txt'), 0o755);
      await hidden();
      chmodSync(join(cwd, 'a.txt'), 0o644);
      git(cwd, 'config', 'core.symlinks', 'false');
      rmSync(join(cwd, 'link'));
      writeFileSync(join(cwd, 'link'), 'a.txt');
      await hidden();
    },
  );

  it('compares file contents when Git trusts an unchanged size and mtime', async () => {
    const cwd = repo();
    const path = join(cwd, 'a.txt');
    const when = new Date('2024-01-01');
    git(cwd, 'config', 'core.trustctime', 'false');
    utimesSync(path, when, when);
    git(cwd, 'update-index', '--refresh');
    const head = git(cwd, 'rev-parse', 'HEAD').trim();
    writeFileSync(path, readFileSync(path, 'utf8').replace('one', 'two'));
    utimesSync(path, when, when);
    expect(await worktreeMatchesCommit(cwd, head)).toBe(false);
  });

  it('finds a nested submodule edit even when the intermediate repository ignores it', async () => {
    const cwd = repo();
    const middle = repo();
    const leaf = repo();
    const file = ['-c', 'protocol.file.allow=always'];
    git(middle, ...file, 'submodule', 'add', '-q', leaf, 'leaf');
    git(middle, 'commit', '-qm', 'add leaf');
    git(cwd, ...file, 'submodule', 'add', '-q', middle, 'middle');
    git(cwd, 'commit', '-qm', 'add middle');
    git(cwd, ...file, 'submodule', 'update', '-q', '--init', '--recursive');
    const head = git(cwd, 'rev-parse', 'HEAD').trim();
    expect(await worktreeMatchesCommit(cwd, head)).toBe(true);
    const child = join(cwd, 'middle');
    git(child, 'config', 'diff.ignoreSubmodules', 'all');
    git(child, 'config', 'submodule.leaf.ignore', 'all');
    writeFileSync(join(child, 'leaf', 'a.txt'), 'nested edit');
    expect(await worktreeMatchesCommit(cwd, head)).toBe(false);
    expect(await patchCoversWorktree(cwd, head, await snapshotTree(cwd), { empty: true })).toBe(false);
  });

  it('keeps a worktree whose submodule holds an edit the patch cannot carry', async () => {
    const cwd = repo();
    const dep = repo();
    const file = ['-c', 'protocol.file.allow=always'];
    execFileSync('git', [...file, 'submodule', 'add', '-q', dep, 'dep'], { cwd });
    git(cwd, 'commit', '-q', '-m', 'dep');
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'a.txt'), 'one\ntwo\nthree\nfour\n');
      return { text: 'Added a line.' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'edit' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()).toMatchObject({ status: 'completed', state: 'unmerged', changes: ['M\ta.txt'] });
      const dir = task()!.cwd;
      writeFileSync(join(dir, 'dep', 'notes.txt'), 'before init');
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge' })).rejects.toMatchObject({ reason: 'changed' });
      rmSync(join(dir, 'dep', 'notes.txt'));
      execFileSync('git', [...file, 'submodule', 'update', '-q', '--init'], { cwd: dir });
      git(join(dir, 'dep'), 'config', 'status.showUntrackedFiles', 'no');
      writeFileSync(join(dir, 'dep', 'notes.txt'), 'untracked');
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge' })).rejects.toMatchObject({ reason: 'changed' });
      rmSync(join(dir, 'dep', 'notes.txt'));
      writeFileSync(join(dir, 'dep', 'a.txt'), 'edited in the submodule\n');
      // The parent's patch carries a.txt only: merging it would remove the worktree and the edit.
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge' })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
      expect(readFileSync(join(dir, 'dep', 'a.txt'), 'utf8')).toBe('edited in the submodule\n');
      // A new commit of the submodule, staged in the parent: Merge locally cannot apply it either.
      git(join(dir, 'dep'), 'commit', '-q', '-am', 'dep work');
      // With the parent's a.txt staged too, the index matches the snapshot: only the gitlink stops it.
      git(dir, 'add', 'a.txt', 'dep');
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge' })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      expect(task()?.state).toBe('unmerged');
      // Back to the parent's edit alone: it merges.
      execFileSync('git', ['reset', '-q', '--hard', 'HEAD~1'], { cwd: join(dir, 'dep') });
      execFileSync('git', ['reset', '-q', '--', 'dep'], { cwd: dir });
      expect(await session.actOnPackTask!(1, 't1', { type: 'merge' })).toContain('Merged t1');
    } finally {
      session.close();
      await team.close();
    }
  });

  it('lists the files of the revision a check ran on, and merges a mix of staged and unstaged edits', async () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'b.txt'), 'b\n');
    git(cwd, 'add', 'b.txt');
    git(cwd, 'commit', '-q', '-m', 'b');
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'a.txt'), 'one\ntwo\nthree\nfour\n');
      return { text: 'Added a line.' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'edit' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker], verification: { label: 'ok', run: () => ({ ok: true }) } });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()?.changes).toEqual(['M\ta.txt']);
      const dir = task()!.cwd;
      // Staged, then deleted from the working copy: the snapshot does not move, the list does.
      writeFileSync(join(dir, 'notes.txt'), 'notes\n');
      git(dir, 'add', 'notes.txt');
      rmSync(join(dir, 'notes.txt'));
      await session.actOnPackTask!(1, 't1', { type: 'verify' });
      expect(task()?.changes).toEqual(['M\ta.txt', 'A\tnotes.txt']);
      git(dir, 'reset', '-q', '--', 'notes.txt');
      // A file added after the task ended: the check's revision has it, and so does the list.
      writeFileSync(join(dir, 'c.txt'), 'c\n');
      await session.actOnPackTask!(1, 't1', { type: 'verify' });
      expect(task()?.changes).toEqual(['M\ta.txt', 'A\tc.txt']);
      // Another one while the check's result is shown: the watched worktree moves the revision on,
      // and the list with it.
      const checked = task()!.checks!.revision;
      writeFileSync(join(dir, 'd.txt'), 'd\n');
      await vi.waitFor(() => expect(task()!.checks!.revision).not.toBe(checked), { timeout: 5000 });
      expect(task()?.changes).toEqual(['M\ta.txt', 'A\tc.txt', 'A\td.txt']);
      // A merge refused as stale shows the files of the revision it found.
      const seen = task()!.checks!.revision;
      writeFileSync(join(dir, 'e.txt'), 'e\n');
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge', revision: seen })).rejects.toMatchObject({
        reason: 'stale',
      });
      expect(task()!.checks!.revision).not.toBe(seen);
      expect(task()?.changes).toEqual(['M\ta.txt', 'A\tc.txt', 'A\td.txt', 'A\te.txt']);
      // a.txt staged, b.txt edited and not: the patch carries both, so it merges.
      writeFileSync(join(dir, 'b.txt'), 'b changed\n');
      git(dir, 'add', 'a.txt');
      await session.actOnPackTask!(1, 't1', { type: 'verify' });
      expect(await session.actOnPackTask!(1, 't1', { type: 'merge', revision: task()!.checks!.revision })).toContain(
        'Merged t1',
      );
      expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\n');
      expect(readFileSync(join(cwd, 'b.txt'), 'utf8')).toBe('b changed\n');
    } finally {
      session.close();
      await team.close();
    }
  });

  it('lists a file the worker staged and then deleted when the task ends', async () => {
    const cwd = repo();
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'late.txt'), 'late\n');
      execFileSync('git', ['add', 'late.txt'], { cwd: task.cwd });
      rmSync(join(task.cwd, 'late.txt'));
      return { text: 'Staged a file.' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'edit' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    try {
      session.send('go');
      await session.idle();
      expect(session.get().turns[0]?.pack?.tasks[0]).toMatchObject({ state: 'unmerged', changes: ['A\tlate.txt'] });
      const ended = session.get().turns[0]!.pack!.tasks[0]!;
      expect(ended.worktree).toBe(ended.cwd);
    } finally {
      session.close();
      await team.close();
    }
  });

  it('merged without a diff or check first, a task lists the files of the revision merged', async () => {
    const cwd = repo();
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'a.txt'), 'one\ntwo\nthree\nfour\n');
      return { text: 'Added a line.' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'edit' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      const before = task()!.checks?.revision;
      writeFileSync(join(task()!.cwd, 'e.txt'), 'e\n');
      expect(await session.actOnPackTask!(1, 't1', { type: 'merge' })).toContain('Merged t1');
      expect(task()?.changes).toEqual(['M\ta.txt', 'A\te.txt']);
      expect(task()!.checks?.revision).not.toBe(before);
    } finally {
      session.close();
      await team.close();
    }
  });

  it("merges the task's change where it was made, whatever the person's diff settings say", async () => {
    const cwd = repo();
    git(cwd, 'config', 'diff.noprefix', 'true');
    git(cwd, 'config', 'diff.context', '0');
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'a.txt'), 'one\ntwo\ninserted\nthree\n');
      mkdirSync(join(task.cwd, 'lib'));
      writeFileSync(join(task.cwd, 'lib', 'thing'), 'thing\n');
      return { text: 'Inserted a line and added lib/thing.' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'edit' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    try {
      session.send('go');
      await session.idle();
      expect(await session.actOnPackTask!(1, 't1', { type: 'merge' })).toContain('Merged t1');
      expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('one\ntwo\ninserted\nthree\n');
      expect(readFileSync(join(cwd, 'lib', 'thing'), 'utf8')).toBe('thing\n');
      expect(existsSync(join(cwd, 'thing'))).toBe(false);
    } finally {
      session.close();
      await team.close();
    }
  });

  it('keeps a worktree with a repository cloned into it, whose files the patch cannot carry', async () => {
    const cwd = repo();
    const dep = repo();
    const worker = fake('worker', async (task) => {
      writeFileSync(join(task.cwd, 'a.txt'), 'one\ntwo\nthree\nfour\n');
      execFileSync('git', ['clone', '-q', dep, 'vendor'], { cwd: task.cwd });
      writeFileSync(join(task.cwd, 'vendor', 'a.txt'), 'patched in the clone\n');
      return { text: 'Added a line and patched the vendored copy.' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'edit' });
        await tool(task, 'wait');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    const task = () => session.get().turns[0]?.pack?.tasks[0];
    try {
      session.send('go');
      await session.idle();
      expect(task()).toMatchObject({ status: 'completed', state: 'unmerged' });
      const dir = task()!.cwd;
      // Also where git is told to leave submodules out of its diffs.
      git(dir, 'config', 'diff.ignoreSubmodules', 'all');
      await expect(session.actOnPackTask!(1, 't1', { type: 'merge' })).rejects.toMatchObject({
        name: 'PackActionError',
        reason: 'changed',
      });
      expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
      expect(readFileSync(join(dir, 'vendor', 'a.txt'), 'utf8')).toBe('patched in the clone\n');
      expect(task()?.state).toBe('unmerged');
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
        await expect(tool(task, 'discard', { id: started.id })).rejects.toThrow(
          /Cannot discard changes while in Plan mode/,
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

    // Inherited Plan mode (reported by lead's session event when task.mode is omitted) enforces the same guards.
    const inheritedModes: Array<string | undefined> = [];
    const inheritedWorker = fake(
      'codex',
      async (task) => {
        inheritedModes.push(task.mode);
        return { text: 'ok' };
      },
      { plan: true },
    );
    let editWorktreeId = '';
    const leadInherited = fake(
      'lead',
      async (task, emit) => {
        if (!task.resume) {
          const started = JSON.parse(await tool(task, 'delegate', { agent: 'codex', prompt: 'edit' })) as {
            id: string;
          };
          editWorktreeId = started.id;
          await tool(task, 'wait', { ids: [started.id] });
          return { text: 'edited', sessionId: 'lead-1' };
        }
        emit({ type: 'session', sessionId: 'lead-1', mode: 'plan' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        await expect(tool(task, 'delegate', { agent: 'opencode', prompt: 'research', mode: 'shared' })).rejects.toThrow(
          /does not support Plan mode/,
        );
        const started = JSON.parse(
          await tool(task, 'delegate', { agent: 'codex', prompt: 'plan helper', mode: 'shared' }),
        ) as { id: string };
        await tool(task, 'wait', { ids: [started.id] });
        await expect(tool(task, 'merge', { id: editWorktreeId })).rejects.toThrow(
          /Cannot merge changes while in Plan mode/,
        );
        await expect(tool(task, 'discard', { id: editWorktreeId })).rejects.toThrow(
          /Cannot discard changes while in Plan mode/,
        );
        return { text: 'inherited-plan' };
      },
      { mcp: true, plan: true, resume: true },
    );
    const inheritedTeam = pack({ lead: leadInherited, members: [inheritedWorker, plainWorker] });
    try {
      expect((await inheritedTeam.run({ prompt: 'turn 1', cwd }).result).ok).toBe(true);
      const turn2 = await inheritedTeam.run({ prompt: 'turn 2', cwd, resume: 'lead-1' }).result;
      expect(turn2).toMatchObject({ status: 'completed', ok: true, text: 'inherited-plan' });
      expect(inheritedModes).toEqual([undefined, 'plan']);
      expect(inheritedTeam.tasks()[0]?.state).toBe('unmerged');
    } finally {
      await inheritedTeam.close();
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

    // A Plan-mode run sharing a Pack cannot steer a running worker from a concurrent non-plan run.
    let finishWorker!: () => void;
    let workerStarted!: () => void;
    const workerStartedP = new Promise<void>((resolve) => (workerStarted = resolve));
    const steerableWorker: CodingAgent = {
      name: 'codex',
      command: process.execPath,
      capabilities: { steer: true, plan: true },
      run() {
        workerStarted();
        const done = new Promise<void>((resolve) => (finishWorker = resolve));
        const result = done.then(() => ok({ text: 'done' }));
        return {
          result,
          abort() {
            finishWorker();
          },
          steer: async () => {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'done', result: await result };
          },
        };
      },
    };
    let releaseEditLead!: () => void;
    const sharedLead = fake(
      'lead',
      async (task) => {
        if (task.mode !== 'plan') {
          await tool(task, 'delegate', { agent: 'codex', prompt: 'edit work', mode: 'shared' });
          await new Promise<void>((resolve) => (releaseEditLead = resolve));
          return { text: 'edit-lead' };
        }
        await expect(tool(task, 'steer', { id: 't1', text: 'do edit' })).rejects.toThrow(
          /Cannot steer t1 while in Plan mode/,
        );
        return { text: 'plan-lead' };
      },
      { mcp: true, plan: true },
    );
    const sharedPack = pack({ lead: sharedLead, members: [steerableWorker] });
    try {
      const editRun = sharedPack.run({ prompt: 'run edit', cwd });
      await workerStartedP;
      const planRun = await sharedPack.run({ prompt: 'run plan', cwd, mode: 'plan' }).result;
      expect(planRun).toMatchObject({ status: 'completed', ok: true, text: 'plan-lead' });
      finishWorker();
      releaseEditLead();
      expect((await editRun.result).ok).toBe(true);
    } finally {
      await sharedPack.close();
    }
  });

  it('continues a prior task in the new turn with a fresh prompt report and checks', async () => {
    const cwd = repo();
    const worker = fake(
      'worker',
      async (task) => {
        writeFileSync(join(task.cwd, 'a.txt'), task.prompt);
        return { sessionId: 'worker-id' };
      },
      { resume: true },
    );
    let round = 0;
    const lead = fake(
      'lead',
      async (task) => {
        if (round++ === 0) await tool(task, 'delegate', { agent: 'worker', prompt: 'original' });
        else {
          const [first] = JSON.parse(await tool(task, 'wait', { ids: ['t1'] }));
          expect(first.prompt).toBe('original');
          await tool(task, 'steer', { id: 't1', text: 'continued' });
        }
        await tool(task, 'wait', { ids: ['t1'] });
      },
      { mcp: true },
    );
    lead.runText = fake('review', async () => ({ text: 'VERDICT: LGTM' })).run;
    const team = pack({
      lead,
      members: [worker],
      verification: { label: 'test', run: async () => ({ ok: true, detail: 'passed' }) },
    });
    try {
      const first = team.run({ prompt: 'work', cwd });
      expect((await first.result).ok).toBe(true);
      await first.pack!.act('t1', { type: 'verify' });
      await first.pack!.act('t1', { type: 'review' });
      expect(first.pack!.task('t1')?.checks?.verify?.status).toBe('completed');
      const second = team.run({ prompt: 'continue', cwd });
      const result = await second.result;
      expect(result.ok, result.error).toBe(true);
      const task = second.pack!.task('t1');
      expect(task?.checks?.review).toBeUndefined();
      expect(task?.checks?.verify).toBeUndefined();
      expect(task?.fileStats?.['a.txt']).toEqual({ added: 1, removed: 3 });
      const patch = await second.pack!.act('t1', { type: 'diff', path: 'a.txt' });
      expect(patch).toContain('+continued');
      await expect(
        second.pack!.act('t1', { type: 'merge', checked: true, revision: task?.checks?.revision }),
      ).rejects.toMatchObject({ reason: 'stale' });
    } finally {
      await team.close();
    }
  });

  it('continues a finished task via steer in the same session and worktree, and refuses non-resumable drivers', async () => {
    const cwd = repo();
    const seen: Array<{ prompt: string; resume?: string; cwd: string }> = [];
    const worker = fake(
      'worker',
      async (task, emit) => {
        seen.push({ prompt: task.prompt, resume: task.resume, cwd: task.cwd });
        emit({ type: 'session', sessionId: 'worker-sess-1' });
        if (!task.resume) {
          writeFileSync(join(task.cwd, 'first.txt'), 'round 1\n');
          return { text: 'round 1 done', sessionId: 'worker-sess-1', usage: { inputTokens: 10, outputTokens: 5 } };
        }
        writeFileSync(join(task.cwd, 'second.txt'), 'round 2\n');
        return { text: 'round 2 done', sessionId: 'worker-sess-1', usage: { inputTokens: 20, outputTokens: 10 } };
      },
      { resume: true },
    );
    const noResume = fake('noresume', async () => ({ text: 'done', sessionId: 'ignored' }), { resume: false });
    const noSessionId = fake('nosess', async () => ({ text: 'done' }), { resume: true });
    let firstCwd = '';
    const lead = fake(
      'lead',
      async (task) => {
        const listed = JSON.parse(await tool(task, 'agents')) as Array<{ name: string; resume?: boolean }>;
        expect(listed.map((m) => [m.name, m.resume])).toEqual([
          ['worker', true],
          ['noresume', undefined],
          ['nosess', true],
        ]);
        const started = JSON.parse(
          await tool(task, 'delegate', { agent: 'worker', prompt: 'write first file', title: 'Files' }),
        ) as { id: string; cwd: string };
        firstCwd = started.cwd;
        const [r1] = JSON.parse(await tool(task, 'wait', { ids: [started.id] })) as [PackReport];
        expect(r1).toMatchObject({ id: 't1', status: 'completed', text: 'round 1 done', changes: ['A\tfirst.txt'] });

        const continued = await tool(task, 'steer', { id: 't1', text: 'now write second file' });
        expect(continued).toContain('Continued t1');

        const [r2] = JSON.parse(await tool(task, 'wait')) as [PackReport];
        expect(r2).toMatchObject({
          id: 't1',
          status: 'completed',
          text: 'round 2 done',
          cwd: firstCwd,
          changes: ['A\tfirst.txt', 'A\tsecond.txt'],
        });
        expect(r2.steers).toMatchObject([{ text: 'now write second file', from: 'lead', delivery: 'delivered' }]);
        await tool(task, 'merge', { id: 't1' });
        // Cannot continue after its worktree was merged.
        await expect(tool(task, 'steer', { id: 't1', text: 'too late' })).rejects.toThrow(/already merged/);

        // Refuses driver without capabilities.resume.
        await tool(task, 'delegate', { agent: 'noresume', prompt: 'once', mode: 'shared' });
        await tool(task, 'wait', { ids: ['t2'] });
        await expect(tool(task, 'steer', { id: 't2', text: 'again' })).rejects.toThrow(/cannot resume/);

        // Refuses task whose first run never reported a session id.
        await tool(task, 'delegate', { agent: 'nosess', prompt: 'once', mode: 'shared' });
        await tool(task, 'wait', { ids: ['t3'] });
        await expect(tool(task, 'steer', { id: 't3', text: 'again' })).rejects.toThrow(/no session id/);
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker, noResume, noSessionId] });
    try {
      const result = await team.run({ prompt: 'go', cwd }).result;
      expect(result.ok, result.error).toBe(true);
      expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 15 });
      expect(seen).toEqual([
        { prompt: 'write first file', resume: undefined, cwd: firstCwd },
        { prompt: 'now write second file', resume: 'worker-sess-1', cwd: firstCwd },
      ]);
      expect(readFileSync(join(cwd, 'first.txt'), 'utf8')).toBe('round 1\n');
      expect(readFileSync(join(cwd, 'second.txt'), 'utf8')).toBe('round 2\n');
    } finally {
      await team.close();
    }
  });

  it('resumes a real driver (claude --resume) in the same worktree when continuing a finished task', async () => {
    const cwd = repo();
    const binDir = mkdtempSync(join(root, 'claude-resume-'));
    const logFile = join(binDir, 'calls.jsonl');
    const script = join(binDir, 'fake-claude.mjs');
    writeFileSync(
      script,
      `import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
const resumed = args.includes('--resume');
writeFileSync(join(process.cwd(), resumed ? 'round2.txt' : 'round1.txt'), resumed ? 'r2\\n' : 'r1\\n');
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-sess-42' }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'claude-sess-42', result: resumed ? 'fixed' : 'initial' }));
`,
    );
    const bin = join(binDir, 'claude');
    writeFileSync(bin, `#!${process.execPath}\nimport(${JSON.stringify(script)});\n`, { mode: 0o755 });
    const worker = claude({ command: bin, steer: false, partialMessages: false });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'claude', prompt: 'round one' });
        const [first] = JSON.parse(await tool(task, 'wait')) as [PackReport];
        expect(first).toMatchObject({ id: 't1', status: 'completed', text: 'initial', changes: ['A\tround1.txt'] });
        await tool(task, 'steer', { id: 't1', text: 'round two' });
        const [second] = JSON.parse(await tool(task, 'wait')) as [PackReport];
        expect(second).toMatchObject({
          id: 't1',
          status: 'completed',
          text: 'fixed',
          changes: ['A\tround1.txt', 'A\tround2.txt'],
        });
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    try {
      const result = await team.run({ prompt: 'go', cwd }).result;
      expect(result.ok, result.error).toBe(true);
      const calls = readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { cwd: string; args: string[] });
      expect(calls).toHaveLength(2);
      expect(calls[0]!.args).not.toContain('--resume');
      expect(calls[1]!.cwd).toBe(calls[0]!.cwd);
      expect(calls[1]!.args.slice(-3)).toEqual(['--resume', 'claude-sess-42', 'round two']);
    } finally {
      await team.close();
    }
  });

  it('dismisses finished shared tasks via discard and hides them from lead and UI, while refusing running ones', async () => {
    const cwd = repo();
    let release!: () => void;
    const blocking = new Promise<void>((resolve) => (release = resolve));
    const worker = fake(
      'worker',
      async (task) => {
        if (task.prompt === 'slow') await blocking;
        return { text: `done:${task.prompt}`, sessionId: 's-shared' };
      },
      { resume: true },
    );
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: 'slow', mode: 'shared' });
        await tool(task, 'delegate', { agent: 'worker', prompt: 'fast', mode: 'shared' });
        // Running shared task cannot be discarded.
        await expect(tool(task, 'discard', { id: 't1' })).rejects.toThrow(/still running/);
        await tool(task, 'wait', { ids: ['t2'] });
        // Finished shared task is dismissed.
        expect(await tool(task, 'discard', { id: 't2' })).toBe('Dismissed t2.');
        // Dismissing twice or continuing a dismissed shared task is refused.
        await expect(tool(task, 'discard', { id: 't2' })).rejects.toThrow(/already dismissed/);
        await expect(tool(task, 'steer', { id: 't2', text: 'more' })).rejects.toThrow(/already dismissed/);
        release();
        const remaining = JSON.parse(await tool(task, 'wait')) as PackReport[];
        expect(remaining.map((r) => r.id)).toEqual(['t1']);
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    const session = createAgentSession({ agent: team, cwd });
    try {
      session.send('go');
      await session.idle();
      expect(team.tasks().map((t) => t.id)).toEqual(['t1']);
      expect(session.get().turns[0]?.pack?.tasks.map((t) => t.id)).toEqual(['t1']);
    } finally {
      release();
      session.close();
      await team.close();
    }
  });

  it('caps total delegated tasks per turn via maxTasksPerTurn while still allowing steer to reuse tasks', async () => {
    const cwd = repo();
    const worker = fake('worker', async (task) => ({ text: task.prompt, sessionId: `s-${task.prompt}` }), {
      resume: true,
    });
    const lead = fake(
      'lead',
      async (task) => {
        if (task.prompt.startsWith('turn 2')) {
          const started = JSON.parse(
            await tool(task, 'delegate', { agent: 'worker', prompt: 'fresh turn', mode: 'shared' }),
          ) as { id: string };
          expect(started.id).toBe('t3');
          await tool(task, 'wait');
          return;
        }
        await tool(task, 'delegate', { agent: 'worker', prompt: 'one', mode: 'shared' });
        await tool(task, 'delegate', { agent: 'worker', prompt: 'two', mode: 'shared' });
        await tool(task, 'wait');
        // Dismissing a shared task does not bypass the per-turn cap.
        await tool(task, 'discard', { id: 't2' });
        await expect(tool(task, 'delegate', { agent: 'worker', prompt: 'three', mode: 'shared' })).rejects.toThrow(
          /limit of 2 delegated tasks.*steer.*ask the person/i,
        );
        // Reusing an existing finished task via steer still works after reaching the cap.
        expect(await tool(task, 'steer', { id: 't1', text: 'follow up' })).toContain('Continued t1');
        const [reused] = JSON.parse(await tool(task, 'wait')) as [PackReport];
        expect(reused).toMatchObject({ id: 't1', status: 'completed', text: 'follow up' });
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker], maxTasksPerTurn: 2 });
    try {
      expect((await team.run({ prompt: 'turn 1', cwd }).result).ok).toBe(true);
      expect((await team.run({ prompt: 'turn 2', cwd }).result).ok).toBe(true);
    } finally {
      await team.close();
    }
  });

  it('omits full prompt on repeated wait calls and returns a short title instead', async () => {
    const cwd = repo();
    let finish!: () => void;
    const blocking = new Promise<void>((resolve) => (finish = resolve));
    const longPrompt =
      `Investigate the flaky test suite in src/agents. ${'Extra detailed context. '.repeat(30)}`.trim();
    const worker = fake('worker', async (_task, _emit, signal) => {
      await Promise.race([
        blocking,
        new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
      ]);
      return { text: 'all green' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        await tool(task, 'delegate', { agent: 'worker', prompt: longPrompt, mode: 'shared' });
        const [first] = JSON.parse(await tool(task, 'wait', { timeoutSeconds: 0 })) as [Record<string, unknown>];
        expect(first.prompt).toBe(longPrompt);
        expect(first.status).toBe('running');

        const [second] = JSON.parse(await tool(task, 'wait', { timeoutSeconds: 0 })) as [Record<string, unknown>];
        expect(second.prompt).toBeUndefined();
        expect(second.title).toBe('Investigate the flaky test suite in src/agents.');
        expect(second.status).toBe('running');

        finish();
        const [third] = JSON.parse(await tool(task, 'wait')) as [Record<string, unknown>];
        expect(third.prompt).toBeUndefined();
        expect(third.title).toBe('Investigate the flaky test suite in src/agents.');
        expect(third.status).toBe('completed');
        expect(third.text).toBe('all green');
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    try {
      const result = await team.run({ prompt: 'go', cwd }).result;
      expect(result.ok, result.error).toBe(true);
      // Full prompt is still kept on PackTask for the UI and pack.tasks().
      expect(team.tasks()[0]!.prompt).toBe(longPrompt);
    } finally {
      finish();
      await team.close();
    }
  });

  it('caps wait timeout below 300s and streams MCP progress notifications over SSE when accepted', async () => {
    const cwd = repo();
    let finish!: () => void;
    const blocking = new Promise<void>((resolve) => (finish = resolve));
    const worker = fake('worker', async (_task, emit, signal) => {
      emit({ type: 'tool-start', name: 'shell', input: { command: 'npm test' } });
      await Promise.race([
        blocking,
        new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
      ]);
      return { text: 'finished' };
    });
    const lead = fake(
      'lead',
      async (task) => {
        const server = task.mcpServers?.find((candidate) => candidate.name === 'pack') as Extract<
          McpServer,
          { url: string }
        >;
        // Check wait tool description advertises the cap below 300s.
        const listRes = await fetch(server.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...server.headers },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        });
        const listed = (await listRes.json()) as {
          result: {
            tools: Array<{
              name: string;
              description: string;
              inputSchema: { properties: Record<string, { description?: string }> };
            }>;
          };
        };
        const waitTool = listed.result.tools.find((t) => t.name === 'wait')!;
        expect(waitTool.description).toContain(String(MAX_WAIT_SECONDS));
        expect(waitTool.inputSchema.properties.timeoutSeconds?.description).toContain(String(MAX_WAIT_SECONDS));

        await tool(task, 'delegate', { agent: 'worker', prompt: 'run tests', mode: 'shared' });

        // Call wait with Accept: text/event-stream and _meta.progressToken -> receives progress events then result.
        const sseRes = await fetch(server.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...server.headers,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'wait',
              arguments: { timeoutSeconds: 0.25 },
              _meta: { progressToken: 'wait-tok' },
            },
          }),
        });
        expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
        const body = await sseRes.text();
        const messages = body
          .split('\n\n')
          .map((chunk) =>
            chunk
              .split('\n')
              .find((line) => line.startsWith('data: '))
              ?.slice(6),
          )
          .filter((line): line is string => !!line)
          .map(
            (line) =>
              JSON.parse(line) as {
                id?: number;
                method?: string;
                params?: Record<string, unknown>;
                result?: { content: [{ text: string }] };
              },
          );
        const progress = messages.filter((m) => m.method === 'notifications/progress');
        expect(progress.length).toBeGreaterThanOrEqual(2);
        for (const [index, message] of progress.entries())
          expect(message.params).toMatchObject({ progressToken: 'wait-tok', progress: index + 1 });
        const final = messages.find((m) => m.id === 2);
        expect(final?.result?.content[0].text).toContain('"status": "running"');

        // Verify timeoutSeconds > MAX_WAIT_SECONDS is capped at MAX_WAIT_SECONDS (240s).
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        try {
          const longWait = tool(task, 'wait', { timeoutSeconds: 600 });
          await vi.waitFor(() =>
            expect(timeoutSpy.mock.calls.some((call) => call[1] === MAX_WAIT_SECONDS * 1000)).toBe(true),
          );
          expect(timeoutSpy.mock.calls.some((call) => call[1] === 600_000)).toBe(false);
          finish();
          const [done] = JSON.parse(await longWait) as [PackReport];
          expect(done).toMatchObject({ id: 't1', status: 'completed', text: 'finished' });
        } finally {
          timeoutSpy.mockRestore();
        }
      },
      { mcp: true },
    );
    const team = pack({ lead, members: [worker] });
    try {
      const result = await team.run({ prompt: 'go', cwd }).result;
      expect(result.ok, result.error).toBe(true);
    } finally {
      finish();
      await team.close();
    }
  });
});

it('reopens an unmerged worker after shutdown and uses the same worktree and shared capacity', async () => {
  const cwd = repo();
  const { PackPool } = await import('./pack-pool.js');
  const pool = new PackPool(1);
  const worker = writer('writer', 'saved.txt', 'from the original worktree');
  const lead = fake(
    'lead',
    async (task) => {
      await tool(task, 'delegate', { agent: 'writer', prompt: 'write saved.txt' });
      await tool(task, 'wait', { ids: ['t1'] });
    },
    { mcp: true },
  );
  const template = pack({
    lead,
    members: [worker],
    verification: { label: 'verify', run: async () => ({ ok: true }) },
  });
  const first = template.forChat('first', pool);
  const original = first.run({ cwd, prompt: 'delegate' });
  expect((await original.result).ok).toBe(true);
  await first.shutdown();
  const records = JSON.parse(JSON.stringify(first.records()));
  const second = template.forChat('first', pool);
  const controls = second.recover({ cwd, prompt: 'delegate' }, records);
  expect(controls.task('t1')?.worktree).toBe(records[0].task.worktree);
  const busy = pool.take()!;
  await expect(controls.act('t1', { type: 'verify' })).rejects.toMatchObject({ reason: 'capacity' });
  busy();
  await controls.act('t1', { type: 'verify' });
  await controls.act('t1', { type: 'merge' });
  expect(readFileSync(join(cwd, 'saved.txt'), 'utf8')).toBe('from the original worktree');
  expect(second.records()).toEqual([]);
  await second.close();
});

it('queues workers across packs, releases each slot once and serializes mutations only within a repository', async () => {
  const { PackPool } = await import('./pack-pool.js');
  const pool = new PackPool(2);
  const a = pool.take('First')!;
  const b = pool.take('Second')!;
  expect(pool.take('Third')).toBeUndefined();
  expect(pool.busyChats).toEqual(['First', 'Second']);
  const stop = new AbortController();
  const canceled = pool.acquire(stop.signal, undefined, 'Canceled');
  const pending = pool.acquire(new AbortController().signal, undefined, 'Third');
  stop.abort();
  await expect(canceled).rejects.toThrow('Stopped waiting');
  b();
  const third = await pending;
  b();
  expect(pool.busyChats).toEqual(['First', 'Third']);
  a();
  third();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const entries: string[] = [];
  const one = pool.inRepo('/one', async () => {
    entries.push('first');
    await held;
  });
  const two = pool.inRepo('/one', async () => {
    entries.push('second');
  });
  await pool.inRepo('/other', async () => {
    entries.push('other');
  });
  expect(entries).toEqual(['first', 'other']);
  finish();
  await Promise.all([one, two]);
  expect(entries).toEqual(['first', 'other', 'second']);
});
