import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent, AgentTask, CodingAgent } from '../types.js';
import { isObject, numberField, stringField } from './json.js';

export type GeminiApprovalMode = 'default' | 'auto_edit' | 'yolo' | 'plan';

export interface GeminiAgentOptions {
  /** Executable name or path. Default `gemini`. */
  command?: string;
  /** Default `auto_edit`: edit tools run unattended, other tools are refused headless. */
  approvalMode?: GeminiApprovalMode;
  /**
   * Pass `--skip-trust` to trust `cwd` for this run. Default true: in an untrusted folder
   * Gemini falls back to approval mode `default`, which a headless run cannot answer.
   */
  trustWorkspace?: boolean;
}

const EDIT_TOOLS = new Set(['replace', 'write_file', 'edit']);

/** Gemini CLI in headless mode (`gemini --prompt ... --output-format stream-json`). */
export function gemini(options: GeminiAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'gemini',
    command: options.command ?? 'gemini',
    capabilities: { usage: true },
    args: (task) => geminiArgs(task, options),
    createParser: createGeminiParser,
  });
}

export function geminiArgs(task: AgentTask, options: GeminiAgentOptions = {}): string[] {
  const args = ['--output-format', 'stream-json', '--approval-mode', options.approvalMode ?? 'auto_edit'];
  if (options.trustWorkspace ?? true) args.push('--skip-trust');
  if (task.model) args.push('--model', task.model);
  if (task.extraArgs) args.push(...task.extraArgs);
  // `--prompt=<text>` keeps a prompt that starts with a dash from reading as a flag.
  return [...args, `--prompt=${task.prompt}`];
}

export function createGeminiParser(): AgentOutputParser {
  const toolNames = new Map<string, string>();
  let outcome: AgentOutcome | undefined;
  let text = '';

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      switch (value.type) {
        case 'init': {
          const sessionId = stringField(value, 'session_id');
          const model = stringField(value, 'model');
          if (sessionId) events.push({ type: 'session', sessionId, ...(model ? { model } : {}) });
          break;
        }
        case 'message': {
          const content = stringField(value, 'content');
          if (value.role !== 'assistant' || !content) break;
          if (value.delta === true) {
            text += content;
            events.push({ type: 'text-delta', text: content });
          } else {
            text = content;
            events.push({ type: 'message', text: content });
          }
          break;
        }
        case 'tool_use': {
          const name = stringField(value, 'tool_name') ?? 'tool';
          const id = stringField(value, 'tool_id');
          if (id) toolNames.set(id, name);
          events.push({ type: 'tool-start', ...(id ? { id } : {}), name, input: value.parameters });
          const path = stringField(value.parameters, 'file_path');
          if (EDIT_TOOLS.has(name) && path) events.push({ type: 'file-change', paths: [path] });
          break;
        }
        case 'tool_result': {
          const id = stringField(value, 'tool_id');
          const name = id ? toolNames.get(id) : undefined;
          const output = stringField(value, 'output') ?? stringField(value.error, 'message');
          events.push({
            type: 'tool-end',
            ...(id ? { id } : {}),
            ...(name ? { name } : {}),
            isError: value.status === 'error',
            ...(output !== undefined ? { output } : {}),
          });
          break;
        }
        case 'error': {
          const message = stringField(value, 'message');
          if (message) events.push({ type: 'error', message });
          break;
        }
        case 'result': {
          const error = stringField(value.error, 'message');
          outcome = value.status === 'success' ? { ok: true } : { ok: false, error: error ?? 'Gemini run failed.' };
          if (error) events.push({ type: 'error', message: error });
          // Streamed deltas become one final message.
          if (outcome.ok && text.trim()) events.push({ type: 'message', text: text.trim() });
          const stats = value.stats;
          const inputTokens = numberField(stats, 'input_tokens');
          const outputTokens = numberField(stats, 'output_tokens');
          const totalTokens = numberField(stats, 'total_tokens');
          const cachedInputTokens = numberField(stats, 'cached');
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
