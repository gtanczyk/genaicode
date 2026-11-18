import type { TokenUsage } from '../core/types.js';
import { decideApproval } from './live-agent.js';
import { resolvePermissions, unsupportedPermissions } from './permissions.js';
import type { ProcessExit } from './process.js';
import { anySignal, RunRecorder, tokenCount, type AgentOutcome } from './runtime.js';
import type {
  AgentBudget,
  AgentCapabilities,
  AgentEvent,
  AgentFailure,
  AgentPermissions,
  AgentRun,
  AgentTask,
  ApprovalDecision,
  CodingAgent,
  McpServer,
} from './types.js';
import type { SessionSource } from './sessions/types.js';

/**
 * Where a managed session stands.
 * - `idle`: the agent finished its turn and waits for input (`stopReason` says why).
 * - `completed` / `failed` / `cancelled` / `timeout`: the session is over.
 */
export type ManagedState = 'queued' | 'running' | 'idle' | 'completed' | 'failed' | 'cancelled' | 'timeout';

/**
 * Why an `idle` or ended session stopped, normalized across vendors:
 * `end-turn` (done, waiting for input), `requires-action` (an approval is open), `budget` (a cap
 * was reached), `error`. Other values are the vendor's own word.
 */
export type ManagedStopReason = 'end-turn' | 'requires-action' | 'budget' | 'error' | (string & {});

/** What a managed platform can do, beyond the `CodingAgent` capabilities it shares. */
export interface ManagedCapabilities extends AgentCapabilities {
  /** Budget units the platform enforces itself, stopping the session at the cap. */
  budget?: readonly ('usd' | 'tokens')[];
  /** Accepts `ManagedStart.files`. */
  files?: boolean;
}

/** A file placed in the session's workspace before the agent starts. */
export interface ManagedFile {
  /** Relative to the workspace root. */
  path: string;
  content: string | Uint8Array;
}

/** Everything a managed session starts from. Fields a provider cannot honor make `start` reject. */
export interface ManagedStart {
  prompt: string;
  /** Extra system instructions for this session. */
  system?: string;
  model?: string;
  effort?: string;
  maxTurns?: number;
  /** The provider's workspace reference: a repository, a branch, an environment id. */
  workspace?: string;
  /** Remote MCP servers only. `headers` carry per-session credentials and never appear in events. */
  mcpServers?: readonly McpServer[];
  files?: readonly ManagedFile[];
  /**
   * Passed on to the platform's own cap where `capabilities.budget` has the unit. Platforms cap the
   * whole session, so on `resume` `managedAgent()` adds what the session spent before this run.
   */
  budget?: AgentBudget;
  /** Wall-clock cap the platform enforces, where it has one. */
  maxDurationSeconds?: number;
  /** Continue an earlier session: a previous snapshot's `id`. */
  resume?: string;
  permissions?: AgentPermissions;
  /** Extra arguments for providers that take them (most managed platforms do not). */
  extraArgs?: readonly string[];
  /** The caller's id for this work, for the platform's names, metadata and logs. */
  correlationId?: string;
  /** Vendor-specific options, documented by each driver. */
  vendor?: Readonly<Record<string, unknown>>;
}

/** Token usage, plus the vendor's own breakdown (thought, tool use, reasoning, cache writes...). */
export interface ManagedUsage extends TokenUsage {
  details?: Readonly<Record<string, number>>;
}

/** A managed session as the platform reports it now. Safe to store: it carries no secrets. */
export interface ManagedSnapshot {
  id: string;
  state: ManagedState;
  stopReason?: ManagedStopReason;
  /** The agent's last message, when the platform reports it with the session. */
  text?: string;
  /** Why the session failed. */
  error?: string;
  failure?: AgentFailure;
  /** Cumulative for the session; `managedAgent()` reports a resumed run's share as the change since it began. */
  usage?: ManagedUsage;
  costUsd?: number;
  model?: string;
  /** The vendor's own word for the state. */
  vendorState?: string;
  /** Per-session resources `release()` frees: credential vaults, uploaded files, sandboxes. */
  release?: readonly string[];
  /**
   * Event position this snapshot stands at, for `events()` and `watch()`. `start()` should set it
   * just before the new turn's first event, so a resumed session's history is not read again.
   */
  cursor?: string;
  /** Epoch milliseconds. */
  startedAt?: number;
  endedAt?: number;
}

/** Events since `cursor`, and the session's state when the platform reports it with them. */
export interface ManagedEventPage {
  events: AgentEvent[];
  cursor?: string;
  /** More events wait past `cursor`: read them before the next interval. */
  hasMore?: boolean;
  snapshot?: ManagedSnapshot;
}

/** One step of a live event stream: events, a new snapshot, or both. */
export interface ManagedUpdate {
  events?: AgentEvent[];
  snapshot?: ManagedSnapshot;
  /** Position after these events, handed back to `watch` when it reconnects. */
  cursor?: string;
}

/**
 * A hosted agent platform (Anthropic Managed Agents, Gemini Managed Agents, OpenAI, Cursor...).
 *
 * Every method addresses a session by id, so a session can outlive the process that started it:
 * store `snapshot.id` and call `get` later. `managedAgent()` turns a provider into a `CodingAgent`.
 */
export interface ManagedProvider {
  readonly name: string;
  readonly capabilities: ManagedCapabilities;
  /** The platform's sessions, for `listSessions()` (`CodingAgent.sessions`). */
  readonly sessions?: SessionSource | null;
  start(request: ManagedStart, signal?: AbortSignal): Promise<ManagedSnapshot>;
  /** `null`: the session does not exist (any more). */
  get(id: string, signal?: AbortSignal): Promise<ManagedSnapshot | null>;
  /** Events since `cursor`, for platforms that are polled. */
  events?(id: string, cursor: string | undefined, signal?: AbortSignal): Promise<ManagedEventPage>;
  /**
   * A live stream of the session; it ends when the session settles or `signal` aborts. On a
   * reconnect `cursor` is the last update's, so the stream resumes after it rather than replaying.
   */
  watch?(id: string, signal: AbortSignal, cursor?: string): AsyncIterable<ManagedUpdate>;
  /** Add input: steers a running turn, or starts the next one on an idle session. */
  send?(id: string, text: string): Promise<void>;
  /** Answer an `approval-request` the session emitted. */
  answer?(id: string, approvalId: string, decision: ApprovalDecision, note?: string): Promise<void>;
  /** Stop the current work. `enforced: false` when the platform could not confirm it. */
  interrupt(id: string): Promise<{ enforced: boolean }>;
  /** Free the snapshot's per-session resources (`snapshot.release`). Safe to call twice. */
  release?(snapshot: ManagedSnapshot): Promise<void>;
  /** Delete the session and its history. */
  delete?(id: string): Promise<void>;
}

export interface ManagedAgentOptions {
  /** Delay between polls when the provider has no `watch`. Default 5 s. */
  pollIntervalMs?: number;
  /** Delete the session after the run. Default false: it stays for `task.resume`. */
  deleteSession?: boolean;
  /** Extra `ManagedStart` fields for every run (`system`, `files`, `vendor`...). */
  start?: Omit<Partial<ManagedStart>, 'prompt'>;
}

const ENDED = new Set<ManagedState>(['completed', 'failed', 'cancelled', 'timeout']);

/** True once the session will do no more work by itself. */
export function isManagedSettled(snapshot: Pick<ManagedSnapshot, 'state' | 'stopReason'>): boolean {
  return ENDED.has(snapshot.state) || (snapshot.state === 'idle' && snapshot.stopReason !== 'requires-action');
}

/** Adapt a `ManagedProvider` to `CodingAgent`, so hosted and local agents share one API. */
export function managedAgent(provider: ManagedProvider, options: ManagedAgentOptions = {}): CodingAgent {
  return {
    name: provider.name,
    command: provider.name,
    capabilities: { ...provider.capabilities, steer: !!provider.send, approvals: !!provider.answer },
    ...(provider.sessions !== undefined ? { sessions: provider.sessions } : {}),
    run: (task) => runManaged(provider, task, options),
  };
}

function runManaged(provider: ManagedProvider, input: AgentTask, options: ManagedAgentOptions): AgentRun {
  // Defaults from `options.start` hold for refusals, the start request, local budget and decisions alike.
  const task = withDefaults(input, options.start);
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const recorder = new RunRecorder(provider.name, provider.name);
  const controller = new AbortController();
  let stopReason: 'aborted' | 'timeout' | 'failed' | undefined;
  // Why the run failed on our side (an approval answer that did not reach the platform).
  let fatal: string | undefined;
  let sessionId: string | undefined;
  let ended = false;
  // No more input once the turn settled, even while cleanup (release, delete) is still running.
  let closed = false;

  const stop = (reason: 'aborted' | 'timeout' | 'failed') => {
    if (stopReason || controller.signal.aborted) return;
    stopReason = reason;
    controller.abort();
  };
  const onAbort = () => stop('aborted');
  task.signal?.addEventListener('abort', onAbort, { once: true });
  if (task.signal?.aborted) onAbort();
  // A settled session spent what it spent: its own outcome reports that, nothing is left to stop.
  recorder.watchBudget(task.budget, () => {
    if (!last || !isManagedSettled(last)) onAbort();
  });
  let last: ManagedSnapshot | undefined;
  const timer = task.timeoutMs !== undefined ? setTimeout(() => stop('timeout'), task.timeoutMs) : undefined;

  const exit = (reason: ProcessExit['reason'], error?: Error): ProcessExit => ({
    exitCode: null,
    signal: null,
    reason,
    ...(error ? { error } : {}),
  });

  // Usage events carry the session's running total; emit only when it moved.
  let lastUsage = '';
  const answered = new Set<string>();
  // Open approval questions live until the turn settles or the run stops.
  const turn = new AbortController();
  controller.signal.addEventListener('abort', () => turn.abort(), { once: true });
  const sessionText = { value: undefined as string | undefined };

  // Each open question's lifetime: ends when the platform resolves it or the turn settles.
  const questions = new Map<string, AbortController>();
  // Token totals as last reported, so cost-only updates keep them.
  let knownUsage: TokenUsage | undefined;

  // Approvals already reported resolved, by the platform's stream or by our own answer.
  const resolved = new Set<string>();

  /** Fail the run now: the session waits on something this run cannot give it. */
  const fail = (message: string) => {
    fatal ??= message;
    stop('failed');
  };
  const cannotAnswer = () => fail(`${provider.name} paused for an approval, and it has no way to answer one.`);

  const relay = (event: AgentEvent) => {
    if (event.type === 'approval-resolved') {
      questions.get(event.id)?.abort();
      if (resolved.has(event.id)) return;
      resolved.add(event.id);
    }
    // Streamed usage is cumulative for the session too: report this run's share, like snapshots.
    if (event.type === 'usage') event = runUsage(event.usage, event.costUsd);
    recorder.emit(event);
    if (event.type === 'message') sessionText.value = event.text;
    if (event.type === 'usage') {
      knownUsage = event.usage;
      lastUsage = JSON.stringify([event.usage, event.costUsd]);
    }
    if (event.type === 'approval-request' && !provider.answer && !unchecked(provider)) cannotAnswer();
    if (event.type === 'approval-request' && provider.answer && sessionId && !answered.has(event.request.id)) {
      answered.add(event.request.id);
      const id = sessionId;
      const question = new AbortController();
      questions.set(event.request.id, question);
      const signal = anySignal([turn.signal, question.signal]);
      void decideApproval(task, event.request, signal)
        .then(async ({ decision, automatic }) => {
          if (signal.aborted) return;
          await provider.answer!(id, event.request.id, decision);
          // Withdrawn, settled, or the platform's stream already reported it.
          if (signal.aborted || resolved.has(event.request.id)) return;
          resolved.add(event.request.id);
          recorder.emit({
            type: 'approval-resolved',
            id: event.request.id,
            decision,
            ...(automatic ? { automatic } : {}),
          });
        })
        .catch((error: unknown) => {
          if (signal.aborted) return;
          // An answer that never arrived leaves the session waiting: stop the run now.
          const message = error instanceof Error ? error.message : String(error);
          fail(`Answering ${provider.name} approval ${event.request.id} failed: ${message}`);
        });
    }
  };

  // Resources to free, as every snapshot so far listed them.
  const releases = new Set<string>();
  // A resumed session's totals before this run: snapshots are cumulative, a run reports its own share.
  let base: Pick<ManagedSnapshot, 'usage' | 'costUsd'> = {};
  /** Session totals as this run's usage event; usage left out keeps the last known tokens. */
  const runUsage = (usage: ManagedUsage | undefined, costUsd: number | undefined): AgentEvent & { type: 'usage' } => {
    const tokens: TokenUsage = usage ? since(usage, base.usage) : { ...knownUsage };
    const cost = costUsd !== undefined ? Math.max(0, costUsd - (base.costUsd ?? 0)) : undefined;
    return { type: 'usage', usage: tokens, ...(cost !== undefined ? { costUsd: cost } : {}) };
  };
  const observe = (snapshot: ManagedSnapshot) => {
    // The turn is over once a settled state is seen, even while final events are still read.
    if (isManagedSettled(snapshot)) closed = true;
    for (const ref of snapshot.release ?? []) releases.add(ref);
    // Text may arrive on any snapshot; a later one need not repeat it.
    if (snapshot.text !== undefined && snapshot.text !== sessionText.value) {
      sessionText.value = snapshot.text;
      recorder.emit({ type: 'message', text: snapshot.text });
    }
    if (!provider.answer && snapshot.state === 'idle' && snapshot.stopReason === 'requires-action') cannotAnswer();
    // The platform's own budget stop: report its words, before local budget checks see the usage.
    if (snapshot.stopReason === 'budget' && isManagedSettled(snapshot))
      recorder.budgetReached(snapshot.error ?? `${provider.name} stopped at its budget.`);
    if (snapshot.usage || snapshot.costUsd !== undefined) {
      const event = runUsage(snapshot.usage, snapshot.costUsd);
      const key = JSON.stringify([event.usage, event.costUsd]);
      if (key !== lastUsage) {
        lastUsage = key;
        knownUsage = event.usage;
        recorder.emit(event);
      }
    }
  };

  /** The run's end after `stop()`: a local failure, an abort or a timeout. */
  const stopped = (): { exit: ProcessExit; outcome?: AgentOutcome } =>
    stopReason === 'failed'
      ? { exit: exit('closed'), outcome: { ok: false, error: fatal ?? `${provider.name} run failed.` } }
      : { exit: exit(stopReason ?? 'aborted') };

  const outcomeOf = (snapshot: ManagedSnapshot): { exit: ProcessExit; outcome?: AgentOutcome } => {
    // A budget stop wins over the state it was reported with (cancelled, timeout).
    if (snapshot.stopReason === 'budget') {
      recorder.budgetReached(snapshot.error ?? `${provider.name} stopped at its budget.`);
      return { exit: exit('closed'), outcome: { ok: false } };
    }
    if (snapshot.state === 'cancelled') return { exit: exit('aborted') };
    if (snapshot.state === 'timeout') return { exit: exit('timeout') };
    if (snapshot.state === 'failed' || snapshot.stopReason === 'error') {
      if (snapshot.failure?.kind === 'quota')
        recorder.emit({
          type: 'rate-limit',
          limit: {
            window: 'quota',
            status: 'exceeded',
            ...(snapshot.failure.resetsAt !== undefined ? { resetsAt: snapshot.failure.resetsAt } : {}),
          },
        });
      return {
        exit: exit('closed'),
        outcome: {
          ok: false,
          error: snapshot.error ?? `${provider.name} session failed.`,
          ...(snapshot.failure ? { failure: snapshot.failure } : {}),
        },
      };
    }
    return { exit: exit('closed'), outcome: { ok: true } };
  };

  /** A provider exception as an outcome `withFallback()` can act on; quota also as a `rate-limit` event. */
  const classified = (error: unknown): { error: string; failure?: AgentFailure } => {
    const message = error instanceof Error ? error.message : String(error);
    const failure = failureOfError(error);
    if (failure?.kind === 'quota')
      recorder.emit({
        type: 'rate-limit',
        limit: {
          window: 'quota',
          status: 'exceeded',
          ...(failure.resetsAt !== undefined ? { resetsAt: failure.resetsAt } : {}),
        },
      });
    return { error: message, ...(failure ? { failure } : {}) };
  };

  const start = async (): Promise<ManagedSnapshot | { exit: ProcessExit; outcome?: AgentOutcome }> => {
    const refused =
      unsupportedPermissions(provider.name, provider.capabilities, task) ??
      refusedFields(provider, task, options.start?.files);
    if (refused) return { exit: exit('spawn-error', new Error(refused)) };
    const permissions = task.permissions !== undefined ? resolvePermissions(task.permissions) : undefined;
    if (permissions?.approval === 'ask' && !provider.answer)
      return { exit: exit('spawn-error', new Error(`${provider.name} cannot run with permissions.approval 'ask'.`)) };
    // `cwd` is required of every task; '.' (or '') only means "the default workspace".
    const workspace = task.cwd && task.cwd !== '.' ? task.cwd : (options.start?.workspace ?? task.cwd);
    let budget = task.budget;
    if (task.resume !== undefined && !unchecked(provider)) {
      // The session so far: its text is not this run's answer, its spend is not this run's.
      let prior: ManagedSnapshot | null;
      try {
        prior = await provider.get(task.resume, controller.signal);
      } catch (error) {
        if (stopReason) return stopped();
        // An outage before any work: classified, so withFallback() can move on.
        const cause = error instanceof Error ? error : new Error(String(error));
        return { exit: exit('spawn-error', cause), outcome: { ok: false, ...classified(error) } };
      }
      if (stopReason) return stopped();
      // `null`: no such session here; the platform's start decides what resuming it means.
      if (prior) {
        base = {
          ...(prior.usage ? { usage: prior.usage } : {}),
          ...(prior.costUsd !== undefined ? { costUsd: prior.costUsd } : {}),
        };
        sessionText.value = prior.text;
        budget = budget && sessionBudget(budget, base);
      }
    }
    const request: ManagedStart = {
      ...options.start,
      prompt: task.prompt,
      workspace,
      ...(task.model !== undefined ? { model: task.model } : {}),
      ...(task.effort !== undefined ? { effort: task.effort } : {}),
      ...(task.maxTurns !== undefined ? { maxTurns: task.maxTurns } : {}),
      ...(task.resume !== undefined ? { resume: task.resume } : {}),
      ...(task.extraArgs !== undefined ? { extraArgs: task.extraArgs } : {}),
      ...(task.mcpServers !== undefined ? { mcpServers: task.mcpServers } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
      ...(task.timeoutMs !== undefined ? { maxDurationSeconds: Math.ceil(task.timeoutMs / 1000) } : {}),
    };
    try {
      return await provider.start(request, controller.signal);
    } catch (error) {
      if (stopReason) return stopped();
      const cause = error instanceof Error ? error : new Error(String(error));
      return { exit: exit('spawn-error', cause), outcome: { ok: false, ...classified(error) } };
    }
  };

  const follow = async (first: ManagedSnapshot): Promise<{ exit: ProcessExit; outcome?: AgentOutcome }> => {
    let snapshot = first;
    const startCursor = first.cursor;
    observe(snapshot);
    if (provider.watch) {
      // From the turn's own start: a resumed session's earlier events are not this run's.
      let cursor: string | undefined = startCursor;
      while (!stopReason && !isManagedSettled(snapshot)) {
        for await (const update of provider.watch(snapshot.id, controller.signal, cursor)) {
          for (const event of update.events ?? []) relay(event);
          cursor = update.cursor ?? cursor;
          if (update.snapshot) {
            snapshot = last = update.snapshot;
            observe(snapshot);
          }
          if (stopReason || isManagedSettled(snapshot)) break;
          await untilAborted(recorder.events.room(), controller.signal);
        }
        if (stopReason || isManagedSettled(snapshot)) break;
        // The stream closed without a settled state: read it now, and wait only before reconnecting.
        const fresh = await provider.get(snapshot.id, controller.signal);
        if (stopReason) break;
        if (!fresh) return { exit: exit('closed'), outcome: { ok: false, error: `${provider.name} session is gone.` } };
        snapshot = last = fresh;
        observe(snapshot);
        if (!isManagedSettled(snapshot)) await delay(pollIntervalMs, controller.signal);
      }
    } else {
      // From the turn's own start: a resumed session's earlier events are not this run's.
      let cursor: string | undefined = startCursor;
      let page: ManagedEventPage | undefined;
      const read = async () => {
        page = await provider.events!(snapshot.id, cursor, controller.signal);
        if (stopReason) return;
        for (const event of page.events) relay(event);
        // Each page's resources, before a later page's snapshot replaces it.
        for (const ref of page.snapshot?.release ?? []) releases.add(ref);
        cursor = page.cursor ?? cursor;
      };
      // Settled from the start: its final events may still wait in `events()`.
      if (provider.events && !stopReason && isManagedSettled(snapshot)) {
        do await read();
        while (!stopReason && page!.hasMore);
        // The terminal snapshot outranks older events for what it reports itself.
        observe(snapshot);
      }
      // The first read goes out at once; the interval falls between reads.
      let first = true;
      while (!stopReason && !isManagedSettled(snapshot)) {
        await untilAborted(recorder.events.room(), controller.signal);
        if (!first) await delay(pollIntervalMs, controller.signal);
        first = false;
        if (stopReason) break;
        page = undefined as ManagedEventPage | undefined;
        if (provider.events) {
          // Every page the platform has, before the state that may end the loop.
          do await read();
          while (!stopReason && page!.hasMore);
          if (stopReason) break;
        }
        const fresh = page?.snapshot ?? (await provider.get(snapshot.id, controller.signal));
        if (stopReason) break;
        if (!fresh) return { exit: exit('closed'), outcome: { ok: false, error: `${provider.name} session is gone.` } };
        snapshot = last = fresh;
        observe(snapshot);
        // A state read apart from the events: the last ones may have landed in between.
        if (provider.events && !page?.snapshot && isManagedSettled(snapshot)) {
          do await read();
          while (!stopReason && page!.hasMore);
          observe(snapshot);
        }
      }
    }
    // The turn settled or the run stopped: open questions are moot, and answers still in flight
    // are not waited for (their rejection handlers stay, and ignore a settled turn).
    turn.abort();
    closed = true;
    if (stopReason) return stopped();
    return outcomeOf(snapshot);
  };

  const work = async (): Promise<{ exit: ProcessExit; outcome?: AgentOutcome }> => {
    const started = await start();
    if ('exit' in started) return started;
    sessionId = started.id;
    last = started;
    recorder.emit({ type: 'session', sessionId: started.id, ...(started.model ? { model: started.model } : {}) });
    let outcome: { exit: ProcessExit; outcome?: AgentOutcome };
    try {
      outcome = await follow(started);
    } catch (error) {
      if (stopReason) outcome = stopped();
      else {
        const message = error instanceof Error ? error.message : String(error);
        const verb = provider.watch ? 'Streaming' : 'Polling';
        const { failure } = classified(error);
        outcome = {
          exit: exit('closed'),
          outcome: { ok: false, error: `${verb} ${provider.name} failed: ${message}`, ...(failure ? { failure } : {}) },
        };
        // Do not leave a session working (and billing) that nobody watches any more.
        await provider.interrupt(started.id).catch(() => undefined);
      }
    }
    turn.abort();
    closed = true;
    // Nothing to stop in a session that already settled (a local budget check on its last report).
    if (stopReason && !(last && isManagedSettled(last))) await provider.interrupt(started.id).catch(() => undefined);
    if (last) await provider.release?.({ ...last, release: [...releases] }).catch(() => undefined);
    if (options.deleteSession) await provider.delete?.(started.id).catch(() => undefined);
    return outcome;
  };

  const result = work().then(({ exit: done, outcome }) => {
    ended = true;
    clearTimeout(timer);
    task.signal?.removeEventListener('abort', onAbort);
    return recorder.finish(done, outcome);
  });

  return {
    result,
    abort: () => stop('aborted'),
    ...(provider.send
      ? {
          steer: (text: string) =>
            sessionId && !stopReason && !closed && !ended
              ? provider.send!(sessionId, text)
              : Promise.reject(new Error(`${provider.name} is not accepting input.`)),
        }
      : {}),
    [Symbol.asyncIterator]: () => recorder.events.iterate(),
  };
}

/** Marks a provider adapted from `HostedAgentProvider`, which forwards task fields unchecked as it always did. */
export const UNCHECKED_FIELDS = Symbol('genaicode.managed.uncheckedFields');

function unchecked(provider: ManagedProvider): boolean {
  return !!(provider as { [UNCHECKED_FIELDS]?: boolean })[UNCHECKED_FIELDS];
}

/** The task with `options.start` defaults for the fields it leaves out. */
function withDefaults(task: AgentTask, defaults: ManagedAgentOptions['start']): AgentTask {
  if (!defaults) return task;
  const merged: AgentTask = { ...task };
  for (const key of [
    'model',
    'effort',
    'maxTurns',
    'resume',
    'extraArgs',
    'mcpServers',
    'budget',
    'permissions',
  ] as const)
    if (merged[key] === undefined && defaults[key] !== undefined)
      (merged as unknown as Record<string, unknown>)[key] = defaults[key];
  return merged;
}

/** Cumulative usage minus what the session had used before. */
function since(usage: ManagedUsage, before: TokenUsage | undefined): TokenUsage {
  const out: TokenUsage = {};
  if (!before) {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens'] as const)
      if (usage[key] !== undefined) out[key] = usage[key];
    return out;
  }
  // Components only where both reports have them; the total always, as `tokenCount` reads each report.
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) {
    const now = usage[key];
    const then = before[key];
    if (now !== undefined && then !== undefined) out[key] = Math.max(0, now - then);
  }
  out.totalTokens = Math.max(0, tokenCount(usage) - tokenCount(before));
  return out;
}

/** A per-run budget as the session-wide cap a platform enforces. */
function sessionBudget(budget: AgentBudget, spent: Pick<ManagedSnapshot, 'usage' | 'costUsd'>): AgentBudget {
  return {
    ...budget,
    ...(budget.maxCostUsd !== undefined ? { maxCostUsd: budget.maxCostUsd + (spent.costUsd ?? 0) } : {}),
    ...(budget.maxTokens !== undefined
      ? { maxTokens: budget.maxTokens + (spent.usage ? tokenCount(spent.usage) : 0) }
      : {}),
  };
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
]);

/**
 * What a provider exception says about the platform: an explicit `failure`, an HTTP status
 * (`status`, `statusCode`, `response.status`) or a network error code (also on `cause`).
 */
export function failureOfError(error: unknown): AgentFailure | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as {
    failure?: AgentFailure;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    code?: unknown;
    cause?: unknown;
    message?: unknown;
  };
  if (e.failure && typeof e.failure.kind === 'string') return e.failure;
  const status = [e.status, e.statusCode, e.response?.status].find((value) => typeof value === 'number') as
    | number
    | undefined;
  if (status === 401 || status === 403) return { kind: 'auth' };
  if (status === 429) return { kind: 'quota' };
  if (status !== undefined && status >= 500) return { kind: 'unavailable' };
  const codes = [e.code, (e.cause as { code?: unknown } | undefined)?.code];
  if (codes.some((code) => typeof code === 'string' && NETWORK_CODES.has(code))) return { kind: 'unavailable' };
  const message = typeof e.message === 'string' ? e.message : '';
  if (/\bfetch failed\b|\bsocket hang up\b/i.test(message)) return { kind: 'unavailable' };
  if (
    /\b(HTTP|status)\s*5\d\d\b|\b5\d\d (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i.test(
      message,
    )
  )
    return { kind: 'unavailable' };
  if (/\b(HTTP|status)\s*403\b|\b403 Forbidden\b/i.test(message)) return { kind: 'auth' };
  return undefined;
}

/** Task fields this provider cannot honor, as an error message. */
function refusedFields(
  provider: ManagedProvider,
  task: AgentTask,
  files: readonly ManagedFile[] | undefined,
): string | undefined {
  if (unchecked(provider)) return undefined;
  const caps = provider.capabilities;
  if (files?.length && !caps.files) return `${provider.name} cannot take start files.`;
  const local = task.mcpServers?.find((server) => 'command' in server);
  if (local) return `${provider.name} reaches only remote MCP servers; '${local.name}' is a local command.`;
  if (task.mcpServers?.length && !caps.mcp) return `${provider.name} cannot attach MCP servers.`;
  if (task.resume !== undefined && !caps.resume) return `${provider.name} cannot resume a session.`;
  if (task.effort !== undefined && caps.effort && !caps.effort.includes(task.effort))
    return `${provider.name} does not accept effort '${task.effort}' (supported: ${caps.effort.join(', ') || 'none'}).`;
  return undefined;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

/** Resolve when `wait` does or `signal` aborts, whichever comes first. */
function untilAborted(wait: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    void wait.then(done);
  });
}
