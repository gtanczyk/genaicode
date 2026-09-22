import { liveAgent, uuidv7, type LiveSession } from '../live-agent.js';
import { RpcError } from '../rpc.js';
import type { AgentOutcome } from '../runtime.js';
import type { AgentEvent, CodingAgent } from '../types.js';
import { isObject, stringField } from './json.js';

export interface MuseLiveOptions {
  /** Executable name or path. Default `muse`. */
  command?: string;
  /** Pass `--trust-workspace`. Default true. */
  trustWorkspace?: boolean;
  /** How long to wait for the server to acknowledge each request. Default 60 s. */
  requestTimeoutMs?: number;
}

const TOOL_KINDS = new Set(['commandExecution', 'toolCall', 'mcpToolCall', 'fileChange']);

/**
 * Muse over its JSON-RPC server (`muse serve`). Supports `steer()`.
 * Approval requests are reported as events and declined: the answer format is not
 * part of this driver yet, so `capabilities.approvals` is false.
 */
export function museLive(options: MuseLiveOptions = {}): CodingAgent {
  return liveAgent({
    name: 'muse',
    command: options.command ?? 'muse',
    capabilities: { effort: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], approvals: false },
    args: (task) => [
      'serve',
      ...((options.trustWorkspace ?? true) ? ['--trust-workspace'] : []),
      ...(task.extraArgs ?? []),
    ],
    drive: (session) => driveMuse(session, options),
  });
}

async function driveMuse(session: LiveSession, options: MuseLiveOptions): Promise<AgentOutcome> {
  const { task, rpc } = session;
  const timeout = options.requestTimeoutMs ?? 60_000;
  // Filled in as the server replies; notifications before then are not ours.
  const ids: { session?: string; turn?: string } = {};
  let finish: (outcome: AgentOutcome) => void = () => {};
  const finished = new Promise<AgentOutcome>((resolve) => {
    finish = resolve;
  });

  session.onNotification((method, params) => {
    if (ids.session === undefined || stringField(params, 'sessionId') !== ids.session) return;
    if (method === 'turn/completed') {
      if (ids.turn && stringField(params, 'turnId') && stringField(params, 'turnId') !== ids.turn) return;
      const terminal = stringField(params, 'terminal');
      const error = stringField(isObject(params) ? params.error : undefined, 'message');
      if (error) session.emit({ type: 'error', message: error });
      finish(
        terminal === 'completed' ? { ok: true } : { ok: false, error: error ?? `Muse turn ${terminal ?? 'ended'}.` },
      );
      return;
    }
    for (const event of museNotification(method, params)) session.emit(event);
  });

  session.onRequest((method, params) => {
    if (method === 'approval/request') {
      session.emit({
        type: 'approval-request',
        request: {
          id: stringField(params, 'id') ?? stringField(params, 'approvalId') ?? 'approval',
          kind: 'other',
          detail: params,
        },
      });
    }
    throw new RpcError('This client cannot grant this request.', -32601);
  });

  await rpc.request(
    'initialize',
    { clientInfo: { name: 'genaicode', version: '2' }, capabilities: { userInputDialogs: false } },
    timeout,
  );
  rpc.notify('initialized');

  const created = await rpc.request(
    'session/start',
    {
      commandId: uuidv7(),
      workspaceRoot: task.cwd,
      ...(task.model ? { modelId: task.model } : {}),
      approvalMode: 'onRequest',
    },
    timeout,
  );
  const sessionId = stringField(isObject(created) ? created.session : undefined, 'sessionId');
  ids.session = sessionId;
  if (!sessionId) throw new Error('Muse did not return a session id.');
  session.emit({ type: 'session', sessionId });

  const input = (text: string) => [{ type: 'text', text }];
  const started = await rpc.request(
    'turn/start',
    {
      sessionId,
      input: input(task.prompt),
      commandId: uuidv7(),
      ...(task.effort ? { reasoningEffort: task.effort } : {}),
    },
    timeout,
  );
  const turnId = stringField(started, 'turnId');
  ids.turn = turnId;
  if (!turnId) throw new Error('Muse did not return a turn id.');

  session.setSteer(async (text) => {
    const ack = await rpc.request(
      'turn/steer',
      { sessionId, expectedTurnId: turnId, input: input(text), commandId: uuidv7() },
      timeout,
    );
    if (stringField(ack, 'turnId') !== turnId)
      throw new Error('Muse did not confirm the input; it may not have arrived.');
  });
  return finished;
}

/** Map one `muse serve` notification to agent events. */
export function museNotification(method: string, params: unknown): AgentEvent[] {
  const item = isObject(params) && isObject(params.item) ? params.item : undefined;
  if (!item) return [];
  const kind = stringField(item, 'type') ?? stringField(item, 'kind');
  const id = stringField(item, 'id');
  if (method === 'item/completed' && kind === 'agentMessage') {
    const text = stringField(item, 'text');
    return text ? [{ type: 'message', text }] : [];
  }
  if (kind && TOOL_KINDS.has(kind)) {
    const name = stringField(item, 'toolName') ?? kind;
    if (method === 'item/started') return [{ type: 'tool-start', ...(id ? { id } : {}), name }];
    if (method === 'item/completed')
      return [{ type: 'tool-end', ...(id ? { id } : {}), name, isError: item.status === 'failed' }];
  }
  return [];
}
