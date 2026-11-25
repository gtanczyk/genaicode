import { execFile } from 'node:child_process';
import type { PullRequestStatus } from '../react/work.js';

/** A GitHub pull request address, and nothing else: it is handed to `gh` as an argument. */
export const PULL_REQUEST_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

/** How long an answer is reused: the page asks again every minute for pull requests not merged yet. */
const KEPT_MS = 30_000;
/** Lookups that run at once, and those that may wait for them; more are turned away. */
export const PULL_REQUEST_LOOKUPS_RUNNING = 2;
export const PULL_REQUEST_LOOKUPS_WAITING = 8;

/**
 * What became of the pull request at `url`, and whether the task whose worktree is `worktree` opened
 * it. Rejects with `PullRequestBusy` while too many lookups run or wait.
 */
export type PullRequestLookup = (url: string, worktree?: string) => Promise<PullRequestStatus | undefined>;

/** Too many pull request lookups run or wait: ask again later. */
export class PullRequestBusy extends Error {
  override name = 'PullRequestBusy';
}

type Run = (command: string, args: readonly string[]) => Promise<string>;

/**
 * Asks GitHub's own CLI (`gh pr view`) whether a pull request is open, merged or closed, with the
 * person's sign-in there, and git whether the task's worktree has the pull request's head branch
 * checked out at its head commit, with no uncommitted changes: only then did the task open it
 * (`ours`), and all its work is in it. A commit not pushed yet, or an edit not committed, leaves the
 * worktree to merge or discard, and the pull request a link. A reply that merely
 * links some pull request leaves the worktree to merge or discard as any other. No state when `gh`
 * is not installed or signed in, or does not answer in 10 seconds: the page then shows the pull
 * request without one.
 */
export function pullRequestLookup(
  options: {
    env?: NodeJS.ProcessEnv;
    /** For tests: stands in for `gh` and `git`, resolving to their output. */
    run?: Run;
  } = {},
): PullRequestLookup {
  const kept = new Map<string, { at: number; status: Promise<PullRequestStatus | undefined> }>();
  const run: Run =
    options.run ??
    ((command, args) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          command,
          [...args],
          { env: options.env ?? process.env, timeout: 10_000, maxBuffer: 64 * 1024 },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        );
      }));
  const git = (worktree: string, ...args: string[]) =>
    run('git', ['-C', worktree, ...args]).then(
      (output) => output,
      () => undefined,
    );
  /** The worktree is the pull request: its branch, at its head commit, with nothing else in it. */
  const holds = async (worktree: string, branch: string, commit: string): Promise<boolean> => {
    if ((await git(worktree, 'symbolic-ref', '--short', '-q', 'HEAD'))?.trim() !== branch) return false;
    if ((await git(worktree, 'rev-parse', 'HEAD'))?.trim() !== commit) return false;
    return (await git(worktree, 'status', '--porcelain'))?.trim() === '';
  };
  let running = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };
  const look = async (url: string, worktree?: string): Promise<PullRequestStatus | undefined> => {
    if (running < PULL_REQUEST_LOOKUPS_RUNNING) running += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      const view = await run('gh', ['pr', 'view', url, '--json', 'state,headRefName,headRefOid']).then(
        (output) => JSON.parse(output) as { state?: unknown; headRefName?: unknown; headRefOid?: unknown },
        () => undefined,
      );
      if (!view) return undefined;
      const raw = String(view.state ?? '').toLowerCase();
      const state = raw === 'open' || raw === 'merged' || raw === 'closed' ? raw : undefined;
      const head = typeof view.headRefName === 'string' ? view.headRefName : '';
      const commit = typeof view.headRefOid === 'string' ? view.headRefOid : '';
      const ours = worktree && head && commit ? await holds(worktree, head, commit) : false;
      return { ...(state ? { state } : {}), ours };
    } catch {
      return undefined;
    } finally {
      release();
    }
  };
  return (url, worktree) => {
    if (!PULL_REQUEST_URL.test(url)) return Promise.resolve(undefined);
    const key = `${url}\n${worktree ?? ''}`;
    const found = kept.get(key);
    if (found && Date.now() - found.at < KEPT_MS) return found.status;
    // A page that asks for more than this at once is turned away, not queued without end.
    if (running >= PULL_REQUEST_LOOKUPS_RUNNING && waiting.length >= PULL_REQUEST_LOOKUPS_WAITING)
      return Promise.reject(new PullRequestBusy('Too many pull request lookups at once.'));
    const status = look(url, worktree);
    kept.set(key, { at: Date.now(), status });
    // A handful of pull requests per chat: the oldest answers go first.
    if (kept.size > 200) kept.delete(kept.keys().next().value!);
    return status;
  };
}
