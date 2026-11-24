import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The agents the session index can be registered with as an MCP server. */
export const MCP_INSTALL_AGENTS = ['claude', 'codex', 'gemini', 'copilot', 'cursor'] as const;
export type McpInstallAgent = (typeof MCP_INSTALL_AGENTS)[number];

/** What the server is called in each agent's configuration. */
export const MCP_SERVER_NAME = 'genaicode';

/**
 * Claude Code and Codex keep their user-level servers in a file they rewrite themselves, so
 * theirs is changed through their own `mcp add` and `mcp remove`. The others read a JSON file.
 */
const BY_CLI: readonly McpInstallAgent[] = ['claude', 'codex'];

export interface McpInstallOptions {
  env?: NodeJS.ProcessEnv;
  /** The program and arguments the agent starts: default this genaicode's `cli.js sessions mcp`. */
  server?: { command: string; args: readonly string[] };
  /** The agent's own CLI, when it is not on PATH under the agent's name. */
  cli?: string;
  /** Runs an agent's CLI (`claude mcp add ...`). Default: `execFile`, with `env`. */
  run?(command: string, args: readonly string[]): Promise<void>;
}

export interface McpInstallStatus {
  agent: McpInstallAgent;
  /** The agent's file its user-level MCP servers are declared in. */
  file: string;
  /** Whether a server named `genaicode` is declared there. */
  installed: boolean;
  /** Whether it starts the command this genaicode would install. */
  current: boolean;
  /** The declared command line, when there is one. */
  command?: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The file `agent` keeps its user-level MCP servers in. */
export function mcpConfigFile(agent: McpInstallAgent, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  switch (agent) {
    case 'claude':
      return path.join(env.CLAUDE_CONFIG_DIR ?? home, '.claude.json');
    case 'codex':
      return path.join(env.CODEX_HOME ?? path.join(home, '.codex'), 'config.toml');
    case 'gemini':
      return path.join(env.GEMINI_CLI_HOME ?? home, '.gemini', 'settings.json');
    case 'copilot':
      return path.join(env.COPILOT_HOME ?? path.join(home, '.copilot'), 'mcp-config.json');
    case 'cursor':
      return path.join(home, '.cursor', 'mcp.json');
  }
}

/** This package's own `cli.js sessions mcp`, whoever calls. */
function defaultServer(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('../../cli.js', import.meta.url)), 'sessions', 'mcp'],
  };
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function readJson(file: string): Promise<Json> {
  const source = await readText(file);
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

async function writeJson(file: string, config: Json): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const mode = await fs.stat(file).then(
    (stat) => stat.mode & 0o777,
    () => 0o600,
  );
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode });
  await fs.rename(temporary, file);
}

/** Codex's `[mcp_servers.genaicode]` table: its `command` and `args`, as `codex mcp add` writes them. */
function codexServer(toml: string): { command: string; args: string[] } | undefined {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[mcp_servers.${MCP_SERVER_NAME}]`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line) && !/^\s*\[\s*"/.test(line));
  const table = lines.slice(start + 1, end < 0 ? undefined : end);
  const value = (key: string): unknown => {
    const line = table.find((candidate) => new RegExp(`^\\s*${key}\\s*=`).test(candidate));
    if (!line) return undefined;
    try {
      // Basic strings and arrays of them read as JSON; anything else is not what `mcp add` wrote.
      return JSON.parse(line.slice(line.indexOf('=') + 1).trim());
    } catch {
      return undefined;
    }
  };
  const command = value('command');
  const args = value('args');
  return {
    command: typeof command === 'string' ? command : '',
    args: Array.isArray(args) ? args.map(String) : [],
  };
}

async function declared(
  agent: McpInstallAgent,
  file: string,
): Promise<{ command: string; args: string[] } | undefined> {
  if (agent === 'codex') return codexServer(await readText(file));
  const servers = (await readJson(file)).mcpServers;
  const server = isObject(servers) ? servers[MCP_SERVER_NAME] : undefined;
  if (!isObject(server)) return undefined;
  return {
    command: typeof server.command === 'string' ? server.command : '',
    args: Array.isArray(server.args) ? server.args.map(String) : [],
  };
}

/** What is registered with `agent` now. */
export async function mcpInstallStatus(
  agent: McpInstallAgent,
  options: McpInstallOptions = {},
): Promise<McpInstallStatus> {
  const file = mcpConfigFile(agent, options.env);
  const found = await declared(agent, file);
  const wanted = options.server ?? defaultServer();
  return {
    agent,
    file,
    installed: found !== undefined,
    current:
      found !== undefined &&
      found.command === wanted.command &&
      found.args.length === wanted.args.length &&
      found.args.every((arg, index) => arg === wanted.args[index]),
    ...(found ? { command: [found.command, ...found.args].join(' ') } : {}),
  };
}

function runner(options: McpInstallOptions): (command: string, args: readonly string[]) => Promise<void> {
  if (options.run) return options.run;
  return (command, args) =>
    new Promise((resolve, reject) => {
      execFile(command, [...args], { env: options.env ?? process.env, timeout: 30_000 }, (error, _stdout, stderr) => {
        if (!error) return resolve();
        const said = String(stderr).trim().split('\n').pop();
        // The errno stays: a CLI that is not there reads differently from one that refused.
        reject(
          Object.assign(new Error(said || error.message), typeof error.code === 'string' ? { code: error.code } : {}),
        );
      });
    });
}

/**
 * Register the session index (`genaicode sessions mcp`) as a user-level MCP server of `agent`,
 * beside the servers declared there. An earlier registration is replaced.
 */
export async function installMcp(agent: McpInstallAgent, options: McpInstallOptions = {}): Promise<McpInstallStatus> {
  const file = mcpConfigFile(agent, options.env);
  const server = options.server ?? defaultServer();
  if (BY_CLI.includes(agent)) {
    const run = runner(options);
    // Claude Code refuses a name it already has; Codex replaces it.
    if (agent === 'claude' && (await declared(agent, file))) {
      await run(options.cli ?? agent, ['mcp', 'remove', '-s', 'user', MCP_SERVER_NAME]);
    }
    const scope = agent === 'claude' ? ['-s', 'user'] : [];
    await run(options.cli ?? agent, ['mcp', 'add', ...scope, MCP_SERVER_NAME, '--', server.command, ...server.args]);
  } else {
    const config = await readJson(file);
    const servers = isObject(config.mcpServers) ? config.mcpServers : {};
    const entry =
      agent === 'copilot'
        ? { type: 'local', command: server.command, args: [...server.args], tools: ['*'] }
        : { command: server.command, args: [...server.args] };
    await writeJson(file, { ...config, mcpServers: { ...servers, [MCP_SERVER_NAME]: entry } });
  }
  return mcpInstallStatus(agent, options);
}

/** Take the session index out of the MCP servers of `agent`. Resolves to whether it was there. */
export async function uninstallMcp(agent: McpInstallAgent, options: McpInstallOptions = {}): Promise<boolean> {
  const file = mcpConfigFile(agent, options.env);
  if (!(await declared(agent, file))) return false;
  if (BY_CLI.includes(agent)) {
    const scope = agent === 'claude' ? ['-s', 'user'] : [];
    await runner(options)(options.cli ?? agent, ['mcp', 'remove', ...scope, MCP_SERVER_NAME]);
    return true;
  }
  const config = await readJson(file);
  const servers = { ...(config.mcpServers as Json) };
  delete servers[MCP_SERVER_NAME];
  const left = { ...config };
  if (Object.keys(servers).length) left.mcpServers = servers;
  else delete left.mcpServers;
  // A file only this server was in goes with it.
  if (Object.keys(left).length) await writeJson(file, left);
  else await fs.rm(file, { force: true });
  return true;
}
