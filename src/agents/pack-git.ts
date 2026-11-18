import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_OUTPUT = 64 * 1024 * 1024;

function git(
  cwd: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string } = {},
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
    child.once('error', (error) => resolve({ code: 1, stdout: '', stderr: error.message }));
    child.once('close', (code) =>
      resolve({
        code: size > MAX_OUTPUT ? 1 : (code ?? 1),
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: size > MAX_OUTPUT ? 'git output too large' : Buffer.concat(err).toString('utf8'),
      }),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}

async function must(
  cwd: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; input?: string },
): Promise<string> {
  const result = await git(cwd, args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

/** The top of the git worktree `cwd` is in, or null outside a repository. */
export async function repoRoot(cwd: string): Promise<string | null> {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** Everything in `dir` (tracked, changed and untracked, minus ignored) as a git tree. Stages nothing. */
async function snapshotTree(dir: string): Promise<string> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'genaicode-pack-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    const head = await git(dir, ['rev-parse', '--verify', '-q', 'HEAD']);
    if (head.code === 0) await must(dir, ['read-tree', head.stdout.trim()], { env });
    await must(dir, ['add', '-A'], { env });
    return (await must(dir, ['write-tree'], { env })).trim();
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
  const parent = head.code === 0 ? ['-p', head.stdout.trim()] : [];
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
export async function worktreeChanges(dir: string, start: string): Promise<string[]> {
  const tree = await snapshotTree(dir);
  return (await must(dir, ['diff', '--name-status', '--no-renames', start, tree])).split('\n').filter(Boolean);
}

/** The worktree's changes since `start` as a patch `git apply` takes. */
export async function worktreeDiff(dir: string, start: string): Promise<string> {
  const tree = await snapshotTree(dir);
  return must(dir, ['diff', '--binary', '--no-renames', start, tree]);
}

/**
 * Apply `patch` to the files in `repo`. Plain apply is all or nothing; `threeWay` merges what it
 * can and leaves conflict markers in the rest (git stages the files it merged).
 */
export async function applyPatch(
  repo: string,
  patch: string,
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
