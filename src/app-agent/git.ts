import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

async function must(repo: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await runGit(repo, args, { env });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

/** The whole worktree as a git tree, through a scratch index: nothing gets staged. */
export async function snapshotTree(repo: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'genaicode-app-agent-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    if (await head(repo)) await must(repo, ['read-tree', 'HEAD'], env);
    await must(repo, ['add', '-A'], env);
    return (await must(repo, ['write-tree'], env)).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function treeChanges(repo: string, tree: string): Promise<TreeChanges> {
  const base = (await head(repo)) ?? (await emptyTree(repo));
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
 * Commit `tree` only while the worktree still matches it, so what was reviewed is what lands.
 * The commit goes through a scratch index: a failed commit leaves the user's index as it was.
 */
export async function commitTree(
  repo: string,
  tree: string,
  message: string,
): Promise<{ ok: boolean; output: string }> {
  const current = await snapshotTree(repo);
  if (current !== tree) {
    return {
      ok: false,
      output: 'The files changed after they were reviewed. Ask the agent to propose the commit again.',
    };
  }
  const before = await head(repo);
  const dir = mkdtempSync(path.join(tmpdir(), 'genaicode-app-agent-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
  let commit;
  try {
    await must(repo, ['read-tree', tree], env);
    // Hooks run as usual, on the scratch index; they can take a while.
    commit = await runGit(repo, ['commit', '-m', message], { timeoutMs: 20 * 60_000, env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  let output = `${commit.stdout}\n${commit.stderr}`.trim();
  let ok = commit.code === 0;
  const made = ok ? await head(repo) : null;
  // HEAD is our commit only while its parent is the HEAD seen before; otherwise leave it alone.
  const parentOf = made ? await runGit(repo, ['rev-parse', '--verify', '-q', `${made}^`]) : null;
  const parent = parentOf?.code === 0 ? parentOf.stdout.trim() : null;
  if (made && parent !== before) {
    ok = false;
    output = `${output}\n\nHEAD moved while committing, so the commit could not be checked against the review. Check the history in git.`;
  } else if (made && (await must(repo, ['rev-parse', `${made}^{tree}`])).trim() !== tree) {
    // A hook rewrote the files: undo the commit, its changes stay in the worktree for a new review.
    // The expected old value refuses the undo if something else moved HEAD meanwhile.
    const undo = await runGit(
      repo,
      before
        ? ['update-ref', '-m', 'app-agent: undo hook-modified commit', 'HEAD', before, made]
        : ['update-ref', '-d', 'HEAD', made],
    );
    ok = false;
    output =
      undo.code === 0
        ? `${output}\n\nA commit hook changed the files after they were reviewed, so the commit was undone and its changes are left in the worktree. Ask the agent to propose the commit again.`
        : `${output}\n\nA commit hook changed the files after they were reviewed, and HEAD moved before the commit could be undone. Check commit ${made} in git.`;
  } else if (ok) {
    // The user's index now matches the new commit. The commit landed even if this fails.
    const reset = await runGit(repo, ['reset', '-q']);
    if (reset.code !== 0) {
      output = `${output}\n\nCommitted, but resetting the index to it failed: ${reset.stderr.trim()}. Run \`git reset\` before staging more.`;
    }
  }
  return { ok, output: output.length > 8_000 ? `…${output.slice(-8_000)}` : output };
}
