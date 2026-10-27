import { isHttpServer, type PreparedRun } from '../prepare.js';
import type { AgentTask, McpServer } from '../types.js';

/**
 * `-c` overrides that give Muse the task's MCP servers for one run (`muse exec` and `muse serve` take the
 * same repeatable `-c key=value`). Secrets never go on the command line: header values and a stdio
 * server's `env` values travel in environment variables, referenced as `${VAR}`, which Muse expands.
 */
export function museMcpOverrides(servers: readonly McpServer[]): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const env: Record<string, string> = {};
  const set = (key: string, value: unknown) => args.push('-c', `${key}=${JSON.stringify(value)}`);
  servers.forEach((server, index) => {
    const key = `mcp_servers.${server.name}`;
    if (isHttpServer(server)) {
      set(`${key}.transport`, 'streamable_http');
      set(`${key}.url`, server.url);
      Object.entries(server.headers ?? {}).forEach(([header, value], headerIndex) => {
        const variable = `GENAICODE_MCP_${index}_HEADER_${headerIndex}`;
        env[variable] = value;
        set(`${key}.headers.${header}`, `\${${variable}}`);
      });
    } else {
      set(`${key}.transport`, 'stdio');
      set(`${key}.command`, server.command);
      set(`${key}.args`, server.args ?? []);
      Object.entries(server.env ?? {}).forEach(([name, value], envIndex) => {
        const variable = `GENAICODE_MCP_${index}_ENV_${envIndex}`;
        env[variable] = value;
        set(`${key}.env.${name}`, `\${${variable}}`);
      });
    }
  });
  return { args, env };
}

/** The run's arguments with the task's MCP servers placed before the rest (`before` is the subcommand). */
export function withMuseMcp(task: AgentTask, before: string[], after: string[]): PreparedRun {
  if (!task.mcpServers?.length) return { args: [...before, ...after] };
  const mcp = museMcpOverrides(task.mcpServers);
  return { args: [...before, ...mcp.args, ...after], env: mcp.env };
}
