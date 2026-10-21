import { execFile } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TreeChanges } from './state.js';

const MAX_DIFF = 200_000;

function runGit(
  repo: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: repo, timeout: options.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024, env: options.env },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** The commit HEAD points at, or null in a repository without commits. */
async function head(repo: string): Promise<string | null> {
  const result = await runGit(repo, ['rev-parse', '--verify', '-q', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** The empty tree, in the repository's hash format: the base of a first commit. */
async function emptyTree(repo: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'genaicode-app-agent-index-'));
  try {
    return (await must(repo, ['write-tree'], { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') })).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A commit in the middle of one of these would leave the user's own operation half done.
const OPERATIONS: Array<[string, string]> = [
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['sequencer', 'cherry-pick or revert'],
];

async function operationInProgress(repo: string): Promise<string | null> {
  for (const [name, label] of OPERATIONS) {
    const where = await runGit(repo, ['rev-parse', '--git-path', name]);
    if (where.code === 0 && existsSync(path.resolve(repo, where.stdout.trim()))) return label;
  }
  return null;
}

async function indexPath(repo: string): Promise<string> {
  return path.resolve(repo, (await must(repo, ['rev-parse', '--git-path', 'index'])).trim());
}

/** The user's index file as it is on disk (null when there is none yet). */
function indexBytes(file: string): Buffer | null {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

/**
 * `git reset` of the user's index to HEAD, only if the index is still `expected`: done on a copy
 * while holding Git's own `index.lock`, so nothing can stage in between the check and the swap.
 */
async function resetIndexIf(
  repo: string,
  file: string,
  expected: Buffer | null,
): Promise<{ ok: true } | { ok: false; changed: boolean; error?: string }> {
  const lock = `${file}.lock`;
  try {
    writeFileSync(lock, '', { flag: 'wx' });
  } catch {
    return { ok: false, changed: true };
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'genaicode-app-agent-index-'));
  let locked = true;
  try {
    const current = indexBytes(file);
    const same = current === null ? expected === null : expected !== null && current.equals(expected);
    if (!same) return { ok: false, changed: true };
    const copy = path.join(dir, 'index');
    if (current) writeFileSync(copy, current);
    const reset = await runGit(repo, ['reset', '-q'], { env: { ...process.env, GIT_INDEX_FILE: copy } });
    if (reset.code !== 0) return { ok: false, changed: false, error: reset.stderr.trim() };
    copyFileSync(copy, lock);
    renameSync(lock, file);
    locked = false;
    return { ok: true };
  } finally {
    if (locked) rmSync(lock, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

async function must(repo: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await runGit(repo, args, { env });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

/**
 * The worktree as a git tree, the commit it is a change on (null before the first commit) and the
 * branch HEAD names (null when detached).
 */
export interface Snapshot {
  tree: string;
  base: string | null;
  ref: string | null;
}

async function headRef(repo: string): Promise<string | null> {
  const result = await runGit(repo, ['symbolic-ref', '-q', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** The whole worktree as a git tree, through a scratch index: nothing gets staged. */
export async function snapshotTree(repo: string): Promise<Snapshot> {
  const dir = mkdtempSync(path.join(tmpdir(), 'genaicode-app-agent-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    const ref = await headRef(repo);
    const base = await head(repo);
    if (base) await must(repo, ['read-tree', base], env);
    await must(repo, ['add', '-A'], env);
    return { tree: (await must(repo, ['write-tree'], env)).trim(), base, ref };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The snapshot's changes against its own base, which is what the user reviews. */
export async function treeChanges(repo: string, { tree, base: from }: Snapshot): Promise<TreeChanges> {
  const base = from ?? (await emptyTree(repo));
  const files = (await must(repo, ['diff', '--name-status', '--no-renames', base, tree]))
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', ...rest] = line.split('\t');
      return { status, path: rest.join('\t') };
    });
  // `-\t-\tpath` in numstat marks a binary file: the diff only says it differs.
  const binary = (await must(repo, ['diff', '--numstat', '--no-renames', '-z', base, tree]))
    .split('\0')
    .filter((entry) => entry.startsWith('-\t-\t'))
    .map((entry) => entry.slice(4));
  const diff = await must(repo, ['diff', '--no-color', base, tree]);
  const shown =
    diff.length <= MAX_DIFF ? { diff } : { diff: `${diff.slice(0, MAX_DIFF)}\n… (truncated)`, truncated: true };
  return { files, ...shown, ...(binary.length ? { binary } : {}) };
}

/**
 * Commit the snapshot only while the worktree and HEAD still match it, so what was reviewed is
 * what lands. Built from plumbing rather than `git commit`: the hooks run on a scratch index (the
 * user's index stays as it was), a hook that changes the files stops the commit before it exists,
 * only the reviewed branch moves and only from the reviewed base, and a merge or cherry-pick in progress is never taken
 * over.
 */
export async function commitTree(
  repo: string,
  { tree, base, ref }: Snapshot,
  message: string,
): Promise<{ ok: boolean; output: string }> {
  const busy = await operationInProgress(repo);
  if (busy) return refuse(`A ${busy} is in progress in this repository. Finish or abort it`);
  const current = await snapshotTree(repo);
  if (current.ref !== ref) return refuse('HEAD is on another branch than when the changes were reviewed');
  if (current.base !== base) return refuse('HEAD moved after the changes were reviewed');
  if (current.tree !== tree) return refuse('The files changed after they were reviewed');

  // The user's own index, to tell later whether something staged meanwhile.
  const index = await indexPath(repo);
  const staged = indexBytes(index);
  const dir = mkdtempSync(path.join(tmpdir(), 'genaicode-app-agent-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index'), GIT_EDITOR: ':' };
  const messageFile = path.join(dir, 'COMMIT_EDITMSG');
  const logs: string[] = [];
  let made: string;
  let subject = '';
  try {
    await must(repo, ['read-tree', tree], env);
    const pre = await runHook(repo, 'pre-commit', [], env);
    logs.push(pre.output);
    if (!pre.ok) return done(false, logs, 'The pre-commit hook failed, so nothing was committed.');
    if ((await must(repo, ['write-tree'], env)).trim() !== tree) {
      return done(
        false,
        logs,
        'A commit hook changed the files after they were reviewed, so nothing was committed; its changes are left in the worktree. Ask the agent to propose the commit again.',
      );
    }
    writeFileSync(messageFile, `${message.trim()}\n`);
    for (const [name, args] of [
      ['prepare-commit-msg', [messageFile, 'message']],
      ['commit-msg', [messageFile]],
    ] as const) {
      const hook = await runHook(repo, name, [...args], env);
      logs.push(hook.output);
      if (!hook.ok) return done(false, logs, `The ${name} hook failed, so nothing was committed.`);
    }
    // Like `git commit -m`: whitespace is cleaned up, `#` lines are kept.
    const finalMessage = readFileSync(messageFile, 'utf8')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!finalMessage) return done(false, logs, 'The commit message is empty after the hooks ran.');
    writeFileSync(messageFile, `${finalMessage}\n`);
    subject = finalMessage.split('\n')[0]!;
    const sign = (await runGit(repo, ['config', '--bool', 'commit.gpgSign'])).stdout.trim() === 'true';
    made = (
      await must(repo, ['commit-tree', tree, ...(base ? ['-p', base] : []), ...(sign ? ['-S'] : []), '-F', messageFile])
    ).trim();
    // A merge started while the hooks or the signer ran is left alone: committing now would bury it.
    // Git has no lock for that, so this runs last, right before the update.
    const started = await operationInProgress(repo);
    if (started) return done(false, logs, `A ${started} started while committing, so nothing was committed.`);
    // The reviewed branch itself (HEAD itself when detached), and only from the reviewed base:
    // anything that moved it or switched HEAD meanwhile wins and this commit is dropped.
    // Git locks HEAD itself while it updates the branch HEAD names, so a checkout cannot land
    // inside the update; one that lands just before it still leaves the commit on the reviewed
    // branch, and the index alone (below).
    const switched = (await headRef(repo)) !== ref;
    const moved = switched
      ? null
      : await runGit(repo, [
          'update-ref',
          ...(ref ? [] : ['--no-deref']),
          '-m',
          `commit: ${subject}`,
          ref ?? 'HEAD',
          made,
          base ?? '0'.repeat(tree.length),
        ]);
    if (!moved || moved.code !== 0) {
      return done(false, logs, 'HEAD moved while committing, so nothing was committed. Check the history in git.');
    }
    // Still on the scratch index, which now matches the new commit, as `git commit` would leave it.
    const post = await runHook(repo, 'post-commit', [], env);
    logs.push(post.output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const branch = ref?.replace(/^refs\/heads\//, '') ?? 'detached HEAD';
  const summary = `[${branch} ${made.slice(0, 7)}] ${subject}`;
  // One that started in the moment before the update may still describe the old commit.
  const late = await operationInProgress(repo);
  if (late) {
    return done(
      true,
      [...logs, summary],
      `A ${late} started while committing, so the index was left as is. Check it against the new commit before finishing it.`,
    );
  }
  // Bring the user's index to the new commit, unless something staged or switched HEAD meanwhile.
  const reset = (await headRef(repo)) === ref ? await resetIndexIf(repo, index, staged) : null;
  if (!reset || (!reset.ok && reset.changed)) {
    return done(
      true,
      [...logs, summary],
      'The index or HEAD changed while committing, so the index was left as is. Check `git status` before staging more.',
    );
  }
  if (!reset.ok) {
    return done(
      true,
      [...logs, summary],
      `Committed, but resetting the index to it failed: ${reset.error}. Run \`git reset\` before staging more.`,
    );
  }
  return done(true, [...logs, summary]);
}

function refuse(reason: string): { ok: boolean; output: string } {
  return { ok: false, output: `${reason}, then ask the agent to propose the commit again.` };
}

function done(ok: boolean, logs: string[], note?: string): { ok: boolean; output: string } {
  const output = [...logs.filter(Boolean), ...(note ? [note] : [])].join('\n\n');
  return { ok, output: output.length > 8_000 ? `…${output.slice(-8_000)}` : output };
}

/** Run one of the repository's hooks the way `git commit` would; a missing hook passes. */
async function runHook(
  repo: string,
  name: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; output: string }> {
  // Hooks can take a while (a test run in pre-commit).
  const timeoutMs = 20 * 60_000;
  // `git hook run` (Git 2.36+) finds the hook (core.hooksPath) and runs it as Git would, on any OS.
  const viaGit = await runGit(repo, ['hook', 'run', '--ignore-missing', name, '--', ...args], { timeoutMs, env });
  if (!/not a git command|unknown subcommand/i.test(viaGit.stderr)) {
    return { ok: viaGit.code === 0, output: `${viaGit.stdout}\n${viaGit.stderr}`.trim() };
  }
  const where = await runGit(repo, ['rev-parse', '--git-path', `hooks/${name}`]);
  const file = path.resolve(repo, where.stdout.trim());
  try {
    accessSync(file, constants.X_OK);
  } catch {
    return { ok: true, output: '' };
  }
  const top = (await runGit(repo, ['rev-parse', '--show-toplevel'])).stdout.trim() || repo;
  return new Promise((resolve) => {
    execFile(file, args, { cwd: top, env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ ok: !error, output: `${String(stdout)}\n${String(stderr)}`.trim() }),
    );
  });
}
