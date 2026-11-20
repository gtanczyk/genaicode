import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_EVENTS } from './hook-input.js';

/** The agents whose hooks can report what a session is doing. */
export const HOOK_AGENTS = ['claude', 'codex', 'gemini', 'copilot', 'cursor'] as const;
export type HookAgent = (typeof HOOK_AGENTS)[number];

/** Ends every hook command genaicode installs: how its own entries are told from the user's. */
const MARKER = '--genaicode-live';
/** Marks the hook that holds a question open for the tower (`--answer`). */
const ANSWER = '--answer';

/**
 * The events reported, per agent, in the agent's own words. Claude Code and Codex wait for
 * `SessionEnd` and run the rest in the background; the others run hooks as they come.
 */
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
  ...AGENT_EVENTS,
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

/**
 * The file `agent` reads its user-level hooks from. Copilot reads every file in
 * `~/.copilot/hooks`, so genaicode's are in one of their own.
 */
export function hooksFile(agent: HookAgent, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  switch (agent) {
    case 'claude':
      return path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'), 'settings.json');
    case 'codex':
      return path.join(env.CODEX_HOME ?? path.join(home, '.codex'), 'hooks.json');
    case 'gemini':
      return path.join(env.GEMINI_CLI_HOME ?? home, '.gemini', 'settings.json');
    case 'copilot':
      return path.join(env.COPILOT_HOME ?? path.join(home, '.copilot'), 'hooks', 'genaicode.json');
    case 'cursor':
      return path.join(home, '.cursor', 'hooks.json');
  }
}

/**
 * The command line of the hook for `agent`; `answer`: the one that holds a question open;
 * `event`: for Copilot, whose hooks are not told which event they run for.
 */
export function hookCommand(agent: HookAgent, command: string, answer = false, event?: string): string {
  return `${command} ${agent}${event ? ` ${event}` : ''}${answer ? ` ${ANSWER}` : ''} ${MARKER}`;
}

/** The hook's command for `event` of `agent`. */
const commandFor = (agent: HookAgent, command: string, event: string) =>
  hookCommand(agent, command, false, agent === 'copilot' ? event : undefined);

/** Copilot and Cursor list handlers under each event; the others list groups of them (`{ hooks: [...] }`). */
const FLAT: readonly HookAgent[] = ['copilot', 'cursor'];

/** The agents whose dialog stays open while a hook holds the question: Codex would wait instead. */
export const ANSWER_AGENTS: readonly HookAgent[] = ['claude'];
/** How long Claude Code waits for that hook, seconds; it gives up a minute before. */
const ANSWER_TIMEOUT = 600;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** A handler's command line: Copilot's is under `bash` (and `powershell`). */
const commandOf = (handler: unknown): string | undefined =>
  !isObject(handler)
    ? undefined
    : typeof handler.command === 'string'
      ? handler.command
      : typeof handler.bash === 'string'
        ? handler.bash
        : undefined;
const ours = (handler: unknown): boolean => commandOf(handler)?.endsWith(MARKER) === true;

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
      if (ours(group)) return [];
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

/** The handlers declared for one event: in groups, or listed as they are (Copilot, Cursor). */
function handlersOf(groups: unknown): unknown[] {
  return (Array.isArray(groups) ? groups : []).flatMap((group: unknown) =>
    isObject(group) && Array.isArray(group.hooks) ? (group.hooks as unknown[]) : [group],
  );
}

/** This package's own `cli.js`, whoever calls: the CLI or an app that imports `installHooks`. */
function defaultCommand(): string {
  const script = fileURLToPath(new URL('../../cli.js', import.meta.url));
  return `"${process.execPath}" "${script}" hook`;
}

function found(config: Json): { events: string[]; commands: Map<string, string>; answer?: string } {
  const events: string[] = [];
  const commands = new Map<string, string>();
  let answer: string | undefined;
  for (const [event, groups] of Object.entries(isObject(config.hooks) ? config.hooks : {})) {
    for (const handler of handlersOf(groups).filter(ours)) {
      const command = commandOf(handler)!;
      if (command.endsWith(`${ANSWER} ${MARKER}`)) {
        answer = command;
        continue;
      }
      if (!events.includes(event)) events.push(event);
      commands.set(event, command);
    }
  }
  return { events, commands, ...(answer ? { answer } : {}) };
}

/** What is installed for `agent` now. */
export async function hooksStatus(agent: HookAgent, options: HooksOptions = {}): Promise<HooksStatus> {
  const file = hooksFile(agent, options.env);
  const { events, commands, answer } = found(await readConfig(file));
  const base = options.command ?? defaultCommand();
  const command = [...commands.values()].pop();
  return {
    agent,
    file,
    events,
    installed: EVENTS[agent].every((event) => commands.get(event) === commandFor(agent, base, event)),
    ...(command ? { command } : {}),
    answer: answer === hookCommand(agent, base, true),
  };
}

/**
 * Declare genaicode's hook in the user-level hooks of `agent`, beside whatever is declared there.
 * An earlier install is replaced. The hook only notes what the session is doing (see `recordHook`).
 */
export async function installHooks(agent: HookAgent, options: HooksOptions = {}): Promise<HooksStatus> {
  const file = hooksFile(agent, options.env);
  const config = without(await readConfig(file));
  const base = options.command ?? defaultCommand();
  const hooks: Json = isObject(config.hooks) ? { ...config.hooks } : {};
  for (const event of EVENTS[agent]) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const handler = handlerFor(agent, commandFor(agent, base, event), event);
    hooks[event] = [...groups, FLAT.includes(agent) ? handler : { hooks: [handler] }];
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
  // Copilot and Cursor want to know which version of the file's format they read.
  await writeConfig(file, { ...(FLAT.includes(agent) ? { version: 1 } : {}), ...config, hooks });
  return hooksStatus(agent, options);
}

/** One handler, in the agent's own format. */
function handlerFor(agent: HookAgent, command: string, event: string): Json {
  switch (agent) {
    case 'claude':
    case 'codex':
      // Codex gives an `Interrupt` hook three seconds at most.
      return {
        type: 'command',
        command,
        timeout: event === 'Interrupt' ? 3 : 10,
        ...(event === 'SessionEnd' ? {} : { async: true }),
      };
    case 'gemini':
      // Milliseconds; the name is how `/hooks` lists it.
      return { type: 'command', name: 'genaicode', command, timeout: 10_000 };
    case 'copilot':
      return { type: 'command', bash: command, powershell: `& ${command}`, timeoutSec: 10 };
    case 'cursor':
      return { command, timeout: 10 };
  }
}

/** Take genaicode's hook out of the hooks of `agent`. Resolves to whether there was one. */
export async function uninstallHooks(agent: HookAgent, options: HooksOptions = {}): Promise<boolean> {
  const file = hooksFile(agent, options.env);
  const config = await readConfig(file);
  const { events, answer } = found(config);
  if (!events.length && !answer) return false;
  const left = without(config);
  // A file only genaicode's hooks were in goes with them, and so does Copilot's folder for them.
  if (Object.keys(left).every((key) => key === 'version')) {
    await fs.rm(file, { force: true });
    if (agent === 'copilot') await fs.rmdir(path.dirname(file)).catch(() => undefined);
  } else await writeConfig(file, left);
  return true;
}
