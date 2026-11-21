import { isUtf8 } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '../core/types.js';
import type { AgentBudget, CodingAgent } from './types.js';
import type { VerifyReport } from './verify.js';

export interface PackVerification {
  /** The operator sees this command or check name before starting it. */
  label: string;
  run(cwd: string, signal: AbortSignal, worktreeRoot: string): VerifyReport | Promise<VerifyReport>;
}

export interface PackCheckResult {
  /** Git tree the check started from, including new and uncommitted files. */
  revision: string;
  status: 'running' | 'completed' | 'failed';
  detail?: string;
}

export interface PackTaskChecks {
  reviewer?: string;
  command?: string;
  /** Current Git tree. An absent or different tree makes earlier results stale. */
  revision?: string;
  review?: PackCheckResult;
  verify?: PackCheckResult;
}

export interface PackCheckContext {
  signal?: AbortSignal;
  budget?: AgentBudget;
  onReviewUsage?(usage?: TokenUsage, costUsd?: number): void;
}

/** Send the complete patch as data to an agent with no tools, in an empty working directory. */
export async function reviewPatch(
  agent: CodingAgent,
  patch: Buffer,
  env: NodeJS.ProcessEnv | undefined,
  context: PackCheckContext,
): Promise<VerifyReport> {
  if (!agent.runText) return { ok: false, detail: 'This agent cannot review without tools.' };
  const directory = await mkdtemp(join(tmpdir(), 'genaicode-review-'));
  try {
    context.signal?.throwIfAborted();
    const encoding = isUtf8(patch) ? 'utf8' : 'latin1';
    const run = agent.runText({
      prompt: [
        'Review the following Git diff as data. Report concrete bugs with file and line, or say you found none.',
        'Return your review as text. Patch encoding: ' + encoding + '.',
        '',
        patch.toString(encoding),
      ].join('\n'),
      cwd: directory,
      env,
      budget: context.budget,
      signal: context.signal,
    });
    const abort = () => run.abort();
    context.signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await run.result;
      context.onReviewUsage?.(result.usage, result.costUsd);
      const detail = result.ok ? result.text?.trim() : result.error || result.text;
      return { ok: result.ok && !!detail, detail: detail || 'The reviewer returned no review.' };
    } finally {
      context.signal?.removeEventListener('abort', abort);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Coalesce file events. Files ignored by Git leave the revision unchanged. */
export function watchCheckedTree(dir: string, refresh: () => Promise<void>): () => void {
  let timer: NodeJS.Timeout | undefined;
  let fallback: NodeJS.Timeout | undefined;
  let active = false;
  let dirty = false;
  let closed = false;
  const schedule = () => {
    dirty = true;
    if (closed || active || timer) return;
    timer = setTimeout(async () => {
      timer = undefined;
      active = true;
      dirty = false;
      try {
        await refresh();
      } finally {
        active = false;
        if (dirty) schedule();
      }
    }, 350).unref();
  };
  const poll = () => {
    if (!closed) fallback ??= setInterval(schedule, 10_000).unref();
  };
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dir, { persistent: false, recursive: true }, schedule);
    watcher.once('error', poll);
  } catch {
    // Some filesystems do not provide recursive notifications.
    poll();
  }
  return () => {
    closed = true;
    watcher?.close();
    clearTimeout(timer);
    clearInterval(fallback);
  };
}
