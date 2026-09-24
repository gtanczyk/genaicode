import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { CodingAgent } from './types.js';

/** Resolve an executable the way a shell would: absolute path, or the first match on PATH. */
export function findExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const windows = process.platform === 'win32';
  const extensions = windows ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  const candidates = isAbsolute(command)
    ? extensions.map((extension) => command + extension)
    : (env.PATH ?? env.Path ?? '')
        .split(delimiter)
        .filter(Boolean)
        .flatMap((dir) => extensions.map((extension) => join(dir, command + extension)));
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      if (!windows) accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
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
