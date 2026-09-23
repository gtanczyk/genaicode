import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import { isHttpServer, type PreparedRun } from '../prepare.js';
import type { AgentEvent, AgentTask, CodingAgent, McpServer } from '../types.js';
import { isObject, numberField, positionalPrompt, stringField } from './json.js';

export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexAgentOptions {
  /** Executable name or path. Default `codex`. */
  command?: string;
  /** Default `workspace-write`: edits inside `cwd`, no network. */
  sandbox?: CodexSandbox;
  /** Allow running outside a git repository. Default true. */
  skipGitRepoCheck?: boolean;
}

/** OpenAI Codex CLI in exec mode (`codex exec --json`). */
export function codex(options: CodexAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'codex',
    command: options.command ?? 'codex',
    capabilities: { effort: ['minimal', 'low', 'medium', 'high', 'xhigh'], usage: true, mcp: true },
    args: (task) => codexArgs(task, options),
    prepare: (task) => withCodexMcp(task, codexArgs(task, options)),
    createParser: createCodexParser,
  });
}

export function codexArgs(task: AgentTask, options: CodexAgentOptions = {}): string[] {
  const args = ['exec', '--json', '--sandbox', options.sandbox ?? 'workspace-write'];
  if (options.skipGitRepoCheck ?? true) args.push('--skip-git-repo-check');
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(task.effort)}`);
  if (task.extraArgs) args.push(...task.extraArgs);
  return [...args, ...positionalPrompt(task.prompt)];
}

/** Prefix `args` with the task's MCP servers as `-c mcp_servers.*` config overrides. */
export function withCodexMcp(task: AgentTask, args: string[]): PreparedRun {
  if (!task.mcpServers?.length) return { args };
  const mcp = codexMcpOverrides(task.mcpServers);
  return { args: [...mcp.args, ...args], env: mcp.env };
}

/**
 * Config overrides for Codex MCP servers. Secrets never go on the command line: HTTP
 * header values travel in environment variables (`env_http_headers`), and a stdio
 * server's `env` is set on Codex's environment and forwarded by name (`env_vars`).
 */
export function codexMcpOverrides(servers: readonly McpServer[]): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const env: Record<string, string> = {};
  const set = (key: string, value: string) => args.push('-c', `${key}=${value}`);
  servers.forEach((server, index) => {
    const key = `mcp_servers.${server.name}`;
    if (isHttpServer(server)) {
      set(`${key}.url`, JSON.stringify(server.url));
      const headers = Object.entries(server.headers ?? {});
      if (headers.length) {
        const table = headers.map(([header, value], headerIndex) => {
          const variable = `GENAICODE_MCP_${index}_HEADER_${headerIndex}`;
          env[variable] = value;
          return `${JSON.stringify(header)} = ${JSON.stringify(variable)}`;
        });
        set(`${key}.env_http_headers`, `{ ${table.join(', ')} }`);
      }
    } else {
      set(`${key}.command`, JSON.stringify(server.command));
      set(`${key}.args`, JSON.stringify(server.args ?? []));
      // Values go into Codex's own environment and are forwarded by name (`env_vars`), so no
      // server secret ever reaches argv.
      const entries = Object.entries(server.env ?? {});
      for (const [name, value] of entries) {
        if (name in env && env[name] !== value) {
          throw new Error(`MCP servers need different values for ${name}; Codex can forward only one.`);
        }
        env[name] = value;
      }
      if (entries.length) set(`${key}.env_vars`, JSON.stringify(entries.map(([name]) => name)));
    }
  });
  return { args, env };
}

export function createCodexParser(): AgentOutputParser {
  let outcome: AgentOutcome | undefined;

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      const type = stringField(value, 'type');
      const item = isObject(value.item) ? value.item : undefined;
      const itemType = stringField(item, 'type');
      const id = stringField(item, 'id');
      const withId = id ? { id } : {};

      if (type === 'thread.started') {
        const sessionId = stringField(value, 'thread_id');
        if (sessionId) events.push({ type: 'session', sessionId });
      } else if (type === 'item.started' && item) {
        if (itemType === 'command_execution') {
          events.push({ type: 'tool-start', ...withId, name: 'shell', input: { command: item.command } });
        } else if (itemType === 'mcp_tool_call') {
          events.push({ type: 'tool-start', ...withId, name: mcpName(item), input: item.arguments });
        }
      } else if (type === 'item.completed' && item) {
        if (itemType === 'agent_message') {
          const text = stringField(item, 'text');
          if (text) events.push({ type: 'message', text });
        } else if (itemType === 'command_execution') {
          const output = stringField(item, 'aggregated_output');
          const exitCode = numberField(item, 'exit_code');
          events.push({
            type: 'tool-end',
            ...withId,
            name: 'shell',
            isError: item.status === 'failed' || (exitCode !== undefined && exitCode !== 0),
            ...(output !== undefined ? { output } : {}),
          });
        } else if (itemType === 'mcp_tool_call') {
          events.push({
            type: 'tool-end',
            ...withId,
            name: mcpName(item),
            isError: item.status === 'failed' || item.error !== undefined,
          });
        } else if (itemType === 'file_change') {
          const paths = Array.isArray(item.changes)
            ? item.changes.map((change) => stringField(change, 'path')).filter((path): path is string => !!path)
            : [];
          if (paths.length) events.push({ type: 'file-change', paths });
        } else if (itemType === 'error') {
          const message = stringField(item, 'message');
          if (message) events.push({ type: 'error', message });
        }
      } else if (type === 'turn.completed') {
        outcome = { ok: true };
        const usage = value.usage;
        if (isObject(usage)) {
          const inputTokens = numberField(usage, 'input_tokens');
          const outputTokens = numberField(usage, 'output_tokens');
          const cachedInputTokens = numberField(usage, 'cached_input_tokens');
          events.push({
            type: 'usage',
            usage: {
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
              ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
              ...(inputTokens !== undefined && outputTokens !== undefined
                ? { totalTokens: inputTokens + outputTokens }
                : {}),
            },
          });
        }
      } else if (type === 'turn.failed') {
        const message = stringField(value.error, 'message') ?? 'Codex turn failed.';
        outcome = { ok: false, error: message };
        events.push({ type: 'error', message });
      } else if (type === 'error') {
        const message = stringField(value, 'message');
        if (message) events.push({ type: 'error', message });
      }
      return events;
    },
  };
}

function mcpName(item: Record<string, unknown>): string {
  return [stringField(item, 'server'), stringField(item, 'tool')].filter(Boolean).join('/') || 'mcp';
}
