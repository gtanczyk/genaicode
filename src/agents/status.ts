import { execFile } from 'node:child_process';
import { findAllExecutables } from './discovery.js';
import { agentGuide, agentOrder, type AgentGuide } from './drivers/catalog.js';
import type { CodingAgent } from './types.js';

/**
 * Local sign-in state for an installed agent CLI:
 * - `ready`: cheap local check confirmed the CLI is signed in (or has a key).
 * - `signed-out`: cheap local check confirmed the CLI is not signed in.
 * - `unknown`: no cheap local check is available yet, or the check could not determine it.
 */
export type AgentAuthState = 'ready' | 'signed-out' | 'unknown';

/** Detailed local status of one supported coding agent (never invokes a model). */
export interface AgentInspection {
  name: string;
  command: string;
  installed: boolean;
  /** First matching executable on PATH, when installed. */
  path?: string;
  /** Additional distinct executables found later on PATH (e.g. Homebrew + npm global). */
  otherPaths?: string[];
  /** Version reported by `<command> --version`, when recognized. */
  version?: string;
  auth: AgentAuthState;
  /** True when the binary exists on PATH but failed to execute (wrong arch, broken install, etc.). */
  broken?: boolean;
  /** Plan or auth method reported by the CLI (e.g. `Max`, `Pro`, `ChatGPT`, `API key`). */
  plan?: string;
  /** Actionable note: broken binary error, additional installs on PATH, or config issue. */
  hint?: string;
  /** Static install/sign-in guide from the driver catalog. */
  guide: AgentGuide;
}

export interface InspectOptions {
  /** Timeout per CLI probe (`--version`, `auth status`, `login status`) in ms. Default 5,000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const VERSION_RE = /\d+\.\d+(?:\.\d+)?/;

/** Whether an inspected agent can be chosen to run a prompt right now. */
export function isAgentUsable(agent: Pick<AgentInspection, 'installed' | 'broken' | 'auth'>): boolean {
  return agent.installed && !agent.broken && agent.auth !== 'signed-out';
}

interface ProbeOutput {
  error: (NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | null }) | null;
  stdout: string;
  stderr: string;
}

function runProbe(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ProbeOutput> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { env, timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          error: error as ProbeOutput['error'],
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
        });
      },
    );
  });
}

function firstLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 240);
  }
  return undefined;
}

function brokenHint(probe: ProbeOutput): string {
  const fromOutput = firstLine(probe.stderr) ?? firstLine(probe.stdout);
  if (fromOutput) return fromOutput;
  const err = probe.error;
  if (!err) return 'Binary failed to run.';
  if (err.killed) return 'Timed out while checking the binary.';
  if (err.code === 'ENOEXEC') return 'Exec format error (wrong architecture or corrupted binary).';
  if (err.code === 'EACCES') return 'Permission denied running this binary.';
  return firstLine(err.message) ?? 'Binary failed to run.';
}

function formatClaudePlan(parsed: Record<string, unknown>): string | undefined {
  const sub = typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType.trim().toLowerCase() : '';
  if (sub === 'max') return 'Max';
  if (sub === 'pro') return 'Pro';
  if (sub === 'team') return 'Team';
  if (sub === 'enterprise') return 'Enterprise';
  if (sub && sub !== 'none') return sub;
  const method = typeof parsed.authMethod === 'string' ? parsed.authMethod.trim().toLowerCase() : '';
  if (method === 'api_key') return 'API key';
  if (method === 'claude.ai' || method === 'oauth') return 'Claude';
  return method && method !== 'none' ? method : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function checkClaudeAuth(
  command: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ auth: AgentAuthState; plan?: string; hint?: string }> {
  const probe = await runProbe(command, ['auth', 'status'], env, timeoutMs);
  const parsed = parseJsonObject(probe.stdout) ?? parseJsonObject(probe.stderr);
  if (parsed && typeof parsed.loggedIn === 'boolean') {
    if (parsed.loggedIn) {
      const plan = formatClaudePlan(parsed);
      return { auth: 'ready', ...(plan ? { plan } : {}) };
    }
    return { auth: 'signed-out' };
  }
  const combined = `${probe.stdout}\n${probe.stderr}`;
  if (/\bnot (logged|signed) in\b/i.test(combined)) return { auth: 'signed-out' };
  if (!probe.error && /\blogged in\b/i.test(combined)) return { auth: 'ready' };
  // Older CLI without `auth status` (or non-JSON output): check standard env credentials without claiming sign-out.
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { auth: 'ready', plan: env.ANTHROPIC_API_KEY ? 'API key' : 'OAuth token' };
  }
  return { auth: 'unknown' };
}

async function checkCodexAuth(
  command: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ auth: AgentAuthState; plan?: string; hint?: string }> {
  const probe = await runProbe(command, ['login', 'status'], env, timeoutMs);
  // Codex prints login status to stderr (and may use stdout in other versions).
  const combined = `${probe.stdout}\n${probe.stderr}`;
  if (/\bnot logged in\b/i.test(combined)) return { auth: 'signed-out' };
  if (!probe.error && /\blogged in\b/i.test(combined)) {
    const plan = /chatgpt/i.test(combined) ? 'ChatGPT' : /api[ _-]?key/i.test(combined) ? 'API key' : undefined;
    return { auth: 'ready', ...(plan ? { plan } : {}) };
  }
  if (probe.error) {
    const detail = firstLine(probe.stderr) ?? firstLine(probe.stdout);
    // Surface configuration errors without misclassifying them as signed-out.
    if (detail && /error loading configuration/i.test(detail)) {
      return { auth: 'unknown', hint: detail };
    }
  }
  return { auth: 'unknown' };
}

/**
 * Inspect one coding agent CLI: presence (and additional installs on PATH), `--version` health,
 * and cheap local sign-in status where supported (`claude`, `codex`). Never invokes a model.
 */
export async function inspectAgent(
  agent: Pick<CodingAgent, 'name' | 'command'>,
  env: NodeJS.ProcessEnv = process.env,
  options: InspectOptions = {},
): Promise<AgentInspection> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const guide = agentGuide(agent.name, agent.command);
  const paths = findAllExecutables(agent.command, env);
  if (!paths.length) {
    return { name: agent.name, command: agent.command, installed: false, auth: 'unknown', guide };
  }
  const [path, ...otherPaths] = paths;
  const otherHint = otherPaths.length ? `Also installed at ${otherPaths.join(', ')}` : undefined;

  const versionProbe = await runProbe(path!, ['--version'], env, timeoutMs);
  if (versionProbe.error) {
    const errorHint = brokenHint(versionProbe);
    const hint = otherHint ? `${errorHint} (${otherHint})` : errorHint;
    return {
      name: agent.name,
      command: agent.command,
      installed: true,
      path,
      ...(otherPaths.length ? { otherPaths } : {}),
      auth: 'unknown',
      broken: true,
      hint,
      guide,
    };
  }
  const version = VERSION_RE.exec(`${versionProbe.stdout}\n${versionProbe.stderr}`)?.[0];

  let authResult: { auth: AgentAuthState; plan?: string; hint?: string } = { auth: 'unknown' };
  if (agent.name === 'claude') {
    authResult = await checkClaudeAuth(path!, env, timeoutMs);
  } else if (agent.name === 'codex') {
    authResult = await checkCodexAuth(path!, env, timeoutMs);
  }

  const hints = [authResult.hint, otherHint].filter((part): part is string => !!part);
  return {
    name: agent.name,
    command: agent.command,
    installed: true,
    path,
    ...(otherPaths.length ? { otherPaths } : {}),
    ...(version ? { version } : {}),
    auth: authResult.auth,
    ...(authResult.plan ? { plan: authResult.plan } : {}),
    ...(hints.length ? { hint: hints.join(' · ') } : {}),
    guide,
  };
}

/**
 * Inspect all given agents in parallel and return them in canonical onboarding order
 * (Claude Code, Codex, Copilot, Antigravity, Muse, Gemini, Cursor, opencode, vibe, then custom).
 */
export async function inspectAgents(
  agents: readonly Pick<CodingAgent, 'name' | 'command'>[],
  env: NodeJS.ProcessEnv = process.env,
  options: InspectOptions = {},
): Promise<AgentInspection[]> {
  const unique: Array<{ agent: Pick<CodingAgent, 'name' | 'command'>; index: number }> = [];
  const seen = new Set<string>();
  agents.forEach((agent, index) => {
    if (seen.has(agent.name)) return;
    seen.add(agent.name);
    unique.push({ agent, index });
  });
  const ordered = unique.sort(
    (a, b) =>
      agentOrder(a.agent.name, a.agent.command) - agentOrder(b.agent.name, b.agent.command) || a.index - b.index,
  );
  return Promise.all(ordered.map(({ agent }) => inspectAgent(agent, env, options)));
}

export interface AgentInspectorOptions {
  agents: readonly Pick<CodingAgent, 'name' | 'command'>[];
  /** Returns the current environment (so desktop env refreshes take effect immediately). */
  getEnv: () => NodeJS.ProcessEnv;
  /** Optional hook to re-read the desktop login shell environment before an explicit refresh. */
  refreshEnv?: () => Promise<void>;
  /** Cache lifetime in milliseconds. Default 5,000. */
  ttlMs?: number;
  /** Per-CLI probe timeout in milliseconds. Default 5,000. */
  timeoutMs?: number;
  /** Called whenever a fresh inspection finishes. */
  onUpdate?: (agents: AgentInspection[]) => void;
}

export interface AgentInspector {
  check(options?: { refresh?: boolean; refreshEnv?: boolean }): Promise<{ agents: AgentInspection[]; setup: boolean }>;
  invalidate(): void;
}

/**
 * Cached, non-overlapping local agent inspector for `GET /api/agents`.
 * Keeps results for a few seconds so rapid UI polls do not repeatedly spawn CLIs.
 */
export function createAgentInspector(options: AgentInspectorOptions): AgentInspector {
  const ttlMs = options.ttlMs ?? 5_000;
  let cached: { at: number; agents: AgentInspection[] } | undefined;
  let inFlight: Promise<{ agents: AgentInspection[]; setup: boolean }> | undefined;
  let generation = 0;

  const run = async (refreshEnv: boolean): Promise<{ agents: AgentInspection[]; setup: boolean }> => {
    const mine = ++generation;
    if (refreshEnv && options.refreshEnv) {
      await options.refreshEnv().catch(() => undefined);
    }
    const agents = await inspectAgents(options.agents, options.getEnv(), {
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    if (mine === generation) {
      cached = { at: Date.now(), agents };
      options.onUpdate?.(agents);
    }
    return { agents, setup: !agents.some(isAgentUsable) };
  };

  return {
    check(req = {}) {
      const force = req.refresh === true || req.refreshEnv === true;
      if (!force && cached && Date.now() - cached.at < ttlMs) {
        return Promise.resolve({ agents: cached.agents, setup: !cached.agents.some(isAgentUsable) });
      }
      if (!force && inFlight) return inFlight;
      const promise = run(req.refreshEnv === true).finally(() => {
        if (inFlight === promise) inFlight = undefined;
      });
      inFlight = promise;
      return promise;
    },
    invalidate() {
      cached = undefined;
    },
  };
}
