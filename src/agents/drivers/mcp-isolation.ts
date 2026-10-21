import { execFile } from 'node:child_process';
import type { AgentTask } from '../types.js';

/**
 * Names of the MCP servers an agent CLI would load on its own (user, workspace and plugin
 * config), from its `mcp list --json`, so a run can switch off every server but the task's.
 * Throws when the list cannot be read: a run that must be isolated does not start without it.
 */
export function configuredMcpServers<T extends string | { name: string }>(
  command: string,
  task: AgentTask,
  servers: (listing: unknown) => T[],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    // `task.env` replaces the environment, as it does for the run itself: what the caller left out stays out.
    execFile(
      command,
      ['mcp', 'list', '--json'],
      { cwd: task.cwd, env: task.env ?? process.env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error(`could not list ${command}'s MCP servers: ${error.message}`));
        try {
          const own = new Set((task.mcpServers ?? []).map((server) => server.name));
          const nameOf = (server: T) => (typeof server === 'string' ? server : server.name);
          resolve(servers(JSON.parse(String(stdout)) as unknown).filter((server) => !own.has(nameOf(server))));
        } catch (parseError) {
          reject(new Error(`could not read ${command}'s MCP server list: ${(parseError as Error).message}`));
        }
      },
    );
  });
}
