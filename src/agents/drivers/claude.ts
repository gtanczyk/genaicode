import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent, AgentTask, CodingAgent } from '../types.js';
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
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Claude Code in print mode (`claude -p --output-format stream-json`). */
export function claude(options: ClaudeAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'claude',
    command: options.command ?? 'claude',
    capabilities: { effort: ['low', 'medium', 'high', 'xhigh', 'max'], maxTurns: true, usage: true },
    args: (task) => claudeArgs(task, options),
    createParser: createClaudeParser,
  });
}

export function claudeArgs(task: AgentTask, options: ClaudeAgentOptions = {}): string[] {
  const args = ['-p', '--verbose', '--output-format', 'stream-json'];
  args.push('--permission-mode', options.permissionMode ?? 'acceptEdits');
  if (options.allowedTools?.length) args.push('--allowedTools', options.allowedTools.join(','));
  if (options.disallowedTools?.length) args.push('--disallowedTools', options.disallowedTools.join(','));
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
