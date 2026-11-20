/**
 * The hooks of Gemini CLI, GitHub Copilot CLI and Cursor say what Claude Code's and Codex's say,
 * in their own words. `hookInput` puts a hook's input in the words `liveEvent` reads: Claude
 * Code's `hook_event_name`, `session_id`, `cwd`, `tool_name`, `tool_input`.
 */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** Event names, per agent, as Claude Code calls them. Events not named here change nothing. */
const EVENT_NAMES: Record<string, Record<string, string>> = {
  gemini: {
    SessionStart: 'SessionStart',
    BeforeAgent: 'UserPromptSubmit',
    AfterTool: 'PostToolUse',
    AfterAgent: 'Stop',
    SessionEnd: 'SessionEnd',
  },
  // Copilot's own (camelCase) events carry no event name: the hook's command line gives it.
  copilot: {
    sessionStart: 'SessionStart',
    userPromptSubmitted: 'UserPromptSubmit',
    permissionRequest: 'PermissionRequest',
    postToolUse: 'PostToolUse',
    postToolUseFailure: 'PostToolUseFailure',
    agentStop: 'Stop',
    sessionEnd: 'SessionEnd',
  },
  cursor: {
    sessionStart: 'SessionStart',
    beforeSubmitPrompt: 'UserPromptSubmit',
    postToolUse: 'PostToolUse',
    postToolUseFailure: 'PostToolUseFailure',
    stop: 'Stop',
    sessionEnd: 'SessionEnd',
  },
};

/** The events genaicode's hook is installed for, per agent, in the agent's own words. */
export const AGENT_EVENTS: Record<'gemini' | 'copilot' | 'cursor', readonly string[]> = {
  gemini: [...Object.keys(EVENT_NAMES.gemini!), 'Notification'],
  copilot: Object.keys(EVENT_NAMES.copilot!),
  cursor: Object.keys(EVENT_NAMES.cursor!),
};

/** Copilot hands a tool's arguments over as JSON text: the same call reads the same either way. */
function args(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * `input` as Claude Code would have put it; as it is for an agent that already does (Claude Code,
 * Codex). `event`: the event the hook was installed for, when the input does not name it.
 */
export function hookInput(agent: string, input: unknown, event?: string): unknown {
  const names = EVENT_NAMES[agent];
  if (!names || !isObject(input)) return input;
  const own = event ?? text(input.hook_event_name);
  if (!own) return undefined;
  const id = text(input.session_id) ?? text(input.sessionId) ?? text(input.conversation_id);
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
  const cwd = text(input.cwd) ?? text(roots[0]);
  const tool = text(input.tool_name) ?? text(input.toolName);
  // Copilot's `permissionRequest` names it `toolInput`, its tool hooks `toolArgs`.
  const toolInput =
    'tool_input' in input ? input.tool_input : 'toolInput' in input ? args(input.toolInput) : args(input.toolArgs);
  const base = {
    ...(id ? { session_id: id } : {}),
    ...(cwd ? { cwd } : {}),
    ...(tool ? { tool_name: tool, tool_input: toolInput } : {}),
  };
  // Gemini tells of a question only in a notification, which names no tool the way its other hooks do.
  if (agent === 'gemini' && own === 'Notification') {
    if (input.notification_type !== 'ToolPermission') return undefined;
    return {
      session_id: id,
      ...(cwd ? { cwd } : {}),
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    };
  }
  const name = names[own];
  if (!name) return undefined;
  if (name === 'SessionStart') {
    // Copilot and Gemini start a session over after a compaction or /clear: still the same one at work.
    const source = text(input.source);
    return { ...base, hook_event_name: name, ...(source === 'compact' ? { source } : {}) };
  }
  return { ...base, hook_event_name: name };
}

/**
 * What the hook prints for `agent` after `event`. Cursor blocks a prompt whose hook answers
 * nothing it can read, so it gets "go on"; Gemini reads every hook's output as JSON.
 */
export function hookOutput(agent: string, event: string | undefined): string | undefined {
  // Not knowing the event, it lets the prompt through all the same.
  if (agent === 'cursor') return event === undefined || event === 'beforeSubmitPrompt' ? '{"continue":true}\n' : '{}\n';
  if (agent === 'gemini') return '{}\n';
  if (event === 'Stop' || event === 'agentStop') return '{}\n';
  return undefined;
}
