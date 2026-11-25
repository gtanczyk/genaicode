import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
export async function snapshotTree(dir: string, strict = false): Promise<string> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'genaicode-pack-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    const head = await git(dir, ['rev-parse', '--verify', '-q', 'HEAD']);
    if (head.code === 0) await must(dir, ['read-tree', head.stdout.toString().trim()], { env });
    const settings = strict
      ? ['-c', 'core.ignoreCase=false', '-c', 'core.fileMode=true', '-c', 'core.symlinks=true']
      : [];
    await must(dir, [...settings, 'add', '-A'], { env });
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
export async function stagedChanges(dir: string, revision?: string): Promise<string[]> {
  if (revision) {
    // Both comparisons use the real index. Only their intersection has a staged version
    // different from both HEAD and the working-copy snapshot.
    const changed = await stagedChanges(dir);
    const different = new Set(
      (await must(dir, ['diff', '--cached', '--name-only', '--no-renames', revision])).split('\n'),
    );
    return changed.filter((line) => different.has(line.slice(line.indexOf('\t') + 1)));
  }
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
  if (index === undefined || !(await stagedInSnapshot(dir, startTree, index, tree))) return false;
  return (
    tree === (await snapshotTree(dir, true)) && !(await submoduleWork(dir)) && !(await gitlinkChanged(dir, start, tree))
  );
}

/**
 * Whether the snapshot adds or moves a gitlink (a repository cloned or committed inside the
 * worktree): the patch carries only its commit id, not the repository, so applying it and removing
 * the worktree would lose what is in there.
 */
async function gitlinkChanged(dir: string, start: string, tree: string): Promise<boolean> {
  const raw = await must(dir, ['diff', '--raw', '-z', '--no-renames', '--ignore-submodules=none', start, tree]);
  // Entries ":<old mode> <new mode> <old id> <new id> <status>": a gitlink is mode 160000.
  return raw.split('\0').some((entry) => /^:\d{6} 160000 /.test(entry));
}

/**
 * Whether every path staged in the worktree's index (where it differs from the start) is staged as
 * the snapshot has it: then the patch carries it. A path staged one way and changed again on disk
 * keeps a version only the index holds.
 */
async function stagedInSnapshot(dir: string, startTree: string, index: string, tree: string): Promise<boolean> {
  if (index === startTree || index === tree) return true;
  const entries = async (to: string) => {
    const raw = await must(dir, [
      'diff',
      '--raw',
      '-z',
      '--no-renames',
      '--ignore-submodules=none',
      '--abbrev=40',
      startTree,
      to,
    ]);
    // "-z" raw output: ":<modes> <ids> <status>\0<path>\0" for each entry.
    const parts = raw.split('\0');
    const found = new Map<string, string>();
    for (let at = 0; at + 1 < parts.length; at += 2) {
      const [, , , id] = parts[at]!.slice(1).split(' ');
      const mode = parts[at]!.slice(1).split(' ')[1];
      found.set(parts[at + 1]!, `${mode} ${id}`);
    }
    return found;
  };
  const staged = await entries(index);
  const snapshot = await entries(tree);
  for (const [file, entry] of staged) if (snapshot.get(file) !== entry) return false;
  return true;
}

/**
 * Whether a submodule of the worktree changed at all (its commit, staged or not, edits, untracked
 * files): the patch cannot carry what is inside it, nor does Merge locally apply a new commit of
 * it, so removing the worktree would lose it.
 */
async function submoduleWork(dir: string): Promise<boolean> {
  const entries = await must(dir, ['ls-files', '--stage', '-z']);
  for (const entry of entries.split('\0')) {
    const link = /^160000 ([0-9a-f]+) 0\t([\s\S]+)$/.exec(entry);
    if (!link) continue;
    const child = path.join(dir, link[2]!);
    const stat = lstatSync(child, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isDirectory()) return true;
    if (!existsSync(path.join(child, '.git'))) {
      if (readdirSync(child).length) return true;
    } else if (!(await worktreeMatchesCommit(child, link[1]!))) return true;
  }
  return false;
}

/** Compare the actual files (using a fresh index), staged content and nested repositories to a commit. */
export async function worktreeMatchesCommit(dir: string, commit: string): Promise<boolean> {
  if ((await must(dir, ['rev-parse', 'HEAD'])).trim() !== commit) return false;
  const tree = (await must(dir, ['rev-parse', 'HEAD^{tree}'])).trim();
  return (await indexTree(dir)) === tree && (await snapshotTree(dir, true)) === tree && !(await submoduleWork(dir));
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

/** Git omits line counts for binary changes. Keep the same path spelling as --name-status. */
export async function worktreeStats(dir: string, start: string, revision: string) {
  const stats: Record<string, { added: number; removed: number }> = Object.create(null);
  const output = await must(dir, ['diff', '--no-renames', '--numstat', start, revision]);
  for (const line of output.split('\n')) {
    const match = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (match) stats[match[3]!] = { added: Number(match[1]), removed: Number(match[2]) };
  }
  return stats;
}

/** The worktree's changes since `start` as a patch `git apply` takes. */
export async function worktreeDiff(dir: string, start: string, tree: string, file?: string): Promise<Buffer> {
  // --name-status C-quotes unusual names for display. Resolve that spelling against the
  // same tree's NUL-delimited path list before passing a literal pathspec back to Git.
  if (file?.startsWith('"')) {
    const args = ['diff', '--no-renames', '--name-only'];
    const display = (await must(dir, [...args, start, tree])).split('\n');
    const raw = (await must(dir, [...args, '-z', start, tree])).split('\0');
    const index = display.indexOf(file);
    if (index < 0) return Buffer.alloc(0);
    file = raw[index];
  }
  // The patch's form is pinned: a person's diff settings (no prefixes, other prefixes, less
  // context) would make `git apply` put a file elsewhere or a line in the wrong place.
  return mustBytes(dir, [
    '--literal-pathspecs',
    'diff',
    '--binary',
    '--no-renames',
    '--no-textconv',
    '--no-ext-diff',
    '--no-color',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '--unified=3',
    start,
    tree,
    ...(file ? ['--', file] : []),
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
