import { describe, expect, it, vi } from 'vitest';
import {
  PULL_REQUEST_LOOKUPS_RUNNING,
  PULL_REQUEST_LOOKUPS_WAITING,
  PullRequestBusy,
  pullRequestLookup,
} from './pull-requests.js';

const URL = 'https://github.com/acme/app/pull/351';
const WORKTREE = '/w/.genaicode/worktrees/t1';

/** `gh` answers `view`; git says the worktree has `branch` checked out (none: detached). */
function tools(view: string, branch?: string) {
  return vi.fn(async (...[command]: [command: string, args: readonly string[]]) => {
    if (command === 'gh') return view;
    if (branch === undefined) throw new Error('fatal: ref HEAD is not a symbolic ref');
    return `${branch}\n`;
  });
}

describe('pullRequestLookup', () => {
  it('reads the state gh reports, and asks once while the answer is fresh', async () => {
    const run = tools('{"state":"MERGED","headRefName":"work-panel"}\n');
    const lookup = pullRequestLookup({ run });
    expect(await lookup(URL)).toEqual({ state: 'merged', ours: false });
    expect(await lookup(URL)).toEqual({ state: 'merged', ours: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('gh', ['pr', 'view', URL, '--json', 'state,headRefName']);
    expect(await pullRequestLookup({ run: tools('{"state":"OPEN"}') })(URL)).toEqual({ state: 'open', ours: false });
    expect(await pullRequestLookup({ run: tools('{"state":"CLOSED"}') })(URL)).toEqual({
      state: 'closed',
      ours: false,
    });
  });

  it("is the task's own only when its worktree has the pull request's head branch checked out", async () => {
    const view = '{"state":"OPEN","headRefName":"work-panel"}';
    const run = tools(view, 'work-panel');
    expect(await pullRequestLookup({ run })(URL, WORKTREE)).toEqual({ state: 'open', ours: true });
    expect(run).toHaveBeenCalledWith('git', ['-C', WORKTREE, 'symbolic-ref', '--short', '-q', 'HEAD']);
    // "Fixed locally, see PR #351 for the original bug": another branch, or none (a detached worktree).
    expect(await pullRequestLookup({ run: tools(view, 'fix-import') })(URL, WORKTREE)).toEqual({
      state: 'open',
      ours: false,
    });
    expect(await pullRequestLookup({ run: tools(view) })(URL, WORKTREE)).toEqual({ state: 'open', ours: false });
  });

  it('has no answer when gh fails or says something else', async () => {
    const failing = async () => {
      throw new Error('gh: command not found');
    };
    expect(await pullRequestLookup({ run: failing })(URL)).toBeUndefined();
    expect(await pullRequestLookup({ run: tools('not json') })(URL)).toBeUndefined();
    expect(await pullRequestLookup({ run: tools('{"state":"DRAFT"}') })(URL)).toEqual({ ours: false });
  });

  it('hands gh nothing but a pull request address', async () => {
    const run = tools('{"state":"OPEN"}');
    const lookup = pullRequestLookup({ run });
    for (const url of [
      'https://github.com/acme/app/pull/351 --repo x',
      'https://github.com/acme/app/pull/351/files',
      'https://example.com/acme/app/pull/351',
      '--web',
      '',
    ]) {
      expect(await lookup(url)).toBeUndefined();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('runs two lookups at once, lets a few wait, and turns away the rest', async () => {
    const answers: Array<() => void> = [];
    let running = 0;
    let most = 0;
    const run = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          running += 1;
          most = Math.max(most, running);
          answers.push(() => {
            running -= 1;
            resolve('{"state":"OPEN"}');
          });
        }),
    );
    const lookup = pullRequestLookup({ run });
    const asked = Array.from({ length: PULL_REQUEST_LOOKUPS_RUNNING + PULL_REQUEST_LOOKUPS_WAITING }, (_, i) =>
      lookup(`https://github.com/acme/app/pull/${i + 1}`),
    );
    await expect(lookup('https://github.com/acme/app/pull/99')).rejects.toBeInstanceOf(PullRequestBusy);
    await vi.waitFor(() => expect(answers).toHaveLength(PULL_REQUEST_LOOKUPS_RUNNING));
    // The same address again is the answer on its way, not another lookup.
    void lookup('https://github.com/acme/app/pull/1');
    while (answers.length) {
      answers.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await Promise.all(asked)).toHaveLength(PULL_REQUEST_LOOKUPS_RUNNING + PULL_REQUEST_LOOKUPS_WAITING);
    expect(most).toBe(PULL_REQUEST_LOOKUPS_RUNNING);
    expect(run).toHaveBeenCalledTimes(PULL_REQUEST_LOOKUPS_RUNNING + PULL_REQUEST_LOOKUPS_WAITING);
  });
});
