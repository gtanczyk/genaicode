import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import type { CodingAgent } from './types.js';

/** Resolve all distinct executables matching `command` in PATH precedence order. */
export function findAllExecutables(command: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const windows = process.platform === 'win32';
  const extensions = windows ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  const candidates = isAbsolute(command)
    ? extensions.map((extension) => command + extension)
    : (env.PATH ?? env.Path ?? '')
        .split(delimiter)
        .filter(Boolean)
        .flatMap((dir) => extensions.map((extension) => join(dir, command + extension)));
  const found: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      if (!windows) accessSync(candidate, constants.X_OK);
      let real: string;
      try {
        real = realpathSync(candidate);
      } catch {
        real = resolve(candidate);
      }
      if (seen.has(real)) continue;
      seen.add(real);
      found.push(candidate);
    } catch {
      continue;
    }
  }
  return found;
}

/** Resolve an executable the way a shell would: absolute path, or the first match on PATH. */
export function findExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return findAllExecutables(command, env)[0] ?? null;
}

export interface AgentAvailability {
  agent: CodingAgent;
  /** Resolved executable, or null when the agent's command is not installed. */
  path: string | null;
}

/** Report which agents have their CLI installed. Presence only; login and flags are the agent's concern. */
export function detectAgents(
  agents: readonly CodingAgent[],
  env: NodeJS.ProcessEnv = process.env,
): AgentAvailability[] {
  return agents.map((agent) => ({ agent, path: findExecutable(agent.command, env) }));
}
