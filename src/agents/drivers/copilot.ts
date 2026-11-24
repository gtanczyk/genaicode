import { copilotSessions } from '../sessions/stores.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import { exclusiveOption, resolvePermissions, type PermissionFlags } from '../permissions.js';
import { isHttpServer, type PreparedRun } from '../prepare.js';
import type { AgentEvent, AgentPermissions, AgentTask, CodingAgent, McpServer } from '../types.js';
import { isObject, numberField, stringField } from './json.js';
import { configuredMcpServers } from './mcp-isolation.js';

export interface CopilotAgentOptions {
  /** Executable name or path. Default `copilot`. */
  command?: string;
  /**
   * Pass `--allow-all-tools`. Default true: without it a headless run cannot approve a tool.
   * `denyTools` still wins over it.
   */
  allowAllTools?: boolean;
  /** Permission patterns passed as `--allow-tool`, e.g. `shell(git:*)` or `write`. */
  allowTools?: readonly string[];
  /** Permission patterns passed as `--deny-tool`, e.g. `shell` or `shell(rm)`. */
  denyTools?: readonly string[];
  /** Tools removed from the model altogether (`--excluded-tools`), e.g. `web_fetch`, `web_search`. */
  excludedTools?: readonly string[];
  /** Keep the `ask_user` tool. Default false (`--no-ask-user`): a headless run has nobody to ask. */
  askUser?: boolean;
  /** With `task.mcpServers` and `allowAllTools: false`: pre-allow every tool of those servers. Default true. */
  allowMcpTools?: boolean;
  /**
   * Switch off the built-in MCP servers and every server Copilot would load from its own config
   * (user, workspace, plugins), leaving only the task's. Lists them with `copilot mcp list --json`
   * first; the run fails if that fails.
   */
  onlyTaskMcpServers?: boolean;
}

const EDIT_TOOLS = new Set(['edit', 'create', 'str_replace_editor']);

/** GitHub Copilot CLI in prompt mode (`copilot --prompt=… --output-format json`). */
export function copilot(options: CopilotAgentOptions = {}): CodingAgent {
  return cliAgent({
    sessions: copilotSessions(),
    name: 'copilot',
    command: options.command ?? 'copilot',
    capabilities: {
      effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      usage: true,
      mcp: true,
      resume: true,
      permissions: { approval: ['auto-approve'], sandbox: ['unrestricted'] },
    },
    args: (task) => copilotArgs(task, options),
    prepare: (task) => prepareCopilot(task, options),
    createParser: createCopilotParser,
  });
}

/** The run's arguments: the task's MCP servers, and with `onlyTaskMcpServers` the others switched off. */
export async function prepareCopilot(task: AgentTask, options: CopilotAgentOptions): Promise<PreparedRun> {
  const prepared = writeCopilotMcp(task, options);
  if (!options.onlyTaskMcpServers) return prepared;
  try {
    const others = await configuredMcpServers(options.command ?? 'copilot', task, copilotMcpNames);
    const off = ['--disable-builtin-mcps', ...others.map((name) => `--disable-mcp-server=${name}`)];
    // Before `--prompt=`, which stays last.
    return { ...prepared, args: [...off, ...prepared.args] };
  } catch (error) {
    prepared.cleanup?.();
    throw error;
  }
}

/** Server names in `copilot mcp list --json`: `{ mcpServers: { name: … } }`. */
export function copilotMcpNames(listing: unknown): string[] {
  if (!isObject(listing) || !isObject(listing.mcpServers)) throw new Error('expected { mcpServers }');
  return Object.keys(listing.mcpServers);
}

/** Write the task's MCP servers to a private temp file, so header secrets stay out of argv. */
function writeCopilotMcp(task: AgentTask, options: CopilotAgentOptions): PreparedRun {
  if (!task.mcpServers?.length) return { args: copilotArgs(task, options) };
  const dir = mkdtempSync(join(tmpdir(), 'genaicode-copilot-mcp-'));
  const file = join(dir, 'mcp.json');
  writeFileSync(file, JSON.stringify(copilotMcpConfig(task.mcpServers)), { mode: 0o600 });
  return {
    args: copilotArgs(task, options, file),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The `--additional-mcp-config` document for a set of servers. */
export function copilotMcpConfig(servers: readonly McpServer[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    const timeout = server.toolTimeoutSec ? { timeout: server.toolTimeoutSec * 1000 } : {};
    mcpServers[server.name] = isHttpServer(server)
      ? {
          type: 'http',
          url: server.url,
          tools: ['*'],
          ...(server.headers ? { headers: server.headers } : {}),
          ...timeout,
        }
      : {
          type: 'local',
          command: server.command,
          args: [...(server.args ?? [])],
          tools: ['*'],
          ...(server.env ? { env: server.env } : {}),
          ...timeout,
        };
  }
  return { mcpServers };
}

/**
 * Copilot CLI flags for `permissions`. A prompt-mode run must allow its tools up front
 * (`--allow-all-tools`), so the only approval policy is `auto-approve`. `unrestricted` adds
 * `--allow-all-paths --allow-all-urls`. Copilot's `--sandbox` lets a command opt out of it per
 * call, which cannot be locked from the command line, so `workspace-write` is not offered.
 */
export function copilotPermissionFlags(permissions: AgentPermissions): PermissionFlags {
  const { approval, sandbox } = permissions;
  if (approval && approval !== 'auto-approve')
    throw new Error(`copilot cannot run with permissions.approval '${approval}' in prompt mode.`);
  if (sandbox && sandbox !== 'unrestricted')
    throw new Error(`copilot cannot run with permissions.sandbox '${sandbox}'.`);
  const args: string[] = [];
  const replaces: Record<string, 'flag' | 'value'> = {};
  if (approval) {
    Object.assign(replaces, { '--allow-all-tools': 'flag', '--allow-all': 'flag', '--yolo': 'flag' });
    args.push('--allow-all-tools');
  }
  if (sandbox) {
    Object.assign(replaces, { '--allow-all-paths': 'flag', '--allow-all-urls': 'flag', '--sandbox': 'flag' });
    args.push('--allow-all-paths', '--allow-all-urls');
  }
  return { args, replaces };
}

export function copilotArgs(task: AgentTask, options: CopilotAgentOptions = {}, mcpConfigPath?: string): string[] {
  const permissions = resolvePermissions(task.permissions);
  exclusiveOption('copilot', 'allowAllTools', options.allowAllTools !== undefined, 'approval', !!permissions.approval);
  const flags = copilotPermissionFlags(permissions);
  const args = ['--output-format', 'json'];
  if (!permissions.approval && (options.allowAllTools ?? true)) args.push('--allow-all-tools');
  args.push(...flags.args);
  // `--allow-tool` and `--deny-tool` take several values; the `=` form keeps each one to a single value.
  // A `trusted` server (genaicode's own `ask_user`) is pre-allowed even when `allowMcpTools` is off.
  const allowMcp = options.allowMcpTools ?? true;
  const allowed = [
    ...new Set([
      ...(options.allowTools ?? []),
      ...(mcpConfigPath && !permissions.approval && !(options.allowAllTools ?? true)
        ? (task.mcpServers ?? []).filter((server) => allowMcp || server.trusted).map((server) => server.name)
        : []),
    ]),
  ];
  for (const tool of allowed) args.push(`--allow-tool=${tool}`);
  for (const tool of options.denyTools ?? []) args.push(`--deny-tool=${tool}`);
  if (options.excludedTools?.length) args.push(`--excluded-tools=${options.excludedTools.join(',')}`);
  if (!options.askUser) args.push('--no-ask-user');
  if (mcpConfigPath) args.push('--additional-mcp-config', `@${mcpConfigPath}`);
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--reasoning-effort', task.effort);
  // `--resume` takes an optional value, so the id goes in the `=` form.
  if (task.resume) args.push(`--resume=${task.resume}`);
  if (task.extraArgs) args.push(...task.extraArgs);
  // `--prompt=<text>` keeps a prompt that starts with a dash from reading as a flag.
  return [...args, `--prompt=${task.prompt}`];
}

export function createCopilotParser(): AgentOutputParser {
  const toolCalls = new Map<string, { name: string; path?: string }>();
  const changed = new Set<string>();
  const usage = { outputTokens: 0, reported: false };
  let outcome: AgentOutcome | undefined;
  let sessionSent = false;
  let lastError: string | undefined;

  let sessionId: string | undefined;
  let sentModel: string | undefined;
  const session = (id: string | undefined, model?: string): AgentEvent[] => {
    if (!id || sessionSent) return [];
    sessionSent = true;
    sessionId = id;
    sentModel = model;
    return [{ type: 'session', sessionId: id, ...(model ? { model } : {}) }];
  };
  // A routing decision (Auto's pick, a switch) is only a candidate until the agent replies or acts:
  // a request that fails first answered nothing.
  let candidate: string | undefined;
  const confirmed = (): AgentEvent[] => answered(candidate);
  // Auto picks a model per turn, and the reply names the one that answered.
  const answered = (model: string | undefined): AgentEvent[] => {
    if (!sessionId || !model || model === sentModel) return [];
    sentModel = model;
    return [{ type: 'session', sessionId, model }];
  };

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const data = isObject(value.data) ? value.data : {};
      // Sub-agent traffic carries an envelope `agentId` (older CLIs: `data.parentToolCallId`);
      // the parent's own events cover it.
      const nested = stringField(value, 'agentId') !== undefined || stringField(data, 'parentToolCallId') !== undefined;
      const events: AgentEvent[] = [];

      switch (value.type) {
        case 'session.start':
        case 'session.resume': {
          // The selected model is a candidate like Auto's pick: named once the agent replies or acts
          // (`auto` is a setting, never a model).
          const selected = stringField(data, 'selectedModel');
          if (selected && selected !== 'auto') candidate = selected;
          events.push(...session(stringField(data, 'sessionId')));
          break;
        }
        case 'session.auto_mode_resolved':
          candidate = stringField(data, 'chosenModel') ?? candidate;
          break;
        case 'session.model_change':
          // A switch mid-turn, such as a fallback after a refusal.
          if (!nested) candidate = stringField(data, 'newModel') ?? candidate;
          break;
        case 'assistant.message_delta': {
          const text = stringField(data, 'deltaContent');
          if (!nested && text) events.push(...confirmed(), { type: 'text-delta', text });
          break;
        }
        case 'assistant.message': {
          const text = stringField(data, 'content');
          if (!nested) {
            // The reply's own model is the one that answered: later steps of it confirm that, not the pick.
            const named = stringField(data, 'model');
            if (named) candidate = named;
            events.push(...answered(candidate));
          }
          if (!nested && text?.trim()) events.push({ type: 'message', text });
          // JSON output drops `assistant.usage`; each message still carries its output tokens.
          const outputTokens = numberField(data, 'outputTokens');
          if (outputTokens !== undefined) {
            usage.reported = true;
            usage.outputTokens += outputTokens;
          }
          break;
        }
        case 'tool.execution_start': {
          if (!nested) events.push(...confirmed());
          const id = stringField(data, 'toolCallId');
          const server = stringField(data, 'mcpServerName');
          const tool = stringField(data, 'mcpToolName');
          const name = server && tool ? `${server}/${tool}` : (stringField(data, 'toolName') ?? 'tool');
          const path = EDIT_TOOLS.has(name) ? stringField(data.arguments, 'path') : undefined;
          if (id) toolCalls.set(id, { name, ...(path ? { path } : {}) });
          if (!nested) events.push({ type: 'tool-start', ...(id ? { id } : {}), name, input: data.arguments });
          break;
        }
        case 'tool.execution_complete': {
          const id = stringField(data, 'toolCallId');
          const call = id ? toolCalls.get(id) : undefined;
          const exitCode = numberField(data.shellExecution, 'exitCode');
          const isError = data.success !== true || (exitCode !== undefined && exitCode !== 0);
          const output = stringField(data.result, 'content') ?? stringField(data.error, 'message');
          if (!nested) {
            events.push({
              type: 'tool-end',
              ...(id ? { id } : {}),
              ...(call ? { name: call.name } : {}),
              isError,
              ...(output !== undefined ? { output } : {}),
            });
          }
          if (!isError && call?.path && !changed.has(call.path)) {
            changed.add(call.path);
            events.push({ type: 'file-change', paths: [call.path] });
          }
          break;
        }
        case 'session.error': {
          const message = stringField(data, 'message');
          if (message) {
            lastError = message;
            events.push({ type: 'error', message });
          }
          break;
        }
        case 'result': {
          events.push(...session(stringField(value, 'sessionId')));
          // Shell commands and patches can modify files no edit tool reported.
          const modified = isObject(value.usage) && isObject(value.usage.codeChanges) ? value.usage.codeChanges : {};
          const paths = Array.isArray(modified.filesModified)
            ? modified.filesModified.filter((path): path is string => typeof path === 'string' && !changed.has(path))
            : [];
          if (paths.length) {
            paths.forEach((path) => changed.add(path));
            events.push({ type: 'file-change', paths });
          }
          if (usage.reported) events.push({ type: 'usage', usage: { outputTokens: usage.outputTokens } });
          const exitCode = numberField(value, 'exitCode');
          const blocker = stringField(value, 'blocker');
          if (exitCode === 0 && value.outcome !== 'blocked') {
            outcome = { ok: true };
          } else {
            const error =
              (value.outcome === 'blocked' ? `Copilot is blocked${blocker ? `: ${blocker}` : '.'}` : undefined) ??
              lastError ??
              `Copilot exited with code ${exitCode ?? 'unknown'}.`;
            outcome = { ok: false, error };
            if (error !== lastError) events.push({ type: 'error', message: error });
          }
          break;
        }
      }
      return events;
    },
  };
}
