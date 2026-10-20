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
    await must(repo, ['read-tree', 'HEAD'], env);
    await must(repo, ['add', '-A'], env);
    return (await must(repo, ['write-tree'], env)).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function treeChanges(repo: string, tree: string): Promise<TreeChanges> {
  const files = (await must(repo, ['diff', '--name-status', '--no-renames', 'HEAD', tree]))
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', ...rest] = line.split('\t');
      return { status, path: rest.join('\t') };
    });
  const diff = await must(repo, ['diff', '--no-color', 'HEAD', tree]);
  return { files, diff: diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… (truncated)` : diff };
}

/** Commit `tree` only while the worktree still matches it, so what was reviewed is what lands. */
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
  await must(repo, ['read-tree', tree]);
  // Hooks run as usual; they can take a while.
  const commit = await runGit(repo, ['commit', '-m', message], { timeoutMs: 20 * 60_000 });
  const output = `${commit.stdout}\n${commit.stderr}`.trim();
  return { ok: commit.code === 0, output: output.length > 8_000 ? `…${output.slice(-8_000)}` : output };
}
