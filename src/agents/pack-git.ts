import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const MAX_OUTPUT = 64 * 1024 * 1024;

function git(
  cwd: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: Buffer } = {},
): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill();
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', (error) => resolve({ code: 1, stdout: Buffer.alloc(0), stderr: error.message }));
    child.once('close', (code) =>
      resolve({
        code: size > MAX_OUTPUT ? 1 : (code ?? 1),
        stdout: Buffer.concat(out),
        stderr: size > MAX_OUTPUT ? 'git output too large' : Buffer.concat(err).toString('utf8'),
      }),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}

async function mustBytes(cwd: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<Buffer> {
  const result = await git(cwd, args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

async function must(cwd: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<string> {
  return (await mustBytes(cwd, args, options)).toString('utf8');
}

/** The top of the git worktree `cwd` is in, or null outside a repository. */
export async function repoRoot(cwd: string): Promise<string | null> {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

/** The branch checked out in `cwd`; undefined outside a repository, on a detached HEAD or before the first commit. */
export async function currentBranch(cwd: string): Promise<string | undefined> {
  const result = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return result.code === 0 ? result.stdout.toString('utf8').trim() || undefined : undefined;
}

/** Everything in `dir` (tracked, changed and untracked, minus ignored) as a git tree. Stages nothing. */
export async function snapshotTree(dir: string): Promise<string> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'genaicode-pack-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    const head = await git(dir, ['rev-parse', '--verify', '-q', 'HEAD']);
    if (head.code === 0) await must(dir, ['read-tree', head.stdout.toString().trim()], { env });
    await must(dir, ['add', '-A'], { env });
    return (await must(dir, ['write-tree'], { env })).trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Check out the recorded objects into an empty directory, without the worker's ignored files, Git config or hooks. */
export async function withSnapshot<T>(repo: string, tree: string, inspect: (dir: string) => Promise<T>): Promise<T> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'genaicode-checkout-'));
  const directory = path.join(scratch, 'project');
  const metadata = path.join(scratch, 'git');
  try {
    mkdirSync(directory);
    const objects = (await must(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'objects'])).trim();
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: scratch,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(scratch, 'empty.config'),
      GIT_ATTR_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
    };
    await must(
      scratch,
      [
        'init',
        '--quiet',
        '--bare',
        '--template=',
        '--object-format=' + (tree.length === 64 ? 'sha256' : 'sha1'),
        metadata,
      ],
      { env },
    );
    await must(scratch, ['--git-dir', metadata, '--work-tree', directory, 'read-tree', '--reset', '-u', tree], {
      env: { ...env, GIT_OBJECT_DIRECTORY: objects },
    });
    return await inspect(realpathSync(directory));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'genaicode pack',
  GIT_AUTHOR_EMAIL: 'pack@genaicode.invalid',
  GIT_COMMITTER_NAME: 'genaicode pack',
  GIT_COMMITTER_EMAIL: 'pack@genaicode.invalid',
};

/**
 * A new detached worktree at `dir` holding `repo` as it is now, uncommitted and untracked files
 * included. Returns the commit it starts from (reachable only from the worktree).
 */
export async function addWorktree(repo: string, dir: string): Promise<string> {
  const tree = await snapshotTree(repo);
  const head = await git(repo, ['rev-parse', '--verify', '-q', 'HEAD']);
  const parent = head.code === 0 ? ['-p', head.stdout.toString().trim()] : [];
  const commit = (
    await must(repo, ['commit-tree', tree, ...parent, '-m', 'genaicode pack: start of a delegated task'], {
      env: { ...process.env, ...IDENTITY },
    })
  ).trim();
  const parentDir = path.dirname(dir);
  mkdirSync(parentDir, { recursive: true });
  // Keep the worktrees out of the repository they sit in.
  const ignore = path.join(parentDir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  await must(repo, ['worktree', 'add', '--detach', dir, commit]);
  return commit;
}

export async function removeWorktree(repo: string, dir: string): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', dir]);
  rmSync(dir, { recursive: true, force: true });
  await git(repo, ['worktree', 'prune']);
}

/** Files the worktree changed since `start`, as `git diff --name-status` lines. */
export async function worktreeChanges(dir: string, start: string, tree?: string): Promise<string[]> {
  tree ??= await snapshotTree(dir);
  return (await must(dir, ['diff', '--name-status', '--no-renames', start, tree])).split('\n').filter(Boolean);
}

/**
 * Files staged in the worktree's own index that differ from its HEAD, as `git diff --name-status`
 * lines. A snapshot misses them once the working copy no longer has them (staged, then deleted).
 */
export async function stagedChanges(dir: string): Promise<string[]> {
  return (await must(dir, ['diff', '--cached', '--name-status', '--no-renames', 'HEAD'])).split('\n').filter(Boolean);
}

/**
 * Whether the patch from `start` to `tree` (the worktree's snapshot, taken with a fresh index) covers
 * everything the worktree at `dir` holds, so that merging it or, with `empty`, discarding it loses
 * nothing: HEAD is still `start` (a commit would not be carried), and the worktree's own index holds
 * either the start or the snapshot (anything staged that the working copy no longer has would go).
 * With `empty` the snapshot must also equal the start. Status flags such as `--assume-unchanged`
 * hide an edit from `git status` but not from the snapshot, which is why it is compared as trees.
 */
export async function patchCoversWorktree(
  dir: string,
  start: string,
  tree: string,
  { empty = false }: { empty?: boolean } = {},
): Promise<boolean> {
  const head = (await must(dir, ['rev-parse', '--verify', 'HEAD'])).trim();
  if (head !== start) return false;
  const startTree = (await must(dir, ['rev-parse', '--verify', `${start}^{tree}`])).trim();
  if (empty && tree !== startTree) return false;
  const index = await indexTree(dir);
  return index !== undefined && (index === startTree || index === tree);
}

/** The worktree's own index as a tree, written from a copy so the index itself is not touched; undefined while it has conflicts. */
async function indexTree(dir: string): Promise<string | undefined> {
  const file = (await must(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
  const scratch = mkdtempSync(path.join(tmpdir(), 'genaicode-pack-index-'));
  try {
    const copy = path.join(scratch, 'index');
    if (existsSync(file)) copyFileSync(file, copy);
    const result = await git(dir, ['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: copy } });
    return result.code === 0 ? result.stdout.toString('utf8').trim() : undefined;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The worktree's changes since `start` as a patch `git apply` takes. */
export function worktreeDiff(dir: string, start: string, tree: string): Promise<Buffer> {
  return mustBytes(dir, [
    'diff',
    '--binary',
    '--no-renames',
    '--no-textconv',
    '--no-ext-diff',
    '--no-color',
    start,
    tree,
  ]);
}

/**
 * Apply `patch` to the files in `repo`. Plain apply is all or nothing; `threeWay` merges what it
 * can and leaves conflict markers in the rest (git stages the files it merged).
 */
export async function applyPatch(
  repo: string,
  patch: Buffer,
  threeWay = false,
): Promise<{ ok: true } | { ok: false; error: string; conflicts: boolean }> {
  const base = ['apply', '--whitespace=nowarn'];
  if (!threeWay) {
    const result = await git(repo, [...base, '-'], { input: patch });
    return result.code === 0 ? { ok: true } : { ok: false, error: result.stderr.trim(), conflicts: false };
  }
  const result = await git(repo, [...base, '--3way', '-'], { input: patch });
  if (result.code === 0) return { ok: true };
  return { ok: false, error: result.stderr.trim(), conflicts: /with conflicts/.test(result.stderr) };
}
