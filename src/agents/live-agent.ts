import { randomBytes } from 'node:crypto';
import { planSpawn, type PreparedRun } from './prepare.js';
import { startProcess } from './process.js';
import { RpcError, RpcPeer } from './rpc.js';
import { invalidCwd, RunRecorder, type AgentOutcome } from './runtime.js';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentRun,
  AgentTask,
  ApprovalDecision,
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
  onRequest(handler: (method: string, params: unknown) => unknown | Promise<unknown>): void;
  /** Ask `task.onApproval` (deny when absent or when it throws), emitting request and decision events. */
  approve(request: ApprovalRequest): Promise<ApprovalDecision>;
  /** Make `AgentRun.steer` send input, or pass undefined once the task stops accepting it. */
  setSteer(steer: ((text: string) => Promise<void>) | undefined): void;
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
  const steerRun = (text: string) =>
    steer ? steer(text) : Promise.reject(new Error(`${definition.name} is not accepting input.`));

  const plan = planSpawn(definition, task, invalidCwd(task.cwd));
  if (!plan.ok) {
    const result = recorder.finish(
      { exitCode: null, signal: null, reason: 'spawn-error', error: new Error(plan.error) },
      undefined,
    );
    return { result: Promise.resolve(result), abort() {}, steer: steerRun, [Symbol.asyncIterator]: iterate };
  }

  let notificationHandler: (method: string, params: unknown) => void = () => {};
  let requestHandler: (method: string, params: unknown) => unknown = (method) => {
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
  const rpc = new RpcPeer((line) => handle.write(line), {
    notification: (method, params) => notificationHandler(method, params),
    request: (method, params) => requestHandler(method, params),
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
    async approve(request) {
      recorder.emit({ type: 'approval-request', request });
      let decision: ApprovalDecision = 'deny';
      try {
        if (task.onApproval) decision = (await task.onApproval(request)) === 'approve' ? 'approve' : 'deny';
      } catch {
        decision = 'deny';
      }
      recorder.emit({ type: 'approval-resolved', id: request.id, decision });
      return decision;
    },
    setSteer(next) {
      steer = next;
    },
  };

  const exited = handle.exit.then((exit) => {
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

  return { result, abort: handle.kill, steer: steerRun, [Symbol.asyncIterator]: iterate };
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
