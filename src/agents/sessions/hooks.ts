import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The agents whose hooks can report what a session is doing. */
export const HOOK_AGENTS = ['claude', 'codex'] as const;
export type HookAgent = (typeof HOOK_AGENTS)[number];

/** Ends every hook command genaicode installs: how its own entries are told from the user's. */
const MARKER = '--genaicode-live';

/** The events reported, per agent. `SessionEnd` is waited for; the rest run in the background. */
const EVENTS: Record<HookAgent, readonly string[]> = {
  claude: [
    'SessionStart',
    'UserPromptSubmit',
    'PermissionRequest',
    'Notification',
    'PostToolUse',
    'Stop',
    'SessionEnd',
  ],
  codex: ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'],
};

export interface HooksOptions {
  env?: NodeJS.ProcessEnv;
  /** The command a hook runs, without the agent: default `"<node>" "<this genaicode's cli.js>" hook`. */
  command?: string;
}

export interface HooksStatus {
  agent: HookAgent;
  /** The agent's file the hooks are declared in. */
  file: string;
  /** Events genaicode's hook is installed for. */
  events: string[];
  /** Whether every event is covered by the command this genaicode would install. */
  installed: boolean;
  /** The installed command, when there is one. */
  command?: string;
}

/** The file `agent` reads its user-level hooks from. */
export function hooksFile(agent: HookAgent, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return agent === 'claude'
    ? path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'), 'settings.json')
    : path.join(env.CODEX_HOME ?? path.join(home, '.codex'), 'hooks.json');
}

/** The command line of the hook for `agent`. */
export function hookCommand(agent: HookAgent, command: string): string {
  return `${command} ${agent} ${MARKER}`;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const ours = (handler: unknown): boolean =>
  isObject(handler) && typeof handler.command === 'string' && handler.command.endsWith(MARKER);

async function readConfig(file: string): Promise<Json> {
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (!source.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${file} is not valid JSON. Fix it first: it is left as it is.`);
  }
  if (!isObject(value)) throw new Error(`${file} does not hold a JSON object. It is left as it is.`);
  return value;
}

async function writeConfig(file: string, config: Json): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const mode = await fs.stat(file).then(
    (stat) => stat.mode & 0o777,
    () => 0o600,
  );
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode });
  await fs.rename(temporary, file);
}

/** `config` without genaicode's hook entries; what the user declared stays. */
function without(config: Json): Json {
  if (!isObject(config.hooks)) return config;
  const hooks: Json = {};
  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept = groups.flatMap((group: unknown) => {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(ours)) return [group];
      const handlers = group.hooks.filter((handler) => !ours(handler));
      return handlers.length ? [{ ...group, hooks: handlers }] : [];
    });
    if (kept.length) hooks[event] = kept;
  }
  const rest = { ...config };
  delete rest.hooks;
  return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

/** This package's own `cli.js`, whoever calls: the CLI or an app that imports `installHooks`. */
function defaultCommand(): string {
  const script = fileURLToPath(new URL('../../cli.js', import.meta.url));
  return `"${process.execPath}" "${script}" hook`;
}

function found(config: Json): { events: string[]; command?: string } {
  const events: string[] = [];
  let command: string | undefined;
  for (const [event, groups] of Object.entries(isObject(config.hooks) ? config.hooks : {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const handler = isObject(group) && Array.isArray(group.hooks) ? group.hooks.find(ours) : undefined;
      if (!isObject(handler)) continue;
      events.push(event);
      command = handler.command as string;
    }
  }
  return { events, ...(command ? { command } : {}) };
}

/** What is installed for `agent` now. */
export async function hooksStatus(agent: HookAgent, options: HooksOptions = {}): Promise<HooksStatus> {
  const file = hooksFile(agent, options.env);
  const { events, command } = found(await readConfig(file));
  const wanted = hookCommand(agent, options.command ?? defaultCommand());
  return {
    agent,
    file,
    events,
    installed: command === wanted && EVENTS[agent].every((event) => events.includes(event)),
    ...(command ? { command } : {}),
  };
}

/**
 * Declare genaicode's hook in the user-level hooks of `agent`, beside whatever is declared there.
 * An earlier install is replaced. The hook only notes what the session is doing (see `recordHook`).
 */
export async function installHooks(agent: HookAgent, options: HooksOptions = {}): Promise<HooksStatus> {
  const file = hooksFile(agent, options.env);
  const config = without(await readConfig(file));
  const command = hookCommand(agent, options.command ?? defaultCommand());
  const hooks: Json = isObject(config.hooks) ? { ...config.hooks } : {};
  for (const event of EVENTS[agent]) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const handler = { type: 'command', command, timeout: 10, ...(event === 'SessionEnd' ? {} : { async: true }) };
    hooks[event] = [...groups, { hooks: [handler] }];
  }
  await writeConfig(file, { ...config, hooks });
  return hooksStatus(agent, options);
}

/** Take genaicode's hook out of the hooks of `agent`. Resolves to whether there was one. */
export async function uninstallHooks(agent: HookAgent, options: HooksOptions = {}): Promise<boolean> {
  const file = hooksFile(agent, options.env);
  const config = await readConfig(file);
  if (!found(config).events.length) return false;
  await writeConfig(file, without(config));
  return true;
}
