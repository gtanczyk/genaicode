import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent, AgentTask, CodingAgent } from '../types.js';
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
    capabilities: { effort: ['minimal', 'low', 'medium', 'high', 'xhigh'], usage: true },
    args: (task) => codexArgs(task, options),
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
