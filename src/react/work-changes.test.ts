import { describe, expect, it } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import type { SessionEntry, SessionState } from '../agents/session.js';
import type { Artifact } from '../agents/types.js';
import {
  patchFiles,
  readWorkView,
  taskFilePath,
  workArtifacts,
  workChanges,
  workTasks,
  workViewerBack,
  writeWorkView,
  type WorkPanelView,
} from './work.js';

const base = {
  agent: 'codex',
  prompt: 'Do it.',
  cwd: '/work/app/.genaicode/worktrees/t1-abc',
  mode: 'worktree' as const,
};
const task = (id: string, patch: Partial<PackTask>): PackTask => ({ ...base, id, status: 'completed', ...patch });
const artifact = (id: string, version: number, patch: Partial<Artifact> = {}): Artifact => ({
  id,
  name: id,
  title: `Title ${id}`,
  kind: 'html',
  mimeType: 'text/html',
  bytes: 1024 * version,
  version,
  ...patch,
});

function session(turns: Array<{ entries?: SessionEntry[]; tasks?: PackTask[] }>): SessionState {
  return {
    agent: 'claude',
    cwd: '/work/app',
    status: 'idle',
    canSteer: true,
    usage: {},
    queued: [],
    approvals: [],
    turns: turns.map((turn, index) => ({
      id: index + 1,
      agent: 'claude',
      prompt: 'go',
      startedAt: 0,
      entries: turn.entries ?? [],
      ...(turn.tasks ? { pack: { lead: 'claude', maxParallel: 4, interactive: true, tasks: turn.tasks } } : {}),
    })),
  } as SessionState;
}

const PATCH = [
  '--- src/a.ts',
  '+++ src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '--- a removed line that starts with two dashes',
  '+++ an added one',
  '+more',
  ' end',
  '--- /dev/null',
  '+++ src/new.ts',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
].join('\n');

describe('patchFiles', () => {
  it('cuts a patch into its files, with how each changed and its added and removed lines', () => {
    const files = patchFiles(PATCH);
    expect(files.map(({ path, kind, added, removed }) => [path, kind, added, removed])).toEqual([
      ['src/a.ts', 'M', 2, 1],
      ['src/new.ts', 'A', 2, 0],
      ['src/gone.ts', 'D', 0, 1],
    ]);
    // A `--- ` line inside a hunk is a removed line, not the next file.
    expect(files[0]!.text.split('\n')).toHaveLength(8);
    expect(files[2]!.text.startsWith('diff --git a/src/gone.ts')).toBe(true);
    expect(patchFiles('no patch at all')).toEqual([]);
  });
});

describe('workArtifacts', () => {
  it('lists each artifact once with its versions, the one published last first', () => {
    const state = session([
      {
        entries: [
          { kind: 'artifact', artifact: artifact('a', 1) },
          { kind: 'artifact', artifact: artifact('b', 1) },
        ],
      },
      { entries: [{ kind: 'artifact', artifact: artifact('a', 2, { title: 'Second' }) }] },
    ]);
    const list = workArtifacts(state);
    expect(list.map((item) => [item.id, item.latest.title, item.versions.map((v) => v.version)])).toEqual([
      ['a', 'Second', [2, 1]],
      ['b', 'Title b', [1]],
    ]);
    expect(workArtifacts(null)).toEqual([]);
  });
});

describe('workChanges', () => {
  it('lists the lead’s own files once, newest first, with a diff and counts only when every edit had a patch', () => {
    const state = session([
      {
        entries: [
          { kind: 'files', paths: ['/work/app/src/a.ts', 'src/new.ts', 'src/gone.ts'], diff: PATCH },
          { kind: 'files', paths: ['README.md'] },
        ],
      },
      {
        entries: [
          { kind: 'files', paths: ['README.md'] },
          { kind: 'files', paths: ['src/new.ts'] },
        ],
      },
    ]);
    const { lead, tasks, unlisted } = workChanges(state, workTasks(state));
    expect(tasks).toEqual([]);
    expect(unlisted).toBe(0);
    expect(
      lead.map(({ path, kind, edits, added, removed, diff }) => [path, kind, edits, added, removed, !!diff]),
    ).toEqual([
      // Edited again without a patch: a count over one of its two edits would mislead.
      ['src/new.ts', undefined, 2, undefined, undefined, false],
      ['README.md', undefined, 2, undefined, undefined, false],
      ['src/gone.ts', 'D', 1, 0, 1, true],
      ['/work/app/src/a.ts', 'M', 1, 2, 1, true],
    ]);
    expect(lead[3]!.diff).toContain('+++ src/a.ts');
    expect(lead[3]!.diff).not.toContain('src/new.ts');
  });

  it('lists the files of delegated tasks with their task, and leaves what a merge reports to the task', () => {
    const state = session([
      {
        entries: [
          // What merging t1 reports for the lead's turn.
          { kind: 'files', paths: ['src/cart.ts', 'src/cart.test.ts'] },
          { kind: 'files', paths: ['src/lead.ts'] },
        ],
        tasks: [
          task('t1', { state: 'merged', changes: ['M\tsrc/cart.ts', 'A\tsrc/cart.test.ts'] }),
          task('t2', { state: 'unmerged', changes: ['R100\tsrc/old.ts\tsrc/renamed.ts', 'D\tsrc/dead.ts'] }),
          task('t3', { state: 'unmerged' }),
          task('t4', { state: 'unmerged', status: 'running' }),
          task('t5', { mode: 'shared' }),
        ],
      },
    ]);
    const { lead, tasks, unlisted } = workChanges(state, workTasks(state));
    expect(lead.map((row) => row.path)).toEqual(['src/lead.ts']);
    expect(tasks).toEqual([
      { path: 'src/renamed.ts', from: 'src/old.ts', kind: 'R', task: '1:t2', id: 't2', state: 'unmerged' },
      { path: 'src/dead.ts', kind: 'D', task: '1:t2', id: 't2', state: 'unmerged' },
      { path: 'src/cart.ts', kind: 'M', task: '1:t1', id: 't1', state: 'merged' },
      { path: 'src/cart.test.ts', kind: 'A', task: '1:t1', id: 't1', state: 'merged' },
    ]);
    // t3 ended with a worktree whose files could not be listed; t4 still runs.
    expect(unlisted).toBe(1);
  });
});

describe('the viewer', () => {
  it('names where back goes', () => {
    const state = session([{ tasks: [task('t1', {})] }]);
    const tasks = workTasks(state);
    const view = (from: NonNullable<WorkPanelView['viewing']>['from']): WorkPanelView => ({
      tab: 'tasks',
      task: '1:t1',
      viewing: { kind: 'file', path: 'a.ts', from },
    });
    expect(
      (['changes', 'artifacts', 'task', 'chat'] as const).map((from) => workViewerBack(view(from), tasks)),
    ).toEqual(['Changes', 'Artifacts', 't1', 'Close']);
  });

  it('finds a task’s file in its worktree while that is there, else in the chat’s folder', () => {
    const unmerged = task('t1', { state: 'unmerged', cwd: '/work/app/.genaicode/worktrees/t1-abc/packages/web' });
    expect(taskFilePath(unmerged, 'packages/web/a.ts', '/work/app')).toBe(
      '/work/app/.genaicode/worktrees/t1-abc/packages/web/a.ts',
    );
    expect(taskFilePath(task('t1', { state: 'merged' }), 'src/a.ts', '/work/app')).toBe('/work/app/src/a.ts');
    expect(taskFilePath(task('t1', { mode: 'shared', cwd: '/work/app' }), 'src/a.ts', '/work/app/')).toBe(
      '/work/app/src/a.ts',
    );
  });

  it('remembers the tab of a chat, not what was open in the viewer', () => {
    const kept = new Map<string, string>();
    const store = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
    writeWorkView(store, 'a', { tab: 'changes', viewing: { kind: 'artifact', id: 'x', from: 'artifacts' } });
    expect(readWorkView(store, 'a')).toEqual({ tab: 'changes' });
    kept.set('genaicode-work', JSON.stringify([['a', { tab: 'live-or-unknown' }]]));
    expect(readWorkView(store, 'a')).toEqual({ tab: 'tasks' });
  });
});
