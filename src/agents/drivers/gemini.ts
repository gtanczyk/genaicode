import { geminiSessions } from '../sessions/stores.js';
import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import { exclusiveOption, resolvePermissions, type PermissionFlags } from '../permissions.js';
import type { AgentEvent, AgentMode, AgentPermissions, AgentTask, CodingAgent } from '../types.js';
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

/**
 * Gemini CLI flags for `permissions`. `deny` is approval mode `auto_edit` (edits run, other
 * tools are refused headless), `auto-approve` is `yolo`, and `read-only` is `plan`, which
 * cannot be combined with `auto-approve`. `workspace-write` runs Gemini in its sandbox
 * (`--sandbox`: Seatbelt on macOS, Docker or Podman elsewhere; Gemini fails to start when
 * none is available) and `unrestricted` turns it off. `GEMINI_SANDBOX` overrides the flag in
 * Gemini, so it is set too. `ask` is not possible headless.
 */
export function geminiPermissionFlags(permissions: AgentPermissions): PermissionFlags {
  const { approval, sandbox } = permissions;
  if (approval === 'ask') throw new Error("gemini cannot ask for approval headless (permissions.approval 'ask').");
  if (sandbox === 'read-only' && approval === 'auto-approve')
    throw new Error("gemini's read-only mode (plan) cannot be combined with permissions.approval 'auto-approve'.");
  const args: string[] = [];
  const replaces: Record<string, 'flag' | 'value'> = {};
  const mode =
    sandbox === 'read-only' ? 'plan' : approval === 'auto-approve' ? 'yolo' : approval ? 'auto_edit' : undefined;
  if (mode) {
    Object.assign(replaces, { '--approval-mode': 'value', '--yolo': 'flag', '-y': 'flag' });
    args.push('--approval-mode', mode);
  }
  let env: Record<string, string> | undefined;
  if (sandbox === 'workspace-write' || sandbox === 'unrestricted') {
    Object.assign(replaces, { '--sandbox': 'flag', '-s': 'flag', '--no-sandbox': 'flag' });
    args.push(sandbox === 'workspace-write' ? '--sandbox' : '--no-sandbox');
    env = { GEMINI_SANDBOX: sandbox === 'workspace-write' ? 'true' : 'false' };
  }
  return { args, replaces, ...(env ? { env } : {}) };
}

/** Gemini CLI in headless mode (`gemini --prompt ... --output-format stream-json`). */
export function gemini(options: GeminiAgentOptions = {}): CodingAgent {
  return cliAgent({
    sessions: geminiSessions(),
    name: 'gemini',
    command: options.command ?? 'gemini',
    capabilities: {
      usage: true,
      ...(options.trustWorkspace === false ? {} : { plan: true }),
      permissions: { approval: ['auto-approve', 'deny'], sandbox: ['workspace-write', 'read-only', 'unrestricted'] },
    },
    args: (task) => geminiArgs(task, options),
    prepare: (task) => {
      const { env } = geminiPermissionFlags(resolvePermissions(task.permissions));
      return { args: geminiArgs(task, options), ...(env ? { env } : {}) };
    },
    createParser: createGeminiParser,
  });
}

function stripGeminiModeFlags(extraArgs: readonly string[], mode: AgentMode): string[] {
  const kept: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i]!;
    if (arg === '--') {
      kept.push(...extraArgs.slice(i));
      break;
    }
    if (mode === 'plan') {
      if (arg === '--approval-mode') {
        i++;
      } else if (arg.startsWith('--approval-mode=') || arg === '--yolo' || arg === '-y') {
        continue;
      } else {
        kept.push(arg);
      }
    } else {
      // Leaving Plan mode: remove only an explicit `plan` override so non-Plan policies (e.g. `default`) stay intact.
      if (arg === '--approval-mode' && extraArgs[i + 1] === 'plan') {
        i++;
      } else if (arg === '--approval-mode=plan') {
        continue;
      } else {
        kept.push(arg);
      }
    }
  }
  return kept;
}

export function geminiArgs(task: AgentTask, options: GeminiAgentOptions = {}): string[] {
  const permissions = resolvePermissions(task.permissions);
  const flags = geminiPermissionFlags(permissions);
  const owned = flags.args.includes('--approval-mode');
  exclusiveOption('gemini', 'approvalMode', options.approvalMode !== undefined, 'approval/sandbox', owned);
  if (task.mode !== undefined && task.mode !== 'default' && task.mode !== 'plan')
    throw new Error(`Invalid task.mode for gemini: ${JSON.stringify(task.mode)}. Expected 'default' or 'plan'.`);
  if (task.mode === 'plan' && options.trustWorkspace === false)
    throw new Error('gemini cannot guarantee Plan mode when trustWorkspace is false.');
  if (task.mode === 'plan' && permissions.approval === 'auto-approve')
    throw new Error("gemini's plan mode cannot be combined with permissions.approval 'auto-approve'.");
  const args = ['--output-format', 'stream-json'];
  if (task.mode === 'plan') {
    args.push('--approval-mode', 'plan');
    for (let i = 0; i < flags.args.length; i++) {
      if (flags.args[i] === '--approval-mode') i++;
      else args.push(flags.args[i]!);
    }
  } else {
    const defaultApproval =
      task.mode === 'default' && options.approvalMode === 'plan' ? 'auto_edit' : (options.approvalMode ?? 'auto_edit');
    if (!owned) args.push('--approval-mode', defaultApproval);
    args.push(...flags.args);
  }
  if (options.trustWorkspace ?? true) args.push('--skip-trust');
  if (task.model) args.push('--model', task.model);
  if (task.extraArgs)
    args.push(...(task.mode !== undefined ? stripGeminiModeFlags(task.extraArgs, task.mode) : task.extraArgs));
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
