import { claudeSessions } from '../sessions/claude.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import { decideApproval, reportApproval, reportReply } from '../live-agent.js';
import { exclusiveOption, resolvePermissions } from '../permissions.js';
import { isHttpServer, type PrepareContext, type PreparedRun } from '../prepare.js';
import { epochMs, limitStatus } from '../runtime.js';
import type { AgentEvent, AgentMode, AgentTask, CodingAgent, McpServer, RateLimit } from '../types.js';
import {
  claudeApprovalEnv,
  claudePermissionFlags,
  claudeSandboxRefuses,
  isClaudeExitPlanMode,
  startClaudeApprovalServer,
} from './claude-approvals.js';
import { isObject, numberField, positionalPrompt, stringField } from './json.js';
import { anySignal } from '../runtime.js';

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
  /**
   * Permission mode passed as `--permission-mode`. When omitted (and `task.permissions` is unset),
   * inherits `permissions.defaultMode` from `options.settings` or the user's Claude Code
   * `settings.json`, falling back to `acceptEdits` when none is configured.
   */
  permissionMode?: ClaudePermissionMode;
  /** Passed as `--allowedTools`. */
  allowedTools?: readonly string[];
  /** Passed as `--disallowedTools`. */
  disallowedTools?: readonly string[];
  /** With `task.mcpServers`: ignore MCP servers from the user's own Claude Code config. Default false. */
  strictMcpConfig?: boolean;
  /** With `task.mcpServers`: pre-allow every tool of those servers. Default true (headless runs cannot ask). */
  allowMcpTools?: boolean;
  /**
   * Settings passed as `--settings`, above the user's and the project's, e.g.
   * `{ disableAllHooks: true }`. Merged with the sandbox settings of `task.permissions`.
   */
  settings?: Record<string, unknown>;
  /**
   * Send the prompt as `--input-format stream-json` on stdin, so `AgentRun.steer` can add
   * messages that Claude reads between tool calls of the running turn. Default true; false
   * passes the prompt as an argument and declares no steering.
   */
  steer?: boolean;
  /**
   * Stream replies as Claude writes them (`--include-partial-messages`, `text-delta` events).
   * Default: on when `claude --help` lists the flag (asked once per command), so a CLI too old for
   * it runs as before, its replies arriving whole.
   */
  partialMessages?: boolean;
}

const PARTIAL_FLAG = '--include-partial-messages';
const partialProbes = new Map<string, Promise<boolean>>();

/**
 * Whether the Claude Code at `command` takes `--include-partial-messages`: its `--help` lists it.
 * Its answer is kept per command; false, and asked again next time, when it cannot be asked
 * within a few seconds or does not start.
 */
export function claudeTakesPartialMessages(command: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const running = partialProbes.get(command);
  if (running) return running;
  // Only what the CLI said is kept: a probe that timed out or could not start is asked again next time.
  let settled = false;
  const probe = new Promise<{ takes: boolean; keep: boolean }>((resolve) => {
    const done = (takes: boolean, keep: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ takes, keep });
    };
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, ['--help'], {
        cwd: tmpdir(),
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      done(false, false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      done(false, false);
    }, 5_000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (out.length < 1_000_000) out += chunk;
    });
    child.on('error', () => {
      clearTimeout(timer);
      done(false, false);
    });
    child.on('close', () => {
      clearTimeout(timer);
      done(out.includes(PARTIAL_FLAG), true);
    });
  }).then(({ takes, keep }) => {
    if (!keep && partialProbes.get(command) === probe) partialProbes.delete(command);
    return takes;
  });
  partialProbes.set(command, probe);
  return probe;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_SETTINGS_BYTES = 1024 * 1024;

function claudeUserSettingsPath(env: NodeJS.ProcessEnv): string {
  const dir = env.CLAUDE_CONFIG_DIR || join(env.HOME || env.USERPROFILE || homedir(), '.claude');
  return join(dir, 'settings.json');
}

function readClaudeUserSettings(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
  const file = claudeUserSettingsPath(env);
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readsUserSettings(extraArgs?: readonly string[]): boolean {
  if (!extraArgs?.length) return true;
  let sources: string | undefined;
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i]!;
    if (arg === '--') break;
    if (arg === '--bare') return false;
    if (arg === '--setting-sources') {
      sources = extraArgs[i + 1] ?? '';
      i++;
    } else if (arg.startsWith('--setting-sources=')) {
      sources = arg.slice('--setting-sources='.length);
    }
  }
  if (sources === undefined) return true;
  return sources
    .split(',')
    .map((part) => part.trim())
    .includes('user');
}

function isModeDisabled(
  user: Record<string, unknown> | undefined,
  userPerms: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
  overridePerms: Record<string, unknown> | undefined,
  key: 'disableAutoMode' | 'disableBypassPermissionsMode',
): boolean {
  const from = (root: Record<string, unknown> | undefined, perms: Record<string, unknown> | undefined) =>
    perms?.[key] === 'disable' || root?.[key] === 'disable' ? 'disable' : (perms?.[key] ?? root?.[key]);
  return (from(override, overridePerms) ?? from(user, userPerms)) === 'disable';
}

function defaultModeInSettings(
  user: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): string | undefined {
  const userPerms = user && isObject(user.permissions) ? user.permissions : undefined;
  const overridePerms = override && isObject(override.permissions) ? override.permissions : undefined;
  const mode =
    stringField(overridePerms, 'defaultMode')?.trim() || stringField(userPerms, 'defaultMode')?.trim() || undefined;
  if (!mode) return undefined;
  if (mode === 'auto' && isModeDisabled(user, userPerms, override, overridePerms, 'disableAutoMode')) return undefined;
  if (
    mode === 'bypassPermissions' &&
    isModeDisabled(user, userPerms, override, overridePerms, 'disableBypassPermissionsMode')
  )
    return undefined;
  return mode;
}

function hasDefaultModeInSettings(
  user: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): boolean {
  return defaultModeInSettings(user, override) !== undefined;
}

function stripClaudeModeFlags(extraArgs: readonly string[], mode: AgentMode): string[] {
  const kept: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i]!;
    if (arg === '--') {
      kept.push(...extraArgs.slice(i));
      break;
    }
    if (mode === 'plan') {
      if (arg === '--permission-mode') {
        i++;
      } else if (
        arg.startsWith('--permission-mode=') ||
        arg === '--dangerously-skip-permissions' ||
        arg === '--allow-dangerously-skip-permissions'
      ) {
        continue;
      } else {
        kept.push(arg);
      }
    } else {
      // Leaving Plan mode: remove only an explicit `plan` override so non-Plan policies (e.g. `manual`) stay intact.
      if (arg === '--permission-mode' && extraArgs[i + 1] === 'plan') {
        i++;
      } else if (arg === '--permission-mode=plan') {
        continue;
      } else {
        kept.push(arg);
      }
    }
  }
  return kept;
}

/**
 * Whether Claude Code already has a usable `permissions.defaultMode` in `options.settings` or
 * the user's `settings.json` (`$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`).
 * Project settings are ignored: Claude rejects elevated modes such as `auto` there, and an
 * untrusted repository must not weaken the driver's fallback.
 */
export function hasClaudeDefaultMode(
  env: NodeJS.ProcessEnv = process.env,
  override?: Record<string, unknown>,
  extraArgs?: readonly string[],
): boolean {
  const user = readsUserSettings(extraArgs) ? readClaudeUserSettings(env) : undefined;
  return hasDefaultModeInSettings(user, override);
}

/**
 * Claude Code in print mode (`claude -p --output-format stream-json`).
 *
 * With `task.onApproval`, permission prompts reach it through Claude's
 * `--permission-prompt-tool`, served from a private loopback MCP endpoint for the task (see
 * `startClaudeApprovalServer`), and Claude waits up to a day for an answer (`claudeApprovalEnv`).
 * Without it, tools the permission mode does not allow are refused.
 *
 * `task.permissions`: see `claudePermissionFlags`. `ask` and `auto-approve` use the same
 * prompt tool; a request outside the sandbox is denied before anyone is asked.
 *
 * Steering (`options.steer`, on by default): the prompt and each steer are user messages on
 * stdin, and `--replay-user-messages` tells when Claude took one. Stdin closes once a turn
 * ends with every message taken; a steer that came too late for its turn runs as one more.
 */
export function claude(options: ClaudeAgentOptions = {}): CodingAgent {
  const steer = options.steer ?? true;
  const command = options.command ?? 'claude';
  const input = { start: (task: AgentTask) => [claudeUserMessage(task.prompt)], steer: claudeUserMessage };
  // Remembers each session's last effective mode so a direct `resume` with `mode` omitted keeps Plan mode.
  const sessionModes = new Map<string, AgentMode>();
  const rememberMode = (sessionId: string, mode: AgentMode) => {
    if (sessionModes.size >= 256) sessionModes.clear();
    sessionModes.set(sessionId, mode);
  };
  const agent = cliAgent({
    sessions: claudeSessions(),
    name: 'claude',
    command,
    capabilities: {
      ...(steer ? { steer: true } : {}),
      effort: ['low', 'medium', 'high', 'xhigh', 'max'],
      // Claude Code's model aliases: each names the latest model of its kind.
      models: ['opus', 'sonnet', 'haiku'],
      maxTurns: true,
      usage: true,
      rateLimits: true,
      mcp: true,
      resume: true,
      plan: true,
      approvals: true,
      questions: true,
      permissions: {
        approval: ['ask', 'auto-approve', 'deny'],
        sandbox: ['workspace-write', 'read-only', 'unrestricted'],
      },
    },
    args: (task) => claudeArgs(task, options, undefined, undefined, steer),
    prepare: async (task, context) =>
      prepareClaude(
        task,
        options,
        context,
        steer,
        sessionModes,
        options.partialMessages ?? (await claudeTakesPartialMessages(command, task.env ?? process.env)),
      ),
    createParser: () => {
      const parser = createClaudeParser();
      // The first session event of a run says its mode (none: default); a later one, such as a
      // fallback's model report, changes it only when it names one.
      let modeSeen = false;
      return {
        outcome: () => parser.outcome?.(),
        ...(parser.input ? { input: (value: unknown) => parser.input!(value) } : {}),
        event(value) {
          const events = parser.event(value);
          for (const event of events) {
            if (event.type !== 'session') continue;
            if (event.mode !== undefined) rememberMode(event.sessionId, event.mode);
            else if (!modeSeen) rememberMode(event.sessionId, 'default');
            modeSeen = true;
          }
          return events;
        },
      };
    },
    ...(steer ? { input } : {}),
  });
  // The model receives only the stdin message. Keep the user's login, without loading
  // normal driver settings, tools or customizations into a review of untrusted text.
  const text = cliAgent({
    name: 'claude',
    command,
    input,
    createParser: createClaudeParser,
    env: (env) => {
      const child: NodeJS.ProcessEnv = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
      for (const key of [
        'PATH',
        'HOME',
        'USER', // Claude selects its macOS Keychain login by account name.
        'USERPROFILE',
        'SystemRoot',
        'TMPDIR',
        'TEMP',
        'TMP',
        'CLAUDE_CONFIG_DIR',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
      ]) {
        if (env[key] !== undefined) child[key] = env[key];
      }
      return child;
    },
    args: (task) => [
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--replay-user-messages',
      '--tools',
      '',
      '--strict-mcp-config',
      '--safe-mode',
      '--restricted',
      '--disable-slash-commands',
      '--settings',
      '{"disableAllHooks":true}',
      '--permission-mode',
      'dontAsk',
      '--no-session-persistence',
      '--system-prompt',
      'Answer using only the text supplied by the user.',
      ...(task.budget?.maxCostUsd !== undefined ? ['--max-budget-usd', String(task.budget.maxCostUsd)] : []),
    ],
  });
  return { ...agent, runText: text.run };
}

/** One `--input-format stream-json` line: a user message with `text`. */
export function claudeUserMessage(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}

async function savedClaudeMode(
  resume: string,
  env: NodeJS.ProcessEnv | undefined,
  signal: AbortSignal | undefined,
): Promise<AgentMode | undefined> {
  try {
    const matches = await claudeSessions().find?.(resume, { env, signal });
    return matches?.find((item) => item.id === resume)?.mode;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

/** Write the task's MCP servers to a private temp file, so header secrets stay out of argv. */
async function prepareClaude(
  task: AgentTask,
  options: ClaudeAgentOptions,
  context: PrepareContext,
  stdinPrompt: boolean,
  sessionModes?: ReadonlyMap<string, AgentMode>,
  partialMessages = false,
): Promise<PreparedRun> {
  if (task.mode !== undefined && task.mode !== 'default' && task.mode !== 'plan')
    throw new Error(`Invalid task.mode for claude: ${JSON.stringify(task.mode)}. Expected 'default' or 'plan'.`);
  const permissions = resolvePermissions(task.permissions);
  const owned = permissions.approval !== undefined || permissions.sandbox !== undefined;
  const resumedPlan =
    task.mode === undefined &&
    task.resume !== undefined &&
    (sessionModes?.get(task.resume) ?? (await savedClaudeMode(task.resume, task.env, context.signal))) === 'plan';
  const effectiveTask = resumedPlan ? { ...task, mode: 'plan' as const } : task;
  const asks = permissions.approval ? permissions.approval !== 'deny' : !!effectiveTask.onApproval;
  const approvals = asks ? await claudeApprovals(effectiveTask, context) : undefined;
  const servers = [...(effectiveTask.mcpServers ?? []), ...(approvals ? [approvals.server] : [])];
  const userSettings =
    !owned && options.permissionMode === undefined && readsUserSettings(effectiveTask.extraArgs)
      ? readClaudeUserSettings(effectiveTask.env ?? process.env)
      : undefined;
  const settingsDefaultMode =
    !owned && options.permissionMode === undefined ? defaultModeInSettings(userSettings, options.settings) : undefined;
  const inheritMode =
    settingsDefaultMode !== undefined && !(effectiveTask.mode === 'default' && settingsDefaultMode === 'plan');
  if (!servers.length)
    return {
      args: claudeArgs(effectiveTask, options, undefined, undefined, stdinPrompt, inheritMode, partialMessages),
    };
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'genaicode-claude-mcp-'));
    const file = join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify(claudeMcpConfig(servers)), { mode: 0o600 });
    const args = claudeArgs(effectiveTask, options, file, approvals?.args, stdinPrompt, inheritMode, partialMessages);
    const created = dir;
    return {
      args,
      ...(approvals ? { env: claudeApprovalEnv(effectiveTask.env) } : {}),
      cleanup: () => {
        void approvals?.close();
        rmSync(created, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (dir) rmSync(dir, { recursive: true, force: true });
    void approvals?.close();
    throw error;
  }
}

/** The task's approval endpoint: decides under `task.permissions`, with the run's approval events. */
async function claudeApprovals(task: AgentTask, context: PrepareContext) {
  const taken = new Set((task.mcpServers ?? []).map((server) => server.name));
  let name = 'genaicode_approval';
  for (let n = 2; taken.has(name); n++) name = `genaicode_approval_${n}`;
  const sandbox = resolvePermissions(task.permissions).sandbox;
  return startClaudeApprovalServer(
    async (request, signal) => {
      const ended = signal ? anySignal([signal, context.signal]) : context.signal;
      return reportApproval(context.emit, request, ended, async () =>
        // Outside the sandbox, or leaving an explicitly requested Plan turn: denied by policy.
        (sandbox && claudeSandboxRefuses(request.detail, sandbox, task.cwd)) ||
        (task.mode === 'plan' && isClaudeExitPlanMode(request.detail))
          ? { decision: 'deny', automatic: true }
          : decideApproval(task, request, ended),
      );
    },
    {
      name,
      // Asked whatever the approval policy: `auto-approve` cannot choose for the person.
      onQuestion: async (request, signal) => {
        const ended = signal ? anySignal([signal, context.signal]) : context.signal;
        const outcome = await reportReply(context.emit, request, ended, () => decideApproval(task, request, ended));
        return outcome.decision === 'approve' ? (outcome.answers ?? {}) : undefined;
      },
    },
  );
}

/** The `--mcp-config` document for a set of servers. */
export function claudeMcpConfig(servers: readonly McpServer[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    mcpServers[server.name] = isHttpServer(server)
      ? { type: 'http', url: server.url, ...(server.headers ? { headers: server.headers } : {}) }
      : {
          command: server.command,
          args: [...(server.args ?? [])],
          ...(server.env ? { env: server.env } : {}),
        };
  }
  return { mcpServers };
}

export function claudeArgs(
  task: AgentTask,
  options: ClaudeAgentOptions = {},
  mcpConfigPath?: string,
  approvalArgs?: readonly string[],
  /** The prompt comes as stream-json on stdin (see `claude({ steer })`), not as an argument. */
  stdinPrompt = false,
  /** Omit the default `--permission-mode acceptEdits` so Claude Code uses `permissions.defaultMode` from settings. */
  inheritPermissionMode?: boolean,
  /** Stream text deltas (`--include-partial-messages`); only for a CLI that takes the flag. */
  partialMessages = false,
): string[] {
  const args = ['-p', '--verbose'];
  // Multi-value flags come first: a single-value flag must follow them before the prompt.
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  if (mcpConfigPath && options.strictMcpConfig) args.push('--strict-mcp-config');
  const allowMcp = options.allowMcpTools ?? true;
  const allowed = [
    ...(options.allowedTools ?? []),
    ...(mcpConfigPath ? (task.mcpServers ?? []).filter((s) => allowMcp || s.trusted).map((s) => `mcp__${s.name}`) : []),
  ];
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  if (options.disallowedTools?.length) args.push('--disallowedTools', options.disallowedTools.join(','));
  const permissions = resolvePermissions(task.permissions);
  const owned = permissions.approval !== undefined || permissions.sandbox !== undefined;
  exclusiveOption('claude', 'permissionMode', options.permissionMode !== undefined, 'approval/sandbox', owned);
  if (task.mode !== undefined && task.mode !== 'default' && task.mode !== 'plan')
    throw new Error(`Invalid task.mode for claude: ${JSON.stringify(task.mode)}. Expected 'default' or 'plan'.`);
  args.push('--output-format', 'stream-json');
  if (partialMessages) args.push(PARTIAL_FLAG);
  if (stdinPrompt) args.push('--input-format', 'stream-json', '--replay-user-messages');
  const settingsMode = defaultModeInSettings(undefined, options.settings);
  const inheritMode =
    inheritPermissionMode ?? (settingsMode !== undefined && !(task.mode === 'default' && settingsMode === 'plan'));
  const configuredMode =
    task.mode === 'default' && options.permissionMode === 'plan' ? 'acceptEdits' : options.permissionMode;
  const modeArgs = owned
    ? claudePermissionFlags(permissions).args
    : configuredMode !== undefined
      ? ['--permission-mode', configuredMode]
      : inheritMode
        ? []
        : ['--permission-mode', 'acceptEdits'];
  if (task.mode === 'plan') {
    const at = modeArgs.indexOf('--permission-mode');
    if (at >= 0) modeArgs[at + 1] = 'plan';
    else modeArgs.push('--permission-mode', 'plan');
  }
  if (options.settings) {
    // One `--settings`: a second one would replace the first.
    const at = modeArgs.indexOf('--settings');
    if (at < 0) modeArgs.push('--settings', JSON.stringify(options.settings));
    else modeArgs[at + 1] = JSON.stringify({ ...options.settings, ...JSON.parse(modeArgs[at + 1]!) });
  }
  args.push(...modeArgs);
  if (approvalArgs) args.push(...approvalArgs);
  if (task.model) args.push('--model', task.model);
  if (task.effort) args.push('--effort', task.effort);
  if (task.maxTurns !== undefined) args.push('--max-turns', String(task.maxTurns));
  if (task.budget?.maxCostUsd !== undefined) args.push('--max-budget-usd', String(task.budget.maxCostUsd));
  if (task.resume) args.push('--resume', task.resume);
  if (task.extraArgs)
    args.push(...(task.mode !== undefined ? stripClaudeModeFlags(task.extraArgs, task.mode) : task.extraArgs));
  return stdinPrompt ? args : [...args, ...positionalPrompt(task.prompt)];
}

export function createClaudeParser(): AgentOutputParser {
  const toolNames = new Map<string, string>();
  let outcome: AgentOutcome | undefined;
  let sessionSent = false;
  let sentModel: string | undefined;
  let lastMessage: string | undefined;

  return {
    outcome: () => outcome,
    input(value) {
      if (!isObject(value)) return undefined;
      if (value.type === 'user' && value.isReplay === true) return 'taken';
      return value.type === 'result' ? 'idle' : undefined;
    },
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      const sessionId = stringField(value, 'session_id');
      if (sessionId && !sessionSent) {
        sessionSent = true;
        sentModel = modelOf(value).model;
        events.push({ type: 'session', sessionId, ...modelOf(value), ...modeOf(value) });
      }
      // A configured fallback answers with another model: the top-level reply names it.
      if (sessionId && value.type === 'assistant' && !stringField(value, 'parent_tool_use_id')) {
        const answered = isObject(value.message) ? stringField(value.message, 'model') : undefined;
        if (answered && answered !== '<synthetic>' && answered !== sentModel) {
          sentModel = answered;
          events.push({ type: 'session', sessionId, model: answered });
        }
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
              if (EDIT_TOOLS.has(block.name) && path)
                events.push({ type: 'file-change', paths: [path], ...(id ? { toolId: id } : {}) });
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
        case 'rate_limit_event':
          events.push(...claudeRateLimits(value.rate_limit_info));
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

const CLAUDE_WINDOWS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d-opus',
  seven_day_sonnet: '7d-sonnet',
  seven_day_overage_included: '7d-overage',
  overage: 'overage',
};

const CLAUDE_STATUS: Record<string, RateLimit['status']> = {
  allowed: 'ok',
  allowed_warning: 'warning',
  rejected: 'exceeded',
};

/**
 * `rate_limit_event.rate_limit_info` as `rate-limit` events: one per subscription window when
 * Claude lists them (`unifiedWindows`), else the window that limits now. `utilization` is 0-1.
 */
export function claudeRateLimits(info: unknown): AgentEvent[] {
  if (!isObject(info)) return [];
  const limit = (window: string, value: Record<string, unknown>, fallback?: unknown): AgentEvent => {
    const utilization = numberField(value, 'utilization');
    const usedPercent = utilization === undefined ? undefined : Math.round(utilization * 1000) / 10;
    const status = CLAUDE_STATUS[String(value.status ?? fallback)] ?? limitStatus(usedPercent);
    const resetsAt = epochMs(numberField(value, 'resetsAt'));
    return {
      type: 'rate-limit',
      limit: {
        window,
        status,
        ...(usedPercent !== undefined ? { usedPercent } : {}),
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      },
    };
  };
  const windows = isObject(info.unifiedWindows) ? info.unifiedWindows : undefined;
  const listed = windows
    ? Object.entries(windows).filter((entry): entry is [string, Record<string, unknown>] => isObject(entry[1]))
    : [];
  if (listed.length) {
    const limiting = stringField(info, 'rateLimitType');
    return listed.map(([key, value]) =>
      limit(CLAUDE_WINDOWS[key] ?? key, value, key === limiting ? info.status : undefined),
    );
  }
  const type = stringField(info, 'rateLimitType');
  if (!type && info.status === undefined) return [];
  return [limit(type ? (CLAUDE_WINDOWS[type] ?? type) : 'quota', info)];
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

function modeOf(value: Record<string, unknown>): { mode?: AgentMode } {
  return stringField(value, 'permissionMode') === 'plan' ? { mode: 'plan' } : {};
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
