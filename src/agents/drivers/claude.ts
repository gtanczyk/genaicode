import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import { isHttpServer, type PreparedRun } from '../prepare.js';
import type { AgentEvent, AgentTask, CodingAgent, McpServer } from '../types.js';
import { isObject, numberField, positionalPrompt, stringField } from './json.js';

export type ClaudePermissionMode =
  | 'acceptEdits'
  | 'auto'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'manual'
  | 'plan'
  | (string & Record<never, never>);

export interface ClaudeAgentOptions {
  /** Executable name or path. Default `claude`. */
  command?: string;
  /** Default `acceptEdits`: file edits run unattended, other tools follow Claude Code settings. */
  permissionMode?: ClaudePermissionMode;
  /** Passed as `--allowedTools`. */
  allowedTools?: readonly string[];
  /** Passed as `--disallowedTools`. */
  disallowedTools?: readonly string[];
  /** With `task.mcpServers`: ignore MCP servers from the user's own Claude Code config. Default false. */
  strictMcpConfig?: boolean;
  /** With `task.mcpServers`: pre-allow every tool of those servers. Default true (headless runs cannot ask). */
  allowMcpTools?: boolean;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Claude Code in print mode (`claude -p --output-format stream-json`). */
export function claude(options: ClaudeAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'claude',
    command: options.command ?? 'claude',
    capabilities: { effort: ['low', 'medium', 'high', 'xhigh', 'max'], maxTurns: true, usage: true, mcp: true },
    args: (task) => claudeArgs(task, options),
    prepare: (task) => prepareClaude(task, options),
    createParser: createClaudeParser,
  });
}

/** Write the task's MCP servers to a private temp file, so header secrets stay out of argv. */
function prepareClaude(task: AgentTask, options: ClaudeAgentOptions): PreparedRun {
  if (!task.mcpServers?.length) return { args: claudeArgs(task, options) };
  const dir = mkdtempSync(join(tmpdir(), 'genaicode-claude-mcp-'));
  const file = join(dir, 'mcp.json');
  writeFileSync(file, JSON.stringify(claudeMcpConfig(task.mcpServers)), { mode: 0o600 });
  return {
    args: claudeArgs(task, options, file),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The `--mcp-config` document for a set of servers. */
export function claudeMcpConfig(servers: readonly McpServer[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    mcpServers[server.name] = isHttpServer(server)
      ? { type: 'http', url: server.url, ...(server.headers ? { headers: server.headers } : {}) }
      : {
          command: server.command,
          args: [...(server.args ?? [])],
          ...(server.env ? { env: server.env } : {}),
        };
  }
  return { mcpServers };
}

export function claudeArgs(task: AgentTask, options: ClaudeAgentOptions = {}, mcpConfigPath?: string): string[] {
  const args = ['-p', '--verbose'];
  // Multi-value flags come first: a single-value flag must follow them before the prompt.
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  if (mcpConfigPath && options.strictMcpConfig) args.push('--strict-mcp-config');
  const allowed = [
    ...(options.allowedTools ?? []),
    ...(mcpConfigPath && (options.allowMcpTools ?? true) ? (task.mcpServers ?? []).map((s) => `mcp__${s.name}`) : []),
  ];
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  if (options.disallowedTools?.length) args.push('--disallowedTools', options.disallowedTools.join(','));
  args.push('--output-format', 'stream-json', '--permission-mode', options.permissionMode ?? 'acceptEdits');
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--effort', task.effort);
  if (task.maxTurns !== undefined) args.push('--max-turns', String(task.maxTurns));
  if (task.extraArgs) args.push(...task.extraArgs);
  return [...args, ...positionalPrompt(task.prompt)];
}

export function createClaudeParser(): AgentOutputParser {
  const toolNames = new Map<string, string>();
  let outcome: AgentOutcome | undefined;
  let sessionSent = false;
  let lastMessage: string | undefined;

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      const sessionId = stringField(value, 'session_id');
      if (sessionId && !sessionSent) {
        sessionSent = true;
        events.push({ type: 'session', sessionId, ...modelOf(value) });
      }

      switch (value.type) {
        case 'assistant':
          for (const block of contentBlocks(value.message)) {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
              lastMessage = block.text;
              events.push({ type: 'message', text: block.text });
            } else if (block.type === 'tool_use' && typeof block.name === 'string') {
              const id = typeof block.id === 'string' ? block.id : undefined;
              if (id) toolNames.set(id, block.name);
              events.push({ type: 'tool-start', ...(id ? { id } : {}), name: block.name, input: block.input });
              const path = stringField(block.input, 'file_path') ?? stringField(block.input, 'notebook_path');
              if (EDIT_TOOLS.has(block.name) && path) events.push({ type: 'file-change', paths: [path] });
            }
          }
          break;
        case 'user':
          for (const block of contentBlocks(value.message)) {
            if (block.type !== 'tool_result') continue;
            const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined;
            const name = id ? toolNames.get(id) : undefined;
            const output = toolOutput(block.content);
            events.push({
              type: 'tool-end',
              ...(id ? { id } : {}),
              ...(name ? { name } : {}),
              isError: block.is_error === true,
              ...(output !== undefined ? { output } : {}),
            });
          }
          break;
        case 'stream_event': {
          const delta = isObject(value.event) ? value.event.delta : undefined;
          const text = stringField(delta, 'text');
          if (stringField(delta, 'type') === 'text_delta' && text) events.push({ type: 'text-delta', text });
          break;
        }
        case 'result': {
          const failed = value.is_error === true || (value.subtype !== undefined && value.subtype !== 'success');
          const text = stringField(value, 'result');
          outcome = failed
            ? { ok: false, error: text || `Claude stopped: ${String(value.subtype ?? 'error')}.` }
            : { ok: true };
          const usage = value.usage;
          if (isObject(usage)) {
            const inputTokens = numberField(usage, 'input_tokens');
            const outputTokens = numberField(usage, 'output_tokens');
            const cachedInputTokens = numberField(usage, 'cache_read_input_tokens');
            const costUsd = numberField(value, 'total_cost_usd');
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
              ...(costUsd !== undefined ? { costUsd } : {}),
            });
          }
          // The result repeats the last assistant message; only surface it when it differs.
          if (!failed && text && text !== lastMessage) events.push({ type: 'message', text });
          if (failed) events.push({ type: 'error', message: outcome.error! });
          break;
        }
      }
      return events;
    },
  };
}

type ContentBlock = { type?: unknown; [key: string]: unknown };

function contentBlocks(message: unknown): ContentBlock[] {
  const content = isObject(message) ? message.content : undefined;
  return Array.isArray(content) ? content.filter(isObject) : [];
}

function modelOf(value: Record<string, unknown>): { model?: string } {
  const model = stringField(value, 'model');
  return model ? { model } : {};
}

function toolOutput(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => stringField(part, 'text'))
    .filter((part): part is string => part !== undefined)
    .join('\n');
  return text || undefined;
}
