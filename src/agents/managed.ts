import type { TokenUsage } from '../core/types.js';
import { decideApproval } from './live-agent.js';
import { resolvePermissions, unsupportedPermissions } from './permissions.js';
import type { ProcessExit } from './process.js';
import { RunRecorder, type AgentOutcome } from './runtime.js';
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
  /** Passed on to the platform's own cap where `capabilities.budget` has the unit. */
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
  /** Cumulative for the session. */
  usage?: ManagedUsage;
  costUsd?: number;
  model?: string;
  /** The vendor's own word for the state. */
  vendorState?: string;
  /** Per-session resources `release()` frees: credential vaults, uploaded files, sandboxes. */
  release?: readonly string[];
  /** Epoch milliseconds. */
  startedAt?: number;
  endedAt?: number;
}

/** Events since `cursor`, and the session's state when the platform reports it with them. */
export interface ManagedEventPage {
  events: AgentEvent[];
  cursor?: string;
  snapshot?: ManagedSnapshot;
}

/** One step of a live event stream: events, a new snapshot, or both. */
export interface ManagedUpdate {
  events?: AgentEvent[];
  snapshot?: ManagedSnapshot;
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
  start(request: ManagedStart, signal?: AbortSignal): Promise<ManagedSnapshot>;
  /** `null`: the session does not exist (any more). */
  get(id: string, signal?: AbortSignal): Promise<ManagedSnapshot | null>;
  /** Events since `cursor`, for platforms that are polled. */
  events?(id: string, cursor: string | undefined, signal?: AbortSignal): Promise<ManagedEventPage>;
  /** A live stream of the session; it ends when the session settles or `signal` aborts. */
  watch?(id: string, signal: AbortSignal): AsyncIterable<ManagedUpdate>;
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
    run: (task) => runManaged(provider, task, options),
  };
}

function runManaged(provider: ManagedProvider, task: AgentTask, options: ManagedAgentOptions): AgentRun {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const recorder = new RunRecorder(provider.name, provider.name);
  const controller = new AbortController();
  let stopReason: 'aborted' | 'timeout' | undefined;
  let sessionId: string | undefined;
  let ended = false;

  const stop = (reason: 'aborted' | 'timeout') => {
    if (stopReason || controller.signal.aborted) return;
    stopReason = reason;
    controller.abort();
  };
  const onAbort = () => stop('aborted');
  task.signal?.addEventListener('abort', onAbort, { once: true });
  if (task.signal?.aborted) onAbort();
  recorder.watchBudget(task.budget, onAbort);
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
  const pending: Promise<void>[] = [];
  const sessionText = { value: undefined as string | undefined };

  const relay = (event: AgentEvent) => {
    recorder.emit(event);
    if (event.type === 'message') sessionText.value = event.text;
    if (event.type === 'approval-request' && provider.answer && sessionId && !answered.has(event.request.id)) {
      answered.add(event.request.id);
      const id = sessionId;
      pending.push(
        decideApproval(task, event.request, controller.signal).then(async ({ decision, automatic }) => {
          if (controller.signal.aborted) return;
          await provider.answer!(id, event.request.id, decision);
          recorder.emit({
            type: 'approval-resolved',
            id: event.request.id,
            decision,
            ...(automatic ? { automatic } : {}),
          });
        }),
      );
    }
  };

  // Resources to free, as every snapshot so far listed them.
  const releases = new Set<string>();
  const observe = (snapshot: ManagedSnapshot) => {
    for (const ref of snapshot.release ?? []) releases.add(ref);
    if (snapshot.usage || snapshot.costUsd !== undefined) {
      const key = JSON.stringify([snapshot.usage, snapshot.costUsd]);
      if (key !== lastUsage) {
        lastUsage = key;
        const usage = { ...snapshot.usage };
        delete usage.details;
        recorder.emit({
          type: 'usage',
          usage,
          ...(snapshot.costUsd !== undefined ? { costUsd: snapshot.costUsd } : {}),
        });
      }
    }
  };

  const outcomeOf = (snapshot: ManagedSnapshot): { exit: ProcessExit; outcome?: AgentOutcome } => {
    if (snapshot.text !== undefined && snapshot.text !== sessionText.value) {
      sessionText.value = snapshot.text;
      recorder.emit({ type: 'message', text: snapshot.text });
    }
    if (snapshot.state === 'cancelled') return { exit: exit('aborted') };
    if (snapshot.state === 'timeout') return { exit: exit('timeout') };
    if (snapshot.stopReason === 'budget') {
      recorder.budgetReached(snapshot.error ?? `${provider.name} stopped at its budget.`);
      return { exit: exit('closed'), outcome: { ok: false } };
    }
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
        outcome: { ok: false, error: snapshot.error ?? `${provider.name} session failed.` },
      };
    }
    return { exit: exit('closed'), outcome: { ok: true } };
  };

  const start = async (): Promise<ManagedSnapshot | { exit: ProcessExit }> => {
    const refused = unsupportedPermissions(provider.name, provider.capabilities, task) ?? refusedFields(provider, task);
    if (refused) return { exit: exit('spawn-error', new Error(refused)) };
    const permissions = task.permissions !== undefined ? resolvePermissions(task.permissions) : undefined;
    if (permissions?.approval === 'ask' && !provider.answer)
      return { exit: exit('spawn-error', new Error(`${provider.name} cannot run with permissions.approval 'ask'.`)) };
    const request: ManagedStart = {
      ...options.start,
      prompt: task.prompt,
      workspace: task.cwd,
      ...(task.model !== undefined ? { model: task.model } : {}),
      ...(task.effort !== undefined ? { effort: task.effort } : {}),
      ...(task.maxTurns !== undefined ? { maxTurns: task.maxTurns } : {}),
      ...(task.resume !== undefined ? { resume: task.resume } : {}),
      ...(task.extraArgs !== undefined ? { extraArgs: task.extraArgs } : {}),
      ...(task.mcpServers !== undefined ? { mcpServers: task.mcpServers } : {}),
      ...(task.budget !== undefined ? { budget: task.budget } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
      ...(task.timeoutMs !== undefined ? { maxDurationSeconds: Math.ceil(task.timeoutMs / 1000) } : {}),
    };
    try {
      return await provider.start(request, controller.signal);
    } catch (error) {
      if (stopReason) return { exit: exit(stopReason) };
      return { exit: exit('spawn-error', error instanceof Error ? error : new Error(String(error))) };
    }
  };

  let last: ManagedSnapshot | undefined;

  const follow = async (first: ManagedSnapshot): Promise<{ exit: ProcessExit; outcome?: AgentOutcome }> => {
    let snapshot = first;
    observe(snapshot);
    if (provider.watch) {
      while (!stopReason && !isManagedSettled(snapshot)) {
        for await (const update of provider.watch(snapshot.id, controller.signal)) {
          for (const event of update.events ?? []) relay(event);
          if (update.snapshot) {
            snapshot = last = update.snapshot;
            observe(snapshot);
          }
          if (stopReason || isManagedSettled(snapshot)) break;
          await untilAborted(recorder.events.room(), controller.signal);
        }
        if (stopReason || isManagedSettled(snapshot)) break;
        // The stream closed without a settled state: wait, read it, and reconnect if still working.
        await delay(pollIntervalMs, controller.signal);
        if (stopReason) break;
        const fresh = await provider.get(snapshot.id, controller.signal);
        if (!fresh) return { exit: exit('closed'), outcome: { ok: false, error: `${provider.name} session is gone.` } };
        snapshot = last = fresh;
        observe(snapshot);
      }
    } else {
      let cursor: string | undefined;
      while (!stopReason && !isManagedSettled(snapshot)) {
        await untilAborted(recorder.events.room(), controller.signal);
        await delay(pollIntervalMs, controller.signal);
        if (stopReason) break;
        let page: ManagedEventPage | undefined;
        if (provider.events) {
          page = await provider.events(snapshot.id, cursor, controller.signal);
          if (stopReason) break;
          for (const event of page.events) relay(event);
          cursor = page.cursor ?? cursor;
        }
        const fresh = page?.snapshot ?? (await provider.get(snapshot.id, controller.signal));
        if (stopReason) break;
        if (!fresh) return { exit: exit('closed'), outcome: { ok: false, error: `${provider.name} session is gone.` } };
        snapshot = last = fresh;
        observe(snapshot);
      }
    }
    await Promise.allSettled(pending);
    if (stopReason) return { exit: exit(stopReason) };
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
      if (stopReason) outcome = { exit: exit(stopReason) };
      else {
        const message = error instanceof Error ? error.message : String(error);
        const verb = provider.watch ? 'Streaming' : 'Polling';
        outcome = {
          exit: exit('closed'),
          outcome: { ok: false, error: `${verb} ${provider.name} failed: ${message}` },
        };
        // Do not leave a session working (and billing) that nobody watches any more.
        await provider.interrupt(started.id).catch(() => undefined);
      }
    }
    if (stopReason) await provider.interrupt(started.id).catch(() => undefined);
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
            sessionId && !stopReason && !ended
              ? provider.send!(sessionId, text)
              : Promise.reject(new Error(`${provider.name} is not accepting input.`)),
        }
      : {}),
    [Symbol.asyncIterator]: () => recorder.events.iterate(),
  };
}

/** Task fields this provider cannot honor, as an error message. */
function refusedFields(provider: ManagedProvider, task: AgentTask): string | undefined {
  const caps = provider.capabilities;
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
