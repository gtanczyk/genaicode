import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import { isHttpServer, type PreparedRun } from '../prepare.js';
import type { AgentEvent, AgentTask, CodingAgent, McpServer } from '../types.js';
import { isObject, numberField, stringField } from './json.js';

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
  /** Keep the `ask_user` tool. Default false (`--no-ask-user`): a headless run has nobody to ask. */
  askUser?: boolean;
  /** With `task.mcpServers` and `allowAllTools: false`: pre-allow every tool of those servers. Default true. */
  allowMcpTools?: boolean;
}

const EDIT_TOOLS = new Set(['edit', 'create', 'str_replace_editor']);

/** GitHub Copilot CLI in prompt mode (`copilot --prompt=… --output-format json`). */
export function copilot(options: CopilotAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'copilot',
    command: options.command ?? 'copilot',
    capabilities: {
      effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      usage: true,
      mcp: true,
    },
    args: (task) => copilotArgs(task, options),
    prepare: (task) => prepareCopilot(task, options),
    createParser: createCopilotParser,
  });
}

/** Write the task's MCP servers to a private temp file, so header secrets stay out of argv. */
function prepareCopilot(task: AgentTask, options: CopilotAgentOptions): PreparedRun {
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
    mcpServers[server.name] = isHttpServer(server)
      ? { type: 'http', url: server.url, tools: ['*'], ...(server.headers ? { headers: server.headers } : {}) }
      : {
          type: 'local',
          command: server.command,
          args: [...(server.args ?? [])],
          tools: ['*'],
          ...(server.env ? { env: server.env } : {}),
        };
  }
  return { mcpServers };
}

export function copilotArgs(task: AgentTask, options: CopilotAgentOptions = {}, mcpConfigPath?: string): string[] {
  const args = ['--output-format', 'json'];
  if (options.allowAllTools ?? true) args.push('--allow-all-tools');
  // `--allow-tool` and `--deny-tool` take several values; the `=` form keeps each one to a single value.
  const allowed = [
    ...(options.allowTools ?? []),
    ...(mcpConfigPath && !(options.allowAllTools ?? true) && (options.allowMcpTools ?? true)
      ? (task.mcpServers ?? []).map((server) => server.name)
      : []),
  ];
  for (const tool of allowed) args.push(`--allow-tool=${tool}`);
  for (const tool of options.denyTools ?? []) args.push(`--deny-tool=${tool}`);
  if (!options.askUser) args.push('--no-ask-user');
  if (mcpConfigPath) args.push('--additional-mcp-config', `@${mcpConfigPath}`);
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--reasoning-effort', task.effort);
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

  const session = (sessionId: string | undefined, model?: string): AgentEvent[] => {
    if (!sessionId || sessionSent) return [];
    sessionSent = true;
    return [{ type: 'session', sessionId, ...(model ? { model } : {}) }];
  };

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const data = isObject(value.data) ? value.data : {};
      // Sub-agent traffic nests under a parent tool call; the parent's own events cover it.
      const nested = stringField(data, 'parentToolCallId') !== undefined;
      const events: AgentEvent[] = [];

      switch (value.type) {
        case 'session.start':
        case 'session.resume':
          events.push(...session(stringField(data, 'sessionId'), stringField(data, 'selectedModel')));
          break;
        case 'assistant.message_delta': {
          const text = stringField(data, 'deltaContent');
          if (!nested && text) events.push({ type: 'text-delta', text });
          break;
        }
        case 'assistant.message': {
          const text = stringField(data, 'content');
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
