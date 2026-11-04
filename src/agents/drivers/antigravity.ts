import { readFileSync } from 'node:fs';
import type { AgentOutcome, AgentOutputParser } from '../cli-agent.js';
import { liveAgent, type LiveSession } from '../live-agent.js';
import { exclusiveOption, resolvePermissions, type PermissionFlags } from '../permissions.js';
import { isHttpServer } from '../prepare.js';
import { RpcError } from '../rpc.js';
import type { AgentEvent, AgentPermissions, AgentTask, ApprovalRequest, CodingAgent, McpServer } from '../types.js';
import { isObject, numberField, stringField, type JsonObject } from './json.js';

export interface AntigravityAgentOptions {
  /** Executable name or path. Default `agy`. */
  command?: string;
  /** Permission mode (`session/set_mode` / `--mode`). Default `accept-edits`: edits run, other tools follow permission rules. */
  mode?: string;
  /** Run terminal commands in Antigravity's sandbox (`--sandbox`). Default true. */
  sandbox?: boolean;
  /** How long to wait for the ACP server to acknowledge setup requests. Default 60 s. */
  requestTimeoutMs?: number;
}

const NO_TIMEOUT = 2 ** 31 - 1;

/**
 * Antigravity CLI over its Agent Client Protocol stdio server (`agy acp`).
 * Supports `mcpServers`, `resume`, `steer()`, and routes permission prompts to `task.onApproval`.
 */
export function antigravity(options: AntigravityAgentOptions = {}): CodingAgent {
  return liveAgent({
    name: 'antigravity',
    command: options.command ?? 'agy',
    capabilities: {
      effort: ['low', 'medium', 'high'],
      usage: true,
      mcp: true,
      resume: true,
      approvals: true,
      permissions: { approval: ['ask', 'auto-approve', 'deny'], sandbox: ['workspace-write', 'unrestricted'] },
    },
    args: (task) => antigravityAcpArgs(task, options),
    drive: (session) => driveAntigravity(session, options),
  });
}

/** CLI arguments for `agy acp`. */
export function antigravityAcpArgs(task: AgentTask, options: AntigravityAgentOptions = {}): string[] {
  const permissions = resolvePermissions(task.permissions);
  exclusiveOption('antigravity', 'sandbox', options.sandbox !== undefined, 'sandbox', !!permissions.sandbox);
  if (permissions.sandbox === 'read-only')
    throw new Error("antigravity cannot run with permissions.sandbox 'read-only'.");
  const sandbox = permissions.sandbox ? permissions.sandbox === 'workspace-write' : (options.sandbox ?? true);
  return ['acp', ...(sandbox ? ['--sandbox'] : []), ...(task.extraArgs ?? [])];
}

/** Formats `task.mcpServers` for `agy acp` `session/new` and `session/resume`. */
export function antigravityMcpServers(servers: readonly McpServer[]): Record<string, unknown>[] {
  return servers.map((server) =>
    isHttpServer(server)
      ? {
          type: 'http',
          name: server.name,
          url: server.url,
          headers: Object.entries(server.headers ?? {}).map(([name, value]) => ({ name, value })),
        }
      : {
          type: 'stdio',
          name: server.name,
          command: server.command,
          args: [...(server.args ?? [])],
          env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
        },
  );
}

interface ActiveTool {
  name: string;
  kind?: string;
  paths: string[];
  input?: JsonObject;
}

async function driveAntigravity(session: LiveSession, options: AntigravityAgentOptions): Promise<AgentOutcome> {
  const { task, rpc } = session;
  const timeout = options.requestTimeoutMs ?? 60_000;
  const ids: { session?: string } = {};
  let streamed = '';
  const tools = new Map<string, ActiveTool>();

  const servers = (task.mcpServers ?? []).map((server) => server.name);
  session.onNotification((method, params) => {
    if (method !== 'session/update' || !isObject(params)) return;
    if (!ids.session || stringField(params, 'sessionId') !== ids.session) return;
    for (const event of antigravityUpdateEvents(params.update, tools, (delta) => (streamed += delta), servers)) {
      session.emit(event);
    }
  });

  session.onRequest(async (method, params, context) => {
    if (method !== 'session/request_permission' || !isObject(params)) {
      throw new RpcError(`${method} is not supported by this client.`, -32601);
    }
    if (!ids.session || stringField(params, 'sessionId') !== ids.session) {
      throw new RpcError('Unknown session.', -32602);
    }
    const toolCall = isObject(params.toolCall) ? params.toolCall : {};
    const id = stringField(toolCall, 'toolCallId') ?? 'approval';
    const rawKind = stringField(toolCall, 'kind');
    const kind: ApprovalRequest['kind'] =
      rawKind === 'execute' ? 'command' : rawKind === 'edit' || rawKind === 'delete' ? 'file-change' : 'other';
    const summary = stringField(toolCall, 'title') ?? stringField(toolCall, 'name');
    const choices = Array.isArray(params.options)
      ? params.options.map((choice) => ({
          optionId: stringField(choice, 'optionId'),
          kind: stringField(choice, 'kind'),
        }))
      : [];
    const decision = await session.approve(
      { id, kind, scope: 'once', ...(summary ? { summary } : {}), detail: params },
      context.signal,
    );
    if (context.signal.aborted || session.signal.aborted) {
      return { outcome: { outcome: 'cancelled' } };
    }
    if (decision === 'approve') {
      const allowOnce = choices.find((choice) => choice.kind === 'allow_once' && choice.optionId);
      if (allowOnce?.optionId) return { outcome: { outcome: 'selected', optionId: allowOnce.optionId } };
      session.emit({ type: 'error', message: `Antigravity offered no one-time approval for ${id}; denying it.` });
    }
    const reject =
      choices.find((choice) => choice.kind === 'reject_once' && choice.optionId) ??
      choices.find((choice) => choice.kind === 'reject_always' && choice.optionId);
    if (reject?.optionId) return { outcome: { outcome: 'selected', optionId: reject.optionId } };
    return { outcome: { outcome: 'cancelled' } };
  });

  await rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'genaicode', version: '2' } }, timeout);

  const mcpServers = antigravityMcpServers(task.mcpServers ?? []);
  const created = task.resume
    ? await rpc.request('session/resume', { sessionId: task.resume, cwd: task.cwd, mcpServers }, timeout)
    : await rpc.request('session/new', { cwd: task.cwd, mcpServers }, timeout);
  const sessionId = stringField(created, 'sessionId');
  ids.session = sessionId;
  if (!sessionId) throw new Error('Antigravity did not return a session id.');
  const model = task.model ?? stringField(isObject(created) ? created.models : undefined, 'currentModelId');
  session.emit({ type: 'session', sessionId, ...(model ? { model } : {}) });

  await rpc.request('session/set_mode', { sessionId, modeId: options.mode ?? 'accept-edits' }, timeout);
  if (task.model) await rpc.request('session/set_model', { sessionId, modelId: task.model }, timeout);
  if (task.effort) {
    await rpc.request(
      'session/set_config_option',
      { sessionId, configId: 'thought_level', value: task.effort },
      timeout,
    );
  }

  const sendPrompt = (text: string) =>
    rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, NO_TIMEOUT);
  let completed: unknown;
  let activePrompt: Promise<void> | undefined = sendPrompt(task.prompt).then((result) => {
    completed = result;
  });
  activePrompt.catch(() => {});
  session.setSteer(async (text) => {
    const previous = activePrompt ?? Promise.resolve();
    const next = sendPrompt(text);
    const settled = next.then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    activePrompt = previous.then(async () => {
      const outcome = await settled;
      if (outcome.ok) completed = outcome.result;
    });
    activePrompt.catch(() => {});
    const outcome = await settled;
    if (!outcome.ok) throw outcome.error;
  });

  while (activePrompt) {
    const current: Promise<void> = activePrompt;
    await current;
    if (activePrompt === current) activePrompt = undefined;
  }
  session.setSteer(undefined);

  const text = streamed.trim();
  if (text) session.emit({ type: 'message', text });

  const usage = isObject(completed) ? completed.usage : undefined;
  const inputTokens = numberField(usage, 'inputTokens') ?? numberField(usage, 'input_tokens');
  const outputTokens = numberField(usage, 'outputTokens') ?? numberField(usage, 'output_tokens');
  const totalTokens = numberField(usage, 'totalTokens') ?? numberField(usage, 'total_tokens');
  const cachedInputTokens = numberField(usage, 'cachedReadTokens') ?? numberField(usage, 'cache_read_tokens');
  if (inputTokens !== undefined || outputTokens !== undefined) {
    session.emit({
      type: 'usage',
      usage: {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
        ...(cachedInputTokens ? { cachedInputTokens } : {}),
      },
    });
  }

  const stopReason = stringField(completed, 'stopReason');
  if (stopReason && stopReason !== 'end_turn') {
    const error = `Antigravity turn ended: ${stopReason}.`;
    session.emit({ type: 'error', message: error });
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Antigravity names an MCP tool `mcp_<server>_<tool>`; other drivers report `mcp__<server>__<tool>`.
 * Rename a tool of an attached server to that form, so apps match MCP tools the same way for every agent.
 */
export function antigravityToolName(name: string, servers: readonly string[]): string {
  const server = [...servers]
    .sort((a, b) => b.length - a.length)
    .find((s) => name.startsWith(`mcp_${s}_`) && name.length > s.length + 5);
  return server ? `mcp__${server}__${name.slice(server.length + 5)}` : name;
}

/** Events for one ACP `session/update` (exported for tests). */
export function antigravityUpdateEvents(
  update: unknown,
  tools: Map<string, ActiveTool>,
  onDelta: (delta: string) => void,
  servers: readonly string[] = [],
): AgentEvent[] {
  if (!isObject(update)) return [];
  const kind = stringField(update, 'sessionUpdate');
  if (kind === 'agent_message_chunk') {
    const delta = stringField(update.content, 'text');
    if (!delta) return [];
    onDelta(delta);
    return [{ type: 'text-delta', text: delta }];
  }
  if (kind !== 'tool_call' && kind !== 'tool_call_update') return [];

  const id = stringField(update, 'toolCallId');
  const withId = id ? { id } : {};
  const key = id ?? stringField(update, 'name') ?? stringField(update, 'title') ?? 'tool';
  const known = tools.get(key);
  const reported = stringField(update, 'name');
  const name =
    (reported && antigravityToolName(reported, servers)) ?? known?.name ?? stringField(update, 'title') ?? 'tool';
  const toolKind = stringField(update, 'kind') ?? known?.kind;
  const locations = Array.isArray(update.locations)
    ? update.locations.map((loc) => stringField(loc, 'path')).filter((path): path is string => !!path)
    : [];
  const paths = locations.length ? locations : (known?.paths ?? []);
  const status = stringField(update, 'status');
  const raw =
    isObject(update.rawInput) && Object.keys(update.rawInput).length > 0
      ? update.rawInput
      : isObject(update.args) && Object.keys(update.args).length > 0
        ? update.args
        : undefined;
  const input = raw && antigravityInput(raw);

  const events: AgentEvent[] = [];
  const kept = raw ?? known?.input;
  if (!known) {
    tools.set(key, { name, ...(toolKind ? { kind: toolKind } : {}), paths, ...(kept ? { input: kept } : {}) });
    events.push({ type: 'tool-start', ...withId, name, ...(input !== undefined ? { input } : {}) });
  } else {
    tools.set(key, { name, ...(toolKind ? { kind: toolKind } : {}), paths, ...(kept ? { input: kept } : {}) });
  }

  if (status === 'completed' || status === 'failed') {
    tools.delete(key);
    const output =
      toolOutput(update) ??
      (status === 'completed' && (toolKind === 'read' || name === 'read_file')
        ? readRange(raw ?? known?.input, paths)
        : undefined);
    events.push({
      type: 'tool-end',
      ...withId,
      name,
      isError: status === 'failed',
      ...(output !== undefined ? { output } : {}),
    });
    if (status === 'completed' && (toolKind === 'edit' || toolKind === 'delete') && paths.length > 0) {
      events.push({ type: 'file-change', paths });
    }
  }
  return events;
}

/**
 * Antigravity's tool arguments use its own keys (`Path`, `CommandLine`, and a `toolSummary` it adds to every
 * call); add the usual `path`, `command` and `description` so front ends show what the call is about.
 */
export function antigravityInput(input: JsonObject): JsonObject {
  const path = stringField(input, 'Path') ?? stringField(input, 'AbsolutePath') ?? stringField(input, 'TargetFile');
  const command = stringField(input, 'CommandLine');
  const summary = stringField(input, 'toolSummary');
  return {
    ...input,
    ...(path && input.path === undefined ? { path } : {}),
    ...(command && input.command === undefined ? { command } : {}),
    ...(summary && input.description === undefined ? { description: summary } : {}),
  };
}

const READ_LIMIT = 20_000;

/**
 * Antigravity reports a `read_file` without the text it read. Show those lines from the file as it is now
 * (`StartLine`/`EndLine`, 1-based and inclusive, when given), cut to 20 000 characters.
 */
function readRange(input: JsonObject | undefined, paths: readonly string[]): string | undefined {
  const path = (input && (stringField(input, 'Path') ?? stringField(input, 'AbsolutePath'))) ?? paths[0];
  if (!path) return undefined;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const lines = text.split('\n');
  const start = Math.max(1, (input && numberField(input, 'StartLine')) ?? 1);
  const end = Math.min(lines.length, (input && numberField(input, 'EndLine')) ?? lines.length);
  const shown = lines.slice(start - 1, end).join('\n');
  return shown.length > READ_LIMIT ? `${shown.slice(0, READ_LIMIT)}\n…` : shown;
}

function toolOutput(update: JsonObject): string | undefined {
  if (typeof update.rawOutput === 'string' && update.rawOutput) return update.rawOutput;
  const raw =
    stringField(update.rawOutput, 'output') ??
    stringField(update.rawOutput, 'error') ??
    stringField(update.rawOutput, 'message');
  if (raw !== undefined) return raw;
  if (!Array.isArray(update.content)) return undefined;
  const texts = update.content
    .map((item) => stringField(item, 'text') ?? stringField(isObject(item) ? item.content : undefined, 'text'))
    .filter((text): text is string => !!text);
  return texts.length ? texts.join('\n') : undefined;
}

/**
 * Antigravity print-mode flags for `permissions`: `auto-approve` is `--dangerously-skip-permissions`
 * and `deny` leaves it off (in print mode Antigravity auto-denies tools that would ask).
 * `workspace-write` runs terminal commands in its sandbox (`--sandbox`), `unrestricted`
 * leaves it off. `ask` is not possible in print mode (use `antigravity()`, which runs `agy acp`).
 */
export function antigravityPermissionFlags(permissions: AgentPermissions): PermissionFlags {
  const { approval, sandbox } = permissions;
  if (approval === 'ask') throw new Error("antigravity cannot ask for approval headless (permissions.approval 'ask').");
  if (sandbox === 'read-only') throw new Error("antigravity cannot run with permissions.sandbox 'read-only'.");
  const args: string[] = [];
  const replaces: Record<string, 'flag' | 'value'> = {};
  if (approval) {
    replaces['--dangerously-skip-permissions'] = 'flag';
    if (approval === 'auto-approve') args.push('--dangerously-skip-permissions');
  }
  if (sandbox) {
    replaces['--sandbox'] = 'flag';
    if (sandbox === 'workspace-write') args.push('--sandbox');
  }
  return { args, replaces };
}

export function antigravityArgs(task: AgentTask, options: AntigravityAgentOptions = {}): string[] {
  const args = ['--mode', options.mode ?? 'accept-edits'];
  const permissions = resolvePermissions(task.permissions);
  exclusiveOption('antigravity', 'sandbox', options.sandbox !== undefined, 'sandbox', !!permissions.sandbox);
  const flags = antigravityPermissionFlags(permissions);
  args.push(...flags.args);
  if (!permissions.sandbox && (options.sandbox ?? true)) args.push('--sandbox');
  args.push('--output-format', 'stream-json');
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--effort', task.effort);
  if (task.resume) args.push('--conversation', task.resume);
  if (task.extraArgs) args.push(...task.extraArgs);
  return [...args, '--print', task.prompt];
}

/** Decodes `--output-format stream-json`: `init`, `step_update` and `result` events. */
export function createAntigravityParser(): AgentOutputParser {
  let outcome: AgentOutcome | undefined;
  let sessionSent = false;
  let streamed = '';
  const started = new Set<string>();

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      switch (value.event) {
        case 'init': {
          const sessionId = stringField(value, 'conversation_id');
          const model = stringField(value.init, 'model');
          if (sessionId && !sessionSent) {
            sessionSent = true;
            events.push({ type: 'session', sessionId, ...(model ? { model } : {}) });
          }
          break;
        }
        case 'step_update': {
          const step = isObject(value.step_update) ? value.step_update : undefined;
          const type = stringField(step, 'step_type');
          const state = stringField(step, 'state');
          if (type === 'agent_response') {
            const delta = stringField(step, 'text_delta');
            if (delta) {
              streamed += delta;
              events.push({ type: 'text-delta', text: delta });
            }
            break;
          }
          if (type !== 'tool') break;
          const info = isObject(step!.tool_info) ? step!.tool_info : undefined;
          const name = stringField(step, 'tool_name') ?? stringField(info, 'name') ?? 'tool';
          const index = numberField(step, 'step_index');
          const id = index !== undefined ? String(index) : undefined;
          const withId = id ? { id } : {};
          const key = id ?? name;
          if (!started.has(key)) {
            started.add(key);
            events.push({
              type: 'tool-start',
              ...withId,
              name,
              ...(info?.parameters !== undefined ? { input: info.parameters } : {}),
            });
          }
          if (state === 'DONE' || state === 'ERROR') {
            started.delete(key);
            const error = stringField(info?.error, 'message');
            const output = error ?? stringField(info, 'output');
            events.push({
              type: 'tool-end',
              ...withId,
              name,
              isError: state === 'ERROR' || info?.error !== undefined,
              ...(output !== undefined ? { output } : {}),
            });
          }
          break;
        }
        case 'result': {
          const result = isObject(value.result) ? value.result : undefined;
          const status = stringField(result, 'status');
          const response = stringField(result, 'response');
          const error = stringField(result, 'error');
          outcome =
            status === 'SUCCESS'
              ? { ok: true }
              : { ok: false, error: error ?? `Antigravity run ended with status ${status ?? 'unknown'}.` };
          if (!outcome.ok) events.push({ type: 'error', message: outcome.error! });
          const text = (response ?? streamed).trim();
          if (text) events.push({ type: 'message', text });
          streamed = '';
          const usage = result?.usage;
          const inputTokens = numberField(usage, 'input_tokens');
          const outputTokens = numberField(usage, 'output_tokens');
          const totalTokens = numberField(usage, 'total_tokens');
          const cachedInputTokens = numberField(usage, 'cache_read_tokens');
          if (inputTokens !== undefined || outputTokens !== undefined) {
            events.push({
              type: 'usage',
              usage: {
                ...(inputTokens !== undefined ? { inputTokens } : {}),
                ...(outputTokens !== undefined ? { outputTokens } : {}),
                ...(totalTokens !== undefined ? { totalTokens } : {}),
                ...(cachedInputTokens ? { cachedInputTokens } : {}),
              },
            });
          }
          break;
        }
      }
      return events;
    },
  };
}
