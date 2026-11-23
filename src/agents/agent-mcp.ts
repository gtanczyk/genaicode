import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { McpServer } from './types.js';

type Env = NodeJS.ProcessEnv;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
};

/** `${VAR}` and `${VAR:-default}`, as Claude Code expands them in `.mcp.json`. */
function expand(text: string, env: Env): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => {
    return env[name] ?? fallback ?? '';
  });
}

const expandAll = (values: Record<string, string> | undefined, env: Env) =>
  values && Object.fromEntries(Object.entries(values).map(([key, value]) => [key, expand(value, env)]));

/**
 * One entry of Claude Code's `mcpServers` map as a genaicode `McpServer`. Only stdio and
 * streamable HTTP servers: other agents cannot attach an SSE one.
 */
/**
 * A path relative to the directory Claude Code starts the server in, made absolute: a task in
 * another directory must start the same program.
 */
const anchored = (value: string, cwd: string) => (/^\.\.?[\\/]/.test(value) ? path.resolve(cwd, value) : value);

function claudeServer(name: string, entry: unknown, env: Env, cwd: string): McpServer | undefined {
  if (!isRecord(entry)) return undefined;
  const type = typeof entry.type === 'string' ? entry.type : undefined;
  if (typeof entry.url === 'string' && (type === undefined || type === 'http')) {
    const headers = expandAll(strings(entry.headers), env);
    return { name, url: expand(entry.url, env), ...(headers ? { headers } : {}) };
  }
  if (typeof entry.command === 'string' && (type === undefined || type === 'stdio')) {
    const args = Array.isArray(entry.args)
      ? entry.args.filter((arg): arg is string => typeof arg === 'string').map((arg) => anchored(expand(arg, env), cwd))
      : undefined;
    const vars = expandAll(strings(entry.env), env);
    return {
      name,
      command: anchored(expand(entry.command, env), cwd),
      ...(args?.length ? { args } : {}),
      ...(vars ? { env: vars } : {}),
    };
  }
  return undefined;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The MCP servers Claude Code loads for `cwd`: user scope (`mcpServers` in `~/.claude.json`),
 * the project's `.mcp.json`, then local scope (`projects[cwd].mcpServers`); a later scope wins.
 */
export async function claudeMcpServers(cwd: string, env: Env = process.env): Promise<McpServer[]> {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const configFile = env.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(home, '.claude.json');
  const [config, project] = await Promise.all([readJson(configFile), readJson(path.join(cwd, '.mcp.json'))]);
  const scopes: unknown[] = [];
  if (isRecord(config)) scopes.push(config.mcpServers);
  if (isRecord(project)) scopes.push(project.mcpServers);
  if (isRecord(config) && isRecord(config.projects)) {
    const local = config.projects[cwd];
    if (isRecord(local)) scopes.push(local.mcpServers);
  }
  const found = new Map<string, McpServer>();
  for (const scope of scopes) {
    if (!isRecord(scope)) continue;
    for (const [name, entry] of Object.entries(scope)) {
      const server = claudeServer(name, entry, env, cwd);
      if (server) found.set(name, server);
      else found.delete(name);
    }
  }
  return [...found.values()];
}

/**
 * The MCP servers an agent CLI has in its own config, as servers another agent can attach.
 * Claude Code only for now; other agents report none. Never throws: an unreadable config is none.
 */
export async function ownMcpServers(agent: string, cwd: string, env: Env = process.env): Promise<McpServer[]> {
  try {
    if (agent === 'claude') return await claudeMcpServers(cwd, env);
  } catch {
    /* A config that cannot be read offers nothing to pass on. */
  }
  return [];
}
