import { keepRunLimit } from './sessions/limits.js';
import { randomBytes } from 'node:crypto';
import { resolvePermissions } from './permissions.js';
import { planError, planSpawnAsync, type PrepareContext, type PreparedRun, type SpawnPlan } from './prepare.js';
import { startProcess } from './process.js';
import { RpcError, RpcPeer, type RpcRequestContext } from './rpc.js';
import { anySignal, invalidCwd, linkAbort, RunRecorder, type AgentOutcome } from './runtime.js';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentResult,
  AgentRun,
  AgentTask,
  ApprovalDecision,
  ApprovalPolicy,
  ApprovalRequest,
  CodingAgent,
  QuestionAnswers,
} from './types.js';
import type { SessionSource } from './sessions/types.js';

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
  /** Like `approve`, for a question: the answers come back with the decision. */
  ask(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalOutcome>;
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
  /** Where the agent keeps its sessions (`CodingAgent.sessions`). */
  sessions?: SessionSource | null;
  /** Arguments that start the agent's JSON-RPC server on stdio. */
  args(task: AgentTask): string[];
  /** Replaces `args` when a task needs setup: extra env, temp files to clean up. */
  prepare?(task: AgentTask, context: PrepareContext): PreparedRun | Promise<PreparedRun>;
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
    ...(definition.sessions !== undefined ? { sessions: definition.sessions } : {}),
    run: (task) => runLiveAgent(definition, task),
  };
}

function runLiveAgent(definition: LiveAgentDefinition, task: AgentTask): AgentRun {
  const recorder = new RunRecorder(definition.name, definition.command, (limit) =>
    keepRunLimit(definition.name, limit, task.env),
  );
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

  // Ends every open approval question when the task is over.
  const lifetime = new AbortController();
  linkAbort(task.signal, lifetime);
  let stopped = false;
  let kill: () => void = () => {};

  const start = (plan: Extract<SpawnPlan, { ok: true }>): Promise<AgentResult> => {
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
    kill = () => handle.kill();
    flow = () => (pressure && !steering ? handle.pause() : handle.resume());
    recorder.events.onPressure = (paused) => {
      pressure = paused;
      flow();
    };
    const rpc = new RpcPeer((line) => handle.write(line), {
      notification: (method, params) => notificationHandler(method, params),
      request: (method, params, context) => requestHandler(method, params, context),
    });
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
      ask(request, signal) {
        const ended = signal ? anySignal([lifetime.signal, signal]) : lifetime.signal;
        return reportReply(
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

    return Promise.race([outcome.then(() => undefined), exited]).then(async (early) => {
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
  };

  const context: PrepareContext = { emit: (event) => recorder.emit(event), signal: lifetime.signal };
  const result = planSpawnAsync(definition, task, invalidCwd(task.cwd), context).then((plan) => {
    // Stopped while `prepare` was still running: whatever it ended with, the run was aborted.
    if (stopped || task.signal?.aborted) {
      lifetime.abort();
      if (plan.ok) plan.cleanup();
      return recorder.finish({ exitCode: null, signal: null, reason: 'aborted' }, undefined);
    }
    if (!plan.ok) {
      lifetime.abort();
      return recorder.finish(
        { exitCode: null, signal: null, reason: 'spawn-error', error: planError(plan) },
        undefined,
      );
    }
    return start(plan);
  });

  const abort = () => {
    stopped = true;
    lifetime.abort();
    kill();
  };
  recorder.watchBudget(task.budget, abort);
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

/** A decided request: the decision, and for a question the answers that came with an approval. */
export interface ApprovalOutcome {
  decision: ApprovalDecision;
  answers?: QuestionAnswers;
}

/**
 * `task.onQuestion`'s answers to a question, cut down to the questions asked. A denial without
 * a handler, when it throws or returns nothing, and when `signal` aborts first.
 */
export async function askQuestion(
  task: Pick<AgentTask, 'onQuestion'>,
  request: ApprovalRequest,
  signal: AbortSignal,
): Promise<ApprovalOutcome> {
  const handler = task.onQuestion;
  if (!handler || signal.aborted) return { decision: 'deny' };
  let stop: () => void = () => {};
  const withdrawn = new Promise<undefined>((resolve) => {
    stop = () => resolve(undefined);
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    const given = await Promise.race([Promise.resolve().then(() => handler(request, signal)), withdrawn]);
    if (signal.aborted || typeof given !== 'object' || given === null) return { decision: 'deny' };
    return { decision: 'approve', answers: questionAnswers(request, given) };
  } catch {
    return { decision: 'deny' };
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

const MAX_ANSWER_CHARS = 10_000;

/** `given` cut down to the questions of `request`: string answers, no empty ones. */
export function questionAnswers(request: ApprovalRequest, given: unknown): QuestionAnswers {
  const answers: QuestionAnswers = {};
  if (typeof given !== 'object' || given === null) return answers;
  for (const question of request.questions ?? []) {
    if (!Object.hasOwn(given, question.id)) continue;
    const value = (given as Record<string, unknown>)[question.id];
    const picked = (Array.isArray(value) ? (value as unknown[]) : [value])
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.slice(0, MAX_ANSWER_CHARS));
    const kept = question.multiple ? picked.slice(0, question.options.length + 1) : picked.slice(0, 1);
    if (kept.length) answers[question.id] = kept;
  }
  return answers;
}

/** `answers` without those of secret questions: what may go into events and the transcript. */
export function shownAnswers(
  request: ApprovalRequest,
  answers: QuestionAnswers | undefined,
): QuestionAnswers | undefined {
  if (!answers) return undefined;
  const secret = new Set(
    (request.questions ?? []).filter((question) => question.secret).map((question) => question.id),
  );
  return Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [id, secret.has(id) ? value.map(() => '••••') : value]),
  );
}

/**
 * Emit `approval-request`, run `decide`, and emit one `approval-resolved`. When `signal`
 * aborts first, the denial is emitted right away, before the run's event stream can close.
 */
export async function reportApproval(
  emit: (event: AgentEvent) => void,
  request: ApprovalRequest,
  signal: AbortSignal,
  decide: () => Promise<ApprovalOutcome & { automatic: boolean }>,
): Promise<ApprovalDecision> {
  return (await reportReply(emit, request, signal, decide)).decision;
}

/** `reportApproval` that also returns a question's answers. The event carries them without secrets. */
export async function reportReply(
  emit: (event: AgentEvent) => void,
  request: ApprovalRequest,
  signal: AbortSignal,
  decide: () => Promise<ApprovalOutcome & { automatic: boolean }>,
): Promise<ApprovalOutcome> {
  emit({ type: 'approval-request', request });
  let reported: ApprovalOutcome | undefined;
  const report = (outcome: ApprovalOutcome, automatic: boolean) => {
    if (reported) return;
    reported = outcome;
    const shown = outcome.decision === 'approve' ? shownAnswers(request, outcome.answers) : undefined;
    emit({
      type: 'approval-resolved',
      id: request.id,
      decision: outcome.decision,
      ...(automatic ? { automatic } : {}),
      ...(shown ? { answers: shown } : {}),
    });
  };
  const withdrawn = () => report({ decision: 'deny' }, false);
  signal.addEventListener('abort', withdrawn, { once: true });
  try {
    const { automatic, ...outcome } = await decide();
    report(outcome, automatic);
    return reported!;
  } finally {
    signal.removeEventListener('abort', withdrawn);
  }
}

/**
 * Decide one request under `task.permissions.approval`: `deny` and `auto-approve` answer
 * without asking (`automatic`), otherwise `askApproval`. An approval that arrives after
 * `signal` aborted is a denial either way. A question is never answered by `auto-approve`:
 * it goes to `task.onQuestion`, and without one it is declined.
 */
export async function decideApproval(
  task: Pick<AgentTask, 'onApproval' | 'onQuestion' | 'permissions'>,
  request: ApprovalRequest,
  signal: AbortSignal,
): Promise<ApprovalOutcome & { automatic: boolean }> {
  let policy: ApprovalPolicy | undefined;
  try {
    policy = resolvePermissions(task.permissions).approval;
  } catch {
    return { decision: 'deny', automatic: true };
  }
  if (policy === 'deny') return { decision: 'deny', automatic: true };
  if (request.kind === 'question') {
    if (!task.onQuestion) return { decision: 'deny', automatic: true };
    return { ...(await askQuestion(task, request, signal)), automatic: false };
  }
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
