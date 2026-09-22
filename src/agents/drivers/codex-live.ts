import { liveAgent, type LiveSession } from '../live-agent.js';
import type { AgentOutcome } from '../runtime.js';
import type { AgentEvent, ApprovalRequest, CodingAgent } from '../types.js';
import { withCodexMcp, type CodexSandbox } from './codex.js';
import { isObject, numberField, stringField, type JsonObject } from './json.js';

export interface CodexLiveOptions {
  /** Executable name or path. Default `codex`. */
  command?: string;
  /** Default `workspace-write`. */
  sandbox?: CodexSandbox;
  /** How long to wait for the server to acknowledge each request. Default 60 s. */
  requestTimeoutMs?: number;
}

/**
 * Codex over its app server (`codex app-server`, JSON-RPC on stdio).
 * Supports `steer()` and routes command and file-change approvals to `task.onApproval`.
 */
export function codexLive(options: CodexLiveOptions = {}): CodingAgent {
  return liveAgent({
    name: 'codex',
    command: options.command ?? 'codex',
    capabilities: { effort: ['minimal', 'low', 'medium', 'high', 'xhigh'], usage: true, approvals: true, mcp: true },
    args: (task) => [...(task.extraArgs ?? []), 'app-server'],
    prepare: (task) => withCodexMcp(task, [...(task.extraArgs ?? []), 'app-server']),
    drive: (session) => driveCodex(session, options),
  });
}

async function driveCodex(session: LiveSession, options: CodexLiveOptions): Promise<AgentOutcome> {
  const { task, rpc } = session;
  const timeout = options.requestTimeoutMs ?? 60_000;
  // Filled in as the server replies; notifications before then are not ours.
  const ids: { thread?: string; turn?: string } = {};
  let finish: (outcome: AgentOutcome) => void = () => {};
  const finished = new Promise<AgentOutcome>((resolve) => {
    finish = resolve;
  });
  const ours = (params: unknown) => ids.thread !== undefined && stringField(params, 'threadId') === ids.thread;

  session.onNotification((method, params) => {
    if (!ours(params)) return;
    if (method === 'turn/completed') {
      const turn = isObject(params) && isObject(params.turn) ? params.turn : undefined;
      if (ids.turn && stringField(turn, 'id') && stringField(turn, 'id') !== ids.turn) return;
      const status = stringField(turn, 'status');
      const error = stringField(turn?.error, 'message');
      if (error) session.emit({ type: 'error', message: error });
      finish(status === 'completed' ? { ok: true } : { ok: false, error: error ?? `Codex turn ${status ?? 'ended'}.` });
      return;
    }
    for (const event of codexNotification(method, params)) session.emit(event);
  });

  session.onRequest(async (method, params) => {
    const legacy = method === 'execCommandApproval' || method === 'applyPatchApproval';
    const kind = method.includes('commandExecution') || method === 'execCommandApproval' ? 'command' : 'file-change';
    if (!legacy && !method.endsWith('/requestApproval')) throw new Error(`${method} is not supported.`);
    const request: ApprovalRequest = {
      id: stringField(params, 'itemId') ?? stringField(params, 'callId') ?? String(Date.now()),
      kind,
      ...summaryOf(params),
      detail: params,
    };
    const decision = await session.approve(request);
    if (legacy) return { decision: decision === 'approve' ? 'approved' : 'denied' };
    return { decision: decision === 'approve' ? 'accept' : 'decline' };
  });

  await rpc.request('initialize', { clientInfo: { name: 'genaicode', version: '2' } }, timeout);
  rpc.notify('initialized');

  const thread = await rpc.request(
    'thread/start',
    {
      cwd: task.cwd,
      ...(task.model ? { model: task.model } : {}),
      sandbox: options.sandbox ?? 'workspace-write',
      approvalPolicy: task.onApproval ? 'on-request' : 'never',
    },
    timeout,
  );
  const threadId = stringField(isObject(thread) ? thread.thread : undefined, 'id');
  ids.thread = threadId;
  if (!threadId) throw new Error('Codex did not return a thread id.');
  session.emit({ type: 'session', sessionId: threadId });

  const input = (text: string) => [{ type: 'text', text }];
  const started = await rpc.request(
    'turn/start',
    { threadId, input: input(task.prompt), ...(task.effort ? { effort: task.effort } : {}) },
    timeout,
  );
  const turnId = stringField(isObject(started) ? started.turn : undefined, 'id');
  ids.turn = turnId;
  if (!turnId) throw new Error('Codex did not return a turn id.');

  session.setSteer(async (text) => {
    await rpc.request('turn/steer', { threadId, expectedTurnId: turnId, input: input(text) }, timeout);
  });
  return finished;
}

/** Map one app-server notification to agent events. */
export function codexNotification(method: string, params: unknown): AgentEvent[] {
  if (!isObject(params)) return [];
  const item = isObject(params.item) ? params.item : undefined;
  const type = stringField(item, 'type');
  const id = stringField(item, 'id');
  const withId = id ? { id } : {};
  switch (method) {
    case 'item/agentMessage/delta': {
      const delta = stringField(params, 'delta');
      return delta ? [{ type: 'text-delta', text: delta }] : [];
    }
    case 'item/started':
      if (type === 'commandExecution')
        return [{ type: 'tool-start', ...withId, name: 'shell', input: { command: item!.command } }];
      if (type === 'mcpToolCall')
        return [{ type: 'tool-start', ...withId, name: mcpName(item!), input: item!.arguments }];
      return [];
    case 'item/completed':
      if (type === 'agentMessage') {
        const text = stringField(item, 'text');
        return text ? [{ type: 'message', text }] : [];
      }
      if (type === 'commandExecution') {
        const exitCode = numberField(item, 'exitCode');
        const output = stringField(item, 'aggregatedOutput');
        return [
          {
            type: 'tool-end',
            ...withId,
            name: 'shell',
            isError: item!.status === 'failed' || (exitCode !== undefined && exitCode !== 0),
            ...(output !== undefined ? { output } : {}),
          },
        ];
      }
      if (type === 'mcpToolCall')
        return [
          {
            type: 'tool-end',
            ...withId,
            name: mcpName(item!),
            isError: item!.status === 'failed' || (item!.error !== undefined && item!.error !== null),
          },
        ];
      if (type === 'fileChange') {
        const paths = Array.isArray(item!.changes)
          ? item!.changes.map((change) => stringField(change, 'path')).filter((path): path is string => !!path)
          : [];
        return paths.length ? [{ type: 'file-change', paths }] : [];
      }
      return [];
    case 'thread/tokenUsage/updated': {
      const usage = isObject(params.tokenUsage) ? params.tokenUsage : undefined;
      const total = isObject(usage?.total) ? usage.total : usage;
      const inputTokens = numberField(total, 'inputTokens');
      const outputTokens = numberField(total, 'outputTokens');
      const cachedInputTokens = numberField(total, 'cachedInputTokens');
      if (inputTokens === undefined && outputTokens === undefined) return [];
      return [
        {
          type: 'usage',
          usage: {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
            ...(inputTokens !== undefined && outputTokens !== undefined
              ? { totalTokens: inputTokens + outputTokens }
              : {}),
          },
        },
      ];
    }
    case 'error': {
      const message = stringField(params.error, 'message') ?? stringField(params, 'message');
      return message ? [{ type: 'error', message }] : [];
    }
    default:
      return [];
  }
}

function summaryOf(params: unknown): { summary?: string } {
  const command = isObject(params) ? params.command : undefined;
  const text = Array.isArray(command) ? command.join(' ') : typeof command === 'string' ? command : undefined;
  const summary = text ?? stringField(params, 'reason');
  return summary ? { summary } : {};
}

function mcpName(item: JsonObject): string {
  return [stringField(item, 'server'), stringField(item, 'tool')].filter(Boolean).join('/') || 'mcp';
}
