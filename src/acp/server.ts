import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { detectAgents } from '../agents/discovery.js';
import { RpcError, RpcPeer } from '../agents/rpc.js';
import type { AgentEvent, AgentResult, AgentRun, ApprovalRequest, CodingAgent, McpServer } from '../agents/types.js';

/**
 * `genaicode acp`: the agent side of the Agent Client Protocol (https://agentclientprotocol.com),
 * version 1, over newline-delimited JSON-RPC. A host in any language (an editor, a game engine's
 * editor, a native app) starts the process, opens sessions and sends prompts; each prompt is one
 * run of the chosen agent CLI, and the agent's own session continues on the next prompt.
 *
 * The host picks the agent, its effort and the approval mode through session config options.
 * Permission prompts reach the host as `session/request_permission`.
 */

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpServerOptions {
  /** Agents to offer; only the installed ones are listed. */
  agents: readonly CodingAgent[];
  /** Agent new sessions start with. Default: the first installed one. */
  agent?: string;
  model?: string;
  effort?: string;
  /** Start sessions in auto-approve mode. */
  approveAll?: boolean;
  env?: NodeJS.ProcessEnv;
  version: string;
  input: NodeJS.ReadableStream;
  output: { write(chunk: string): unknown };
  /** Ends the connection as if the host closed it: running prompts stop. */
  signal?: AbortSignal;
}

type Mode = 'ask' | 'auto-approve';

interface Session {
  id: string;
  cwd: string;
  mcpServers: McpServer[];
  agent: CodingAgent;
  effort?: string;
  mode: Mode;
  /** The agent CLI's own session, continued by the next prompt. */
  agentSessionId?: string;
  run?: AgentRun;
}

const NO_TIMEOUT = 2 ** 31 - 1;

/** Serve ACP until `input` ends. Resolves once every running prompt has stopped. */
export async function serveAcp(options: AcpServerOptions): Promise<void> {
  const env = options.env ?? process.env;
  const installed = detectAgents(options.agents, env)
    .filter(({ path }) => path)
    .map(({ agent }) => agent);
  const sessions = new Map<string, Session>();

  const peer = new RpcPeer((line) => options.output.write(`${line}\n`), {
    notification(method, params) {
      if (method === 'session/cancel') sessions.get(sessionIdOf(params))?.run?.abort();
    },
    request(method, params) {
      switch (method) {
        case 'initialize':
          return initialize();
        case 'session/new':
          return newSession(params as NewSessionParams);
        case 'session/set_config_option':
          return setConfigOption(params as SetConfigParams);
        case 'session/prompt':
          return prompt(params as PromptParams);
        case 'session/close': {
          const session = takeSession(params);
          session.run?.abort();
          sessions.delete(session.id);
          return {};
        }
        default:
          throw new RpcError(`Method not found: ${method}`, -32601);
      }
    },
  });

  function initialize() {
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
        mcpCapabilities: { http: true, sse: false },
        sessionCapabilities: { close: {} },
      },
      agentInfo: { name: 'genaicode', title: 'genaicode', version: options.version },
      authMethods: [],
    };
  }

  function newSession(params: NewSessionParams) {
    if (typeof params?.cwd !== 'string' || params.cwd === '') throw invalid('cwd is required.');
    const agent = options.agent ? installed.find((candidate) => candidate.name === options.agent) : installed[0];
    if (!agent) {
      throw new RpcError(
        options.agent
          ? `Agent "${options.agent}" is not installed.`
          : `No supported agent CLI found on PATH. Install one of: ${options.agents.map((a) => a.command).join(', ')}.`,
        -32603,
      );
    }
    const session: Session = {
      id: randomUUID(),
      cwd: params.cwd,
      mcpServers: (params.mcpServers ?? []).map(toMcpServer),
      agent,
      effort: effortFor(agent, options.effort),
      mode: options.approveAll ? 'auto-approve' : 'ask',
    };
    sessions.set(session.id, session);
    return { sessionId: session.id, configOptions: configOptions(session) };
  }

  function setConfigOption(params: SetConfigParams) {
    const session = takeSession(params);
    const value = params.value;
    if (typeof value !== 'string') throw invalid(`${params.configId} takes one of its listed values.`);
    switch (params.configId) {
      case 'agent': {
        if (session.run) throw invalid('Wait for the running prompt to end before switching agents.');
        const agent = installed.find((candidate) => candidate.name === value);
        if (!agent) throw invalid(`Agent "${value}" is not installed.`);
        if (agent !== session.agent) {
          // The next agent cannot continue the previous one's session.
          session.agent = agent;
          session.agentSessionId = undefined;
          session.effort = effortFor(agent, session.effort);
        }
        break;
      }
      case 'effort':
        if (value !== 'default' && !session.agent.capabilities.effort?.includes(value)) {
          throw invalid(`${session.agent.name} has no effort "${value}".`);
        }
        session.effort = value === 'default' ? undefined : value;
        break;
      case 'mode':
        if (value !== 'ask' && value !== 'auto-approve') throw invalid(`Unknown mode "${value}".`);
        session.mode = value;
        break;
      default:
        throw invalid(`Unknown config option "${String(params.configId)}".`);
    }
    return { configOptions: configOptions(session) };
  }

  async function prompt(params: PromptParams) {
    const session = takeSession(params);
    if (session.run) throw invalid('A prompt is already running in this session.');
    const text = promptText(params.prompt);
    if (!text) throw invalid('The prompt is empty.');

    const update = (value: Record<string, unknown>) =>
      peer.notify('session/update', { sessionId: session.id, update: value });
    const toUpdates = createEventMapper();
    const run = session.agent.run({
      prompt: text,
      cwd: session.cwd,
      model: options.model,
      effort: session.effort,
      // A driver that cannot resume starts each prompt fresh instead of refusing it.
      resume: session.agent.capabilities.resume ? session.agentSessionId : undefined,
      env,
      ...(session.mcpServers.length > 0 ? { mcpServers: session.mcpServers } : {}),
      // Approvals are decided here, as in `genaicode chat`: not every driver takes
      // `permissions.approval`, but every one that asks goes through onApproval.
      onApproval: (request, signal) =>
        session.mode === 'auto-approve' ? 'approve' : askHost(session.id, request, signal),
    });
    session.run = run;
    let result: AgentResult;
    try {
      for await (const event of run) {
        if (event.type === 'session') session.agentSessionId = event.sessionId;
        for (const value of toUpdates(event)) update(value);
      }
      result = await run.result;
    } finally {
      session.run = undefined;
    }
    if (result.sessionId) session.agentSessionId = result.sessionId;
    if (result.status === 'aborted') return { stopReason: 'cancelled' };
    if (!result.ok) throw new RpcError(result.error ?? `${session.agent.name} failed (${result.status}).`, -32603);
    return { stopReason: 'end_turn' };
  }

  async function askHost(sessionId: string, request: ApprovalRequest, signal?: AbortSignal) {
    if (signal?.aborted) return 'deny' as const;
    const answer = peer.request(
      'session/request_permission',
      {
        sessionId,
        toolCall: {
          toolCallId: request.id, // Claude: the id of the tool call it asks about
          title: request.summary ?? approvalTitle(request.kind),
          kind: request.kind === 'command' ? 'execute' : request.kind === 'file-change' ? 'edit' : 'other',
          status: 'pending',
          ...(request.detail === undefined ? {} : { rawInput: request.detail }),
        },
        options: [
          {
            optionId: 'approve',
            name: request.scope === 'turn' ? 'Allow for this turn' : 'Allow',
            kind: 'allow_once',
          },
          { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
        ],
      },
      NO_TIMEOUT,
    );
    const withdrawn = new Promise<undefined>((resolve) => signal?.addEventListener('abort', () => resolve(undefined)));
    try {
      const response = (await Promise.race([answer, withdrawn])) as {
        outcome?: { outcome?: string; optionId?: string };
      };
      return response?.outcome?.outcome === 'selected' && response.outcome.optionId === 'approve' && !signal?.aborted
        ? ('approve' as const)
        : ('deny' as const);
    } catch {
      return 'deny' as const;
    }
  }

  function configOptions(session: Session) {
    const config: Array<Record<string, unknown>> = [
      {
        id: 'agent',
        name: 'Agent',
        description: 'The coding agent CLI that runs the prompts. Switching starts a new conversation.',
        category: 'model',
        type: 'select',
        currentValue: session.agent.name,
        options: installed.map((agent) => ({ value: agent.name, name: agent.name })),
      },
    ];
    const efforts = session.agent.capabilities.effort ?? [];
    if (efforts.length > 0) {
      config.push({
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: session.effort ?? 'default',
        options: [{ value: 'default', name: 'Default' }, ...efforts.map((value) => ({ value, name: value }))],
      });
    }
    config.push({
      id: 'mode',
      name: 'Approvals',
      category: 'mode',
      type: 'select',
      currentValue: session.mode,
      options: [
        { value: 'ask', name: 'Ask', description: 'Ask before the agent runs a command or edits a file.' },
        { value: 'auto-approve', name: 'Auto-approve', description: 'Approve every permission request.' },
      ],
    });
    return config;
  }

  function takeSession(params: unknown): Session {
    const session = sessions.get(sessionIdOf(params));
    if (!session) throw invalid('Unknown session.');
    return session;
  }

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  // Closing the interface ends the loop below even when the input itself never ends.
  if (options.signal?.aborted) lines.close();
  options.signal?.addEventListener('abort', () => lines.close(), { once: true });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      options.output.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
      );
      continue;
    }
    peer.receive(message);
  }
  // The host went away: stop what still runs and let it settle.
  const running = [...sessions.values()].flatMap((session) => (session.run ? [session.run] : []));
  peer.fail(new Error('The client closed the connection.'));
  for (const run of running) run.abort();
  await Promise.allSettled(running.map((run) => run.result));
}

interface NewSessionParams {
  cwd?: unknown;
  mcpServers?: AcpMcpServer[];
}

interface SetConfigParams {
  sessionId?: unknown;
  configId?: unknown;
  value?: unknown;
}

interface PromptParams {
  sessionId?: unknown;
  prompt?: unknown;
}

type AcpMcpServer =
  | { type: 'http' | 'sse'; name: string; url: string; headers?: Array<{ name: string; value: string }> }
  | { type?: undefined; name: string; command: string; args?: string[]; env?: Array<{ name: string; value: string }> };

function toMcpServer(server: AcpMcpServer): McpServer {
  // genaicode server names are /^[A-Za-z0-9_-]+$/; ACP allows any.
  const name = String(server.name ?? '').replace(/[^A-Za-z0-9_-]/g, '_') || 'mcp';
  if ('url' in server && typeof server.url === 'string') {
    if (server.type === 'sse') throw invalid(`MCP server "${server.name}": SSE is not supported; use HTTP.`);
    return { name, url: server.url, headers: pairs(server.headers) };
  }
  if ('command' in server && typeof server.command === 'string') {
    return { name, command: server.command, args: server.args ?? [], env: pairs(server.env) };
  }
  throw invalid(`MCP server "${String(server.name)}" has neither a url nor a command.`);
}

function pairs(list: Array<{ name: string; value: string }> | undefined): Record<string, string> {
  return Object.fromEntries((list ?? []).map(({ name, value }) => [name, value]));
}

function effortFor(agent: CodingAgent, effort: string | undefined): string | undefined {
  return effort !== undefined && agent.capabilities.effort?.includes(effort) ? effort : undefined;
}

function sessionIdOf(params: unknown): string {
  const id = (params as { sessionId?: unknown } | undefined)?.sessionId;
  return typeof id === 'string' ? id : '';
}

function invalid(message: string): RpcError {
  return new RpcError(message, -32602);
}

function approvalTitle(kind: ApprovalRequest['kind']): string {
  return kind === 'command' ? 'Run a command' : kind === 'file-change' ? 'Edit files' : 'Permission request';
}

/** The prompt's content blocks as the text the agent CLI gets. */
export function promptText(blocks: unknown): string {
  if (!Array.isArray(blocks)) throw invalid('prompt must be an array of content blocks.');
  const parts: string[] = [];
  for (const block of blocks as Array<Record<string, unknown>>) {
    switch (block?.type) {
      case 'text':
        parts.push(String(block.text ?? ''));
        break;
      case 'resource_link':
        parts.push(`@${pathOf(String(block.uri ?? ''))}`);
        break;
      case 'resource': {
        const resource = (block.resource ?? {}) as { uri?: unknown; text?: unknown };
        const where = pathOf(String(resource.uri ?? ''));
        if (typeof resource.text === 'string') parts.push(`${where}:\n\`\`\`\n${resource.text}\n\`\`\``);
        else parts.push(`@${where}`);
        break;
      }
      default:
        throw invalid(`Unsupported content block "${String(block?.type)}".`);
    }
  }
  return parts.join('\n').trim();
}

function pathOf(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

/**
 * Turns the agent's events into ACP `session/update` values. Streamed text goes out as it comes;
 * a final `message` adds only what the stream did not already show.
 */
export function createEventMapper(): (event: AgentEvent) => Array<Record<string, unknown>> {
  let streamed = '';
  let messageId = randomUUID();
  let toolCalls = 0;
  const open = new Map<string, string>();
  const chunk = (text: string) => ({
    sessionUpdate: 'agent_message_chunk',
    messageId,
    content: { type: 'text', text },
  });
  const nextMessage = () => {
    streamed = '';
    messageId = randomUUID();
  };

  return (event) => {
    switch (event.type) {
      case 'text-delta':
        streamed += event.text;
        return event.text ? [chunk(event.text)] : [];
      case 'message': {
        const rest = event.text.startsWith(streamed) ? event.text.slice(streamed.length) : streamed ? '' : event.text;
        const update = rest ? [chunk(rest)] : [];
        nextMessage();
        return update;
      }
      case 'tool-start': {
        if (streamed) nextMessage();
        const toolCallId = event.id ?? `tool-${++toolCalls}`;
        open.set(event.name, toolCallId);
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId,
            title: toolTitle(event.name, event.input),
            name: event.name,
            kind: toolKind(event.name),
            status: 'in_progress',
            ...(event.input === undefined ? {} : { rawInput: event.input }),
            ...locationsOf(event.input),
          },
        ];
      }
      case 'tool-end': {
        const toolCallId = event.id ?? (event.name ? open.get(event.name) : undefined);
        if (!toolCallId) return [];
        if (event.name) open.delete(event.name);
        return [
          {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            status: event.isError ? 'failed' : 'completed',
            ...(event.output
              ? {
                  content: [{ type: 'content', content: { type: 'text', text: event.output } }],
                  rawOutput: event.output,
                }
              : {}),
          },
        ];
      }
      case 'file-change':
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId: `files-${++toolCalls}`,
            title: `Changed ${event.paths.join(', ')}`,
            kind: 'edit',
            status: 'completed',
            locations: event.paths.map((path) => ({ path })),
          },
        ];
      default:
        return [];
    }
  };
}

function toolKind(name: string): string {
  const lower = name.toLowerCase();
  if (/bash|shell|exec|command|terminal|run/.test(lower)) return 'execute';
  if (/edit|write|patch|apply|create|file_change/.test(lower)) return 'edit';
  if (/delete|remove/.test(lower)) return 'delete';
  if (/grep|glob|search|find|list|ls/.test(lower)) return 'search';
  if (/read|view|cat|open/.test(lower)) return 'read';
  if (/fetch|web|http|url/.test(lower)) return 'fetch';
  if (/think|todo|plan/.test(lower)) return 'think';
  return 'other';
}

function toolTitle(name: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const fields = input as Record<string, unknown>;
    for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
      const value = fields[key];
      if (typeof value === 'string' && value.trim()) return `${name}: ${oneLine(value)}`;
      if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
        return `${name}: ${oneLine(value.join(' '))}`;
      }
    }
  }
  return name;
}

function locationsOf(input: unknown): { locations?: Array<{ path: string }> } {
  if (!input || typeof input !== 'object') return {};
  const fields = input as Record<string, unknown>;
  const path = [fields.file_path, fields.path, fields.notebook_path].find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return path ? { locations: [{ path }] } : {};
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}
