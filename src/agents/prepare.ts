import { unsupportedPermissions } from './permissions.js';
import type { AgentCapabilities, AgentEvent, AgentTask, McpServer } from './types.js';

/** Everything a driver needs to start one task's process. */
export interface PreparedRun {
  args: string[];
  /** Extra environment variables for the child. */
  env?: Record<string, string>;
  /** Called once the process has exited (temp files, for example). */
  cleanup?(): void;
}

/** What `prepare` can use beyond the task. */
export interface PrepareContext {
  /** Add an event to the run's stream. */
  emit(event: AgentEvent): void;
  /** Aborts once the task is over: the process exited, or it was stopped before it started. */
  readonly signal: AbortSignal;
}

const MCP_NAME = /^[A-Za-z0-9_-]+$/;

/** Reject a task the agent cannot honor before anything is spawned. */
export function unsupportedTask(name: string, capabilities: AgentCapabilities, task: AgentTask): string | undefined {
  const servers = task.mcpServers ?? [];
  if (task.resume !== undefined && !capabilities.resume) return `${name} cannot resume a session in this driver.`;
  if (task.resume !== undefined && !task.resume.trim()) return 'Empty session id in task.resume.';
  if (servers.length && !capabilities.mcp) return `${name} does not support MCP servers in this driver.`;
  const names = new Set<string>();
  for (const server of servers) {
    if (!MCP_NAME.test(server.name)) return `Invalid MCP server name: ${JSON.stringify(server.name)}.`;
    if (names.has(server.name)) return `Duplicate MCP server name: ${server.name}.`;
    names.add(server.name);
  }
  return unsupportedPermissions(name, capabilities, task);
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
  try {
    return spawnPlan(definition, task, definition.prepare ? definition.prepare(task) : { args: definition.args(task) });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** `planSpawn` for a `prepare` that may need to wait (start a server, for example). */
export async function planSpawnAsync(
  definition: Omit<SpawnDefinition, 'prepare'> & {
    prepare?(task: AgentTask, context: PrepareContext): PreparedRun | Promise<PreparedRun>;
  },
  task: AgentTask,
  cwdError: string | undefined,
  context: PrepareContext,
): Promise<SpawnPlan> {
  const refused = unsupportedTask(definition.name, definition.capabilities ?? {}, task) ?? cwdError;
  if (refused) return { ok: false, error: refused };
  try {
    const prepared = definition.prepare ? await definition.prepare(task, context) : { args: definition.args(task) };
    return spawnPlan(definition, task, prepared);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function spawnPlan(
  definition: Pick<SpawnDefinition, 'env'>,
  task: AgentTask,
  prepared: PreparedRun,
): Extract<SpawnPlan, { ok: true }> {
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
