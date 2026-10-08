import { cliAgent, type AgentOutputParser } from '../cli-agent.js';
import { exclusiveOption, resolvePermissions, type PermissionFlags } from '../permissions.js';
import type { PreparedRun } from '../prepare.js';
import type { AgentEvent, AgentPermissions, AgentTask, CodingAgent } from '../types.js';
import { isObject, stringField, type JsonObject } from './json.js';

export interface VibeAgentOptions {
  /** Executable name or path. Default `vibe`. */
  command?: string;
  /**
   * Agent profile (`--agent`). Default `accept-edits`: file edits run unattended, other
   * tools follow the profile, and a headless run declines what it would ask about.
   */
  agent?: string;
  /** Pass `--trust` to trust `cwd` for this run, so project config applies. Default true. */
  trustWorkspace?: boolean;
  /** Stop once the session costs more than this many dollars (`--max-price`). */
  maxPriceUsd?: number;
}

const EDIT_KINDS = new Set(['file_edit', 'file_write']);

/**
 * Mistral Vibe in programmatic mode (`vibe --output streaming --prompt ...`).
 * Vibe has no model flag; `task.model` is passed as `VIBE_ACTIVE_MODEL`.
 */
export function vibe(options: VibeAgentOptions = {}): CodingAgent {
  return cliAgent({
    name: 'vibe',
    command: options.command ?? 'vibe',
    capabilities: {
      maxTurns: true,
      permissions: { approval: ['auto-approve', 'deny'], sandbox: ['read-only', 'unrestricted'] },
    },
    args: (task) => vibeArgs(task, options),
    prepare: (task) => prepareVibe(task, options),
    createParser: createVibeParser,
  });
}

function prepareVibe(task: AgentTask, options: VibeAgentOptions): PreparedRun {
  return { args: vibeArgs(task, options), ...(task.model ? { env: { VIBE_ACTIVE_MODEL: task.model } } : {}) };
}

/**
 * Vibe flags for `permissions`: `auto-approve` is `--auto-approve` for the selected agent
 * profile, `deny` leaves it off (a headless run declines what it would ask about), and
 * `read-only` is the `plan` profile, which cannot be combined with `auto-approve`. Vibe has
 * no sandbox, so `workspace-write` is not offered. `ask` is not possible headless.
 */
export function vibePermissionFlags(permissions: AgentPermissions): PermissionFlags {
  const { approval, sandbox } = permissions;
  if (approval === 'ask') throw new Error("vibe cannot ask for approval headless (permissions.approval 'ask').");
  if (sandbox === 'workspace-write') throw new Error("vibe has no sandbox ('workspace-write').");
  if (sandbox === 'read-only' && approval === 'auto-approve')
    throw new Error("vibe's read-only profile (plan) cannot be combined with permissions.approval 'auto-approve'.");
  const args: string[] = [];
  const replaces: Record<string, 'flag' | 'value'> = {};
  if (approval) {
    Object.assign(replaces, { '--auto-approve': 'flag', '--yolo': 'flag', '--smart-approve': 'flag' });
    if (approval === 'auto-approve') args.push('--auto-approve');
  }
  if (sandbox === 'read-only') {
    replaces['--agent'] = 'value';
    args.push('--agent', 'plan');
  }
  return { args, replaces };
}

export function vibeArgs(task: AgentTask, options: VibeAgentOptions = {}): string[] {
  const permissions = resolvePermissions(task.permissions);
  const readOnly = permissions.sandbox === 'read-only';
  exclusiveOption('vibe', 'agent', options.agent !== undefined, 'sandbox', readOnly);
  const flags = vibePermissionFlags(permissions);
  const args = ['--output', 'streaming'];
  if (!readOnly) args.push('--agent', options.agent ?? 'accept-edits');
  args.push(...flags.args);
  if (options.trustWorkspace ?? true) args.push('--trust');
  if (task.maxTurns !== undefined) args.push('--max-turns', String(task.maxTurns));
  if (options.maxPriceUsd !== undefined) args.push('--max-price', String(options.maxPriceUsd));
  if (task.extraArgs) args.push(...task.extraArgs);
  // `--prompt=<text>` keeps a prompt that starts with a dash from reading as a flag.
  return [...args, `--prompt=${task.prompt}`];
}

/** Decodes `--output streaming`: one completed history entry per line. */
export function createVibeParser(): AgentOutputParser {
  let sessionSent = false;

  return {
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      const sessionId = stringField(value, 'sessionId');
      if (sessionId && !sessionSent) {
        sessionSent = true;
        events.push({ type: 'session', sessionId });
      }
      const id = stringField(value, 'id');
      const withId = id ? { id } : {};
      switch (value.type) {
        case 'message': {
          if (value.role !== 'assistant') break;
          const text = messageText(value.content);
          if (text) events.push({ type: 'message', text });
          break;
        }
        case 'effect': {
          const detail = isObject(value.detail) ? value.detail : undefined;
          const state = isObject(value.state) ? value.state : undefined;
          const name = stringField(detail, 'toolName') ?? stringField(value, 'title') ?? 'tool';
          const status = stringField(state, 'status');
          events.push({
            type: 'tool-start',
            ...withId,
            name,
            ...(detail?.input !== undefined ? { input: detail.input } : {}),
          });
          if (status === 'pending' || status === 'running' || status === 'blocked') break;
          const failed = status !== 'completed';
          const output = failed
            ? (stringField(state?.error, 'message') ?? stringField(state, 'reason') ?? stringField(state, 'outputText'))
            : stringField(state, 'outputText');
          events.push({ type: 'tool-end', ...withId, name, isError: failed, ...(output ? { output } : {}) });
          const path = stringField(detail?.input, 'filePath');
          if (!failed && path && EDIT_KINDS.has(stringField(detail, 'kind') ?? '')) {
            events.push({ type: 'file-change', paths: [path] });
          }
          break;
        }
        case 'notice': {
          const message = stringField(value, 'message');
          if (value.level === 'error' && message) events.push({ type: 'error', message });
          break;
        }
      }
      return events;
    },
  };
}

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is JsonObject => isObject(block) && block.type === 'text')
    .map((block) => stringField(block, 'text') ?? '')
    .filter((text) => text.trim())
    .join('\n\n');
}
