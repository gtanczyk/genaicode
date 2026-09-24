import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent, AgentTask, CodingAgent } from '../types.js';
import { isObject, stringField } from './json.js';

export interface MuseAgentOptions {
  /** Executable name or path. Default `muse`. */
  command?: string;
  /** Pass `--trust-workspace` so the run does not stop to ask. Default true. */
  trustWorkspace?: boolean;
}

/** Muse in exec mode (`muse exec --json`). */
export function muse(options: MuseAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'muse',
    command: options.command ?? 'muse',
    capabilities: { effort: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], maxTurns: true },
    args: (task) => museArgs(task, options),
    createParser: createMuseParser,
  });
}

export function museArgs(task: AgentTask, options: MuseAgentOptions = {}): string[] {
  const args = ['exec', '--json'];
  if (options.trustWorkspace ?? true) args.push('--trust-workspace');
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--reasoning-effort', task.effort);
  if (task.maxTurns !== undefined) args.push('--max-model-steps', String(task.maxTurns));
  if (task.extraArgs) args.push(...task.extraArgs);
  return [...args, task.prompt];
}

const TERMINAL = 'run.terminal.';

export function createMuseParser(): AgentOutputParser {
  let outcome: AgentOutcome | undefined;
  let sessionSent = false;
  let streamed = '';

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      const stream = isObject(value.stream) ? value.stream : undefined;
      const sessionId = stringField(stream, 'id');
      if (!sessionSent && stream?.kind === 'session' && sessionId) {
        sessionSent = true;
        events.push({ type: 'session', sessionId });
      }

      const type = stringField(value, 'payload_type');
      const payload = isObject(value.payload) ? value.payload : undefined;
      const text = stringField(payload, 'text');
      if (!type) return events;

      if (type === 'run.output.delta' && text) {
        streamed += text;
        events.push({ type: 'text-delta', text });
      } else if (type === 'task.lifecycle.side_effect_intent') {
        const operation = stringField(payload?.event, 'operation');
        if (operation && !operation.startsWith('model.')) events.push({ type: 'tool-start', name: operation });
      } else if (
        type === 'approval_wait.effect.started' ||
        (type === 'runtime.session' &&
          payload?.kind === 'approval' &&
          stringField(payload.event, 'kind') === 'requested')
      ) {
        // Headless exec cannot answer; museLive() can.
        events.push({ type: 'approval-request', request: { id: approvalId(payload), kind: 'other', detail: payload } });
      } else if (type.startsWith(TERMINAL)) {
        const verdict = type.slice(TERMINAL.length);
        if (verdict === 'completed') {
          outcome = { ok: true };
          const final = (text ?? streamed).trim();
          if (final) events.push({ type: 'message', text: final });
        } else {
          const reason = stringField(payload, 'reason') ?? text;
          const message = `Muse run ${verdict}${reason ? `: ${reason}` : ''}`;
          outcome = { ok: false, error: message };
          events.push({ type: 'error', message });
        }
      }
      return events;
    },
  };
}

function approvalId(payload: Record<string, unknown> | undefined): string {
  return stringField(payload, 'id') ?? stringField(payload, 'approvalId') ?? 'approval';
}
