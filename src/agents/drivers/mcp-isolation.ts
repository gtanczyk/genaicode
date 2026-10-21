import { execFile } from 'node:child_process';
import type { AgentTask } from '../types.js';

/**
 * Names of the MCP servers an agent CLI would load on its own (user, workspace and plugin
 * config), from its `mcp list --json`, so a run can switch off every server but the task's.
 * Throws when the list cannot be read: a run that must be isolated does not start without it.
 */
export function configuredMcpServers(
  command: string,
  task: AgentTask,
  names: (listing: unknown) => string[],
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ['mcp', 'list', '--json'],
      { cwd: task.cwd, env: { ...process.env, ...task.env }, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error(`could not list ${command}'s MCP servers: ${error.message}`));
        try {
          const own = new Set((task.mcpServers ?? []).map((server) => server.name));
          resolve(names(JSON.parse(String(stdout)) as unknown).filter((name) => !own.has(name)));
        } catch (parseError) {
          reject(new Error(`could not read ${command}'s MCP server list: ${(parseError as Error).message}`));
        }
      },
    );
  });
}
