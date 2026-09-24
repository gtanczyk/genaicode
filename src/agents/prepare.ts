import type { AgentCapabilities, AgentTask, McpServer } from './types.js';

/** Everything a driver needs to start one task's process. */
export interface PreparedRun {
  args: string[];
  /** Extra environment variables for the child. */
  env?: Record<string, string>;
  /** Called once the process has exited (temp files, for example). */
  cleanup?(): void;
}

const MCP_NAME = /^[A-Za-z0-9_-]+$/;

/** Reject a task the agent cannot honor before anything is spawned. */
export function unsupportedTask(name: string, capabilities: AgentCapabilities, task: AgentTask): string | undefined {
  const servers = task.mcpServers ?? [];
  if (servers.length && !capabilities.mcp) return `${name} does not support MCP servers in this driver.`;
  const names = new Set<string>();
  for (const server of servers) {
    if (!MCP_NAME.test(server.name)) return `Invalid MCP server name: ${JSON.stringify(server.name)}.`;
    if (names.has(server.name)) return `Duplicate MCP server name: ${server.name}.`;
    names.add(server.name);
  }
  return undefined;
}

export function isHttpServer(server: McpServer): server is Extract<McpServer, { url: string }> {
  return 'url' in server;
}

interface SpawnDefinition {
  name: string;
  capabilities?: AgentCapabilities;
  args(task: AgentTask): string[];
  prepare?(task: AgentTask): PreparedRun;
  env?(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
}

export type SpawnPlan =
  | { ok: true; args: string[]; env: NodeJS.ProcessEnv; cleanup(): void }
  | { ok: false; error: string };

/** Check the task, then resolve arguments and environment for the child process. */
export function planSpawn(definition: SpawnDefinition, task: AgentTask, cwdError: string | undefined): SpawnPlan {
  const refused = unsupportedTask(definition.name, definition.capabilities ?? {}, task) ?? cwdError;
  if (refused) return { ok: false, error: refused };
  let prepared: PreparedRun;
  try {
    prepared = definition.prepare ? definition.prepare(task) : { args: definition.args(task) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const base = task.env ?? process.env;
  const env = { ...(definition.env ? definition.env(base) : base), ...prepared.env };
  let cleaned = false;
  return {
    ok: true,
    args: prepared.args,
    env,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        prepared.cleanup?.();
      } catch {
        // Best effort: a leftover temp file must not change the task's result.
      }
    },
  };
}
