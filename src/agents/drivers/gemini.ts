import { geminiSessions } from '../sessions/stores.js';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cliAgent, type AgentOutcome, type AgentOutputParser } from '../cli-agent.js';
import { exclusiveOption, resolvePermissions, type PermissionFlags } from '../permissions.js';
import { isHttpServer, type PreparedRun } from '../prepare.js';
import type { AgentEvent, AgentMode, AgentPermissions, AgentTask, CodingAgent, McpServer } from '../types.js';
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
  /**
   * With `task.mcpServers`: mark those servers trusted (`trust: true`) so headless runs can call
   * their tools without prompting. Default true; `trusted` servers are always marked trusted.
   */
  allowMcpTools?: boolean;
}

const EDIT_TOOLS = new Set(['replace', 'write_file', 'edit']);
const MAX_SETTINGS_BYTES = 1024 * 1024;

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
      mcp: true,
      permissions: { approval: ['auto-approve', 'deny'], sandbox: ['workspace-write', 'read-only', 'unrestricted'] },
    },
    args: (task) => geminiArgs(task, options),
    prepare: (task) => prepareGemini(task, options),
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

/**
 * The `mcpServers` block for Gemini CLI's `settings.json`.
 * Streamable HTTP servers use `httpUrl` (`url` is SSE in Gemini CLI); `timeout` is in ms.
 */
export function geminiMcpConfig(
  servers: readonly McpServer[],
  options: { allowMcpTools?: boolean } = {},
): { mcpServers: Record<string, unknown> } {
  const allowMcp = options.allowMcpTools ?? true;
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    const timeout = server.toolTimeoutSec ? { timeout: server.toolTimeoutSec * 1000 } : {};
    const trust = allowMcp || server.trusted ? { trust: true } : {};
    mcpServers[server.name] = isHttpServer(server)
      ? {
          httpUrl: server.url,
          ...(server.headers ? { headers: server.headers } : {}),
          ...timeout,
          ...trust,
        }
      : {
          command: server.command,
          args: [...(server.args ?? [])],
          ...(server.env ? { env: server.env } : {}),
          ...timeout,
          ...trust,
        };
  }
  return { mcpServers };
}

function defaultGeminiSystemSettingsPath(env: NodeJS.ProcessEnv): string {
  if (process.platform === 'darwin') return '/Library/Application Support/GeminiCli/settings.json';
  if (process.platform === 'win32') return join(env.ProgramData || 'C:\\ProgramData', 'gemini-cli', 'settings.json');
  return '/etc/gemini-cli/settings.json';
}

/** Strip `//` and `/* … *\/` comments outside JSON strings (matching Gemini CLI's JSONC loader). */
function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && next !== undefined) {
        out += next;
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') i += 1;
      if (i < input.length) out += input[i]!;
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      if (i >= input.length) throw new SyntaxError('Unterminated block comment');
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Read an existing Gemini system settings file (JSON or JSONC). Missing files (`ENOENT`/`ENOTDIR`)
 * return undefined; an existing file that cannot be read or parsed throws instead of silently
 * dropping system overrides.
 */
function readSettingsFile(file: string): Record<string, unknown> | undefined {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw new Error(
      `Cannot read existing Gemini system settings at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stat.isFile()) {
    throw new Error(`Existing Gemini system settings at ${file} is not a regular file.`);
  }
  if (stat.size > MAX_SETTINGS_BYTES) {
    throw new Error(`Existing Gemini system settings at ${file} exceeds ${MAX_SETTINGS_BYTES} bytes.`);
  }
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read existing Gemini system settings at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(content.replace(/^\uFEFF/, '')));
  } catch (error) {
    throw new Error(
      `Existing Gemini system settings at ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isObject(parsed)) {
    throw new Error(`Existing Gemini system settings at ${file} must be a JSON object.`);
  }
  return parsed;
}

/**
 * Hand Gemini CLI the task's MCP servers via a private temp settings file pointed to by
 * `GEMINI_CLI_SYSTEM_SETTINGS_PATH`. Gemini merges `mcpServers` with user and project settings
 * without touching either; any existing system settings file is preserved in the temp copy,
 * `GEMINI_CLI_SYSTEM_DEFAULTS_PATH` is pinned to the original defaults file when unset, and
 * header/env secrets stay out of argv.
 */
function prepareGemini(task: AgentTask, options: GeminiAgentOptions): PreparedRun {
  const args = geminiArgs(task, options);
  const { env: permEnv } = geminiPermissionFlags(resolvePermissions(task.permissions));
  if (!task.mcpServers?.length) return { args, ...(permEnv ? { env: permEnv } : {}) };

  const baseEnv = task.env ?? process.env;
  const existingPath = baseEnv.GEMINI_CLI_SYSTEM_SETTINGS_PATH || defaultGeminiSystemSettingsPath(baseEnv);
  const existing = readSettingsFile(existingPath);
  const existingMcp = isObject(existing?.mcpServers) ? existing.mcpServers : {};
  const config = geminiMcpConfig(task.mcpServers, { allowMcpTools: options.allowMcpTools });
  const merged = { ...(existing ?? {}), mcpServers: { ...existingMcp, ...config.mcpServers } };
  const dir = mkdtempSync(join(tmpdir(), 'genaicode-gemini-mcp-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify(merged), { mode: 0o600 });
    const env: Record<string, string> = { ...(permEnv ?? {}), GEMINI_CLI_SYSTEM_SETTINGS_PATH: file };
    // Gemini derives system-defaults.json from dirname(GEMINI_CLI_SYSTEM_SETTINGS_PATH) when
    // GEMINI_CLI_SYSTEM_DEFAULTS_PATH is unset; preserve the original directory's defaults path.
    if (!baseEnv.GEMINI_CLI_SYSTEM_DEFAULTS_PATH) {
      env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH = join(dirname(existingPath), 'system-defaults.json');
    }
    return {
      args,
      env,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
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
  let sessionId: string | undefined;
  let initModel: string | undefined;

  return {
    outcome: () => outcome,
    event(value) {
      if (!isObject(value)) return [];
      const events: AgentEvent[] = [];
      switch (value.type) {
        case 'init': {
          sessionId = stringField(value, 'session_id');
          initModel = stringField(value, 'model');
          if (sessionId) events.push({ type: 'session', sessionId, ...(initModel ? { model: initModel } : {}) });
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
          // The CLI can answer with another model than it started on: its stats name the one(s) used.
          const used = isObject(stats) && isObject(stats.models) ? Object.keys(stats.models) : [];
          if (sessionId && used.length === 1 && used[0] !== initModel) {
            initModel = used[0];
            events.push({ type: 'session', sessionId, model: used[0]! });
          } else if (sessionId && used.length > 1 && (!initModel || !used.includes(initModel))) {
            // Several models, none the one reported: no single name is right, so report none.
            initModel = undefined;
            events.push({ type: 'session', sessionId, model: undefined });
          }
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
