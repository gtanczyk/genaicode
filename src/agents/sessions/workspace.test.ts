import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '../types.js';
import type { TopicStore } from './topics.js';
import type { SessionInfo } from './types.js';
import {
  conversationsFile,
  displayPath,
  ensureNeutralHome,
  neutralHomeDir,
  openProjectTool,
  readConversations,
  resolveProjectTarget,
  resolveSessionWorkspace,
  resolveTopicWorkspace,
  saveConversation,
  type WorkspaceDeps,
} from './workspace.js';

const roots: string[] = [];
const makeTemp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const session = (overrides: Partial<SessionInfo>): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id: 's1',
  where: 'local',
  updatedAt: 1000,
  ...overrides,
});

function fakeDeps(options: {
  home?: string;
  genaicodeHome?: string;
  dirs?: readonly string[];
  files?: readonly string[];
  gitRoots?: Record<string, string>;
  gitRemotes?: Record<string, string>;
}): WorkspaceDeps {
  const home = options.home ?? '/Users/tester';
  const genaicodeHome = options.genaicodeHome ?? `${home}/.genaicode`;
  const dirSet = new Set(options.dirs ?? []);
  const fileSet = new Set(options.files ?? []);
  return {
    env: { HOME: home, GENAICODE_HOME: genaicodeHome },
    isDirectory: (dir) => dirSet.has(dir),
    isFile: (target) => fileSet.has(target),
    realpath: (target) => target,
    gitTopLevel: (dir) => options.gitRoots?.[dir],
    gitRemoteUrl: (dir) => options.gitRemotes?.[dir],
  };
}

describe('workspace resolution', () => {
  it('resolves an existing session cwd, and falls back to repo root or main worktree when deleted', () => {
    const deps = fakeDeps({
      dirs: ['/Users/tester/.genaicode/home', '/Users/tester/src/knights', '/Users/tester/src/knights/packages'],
      gitRoots: {
        '/Users/tester/src/knights': '/Users/tester/src/knights',
        '/Users/tester/src/knights/packages': '/Users/tester/src/knights',
      },
    });

    // Existing cwd wins directly.
    expect(resolveSessionWorkspace(session({ cwd: '/Users/tester/src/knights' }), deps)).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/src/knights',
      origin: 'session',
    });

    // Neutral home stays neutral home.
    expect(resolveSessionWorkspace(session({ cwd: '/Users/tester/.genaicode/home' }), deps)).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/.genaicode/home',
      origin: 'home',
    });

    // Deleted subdirectory inside an existing git repo resolves to repo root via nearest existing parent.
    expect(resolveSessionWorkspace(session({ cwd: '/Users/tester/src/knights/packages/old-pkg/src' }), deps)).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/src/knights',
      origin: 'session',
    });

    // Deleted .claude/worktrees/* resolves to main worktree.
    expect(
      resolveSessionWorkspace(session({ cwd: '/Users/tester/src/knights/.claude/worktrees/feat-1' }), deps),
    ).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/src/knights',
      origin: 'session',
    });

    // Deleted (or existing) .genaicode/worktrees/* never picks the worktree; resolves to main repo.
    const withExistingWorktree = fakeDeps({
      dirs: ['/Users/tester/src/knights', '/Users/tester/src/knights/.genaicode/worktrees/task-1'],
      gitRoots: { '/Users/tester/src/knights': '/Users/tester/src/knights' },
    });
    expect(
      resolveSessionWorkspace(
        session({ cwd: '/Users/tester/src/knights/.genaicode/worktrees/task-1' }),
        withExistingWorktree,
      ),
    ).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/src/knights',
      origin: 'session',
    });
  });

  it('uses real git rev-parse --show-toplevel for a deleted subdir inside a real repository', () => {
    // Use a directory outside os.tmpdir() so isScratchDir() does not classify it as temp scratch.
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'ws-git-'));
    roots.push(root);
    const repo = join(root, 'knights');
    const sub = join(repo, 'packages', 'removed');
    mkdirSync(join(repo, 'packages'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const env = { HOME: join(root, 'fake-home'), GENAICODE_HOME: join(root, 'gc') };
    const resolved = resolveSessionWorkspace(session({ cwd: sub }), { env });
    expect(resolved.status).toBe('resolved');
    expect(realpathSync(resolved.cwd)).toBe(realpathSync(repo));
  });

  it('never picks home directory, temp scratch dirs, or unmounted volumes', () => {
    const deps = fakeDeps({
      dirs: ['/Users/tester', '/Users/tester/.genaicode/home', '/tmp/scratch-run', '/Volumes'],
    });

    // Person's home dir itself is disallowed -> unresolved.
    expect(resolveSessionWorkspace(session({ cwd: '/Users/tester' }), deps)).toMatchObject({
      status: 'unresolved',
      cwd: '/Users/tester/.genaicode/home',
      origin: 'unresolved',
    });

    // Temp dir is disallowed -> unresolved.
    expect(resolveSessionWorkspace(session({ cwd: '/tmp/scratch-run' }), deps)).toMatchObject({
      status: 'unresolved',
      cwd: '/Users/tester/.genaicode/home',
      origin: 'unresolved',
    });

    // Unmounted removable/network volume is treated as deleted -> unresolved.
    expect(resolveSessionWorkspace(session({ cwd: '/Volumes/BackupDisk/knights' }), deps)).toMatchObject({
      status: 'unresolved',
      cwd: '/Users/tester/.genaicode/home',
      origin: 'unresolved',
    });
  });

  it('resolves a topic from its most recent non-automated existing session, skipping automated ones and neutral home', () => {
    const deps = fakeDeps({
      dirs: [
        '/Users/tester/.genaicode/home',
        '/Users/tester/src/knights-old',
        '/Users/tester/src/knights-new',
        '/Users/tester/src/auto-dir',
      ],
    });
    const store: TopicStore = {
      topics: [
        { id: 't1', name: 'Knights' },
        { id: 't2', name: 'Automated only' },
      ],
      sessions: {
        'claude:home': 't1',
        'claude:auto': 't1',
        'claude:deleted': 't1',
        'codex:new': 't1',
        'claude:old': 't1',
        'claude:only-auto': 't2',
      },
    };
    const sessions = [
      session({ id: 'home', cwd: '/Users/tester/.genaicode/home', updatedAt: 9000 }),
      session({ id: 'auto', cwd: '/Users/tester/src/auto-dir', automated: true, updatedAt: 8000 }),
      session({ id: 'deleted', cwd: '/Users/tester/src/gone', updatedAt: 7000 }),
      session({ id: 'new', source: 'codex', agent: 'codex', cwd: '/Users/tester/src/knights-new', updatedAt: 6000 }),
      session({ id: 'old', cwd: '/Users/tester/src/knights-old', updatedAt: 5000 }),
      session({ id: 'only-auto', cwd: '/Users/tester/src/auto-dir', automated: true, updatedAt: 4000 }),
    ];

    expect(resolveTopicWorkspace('t1', sessions, store, deps)).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/src/knights-new',
      origin: 'topic',
    });

    // Automated-only topic cannot resolve a project folder -> unresolved (neutral home).
    expect(resolveTopicWorkspace('t2', sessions, store, deps)).toMatchObject({
      status: 'unresolved',
      cwd: '/Users/tester/.genaicode/home',
      origin: 'unresolved',
    });
  });

  it('resolves a claude.ai topic without local cwd from a local checkout of its repository, or asks if none exists', () => {
    const store: TopicStore = {
      topics: [
        { id: 't1', name: 'Knights Web' },
        { id: 't2', name: 'Cloud Only' },
      ],
      sessions: {
        'claude:remote-1': 't1',
        'claude:remote-2': 't2',
      },
    };
    const sessions = [
      session({
        id: 'remote-1',
        where: 'cloud',
        cwd: undefined,
        repository: 'https://github.com/gtanczyk/knights.git',
        project: { id: 'chan_1', name: 'Knights Web' },
        updatedAt: 2000,
      }),
      session({
        id: 'remote-2',
        where: 'cloud',
        cwd: undefined,
        repository: 'https://github.com/gtanczyk/uncloned-repo',
        project: { id: 'chan_2', name: 'Cloud Only' },
        updatedAt: 2000,
      }),
      // Another local session checked out the same repo.
      session({
        id: 'local-knights',
        cwd: '/Users/tester/src/knights',
        updatedAt: 1000,
      }),
    ];
    const deps = fakeDeps({
      dirs: ['/Users/tester/src/knights'],
      gitRemotes: { '/Users/tester/src/knights': 'git@github.com:gtanczyk/knights.git' },
    });

    expect(resolveTopicWorkspace('t1', sessions, store, deps)).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/src/knights',
      origin: 'topic',
    });

    expect(resolveTopicWorkspace('t2', sessions, store, deps)).toMatchObject({
      status: 'unresolved',
      cwd: '/Users/tester/.genaicode/home',
      origin: 'unresolved',
    });
  });

  it('resolves a topic mapped to a Codex desktop project root when no session cwd exists', () => {
    const store: TopicStore = {
      topics: [{ id: 't1', name: 'Atlas' }],
      sessions: {},
      projects: { 'codex:p1': 't1' },
    };
    const deps = fakeDeps({ dirs: ['/Users/tester/src/atlas'] });
    expect(
      resolveTopicWorkspace('t1', [], store, {
        ...deps,
        codexProjects: [{ id: 'p1', name: 'Atlas', roots: ['/Users/tester/src/atlas'] }],
      }),
    ).toEqual({
      status: 'resolved',
      cwd: '/Users/tester/src/atlas',
      origin: 'topic',
    });
  });
});

describe('open_project tool', () => {
  it('resolves paths, topic names, Codex projects, and known folders, and refuses home/root/files', () => {
    const store: TopicStore = {
      topics: [{ id: 't1', name: 'Knights' }],
      sessions: { 'claude:k1': 't1' },
    };
    const sessions = [
      session({ id: 'k1', cwd: '/Users/tester/src/knights', updatedAt: 2000 }),
      session({ id: 'a1', cwd: '/Users/tester/src/api-server', updatedAt: 1000 }),
    ];
    const codex = [{ id: 'c1', name: 'Diorama', roots: ['/Users/tester/src/diorama'] }];
    const deps = fakeDeps({
      dirs: ['/Users/tester', '/Users/tester/src/knights', '/Users/tester/src/api-server', '/Users/tester/src/diorama'],
      files: ['/Users/tester/src/notes.txt'],
    });
    const ctx = { ...deps, store, sessions, codexProjects: codex };

    expect(resolveProjectTarget({ path: '~/src/knights' }, ctx)).toEqual({
      cwd: '/Users/tester/src/knights',
      exists: true,
      topic: { id: 't1', name: 'Knights' },
    });
    expect(resolveProjectTarget({ path: '~/src/new-proj' }, ctx)).toEqual({
      cwd: '/Users/tester/src/new-proj',
      exists: false,
    });
    expect(resolveProjectTarget({ topic: 'knights' }, ctx)).toEqual({
      cwd: '/Users/tester/src/knights',
      exists: true,
      topic: { id: 't1', name: 'Knights' },
    });
    expect(resolveProjectTarget({ topic: 'Diorama' }, ctx)).toEqual({
      cwd: '/Users/tester/src/diorama',
      exists: true,
    });
    expect(resolveProjectTarget({ topic: 'api-server' }, ctx)).toEqual({
      cwd: '/Users/tester/src/api-server',
      exists: true,
    });
    expect(resolveProjectTarget({ path: '~' }, ctx)).toHaveProperty('error');
    expect(resolveProjectTarget({ path: '/' }, ctx)).toHaveProperty('error');
    expect(resolveProjectTarget({ path: '~/src/notes.txt' }, ctx)).toHaveProperty('error');
  });

  it('refuses to move without the person saying yes, and moves only on confirmation', async () => {
    const root = makeTemp('genaicode-open-project-');
    const existing = join(root, 'knights');
    mkdirSync(existing);
    const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    const moved: Array<{ cwd: string }> = [];
    const asked: ApprovalRequest[] = [];

    // Declined -> does not move.
    const declinedTool = openProjectTool({
      env,
      ask: () => (req) => {
        asked.push(req);
        return { confirm: ['No'] };
      },
      onMove: (target) => {
        moved.push(target);
      },
    });
    const declined = await declinedTool.call({ path: '~/knights' });
    expect(declined).toContain('declined');
    expect(moved).toEqual([]);
    expect(asked[0]?.summary).toBe('Continue this conversation in ~/knights?');

    // Unanswered / skipped -> does not move.
    const skippedTool = openProjectTool({
      env,
      ask: () => () => undefined,
      onMove: (target) => {
        moved.push(target);
      },
    });
    expect(await skippedTool.call({ path: '~/knights' })).toContain('declined');
    expect(moved).toEqual([]);

    // No handler -> does not move.
    const noHandlerTool = openProjectTool({
      env,
      ask: () => undefined,
      onMove: (target) => {
        moved.push(target);
      },
    });
    expect(await noHandlerTool.call({ path: '~/knights' })).toContain('Cannot ask');
    expect(moved).toEqual([]);

    // Confirmed -> moves.
    const yesTool = openProjectTool({
      env,
      ask: () => () => ({ confirm: ['Yes'] }),
      onMove: (target) => {
        moved.push(target);
      },
    });
    const ok = await yesTool.call({ path: '~/knights' });
    expect(ok).toContain('Moved this conversation to ~/knights');
    expect(moved).toEqual([{ cwd: existing }]);
  });

  it('creates a missing directory only after explicit confirmation', async () => {
    const root = makeTemp('genaicode-open-new-');
    const targetDir = join(root, 'src', 'brand-new');
    const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    const onMove = vi.fn();

    // Declined -> directory is NOT created.
    const noTool = openProjectTool({
      env,
      ask: () => () => ({ confirm: ['No'] }),
      onMove,
    });
    expect(await noTool.call({ path: '~/src/brand-new' })).toContain('declined');
    expect(existsSync(targetDir)).toBe(false);
    expect(onMove).not.toHaveBeenCalled();

    // Confirmed -> directory IS created and conversation moves there.
    const asked: ApprovalRequest[] = [];
    const yesTool = openProjectTool({
      env,
      ask: () => (req) => {
        asked.push(req);
        return { confirm: ['Create and continue'] };
      },
      onMove,
    });
    const reply = await yesTool.call({ path: '~/src/brand-new' });
    expect(asked[0]?.summary).toContain('does not exist');
    expect(existsSync(targetDir)).toBe(true);
    expect(onMove).toHaveBeenCalledWith({ cwd: targetDir });
    expect(reply).toContain('Moved this conversation to ~/src/brand-new');
  });
});

describe('neutral home and conversation store', () => {
  it('titles a stored taken-over conversation from what the person wrote', async () => {
    const root = makeTemp('genaicode-conv-');
    const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    const recap =
      "You are taking over a conversation that the user had with another coding agent (codex) in this workspace. Recap of what was said (latest last): User: Fix it codex: Done. The user's new message follows. --- Add tests";
    mkdirSync(join(root, '.genaicode'), { recursive: true });
    writeFileSync(
      conversationsFile(env),
      JSON.stringify([
        { id: 'old', cwd: root, origin: 'home', title: recap, updatedAt: 2 },
        { id: 'cut', cwd: root, origin: 'home', title: recap.slice(0, 90), updatedAt: 1 },
      ]),
    );
    const loaded = await readConversations(env);
    expect(loaded.map((item) => [item.id, item.title])).toEqual([
      ['old', 'Add tests'],
      ['cut', undefined],
    ]);
  });

  it('creates ~/.genaicode/home without git and persists conversation records', async () => {
    const root = makeTemp('genaicode-conv-');
    const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    const home = ensureNeutralHome(env);
    expect(home).toBe(neutralHomeDir(env));
    expect(existsSync(home)).toBe(true);
    expect(existsSync(join(home, '.git'))).toBe(false);
    expect(displayPath(home, env)).toBe('~/.genaicode/home');

    await saveConversation(
      {
        id: 'c1',
        cwd: join(root, 'src', 'knights'),
        origin: 'topic',
        topicId: 't1',
        topicName: 'Knights',
        title: 'Fix combat loop',
        agent: 'claude',
        source: 'claude',
        sessionId: 'sess-1',
        updatedAt: 2000,
      },
      env,
    );
    await saveConversation(
      {
        id: 'c2',
        cwd: home,
        origin: 'home',
        title: 'co tam?',
        updatedAt: 1000,
      },
      env,
    );
    const loaded = await readConversations(env);
    expect(loaded.map((item) => [item.id, item.origin, item.topicName])).toEqual([
      ['c1', 'topic', 'Knights'],
      ['c2', 'home', undefined],
    ]);

    // Updating an existing conversation replaces it in place.
    await saveConversation(
      {
        id: 'c2',
        cwd: join(root, 'src', 'new'),
        origin: 'project',
        title: 'co tam?',
        updatedAt: 3000,
      },
      env,
    );
    const updated = await readConversations(env);
    expect(updated.map((item) => [item.id, item.origin])).toEqual([
      ['c2', 'project'],
      ['c1', 'topic'],
    ]);
    // Write a non-file check too
    writeFileSync(join(root, 'plain.txt'), 'hi');
    expect(existsSync(join(root, 'plain.txt'))).toBe(true);
  });

  it('serializes concurrent saveConversation calls so no records are lost', async () => {
    const root = makeTemp('genaicode-concurrent-');
    const env = { HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        saveConversation(
          {
            id: `conv-${index}`,
            cwd: join(root, `proj-${index}`),
            origin: 'session',
            title: `Chat ${index}`,
            sessionId: `sess-${index}`,
            updatedAt: 1000 + index,
          },
          env,
        ),
      ),
    );
    const loaded = await readConversations(env);
    expect(loaded).toHaveLength(10);
    expect(loaded.map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, index) => `conv-${9 - index}`));
  });
});
