import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent, AgentTask, CodingAgent } from '../types.js';
import { isObject, numberField, stringField } from './json.js';

export interface AntigravityAgentOptions {
  /** Executable name or path. Default `agy`. */
  command?: string;
  /** Permission mode (`--mode`). Default `accept-edits`: edits run, other tools follow permission rules. */
  mode?: string;
  /** Run terminal commands in Antigravity's sandbox (`--sandbox`). Default true. */
  sandbox?: boolean;
}

/** Antigravity CLI in print mode (`agy --output-format stream-json --print ...`). */
export function antigravity(options: AntigravityAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'antigravity',
    command: options.command ?? 'agy',
    capabilities: { effort: ['low', 'medium', 'high'], usage: true },
    args: (task) => antigravityArgs(task, options),
    createParser: createAntigravityParser,
  });
}

export function antigravityArgs(task: AgentTask, options: AntigravityAgentOptions = {}): string[] {
  const args = ['--mode', options.mode ?? 'accept-edits'];
  if (options.sandbox ?? true) args.push('--sandbox');
  args.push('--output-format', 'stream-json');
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--effort', task.effort);
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
