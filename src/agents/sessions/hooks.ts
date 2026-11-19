import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The agents whose hooks can report what a session is doing. */
export const HOOK_AGENTS = ['claude', 'codex'] as const;
export type HookAgent = (typeof HOOK_AGENTS)[number];

/** Ends every hook command genaicode installs: how its own entries are told from the user's. */
const MARKER = '--genaicode-live';
/** Marks the hook that holds a question open for the tower (`--answer`). */
const ANSWER = '--answer';

/** The events reported, per agent. `SessionEnd` is waited for; the rest run in the background. */
const EVENTS: Record<HookAgent, readonly string[]> = {
  claude: [
    'SessionStart',
    'UserPromptSubmit',
    'PermissionRequest',
    'Notification',
    'PostToolUse',
    'PostToolUseFailure',
    'Stop',
    // A turn an API error ended: without it the session would look busy.
    'StopFailure',
    'SessionEnd',
  ],
  codex: ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'],
};

export interface HooksOptions {
  env?: NodeJS.ProcessEnv;
  /** The command a hook runs, without the agent: default `"<node>" "<this genaicode's cli.js>" hook`. */
  command?: string;
  /**
   * Also hold each question open so it can be answered from the tower (`genaicode sessions
   * approve`, the browser): Claude Code only. Its dialog shows as before; the first answer counts.
   */
  answer?: boolean;
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
  /** Whether questions can be answered from the tower too (`--answer`). */
  answer: boolean;
}

/** The file `agent` reads its user-level hooks from. */
export function hooksFile(agent: HookAgent, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return agent === 'claude'
    ? path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'), 'settings.json')
    : path.join(env.CODEX_HOME ?? path.join(home, '.codex'), 'hooks.json');
}

/** The command line of the hook for `agent`; `answer`: the one that holds a question open. */
export function hookCommand(agent: HookAgent, command: string, answer = false): string {
  return `${command} ${agent}${answer ? ` ${ANSWER}` : ''} ${MARKER}`;
}

/** The agents whose dialog stays open while a hook holds the question: Codex would wait instead. */
export const ANSWER_AGENTS: readonly HookAgent[] = ['claude'];
/** How long Claude Code waits for that hook, seconds; it gives up a minute before. */
const ANSWER_TIMEOUT = 600;

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

const answering = (handler: unknown): boolean =>
  ours(handler) && String((handler as Json).command).endsWith(`${ANSWER} ${MARKER}`);

function found(config: Json): { events: string[]; command?: string; answer?: string } {
  const events: string[] = [];
  let command: string | undefined;
  let answer: string | undefined;
  for (const [event, groups] of Object.entries(isObject(config.hooks) ? config.hooks : {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const handler of isObject(group) && Array.isArray(group.hooks) ? group.hooks.filter(ours) : []) {
        if (answering(handler)) {
          answer = (handler as Json).command as string;
          continue;
        }
        if (!events.includes(event)) events.push(event);
        command = (handler as Json).command as string;
      }
    }
  }
  return { events, ...(command ? { command } : {}), ...(answer ? { answer } : {}) };
}

/** What is installed for `agent` now. */
export async function hooksStatus(agent: HookAgent, options: HooksOptions = {}): Promise<HooksStatus> {
  const file = hooksFile(agent, options.env);
  const { events, command, answer } = found(await readConfig(file));
  const wanted = hookCommand(agent, options.command ?? defaultCommand());
  return {
    agent,
    file,
    events,
    installed: command === wanted && EVENTS[agent].every((event) => events.includes(event)),
    ...(command ? { command } : {}),
    answer: answer === hookCommand(agent, options.command ?? defaultCommand(), true),
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
    // Codex gives an `Interrupt` hook three seconds at most.
    const handler = {
      type: 'command',
      command,
      timeout: event === 'Interrupt' ? 3 : 10,
      ...(event === 'SessionEnd' ? {} : { async: true }),
    };
    hooks[event] = [...groups, { hooks: [handler] }];
  }
  if (options.answer && ANSWER_AGENTS.includes(agent)) {
    // Waited for: it holds the question while the agent's dialog shows it too.
    const handler = {
      type: 'command',
      command: hookCommand(agent, options.command ?? defaultCommand(), true),
      timeout: ANSWER_TIMEOUT,
    };
    hooks.PermissionRequest = [...(hooks.PermissionRequest as unknown[]), { hooks: [handler] }];
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
