import { codexSessions } from '../sessions/codex.js';
import type { TokenUsage } from '../../core/types.js';
import { QUESTION_SERVER_NAME } from '../ask-user.js';
import { liveAgent, type LiveSession } from '../live-agent.js';
import { epochMs, limitStatus, windowLabel, type AgentOutcome } from '../runtime.js';
import type { AgentEvent, AgentMode, AgentTask, CodingAgent } from '../types.js';
import { codexApprovals } from './codex-approvals.js';
import { exclusiveOption, resolvePermissions } from '../permissions.js';
import type { PrepareContext, PreparedRun } from '../prepare.js';
import { CODEX_SANDBOX, codexOwnServersOff, codexProblem, withCodexMcp, type CodexSandbox } from './codex.js';
import { isObject, numberField, stringField, type JsonObject } from './json.js';

/** Codex app-server collaboration mode (`turn/start.collaborationMode.mode`). */
export type CodexCollaborationMode = AgentMode;

export interface CodexLiveOptions {
  /** Executable name or path. Default `codex`. */
  command?: string;
  /** Default `workspace-write`. */
  sandbox?: CodexSandbox;
  /**
   * Default collaboration mode (`'default'` or `'plan'`). `'plan'` enters Codex's Plan mode,
   * where Codex explores and proposes a plan using its own `request_user_input` tool (genaicode
   * drops `genaicode_ask` so Codex has only one question tool). Overridden per turn by `task.mode`.
   */
  collaborationMode?: CodexCollaborationMode;
  /** How long to wait for the server to acknowledge each request. Default 60 s. */
  requestTimeoutMs?: number;
  /**
   * Switch off every MCP server Codex would load from its own config, leaving only the task's.
   * Lists them with `codex mcp list --json` first. `true`: the run fails if that fails.
   * `'when-listed'`: a Codex that cannot list them runs with its own servers, and says so.
   */
  onlyTaskMcpServers?: boolean | 'when-listed';
}

/**
 * Codex over its app server (`codex app-server`, JSON-RPC on stdio).
 * Supports `steer()` and routes command, file-change and permission-profile approvals to
 * `task.onApproval` (see `codexApprovals`).
 *
 * `task.permissions`: `ask` is approval policy `on-request`; `auto-approve` and `deny` are
 * `never`, since what Codex would ask about is a step outside its sandbox. The sandbox maps to
 * Codex's own (`unrestricted` is `danger-full-access`).
 */
export function codexLive(options: CodexLiveOptions = {}): CodingAgent {
  return liveAgent({
    sessions: codexSessions(),
    name: 'codex',
    command: options.command ?? 'codex',
    capabilities: {
      effort: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      usage: true,
      rateLimits: true,
      approvals: true,
      resume: true,
      plan: true,
      mcp: true,
      permissions: {
        approval: ['ask', 'auto-approve', 'deny'],
        sandbox: ['workspace-write', 'read-only', 'unrestricted'],
      },
    },
    args: (task) => {
      codexThreadPolicy(task, options);
      codexCollaborationMode(task, options);
      return [...(task.extraArgs ?? []), 'app-server'];
    },
    prepare: (task, context) => prepareCodexLive(task, options, context),
    drive: (session) => driveCodex(session, options),
  });
}

const DEFAULT_MODE_INPUT_FLAG = /^features\.default_mode_request_user_input\s*=\s*(true|false)$/;

/** Effective collaboration mode for a turn: `task.mode` overrides `options.collaborationMode`. */
export function codexCollaborationMode(
  task: Pick<AgentTask, 'mode'>,
  options: Pick<CodexLiveOptions, 'collaborationMode'> = {},
): CodexCollaborationMode | undefined {
  const mode = task.mode ?? options.collaborationMode;
  if (mode !== undefined && mode !== 'default' && mode !== 'plan')
    throw new Error(`Invalid Codex collaboration mode: ${JSON.stringify(mode)}. Expected 'default' or 'plan'.`);
  return mode;
}

/**
 * Whether Codex offers its own `request_user_input` tool for this turn: in Plan mode, or when
 * `extraArgs` enables the `default_mode_request_user_input` feature flag.
 */
export function codexHasOwnQuestionTool(
  task: Pick<AgentTask, 'mode' | 'extraArgs'>,
  options: Pick<CodexLiveOptions, 'collaborationMode'> = {},
): boolean {
  if (codexCollaborationMode(task, options) === 'plan') return true;
  let enabled = false;
  const extra = task.extraArgs ?? [];
  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i]!;
    if (arg === '--') break;
    if (arg === '--enable' && extra[i + 1] === 'default_mode_request_user_input') {
      enabled = true;
      i++;
    } else if (arg === '--enable=default_mode_request_user_input') {
      enabled = true;
    } else if (arg === '--disable' && extra[i + 1] === 'default_mode_request_user_input') {
      enabled = false;
      i++;
    } else if (arg === '--disable=default_mode_request_user_input') {
      enabled = false;
    } else if (arg === '-c' || arg === '--config') {
      const match = DEFAULT_MODE_INPUT_FLAG.exec((extra[i + 1] ?? '').trim());
      if (match) enabled = match[1] === 'true';
      i++;
    } else if (arg.startsWith('-c=') || arg.startsWith('--config=')) {
      const match = DEFAULT_MODE_INPUT_FLAG.exec(arg.slice(arg.indexOf('=') + 1).trim());
      if (match) enabled = match[1] === 'true';
    }
  }
  return enabled;
}

/** The app server's arguments: the task's MCP servers, and with `onlyTaskMcpServers` the others off. */
export async function prepareCodexLive(
  task: AgentTask,
  options: CodexLiveOptions = {},
  context?: Partial<PrepareContext>,
): Promise<PreparedRun> {
  codexThreadPolicy(task, options);
  // One question tool per turn: drop genaicode's `ask_user` server when Codex has `request_user_input`.
  const effective =
    codexHasOwnQuestionTool(task, options) && task.mcpServers?.length
      ? { ...task, mcpServers: task.mcpServers.filter((server) => server.name !== QUESTION_SERVER_NAME) }
      : task;
  const prepared = withCodexMcp(effective, [...(task.extraArgs ?? []), 'app-server']);
  if (!options.onlyTaskMcpServers) return prepared;
  let off: string[];
  try {
    // Stopping the turn stops the listing too.
    off = await codexOwnServersOff(options.command ?? 'codex', effective, context?.signal);
  } catch (error) {
    // A name clash is the caller's to fix, and a missing CLI fails the run as it would anyway.
    const code = (error as { code?: unknown }).code;
    if (options.onlyTaskMcpServers !== 'when-listed' || code !== undefined) throw error;
    context?.emit?.({ type: 'stderr', text: `${(error as Error).message}; Codex runs with its own MCP servers.\n` });
    return prepared;
  }
  return { ...prepared, args: [...off, ...prepared.args] };
}

/** `thread/start` sandbox and approval policy for a task. */
export function codexThreadPolicy(
  task: Pick<AgentTask, 'permissions' | 'onApproval'>,
  options: Pick<CodexLiveOptions, 'sandbox'> = {},
): { sandbox: CodexSandbox; approvalPolicy: 'on-request' | 'never' } {
  const { approval, sandbox } = resolvePermissions(task.permissions);
  exclusiveOption('codex', 'sandbox', options.sandbox !== undefined, 'sandbox', sandbox !== undefined);
  const asks = approval ? approval === 'ask' : !!task.onApproval;
  return {
    sandbox: sandbox ? CODEX_SANDBOX[sandbox] : (options.sandbox ?? 'workspace-write'),
    approvalPolicy: asks ? 'on-request' : 'never',
  };
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

  // thread/resume replays the previous turn's cumulative counter. Notifications can arrive
  // before either RPC promise settles, so identify the new turn before charging its usage.
  let baseline: TokenUsage | undefined;
  let startingTurn = false;
  let counted = false;
  const earlyUsage: JsonObject[] = [];
  const resumedUsage = (params: JsonObject) => {
    const report = params.tokenUsage;
    if (!isObject(report)) return;
    const total = codexUsage(report.total ?? report);
    if (!total) return;
    const turnId = stringField(params, 'turnId');
    if (!startingTurn || (ids.turn && turnId && ids.turn !== turnId)) {
      if (!counted) baseline = total;
      return;
    }
    if (!ids.turn) {
      earlyUsage.push(params);
      return;
    }
    // A server without the replay still reports the most recent model call in `last`.
    baseline ??= usageDifference(total, codexUsage(report.last) ?? {});
    counted = true;
    session.emit({ type: 'usage', usage: usageDifference(total, baseline) });
  };

  session.onNotification((method, params) => {
    if (task.resume && method === 'thread/tokenUsage/updated' && isObject(params) && params.threadId === task.resume) {
      resumedUsage(params);
      return;
    }
    // Account-wide: no threadId, and this app-server serves only our task.
    if (method === 'account/rateLimits/updated') {
      for (const event of codexNotification(method, params)) session.emit(event);
      return;
    }
    if (!ours(params)) return;
    if (approvals.notification(method, params)) return;
    if (method === 'turn/completed') {
      const turn = isObject(params) && isObject(params.turn) ? params.turn : undefined;
      if (ids.turn && stringField(turn, 'id') && stringField(turn, 'id') !== ids.turn) return;
      const status = stringField(turn, 'status');
      const error = stringField(turn?.error, 'message');
      if (error) session.emit({ type: 'error', message: error });
      approvals.close();
      finish(status === 'completed' ? { ok: true } : { ok: false, error: error ?? `Codex turn ${status ?? 'ended'}.` });
      return;
    }
    for (const event of codexNotification(method, params)) session.emit(event);
  });

  const approvals = codexApprovals(session, () => ({ session: ids.thread, turn: ids.turn }));
  session.onRequest((method, params, context) => {
    const answer = approvals.request(method, params, context);
    if (!answer) throw new Error(`${method} is not supported.`);
    return answer;
  });

  const wantedMode = codexCollaborationMode(task, options);
  // `turn/start.collaborationMode` is gated behind `experimentalApi` in Codex's app-server.
  const experimental = wantedMode === 'plan' || (wantedMode === 'default' && Boolean(task.resume));
  await rpc.request(
    'initialize',
    {
      clientInfo: { name: 'genaicode', version: '2' },
      ...(experimental ? { capabilities: { experimentalApi: true } } : {}),
    },
    timeout,
  );
  rpc.notify('initialized');

  const policy = codexThreadPolicy(task, options);
  const explicit = resolvePermissions(task.permissions);
  // A resume inherits the saved policy. Only caller-specified settings override it.
  const thread = await rpc.request(
    task.resume ? 'thread/resume' : 'thread/start',
    {
      cwd: task.cwd,
      ...(task.model ? { model: task.model } : {}),
      ...(task.resume ? { threadId: task.resume, excludeTurns: true } : {}),
      ...(!task.resume || explicit.sandbox || options.sandbox ? { sandbox: policy.sandbox } : {}),
      ...(!task.resume || explicit.approval ? { approvalPolicy: policy.approvalPolicy } : {}),
    },
    timeout,
  );
  const info = isObject(thread) && isObject(thread.thread) ? thread.thread : undefined;
  const threadId = stringField(info, 'id');
  if (!threadId) throw new Error('Codex did not return a thread id.');
  if (task.resume && threadId !== task.resume) throw new Error('Codex returned a different thread on resume.');
  if (task.resume && stringField(info?.status, 'type') === 'active')
    throw new Error('The Codex thread already has an active turn.');
  ids.thread = threadId;
  session.emit({ type: 'session', sessionId: threadId });

  // Resumed threads keep their saved collaboration mode; re-send only when it changed.
  const savedMode =
    task.resume && isObject(thread) && isObject(thread.collaborationMode)
      ? stringField(thread.collaborationMode, 'mode')
      : undefined;
  const sendMode = task.resume
    ? (wantedMode === 'plan' && savedMode !== 'plan') || (wantedMode === 'default' && savedMode === 'plan')
    : wantedMode === 'plan';
  const collaborationMode = sendMode
    ? {
        mode: wantedMode,
        settings: {
          model: task.model ?? (isObject(thread) ? stringField(thread, 'model') : undefined) ?? '',
          reasoning_effort:
            task.effort ?? (isObject(thread) ? stringField(thread, 'reasoningEffort') : undefined) ?? null,
          developer_instructions: null,
        },
      }
    : undefined;

  const input = (text: string) => [{ type: 'text', text }];
  startingTurn = true;
  const started = await rpc.request(
    'turn/start',
    {
      threadId,
      input: input(task.prompt),
      ...(task.effort ? { effort: task.effort } : {}),
      ...(collaborationMode ? { collaborationMode } : {}),
    },
    timeout,
  );
  const turnId = stringField(isObject(started) ? started.turn : undefined, 'id');
  ids.turn = turnId;
  if (!turnId) throw new Error('Codex did not return a turn id.');
  for (const params of earlyUsage.splice(0)) resumedUsage(params);

  session.setSteer(async (text) => {
    await rpc.request('turn/steer', { threadId, expectedTurnId: turnId, input: input(text) }, timeout);
  });
  return finished;
}

function codexUsage(value: unknown): TokenUsage | undefined {
  const inputTokens = numberField(value, 'inputTokens');
  const outputTokens = numberField(value, 'outputTokens');
  const cachedInputTokens = numberField(value, 'cachedInputTokens');
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(inputTokens !== undefined && outputTokens !== undefined ? { totalTokens: inputTokens + outputTokens } : {}),
  };
}

function usageDifference(total: TokenUsage, before: TokenUsage): TokenUsage {
  const delta: TokenUsage = {};
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens'] as const) {
    if (total[key] !== undefined) delta[key] = Math.max(0, total[key] - (before[key] ?? 0));
  }
  return delta;
}

/** Map one app-server notification to agent events. */
export function codexNotification(method: string, params: unknown): AgentEvent[] {
  if (!isObject(params)) return [];
  const item = isObject(params.item) ? params.item : undefined;
  const type = stringField(item, 'type');
  const id = stringField(item, 'id');
  const withId = id ? { id } : {};
  switch (method) {
    case 'item/agentMessage/delta':
    case 'item/plan/delta': {
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
      if (type === 'agentMessage' || type === 'plan') {
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
        const changes = Array.isArray(item!.changes) ? item!.changes : [];
        const paths = changes.map((change) => stringField(change, 'path')).filter((path): path is string => !!path);
        const diff = codexChangesDiff(changes);
        return paths.length ? [{ type: 'file-change', paths, ...(diff ? { diff } : {}) }] : [];
      }
      return [];
    case 'thread/tokenUsage/updated': {
      const usage = isObject(params.tokenUsage) ? params.tokenUsage : undefined;
      const total = codexUsage(usage?.total ?? usage);
      return total ? [{ type: 'usage', usage: total }] : [];
    }
    case 'account/rateLimits/updated':
      return codexRateLimits(params.rateLimits);
    case 'error': {
      const message = stringField(params.error, 'message') ?? stringField(params, 'message');
      return message ? [codexProblem(message)] : [];
    }
    default:
      return [];
  }
}

function mcpName(item: JsonObject): string {
  return [stringField(item, 'server'), stringField(item, 'tool')].filter(Boolean).join('/') || 'mcp';
}

/**
 * A Codex `RateLimitSnapshot` as `rate-limit` events, one per window (`primary`, `secondary`).
 * A limit other than the default `codex` one carries its `limitName`.
 */
export function codexRateLimits(snapshot: unknown): AgentEvent[] {
  if (!isObject(snapshot)) return [];
  const limitId = stringField(snapshot, 'limitId');
  const name = stringField(snapshot, 'limitName') ?? (limitId && limitId !== 'codex' ? limitId : undefined);
  const reached = snapshot.rateLimitReachedType !== undefined && snapshot.rateLimitReachedType !== null;
  const events: AgentEvent[] = [];
  for (const key of ['primary', 'secondary'] as const) {
    const window = snapshot[key];
    if (!isObject(window)) continue;
    const usedPercent = numberField(window, 'usedPercent');
    const minutes = numberField(window, 'windowDurationMins');
    const resetsAt = epochMs(numberField(window, 'resetsAt'));
    const status = limitStatus(usedPercent);
    events.push({
      type: 'rate-limit',
      limit: {
        window: minutes ? windowLabel(minutes) : key,
        status,
        ...(usedPercent !== undefined ? { usedPercent } : {}),
        ...(resetsAt !== undefined ? { resetsAt } : {}),
        ...(name ? { name } : {}),
      },
    });
  }
  if (reached && !events.some((event) => event.type === 'rate-limit' && event.limit.status === 'exceeded'))
    events.push({ type: 'rate-limit', limit: { window: 'quota', status: 'exceeded', ...(name ? { name } : {}) } });
  return events;
}

/**
 * The changes of a Codex `fileChange` item as one unified patch. Each change carries its own
 * `diff`: hunks for an update, the whole text for a file it adds or deletes.
 */
export function codexChangesDiff(changes: unknown[]): string | undefined {
  const parts: string[] = [];
  for (const change of changes) {
    if (!isObject(change)) continue;
    const path = stringField(change, 'path');
    const diff = stringField(change, 'diff');
    if (!path || !diff) continue;
    const kind = isObject(change.kind) ? stringField(change.kind, 'type') : stringField(change, 'kind');
    // An added or deleted file comes as its text, which may itself look like a patch.
    const whole = kind === 'add' || kind === 'delete';
    const hunks = !whole && /^(@@|--- |diff --git )/m.test(diff);
    const lines = diff.replace(/\n$/, '').split('\n');
    if (hunks && /^(--- |diff --git )/.test(diff)) parts.push(lines.join('\n'));
    else if (hunks) parts.push([`--- ${path}`, `+++ ${path}`, ...lines].join('\n'));
    else {
      // The file's text, not a patch: every line of it was added, or removed.
      const removed = kind === 'delete';
      const count = `${lines.length ? 1 : 0},${lines.length}`;
      parts.push(
        [
          `--- ${removed ? path : '/dev/null'}`,
          `+++ ${removed ? '/dev/null' : path}`,
          removed ? `@@ -${count} +0,0 @@` : `@@ -0,0 +${count} @@`,
          ...lines.map((line) => `${removed ? '-' : '+'}${line}`),
        ].join('\n'),
      );
    }
  }
  return parts.length ? parts.join('\n') : undefined;
}
