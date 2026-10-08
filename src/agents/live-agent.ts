import { randomBytes } from 'node:crypto';
import { resolvePermissions } from './permissions.js';
import { planSpawn, type PreparedRun } from './prepare.js';
import { startProcess } from './process.js';
import { RpcError, RpcPeer, type RpcRequestContext } from './rpc.js';
import { anySignal, invalidCwd, linkAbort, RunRecorder, type AgentOutcome } from './runtime.js';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentRun,
  AgentTask,
  ApprovalDecision,
  ApprovalPolicy,
  ApprovalRequest,
  CodingAgent,
} from './types.js';

/** What a live driver gets for one task. */
export interface LiveSession {
  readonly task: AgentTask;
  readonly rpc: RpcPeer;
  emit(event: AgentEvent): void;
  /** Called for each notification the agent sends. Set once, before the first request. */
  onNotification(handler: (method: string, params: unknown) => void): void;
  /** Called for each request the agent sends. Throw `RpcError` to decline. Unhandled requests are declined. */
  onRequest(handler: (method: string, params: unknown, context: RpcRequestContext) => unknown | Promise<unknown>): void;
  /**
   * Decide a request with `decideApproval`, emitting request and decision events. The decision
   * is `deny` when there is no handler, it throws, `signal` aborts, or the task ends first; the
   * handler's signal aborts in the last two cases.
   */
  approve(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision>;
  /** Aborts once the task is over: its process exited, or it was stopped. */
  readonly signal: AbortSignal;
  /** Make `AgentRun.steer` send input, or pass undefined once the task stops accepting it. */
  setSteer(steer: ((text: string) => Promise<void>) | undefined): void;
}

/**
 * A vendor's approval protocol over a live session. A driver hands it each request and
 * notification first; methods it does not own come back as `undefined` / `false`.
 */
export interface LiveApprovals {
  /** Answer an approval request, or `undefined` when `method` is not one. Rejects requests from another thread or turn. */
  request(method: string, params: unknown, context?: RpcRequestContext): Promise<unknown> | undefined;
  /** Handle an approval notification. True when `method` belonged to the approval protocol. */
  notification(method: string, params: unknown): boolean;
  /** The turn ended: close open questions, and deny whatever is answered afterwards. */
  close(): void;
}

/** Which thread (or session) and turn approvals must belong to. Undefined until the agent names them. */
export interface LiveApprovalIds {
  session?: string;
  turn?: string;
}

export interface LiveAgentDefinition {
  name: string;
  command: string;
  capabilities?: AgentCapabilities;
  /** Arguments that start the agent's JSON-RPC server on stdio. */
  args(task: AgentTask): string[];
  /** Replaces `args` when a task needs setup: extra env, temp files to clean up. */
  prepare?(task: AgentTask): PreparedRun;
  env?(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  /** Run one task over the session. Resolve with the agent's verdict when its turn ends. */
  drive(session: LiveSession): Promise<AgentOutcome>;
}

/**
 * Build a `CodingAgent` from a CLI that serves JSON-RPC over stdio. The process
 * stays up for the whole task, so the caller can `steer()` it and answer approvals.
 */
export function liveAgent(definition: LiveAgentDefinition): CodingAgent {
  return {
    name: definition.name,
    command: definition.command,
    capabilities: { steer: true, ...definition.capabilities },
    run: (task) => runLiveAgent(definition, task),
  };
}

function runLiveAgent(definition: LiveAgentDefinition, task: AgentTask): AgentRun {
  const recorder = new RunRecorder(definition.name, definition.command);
  const iterate = () => recorder.events.iterate();
  let steer: ((text: string) => Promise<void>) | undefined;
  // A consumer that falls behind pauses the agent's output. A steer awaited from inside the
  // loop needs its reply read, so output keeps flowing while one is in flight.
  let pressure = false;
  let steering = 0;
  let flow: () => void = () => {};
  const steerRun = async (text: string) => {
    if (!steer) throw new Error(`${definition.name} is not accepting input.`);
    steering++;
    flow();
    try {
      await steer(text);
    } finally {
      steering--;
      flow();
    }
  };

  const plan = planSpawn(definition, task, invalidCwd(task.cwd));
  if (!plan.ok) {
    const result = recorder.finish(
      { exitCode: null, signal: null, reason: 'spawn-error', error: new Error(plan.error) },
      undefined,
    );
    return { result: Promise.resolve(result), abort() {}, steer: steerRun, [Symbol.asyncIterator]: iterate };
  }

  let notificationHandler: (method: string, params: unknown) => void = () => {};
  let requestHandler: (method: string, params: unknown, context: RpcRequestContext) => unknown = (method) => {
    throw new RpcError(`${method} is not supported by this client.`, -32601);
  };

  const handle = startProcess({
    command: definition.command,
    args: plan.args,
    cwd: task.cwd,
    env: plan.env,
    timeoutMs: task.timeoutMs,
    signal: task.signal,
    stdin: true,
    onLine(line) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        recorder.emit({ type: 'raw', line });
        return;
      }
      if (!rpc.receive(value)) recorder.emit({ type: 'raw', line });
    },
    onStderr: (text) => recorder.emit({ type: 'stderr', text }),
  });
  flow = () => (pressure && !steering ? handle.pause() : handle.resume());
  recorder.events.onPressure = (paused) => {
    pressure = paused;
    flow();
  };
  const rpc = new RpcPeer((line) => handle.write(line), {
    notification: (method, params) => notificationHandler(method, params),
    request: (method, params, context) => requestHandler(method, params, context),
  });
  // Ends every open approval question when the task is over.
  const lifetime = new AbortController();
  linkAbort(task.signal, lifetime);

  const session: LiveSession = {
    task,
    rpc,
    emit: (event) => recorder.emit(event),
    onNotification(handler) {
      notificationHandler = handler;
    },
    onRequest(handler) {
      requestHandler = handler;
    },
    signal: lifetime.signal,
    approve(request, signal) {
      const ended = signal ? anySignal([lifetime.signal, signal]) : lifetime.signal;
      return reportApproval(
        (event) => recorder.emit(event),
        request,
        ended,
        () => decideApproval(task, request, ended),
      );
    },
    setSteer(next) {
      steer = next;
    },
  };

  const exited = handle.exit.then((exit) => {
    lifetime.abort();
    plan.cleanup();
    steer = undefined;
    rpc.fail(new Error(`${definition.name} exited before the task finished.`));
    return exit;
  });
  const outcome = definition.drive(session).then(
    (verdict) => verdict,
    (error: unknown): AgentOutcome => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );

  const result = Promise.race([outcome.then(() => undefined), exited]).then(async (early) => {
    steer = undefined;
    lifetime.abort();
    // Exiting before the turn ends is a failure even with exit code 0.
    if (early)
      return recorder.finish(
        early,
        (await settledOrUndefined(outcome)) ?? {
          ok: false,
          error: `${definition.name} exited before the task finished.`,
        },
      );
    handle.close();
    return recorder.finish(await exited, await outcome);
  });

  const abort = () => {
    lifetime.abort();
    handle.kill();
  };
  return { result, abort, steer: steerRun, [Symbol.asyncIterator]: iterate };
}

/**
 * `task.onApproval`'s answer, or `deny`: without a handler, when it throws, and when `signal`
 * aborts first (the handler is not waited for then).
 */
export async function askApproval(
  task: Pick<AgentTask, 'onApproval'>,
  request: ApprovalRequest,
  signal: AbortSignal,
): Promise<ApprovalDecision> {
  const handler = task.onApproval;
  if (!handler || signal.aborted) return 'deny';
  let stop: () => void = () => {};
  const withdrawn = new Promise<'deny'>((resolve) => {
    stop = () => resolve('deny');
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    const answer = await Promise.race([Promise.resolve().then(() => handler(request, signal)), withdrawn]);
    return answer === 'approve' && !signal.aborted ? 'approve' : 'deny';
  } catch {
    return 'deny';
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

/**
 * Emit `approval-request`, run `decide`, and emit one `approval-resolved`. When `signal`
 * aborts first, the denial is emitted right away, before the run's event stream can close.
 */
export async function reportApproval(
  emit: (event: AgentEvent) => void,
  request: ApprovalRequest,
  signal: AbortSignal,
  decide: () => Promise<{ decision: ApprovalDecision; automatic: boolean }>,
): Promise<ApprovalDecision> {
  emit({ type: 'approval-request', request });
  let reported: ApprovalDecision | undefined;
  const report = (decision: ApprovalDecision, automatic: boolean) => {
    if (reported) return;
    reported = decision;
    emit({ type: 'approval-resolved', id: request.id, decision, ...(automatic ? { automatic } : {}) });
  };
  const withdrawn = () => report('deny', false);
  signal.addEventListener('abort', withdrawn, { once: true });
  try {
    const { decision, automatic } = await decide();
    report(decision, automatic);
    return reported!;
  } finally {
    signal.removeEventListener('abort', withdrawn);
  }
}

/**
 * Decide one request under `task.permissions.approval`: `deny` and `auto-approve` answer
 * without asking (`automatic`), otherwise `askApproval`. An approval that arrives after
 * `signal` aborted is a denial either way.
 */
export async function decideApproval(
  task: Pick<AgentTask, 'onApproval' | 'permissions'>,
  request: ApprovalRequest,
  signal: AbortSignal,
): Promise<{ decision: ApprovalDecision; automatic: boolean }> {
  let policy: ApprovalPolicy | undefined;
  try {
    policy = resolvePermissions(task.permissions).approval;
  } catch {
    return { decision: 'deny', automatic: true };
  }
  if (policy === 'deny') return { decision: 'deny', automatic: true };
  if (policy === 'auto-approve') return { decision: signal.aborted ? 'deny' : 'approve', automatic: true };
  return { decision: await askApproval(task, request, signal), automatic: false };
}

/** A driver's verdict when it already settled; undefined when it was still waiting. */
async function settledOrUndefined(outcome: Promise<AgentOutcome>): Promise<AgentOutcome | undefined> {
  const pending = Symbol('pending');
  const value = await Promise.race([outcome, Promise.resolve(pending)]);
  return value === pending ? undefined : (value as AgentOutcome);
}

/** RFC 9562 UUIDv7: time-ordered ids some agents require for idempotent commands. */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
