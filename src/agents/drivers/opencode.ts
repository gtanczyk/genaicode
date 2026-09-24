import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent, AgentTask, CodingAgent } from '../types.js';
import { isObject, numberField, stringField } from './json.js';

export interface OpencodeAgentOptions {
  /** Executable name or path. Default `opencode`. */
  command?: string;
  /** opencode agent to use (`--agent`). */
  agent?: string;
  /** Pass `--auto`: approve every permission that is not explicitly denied. Default false. */
  autoApprove?: boolean;
}

const EDIT_TOOLS = new Set(['edit', 'write', 'patch', 'multiedit']);

/**
 * opencode in run mode (`opencode run --format json`). `task.model` is `provider/model`;
 * `task.effort` maps to `--variant`.
 */
export function opencode(options: OpencodeAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'opencode',
    command: options.command ?? 'opencode',
    capabilities: { effort: ['minimal', 'low', 'medium', 'high', 'max'], usage: true },
    args: (task) => opencodeArgs(task, options),
    createParser: createOpencodeParser,
  });
}

export function opencodeArgs(task: AgentTask, options: OpencodeAgentOptions = {}): string[] {
  const args = ['run', '--format', 'json'];
  if (options.agent) args.push('--agent', options.agent);
  if (options.autoApprove) args.push('--auto');
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--variant', task.effort);
  if (task.extraArgs) args.push(...task.extraArgs);
  return [...args, '--', task.prompt];
}

export function createOpencodeParser(): AgentOutputParser {
  let outcome: AgentOutcome | undefined;
  let sessionSent = false;
  const totals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  let costUsd = 0;
  let steps = 0;

  return {
    outcome: () => outcome ?? (steps > 0 ? { ok: true } : undefined),
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      const sessionId = stringField(value, 'sessionID');
      if (sessionId && !sessionSent) {
        sessionSent = true;
        events.push({ type: 'session', sessionId });
      }
      const part = isObject(value.part) ? value.part : undefined;
      switch (value.type) {
        case 'text': {
          const text = stringField(part, 'text')?.trim();
          if (text) events.push({ type: 'message', text });
          break;
        }
        case 'tool_use': {
          const name = stringField(part, 'tool') ?? 'tool';
          const id = stringField(part, 'callID') ?? stringField(part, 'id');
          const state = isObject(part?.state) ? part.state : undefined;
          const failed = state?.status === 'error';
          const output = stringField(state, 'output') ?? stringField(state, 'error');
          events.push({
            type: 'tool-end',
            ...(id ? { id } : {}),
            name,
            isError: failed,
            ...(output !== undefined ? { output } : {}),
          });
          const path = stringField(state?.input, 'filePath');
          if (!failed && EDIT_TOOLS.has(name) && path) events.push({ type: 'file-change', paths: [path] });
          break;
        }
        case 'step_finish': {
          steps += 1;
          const tokens = isObject(part?.tokens) ? part.tokens : undefined;
          totals.inputTokens += numberField(tokens, 'input') ?? 0;
          totals.outputTokens += numberField(tokens, 'output') ?? 0;
          totals.cachedInputTokens += numberField(tokens?.cache, 'read') ?? 0;
          costUsd += numberField(part, 'cost') ?? 0;
          // Running totals across steps, so the last usage event covers the whole run.
          if (tokens) {
            events.push({
              type: 'usage',
              usage: { ...totals, totalTokens: totals.inputTokens + totals.outputTokens },
              costUsd,
            });
          }
          break;
        }
        case 'error': {
          const error = isObject(value.error) ? value.error : undefined;
          const message = stringField(error?.data, 'message') ?? stringField(error, 'name') ?? 'opencode error';
          outcome = { ok: false, error: message };
          events.push({ type: 'error', message });
          break;
        }
      }
      return events;
    },
  };
}
