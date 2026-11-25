import { execFile } from 'node:child_process';
import type { PullRequestState } from '../react/work.js';

/** A GitHub pull request address, and nothing else: it is handed to `gh` as an argument. */
export const PULL_REQUEST_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

/** How long an answer is reused: the page asks again every minute for pull requests still open. */
const KEPT_MS = 30_000;

export type PullRequestLookup = (url: string) => Promise<PullRequestState | undefined>;

/**
 * Asks GitHub's own CLI (`gh pr view`) whether a pull request is open, merged or closed, with the
 * person's sign-in there. Undefined when `gh` is not installed or signed in, or does not answer in
 * 10 seconds: the page then shows the pull request without a state.
 */
export function pullRequestLookup(
  options: {
    env?: NodeJS.ProcessEnv;
    /** For tests: stands in for `gh pr view <url> --json state`, resolving to its output. */
    run?: (url: string) => Promise<string>;
  } = {},
): PullRequestLookup {
  const kept = new Map<string, { at: number; state: Promise<PullRequestState | undefined> }>();
  const run =
    options.run ??
    ((url: string) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          'gh',
          ['pr', 'view', url, '--json', 'state'],
          { env: options.env ?? process.env, timeout: 10_000, maxBuffer: 64 * 1024 },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        );
      }));
  return (url) => {
    if (!PULL_REQUEST_URL.test(url)) return Promise.resolve(undefined);
    const found = kept.get(url);
    if (found && Date.now() - found.at < KEPT_MS) return found.state;
    const state = run(url).then(
      (output) => {
        const state = String((JSON.parse(output) as { state?: unknown }).state ?? '').toLowerCase();
        return state === 'open' || state === 'merged' || state === 'closed' ? state : undefined;
      },
      () => undefined,
    );
    kept.set(url, { at: Date.now(), state: state.catch(() => undefined) });
    // A handful of pull requests per chat: the oldest answers go first.
    if (kept.size > 200) kept.delete(kept.keys().next().value!);
    return kept.get(url)!.state;
  };
}
