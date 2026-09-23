import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent, AgentTask, CodingAgent } from '../types.js';
import { isObject, positionalPrompt, stringField } from './json.js';

export interface CursorAgentOptions {
  /** Executable name or path. Default `cursor-agent`. */
  command?: string;
  /** Pass `--force` so commands run without asking. Default true (a headless run cannot ask). */
  force?: boolean;
  /** Pass `--approve-mcps` so the user's configured MCP servers run without asking. Default true. */
  approveMcps?: boolean;
  /** Pass `--stream-partial-output` and report assistant text as `text-delta` events. Default false. */
  partialOutput?: boolean;
}

/** Cursor's agent CLI in print mode (`cursor-agent -p --output-format stream-json`). */
export function cursor(options: CursorAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'cursor',
    command: options.command ?? 'cursor-agent',
    capabilities: {},
    args: (task) => cursorArgs(task, options),
    createParser: () => createCursorParser({ partialOutput: options.partialOutput }),
  });
}

export function cursorArgs(task: AgentTask, options: CursorAgentOptions = {}): string[] {
  const args = ['-p', '--output-format', 'stream-json'];
  if (options.force ?? true) args.push('--force');
  if (options.approveMcps ?? true) args.push('--approve-mcps');
  if (options.partialOutput) args.push('--stream-partial-output');
  if (task.model) args.push('--model', task.model);
  if (task.extraArgs) args.push(...task.extraArgs);
  return [...args, ...positionalPrompt(task.prompt)];
}

export function createCursorParser(options: { partialOutput?: boolean } = {}): AgentOutputParser {
  let outcome: AgentOutcome | undefined;
  let sessionSent = false;
  let lastMessage: string | undefined;
  let streamed = '';

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      const sessionId = stringField(value, 'session_id');
      if (sessionId && !sessionSent) {
        sessionSent = true;
        const model = stringField(value, 'model');
        events.push({ type: 'session', sessionId, ...(model ? { model } : {}) });
      }
      switch (value.type) {
        case 'assistant': {
          const content = isObject(value.message) ? value.message.content : undefined;
          const text = Array.isArray(content)
            ? content
                .map((block) => (stringField(block, 'type') === 'text' ? stringField(block, 'text') : undefined))
                .filter((part): part is string => !!part)
                .join('')
            : '';
          if (options.partialOutput) {
            // Deltas carry `timestamp_ms` without `model_call_id`; the rest repeat text already streamed.
            if (value.timestamp_ms === undefined || value.model_call_id !== undefined || !text) break;
            streamed += text;
            events.push({ type: 'text-delta', text });
          } else if (text.trim()) {
            lastMessage = text;
            events.push({ type: 'message', text });
          }
          break;
        }
        case 'tool_call': {
          const id = stringField(value, 'call_id');
          const call = cursorToolCall(value.tool_call);
          if (!call) break;
          if (value.subtype === 'started') {
            events.push({ type: 'tool-start', ...(id ? { id } : {}), name: call.name, input: call.args });
          } else if (value.subtype === 'completed') {
            const failed = isObject(call.result) && 'error' in call.result;
            events.push({ type: 'tool-end', ...(id ? { id } : {}), name: call.name, isError: failed });
            const path = stringField(call.args, 'path');
            if (!failed && /write|edit/i.test(call.name) && path) events.push({ type: 'file-change', paths: [path] });
          }
          break;
        }
        case 'result': {
          const failed = value.is_error === true || (value.subtype !== undefined && value.subtype !== 'success');
          const text = stringField(value, 'result');
          outcome = failed ? { ok: false, error: text || 'Cursor agent failed.' } : { ok: true };
          if (failed) events.push({ type: 'error', message: outcome.error! });
          else if (text && text !== lastMessage) events.push({ type: 'message', text });
          else if (!text && streamed.trim()) events.push({ type: 'message', text: streamed });
          break;
        }
      }
      return events;
    },
  };
}

/**
 * `{ writeToolCall: { args, result } }` → `{ name: 'write', args, result }`. Other tools
 * arrive as `{ function: { name, arguments } }`, with `arguments` a JSON string.
 */
function cursorToolCall(value: unknown): { name: string; args?: unknown; result?: unknown } | undefined {
  if (!isObject(value)) return undefined;
  const [key, body] = Object.entries(value)[0] ?? [];
  if (!key) return undefined;
  if (key === 'function' && isObject(body)) {
    return { name: stringField(body, 'name') ?? 'function', args: parseArguments(body.arguments), result: body.result };
  }
  const name = key.replace(/ToolCall$/, '') || key;
  return isObject(body) ? { name, args: body.args, result: body.result } : { name };
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
