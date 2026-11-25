import { describe, expect, it, vi } from 'vitest';
import {
  PULL_REQUEST_LOOKUPS_RUNNING,
  PULL_REQUEST_LOOKUPS_WAITING,
  PullRequestBusy,
  pullRequestLookup,
} from './pull-requests.js';

const URL = 'https://github.com/acme/app/pull/351';
const WORKTREE = '/w/.genaicode/worktrees/t1';

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

/**
 * `gh` answers `view`; git says the worktree has `branch` checked out (none: detached), at `commit`,
 * with `status` from `git status --porcelain`.
 */
function tools(view: string, branch?: string, commit = HEAD, status = '') {
  return vi.fn(async (...[command, args]: [command: string, args: readonly string[]]) => {
    if (command === 'gh') return view;
    if (args[2] === 'rev-parse') return `${commit}\n`;
    if (args[2] === 'status') return status;
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
    expect(run).toHaveBeenCalledWith('gh', ['pr', 'view', URL, '--json', 'state,headRefName,headRefOid']);
    expect(await pullRequestLookup({ run: tools('{"state":"OPEN"}') })(URL)).toEqual({ state: 'open', ours: false });
    expect(await pullRequestLookup({ run: tools('{"state":"CLOSED"}') })(URL)).toEqual({
      state: 'closed',
      ours: false,
    });
  });

  it("is the task's own only when its worktree is the pull request's head branch at its head commit", async () => {
    const view = `{"state":"OPEN","headRefName":"work-panel","headRefOid":"${HEAD}"}`;
    const run = tools(view, 'work-panel');
    expect(await pullRequestLookup({ run })(URL, WORKTREE)).toEqual({ state: 'open', ours: true });
    expect(run).toHaveBeenCalledWith('git', ['-C', WORKTREE, 'symbolic-ref', '--short', '-q', 'HEAD']);
    expect(run).toHaveBeenCalledWith('git', ['-C', WORKTREE, 'rev-parse', 'HEAD']);
    expect(run).toHaveBeenCalledWith('git', ['-C', WORKTREE, 'status', '--porcelain']);
    // "Fixed locally, see PR #351 for the original bug": another branch, or none (a detached worktree).
    expect(await pullRequestLookup({ run: tools(view, 'fix-import') })(URL, WORKTREE)).toEqual({
      state: 'open',
      ours: false,
    });
    expect(await pullRequestLookup({ run: tools(view) })(URL, WORKTREE)).toEqual({ state: 'open', ours: false });
    // The worker pushed the pull request, then committed once more without pushing: that commit is
    // only in the worktree, which stays to merge or discard.
    expect(await pullRequestLookup({ run: tools(view, 'work-panel', 'f'.repeat(40)) })(URL, WORKTREE)).toEqual({
      state: 'open',
      ours: false,
    });
    // ...or edited a file and did not commit it.
    expect(await pullRequestLookup({ run: tools(view, 'work-panel', HEAD, ' M src/app.ts\n') })(URL, WORKTREE)).toEqual(
      { state: 'open', ours: false },
    );
    expect(await pullRequestLookup({ run: tools(view, 'work-panel', HEAD, '?? notes.md\n') })(URL, WORKTREE)).toEqual({
      state: 'open',
      ours: false,
    });
    // gh did not say which commit the pull request is at.
    expect(
      await pullRequestLookup({ run: tools('{"state":"OPEN","headRefName":"work-panel"}', 'work-panel') })(
        URL,
        WORKTREE,
      ),
    ).toEqual({ state: 'open', ours: false });
  });

  it('once merged, asks gh no more but checks the worktree again: an edit after the merge is not its pull request', async () => {
    let status = '';
    const run = vi.fn(async (...[command, args]: [command: string, args: readonly string[]]) => {
      if (command === 'gh') return `{"state":"MERGED","headRefName":"work-panel","headRefOid":"${HEAD}"}`;
      if (args[2] === 'rev-parse') return `${HEAD}\n`;
      if (args[2] === 'status') return status;
      return 'work-panel\n';
    });
    const lookup = pullRequestLookup({ run });
    expect(await lookup(URL, WORKTREE)).toEqual({ state: 'merged', ours: true });
    status = ' M src/app.ts\n';
    // Within the reuse window the answer stands, unless asked fresh.
    expect(await lookup(URL, WORKTREE)).toEqual({ state: 'merged', ours: true });
    expect(await lookup(URL, WORKTREE, { fresh: true })).toEqual({ state: 'merged', ours: false });
    vi.useFakeTimers({ now: Date.now() + 10 * 60_000, toFake: ['Date'] });
    try {
      expect(await lookup(URL, WORKTREE)).toEqual({ state: 'merged', ours: false });
    } finally {
      vi.useRealTimers();
    }
    expect(run.mock.calls.filter(([command]) => command === 'gh')).toHaveLength(1);
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
