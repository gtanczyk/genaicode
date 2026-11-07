import { existsSync, statSync } from 'node:fs';
import { approximateSize, EventQueue } from './event-queue.js';
import type { ProcessExit } from './process.js';
import type { AgentBudget, AgentEvent, AgentFailure, AgentResult, BudgetWarning, RateLimit } from './types.js';

const STDERR_TAIL_BYTES = 4 * 1024;

/** What a driver reports about the task's end, beyond the exit code. */
export interface AgentOutcome {
  ok: boolean;
  error?: string;
}

/** Collects events for iteration and folds them into the pieces of an `AgentResult`. */
export class RunRecorder {
  readonly events = new EventQueue<AgentEvent>(approximateSize);
  private sessionId?: string;
  private text?: string;
  private usage?: AgentResult['usage'];
  private costUsd?: number;
  private lastError?: string;
  private stderrTail = '';
  private budget?: AgentBudget;
  private stopForBudget?: () => void;
  private readonly warned = new Set<BudgetWarning['kind']>();
  private overBudget?: string;
  private quotaReported = false;
  private quotaResetsAt?: number;

  constructor(
    private readonly name: string,
    private readonly command: string,
  ) {}

  /** Enforce `task.budget`: warn past `warnAt`, call `stop` once a cap is passed. */
  watchBudget(budget: AgentBudget | undefined, stop: () => void): void {
    if (!budget || (budget.maxTokens === undefined && budget.maxCostUsd === undefined)) return;
    this.budget = budget;
    this.stopForBudget = stop;
  }

  emit(event: AgentEvent): void {
    if (event.type === 'session') this.sessionId = event.sessionId;
    if (event.type === 'message') this.text = event.text;
    if (event.type === 'usage') {
      this.usage = event.usage;
      if (event.costUsd !== undefined) this.costUsd = event.costUsd;
    }
    if (event.type === 'rate-limit' && event.limit.status === 'exceeded') {
      this.quotaReported = true;
      if (event.limit.resetsAt !== undefined)
        this.quotaResetsAt = Math.max(this.quotaResetsAt ?? 0, event.limit.resetsAt);
    }
    if (event.type === 'error') this.lastError = event.message;
    if (event.type === 'stderr') this.stderrTail = (this.stderrTail + event.text).slice(-STDERR_TAIL_BYTES);
    this.events.push(event);
    if (event.type === 'error' && !this.quotaReported && QUOTA_ERROR.test(event.message)) {
      this.quotaReported = true;
      this.events.push({ type: 'rate-limit', limit: { window: 'quota', status: 'exceeded' } });
    }
    if (event.type === 'usage') this.checkBudget();
  }

  private checkBudget(): void {
    const budget = this.budget;
    if (!budget || this.overBudget) return;
    const checks: BudgetWarning[] = [];
    if (budget.maxTokens !== undefined)
      checks.push({ kind: 'tokens', used: this.usage ? tokenCount(this.usage) : 0, limit: budget.maxTokens });
    if (budget.maxCostUsd !== undefined && this.costUsd !== undefined)
      checks.push({ kind: 'cost', used: this.costUsd, limit: budget.maxCostUsd });
    const warnAt = budget.warnAt ?? 0.8;
    for (const check of checks) {
      if (check.used > check.limit) {
        this.overBudget =
          check.kind === 'tokens'
            ? `${this.name} went over its token budget (${check.used} of ${check.limit}).`
            : `${this.name} went over its cost budget ($${check.used.toFixed(4)} of $${check.limit}).`;
        this.events.push({ type: 'error', message: this.overBudget });
        this.stopForBudget?.();
        return;
      }
      if (check.used >= check.limit * warnAt && !this.warned.has(check.kind)) {
        this.warned.add(check.kind);
        this.events.push({ type: 'budget-warning', warning: check });
      }
    }
  }

  /** Build the result, emit `done`, and end the event stream. */
  finish(exit: ProcessExit, outcome: AgentOutcome | undefined): AgentResult {
    // Stopped for its budget: a failure, not a user stop, even if the agent finished meanwhile.
    const status = this.overBudget ? 'failed' : statusOf(exit, outcome);
    const error = status === 'completed' ? undefined : (this.overBudget ?? this.errorOf(status, exit, outcome));
    // A quota failure reported only in the outcome or on stderr.
    if (error && !this.quotaReported && QUOTA_ERROR.test(error)) {
      this.quotaReported = true;
      this.events.push({ type: 'rate-limit', limit: { window: 'quota', status: 'exceeded' } });
    }
    const failure = status === 'failed' ? this.failureOf(exit, outcome, error) : undefined;
    const result: AgentResult = {
      status,
      ok: status === 'completed',
      exitCode: exit.exitCode,
      signal: exit.signal,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.text !== undefined ? { text: this.text } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.costUsd !== undefined ? { costUsd: this.costUsd } : {}),
      ...(error ? { error } : {}),
      ...(failure ? { failure } : {}),
    };
    this.events.push({ type: 'done', result });
    this.events.close();
    return result;
  }

  /** The agent's own failure, as opposed to a task that went wrong. */
  private failureOf(
    exit: ProcessExit,
    outcome: AgentOutcome | undefined,
    error: string | undefined,
  ): AgentFailure | undefined {
    if (this.overBudget) return { kind: 'budget' };
    if (this.quotaReported)
      return { kind: 'quota', ...(this.quotaResetsAt !== undefined ? { resetsAt: this.quotaResetsAt } : {}) };
    if (error && AUTH_ERROR.test(error)) return { kind: 'auth' };
    if (exit.reason === 'spawn-error') {
      const code = (exit.error as NodeJS.ErrnoException | undefined)?.code;
      return code === 'ENOENT' || code === 'EACCES' ? { kind: 'unavailable' } : undefined;
    }
    if (exit.reason === 'overflow' || exit.signal) return { kind: 'crash' };
    // Ended without a result of its own: the CLI died, not the task.
    if (outcome === undefined && !this.lastError && (exit.reason === 'closed' || exit.exitCode !== 0))
      return { kind: 'crash' };
    return undefined;
  }

  private errorOf(status: AgentResult['status'], exit: ProcessExit, outcome: AgentOutcome | undefined): string {
    if (status === 'aborted') return `${this.name} was stopped.`;
    if (status === 'timeout') return `${this.name} timed out.`;
    if (exit.reason === 'overflow') return `${this.name} wrote a stdout line over 16 MiB.`;
    if (exit.reason === 'spawn-error') return spawnMessage(this.name, this.command, exit.error);
    const reported = outcome?.ok === false ? outcome.error : undefined;
    if (reported ?? this.lastError) return (reported ?? this.lastError)!;
    if (exit.reason === 'closed') return `${this.name} ended without reporting a result.`;
    return this.stderrTail.trim() || `${this.name} exited with code ${exit.exitCode ?? 'unknown'}.`;
  }
}

/** Errors that say a plan, account or API quota ran out. */
const QUOTA_ERROR =
  /\b(429|rate[ _-]?limit(ed|s)?|quota|usage limit|resource[ _]exhausted|too many requests|hit your limit)\b/i;

/** Errors that say the CLI is not signed in or its credentials were refused. */
const AUTH_ERROR =
  /\b(not (logged|signed) in|(log|sign)[ -]?in (is )?required|please (log|sign)[ -]?in|unauthori[sz]ed|401|invalid (api[ _-]?key|x-api-key|credentials)|authentication (failed|required|error)|credentials? (expired|invalid))\b/i;

/** Tokens a usage report counts: `totalTokens`, else input + output. */
export function tokenCount(usage: NonNullable<AgentResult['usage']>): number {
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** `usedPercent` as a status, for vendors that report only the number. */
export function limitStatus(usedPercent: number | undefined): RateLimit['status'] {
  if (usedPercent === undefined) return 'ok';
  return usedPercent >= 100 ? 'exceeded' : usedPercent >= 80 ? 'warning' : 'ok';
}

/** A vendor timestamp in seconds or milliseconds, as epoch milliseconds. */
export function epochMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

/** A window length in minutes as a short label: 300 → `5h`, 10080 → `7d`. */
export function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function statusOf(exit: ProcessExit, outcome: AgentOutcome | undefined): AgentResult['status'] {
  switch (exit.reason) {
    case 'aborted':
      return 'aborted';
    case 'timeout':
      return 'timeout';
    case 'closed':
      return outcome?.ok === true ? 'completed' : 'failed';
    case 'exit':
      return exit.exitCode === 0 && outcome?.ok !== false ? 'completed' : 'failed';
    default:
      return 'failed';
  }
}

/** Abort `target` with `source`, without keeping a listener on `source` once `target` is done. */
export function linkAbort(source: AbortSignal | undefined, target: AbortController): void {
  if (!source) return;
  if (source.aborted) return target.abort();
  const forward = () => target.abort();
  source.addEventListener('abort', forward, { once: true });
  target.signal.addEventListener('abort', () => source.removeEventListener('abort', forward), { once: true });
}

/** A signal that aborts when any of `signals` does (`AbortSignal.any` needs Node 20.3). */
export function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (controller.signal.aborted) break;
    linkAbort(signal, controller);
  }
  return controller.signal;
}

export function invalidCwd(cwd: string): string | undefined {
  if (!existsSync(cwd)) return `Working directory does not exist: ${cwd}`;
  if (!statSync(cwd).isDirectory()) return `Working directory is not a directory: ${cwd}`;
  return undefined;
}

function spawnMessage(name: string, command: string, error: Error | undefined): string {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')
    return `${command} was not found. Install ${name} or pass its path as \`command\`.`;
  return error?.message ?? `${name} could not start.`;
}
