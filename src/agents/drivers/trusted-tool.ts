import type { McpServer } from '../types.js';

/** Attached MCP server names split into all servers and the `trusted` ones. */
export interface TrustedMcpServers {
  readonly servers: readonly string[];
  readonly trusted: readonly string[];
}

/** Extract all attached MCP server names and the subset marked `trusted`. */
export function trustedMcpServers(mcpServers?: readonly McpServer[]): TrustedMcpServers {
  const servers = (mcpServers ?? []).map((server) => server.name);
  const trusted = (mcpServers ?? []).filter((server) => server.trusted).map((server) => server.name);
  return { servers, trusted };
}

/**
 * The attached server an MCP tool name belongs to: the longest matching server name wins, so
 * a look-alike server whose name starts with a trusted one (`genaicode_ask_x`) is matched to
 * itself rather than to `genaicode_ask`.
 */
export function mcpToolServer(
  name: string,
  servers: readonly string[],
  separator: '_' | '__' = '__',
): string | undefined {
  const prefix = `mcp${separator}`;
  return [...servers]
    .sort((a, b) => b.length - a.length)
    .find((server) => {
      const head = `${prefix}${server}${separator}`;
      return name.startsWith(head) && name.length > head.length;
    });
}

/**
 * Whether a permission prompt names a tool of a `trusted` server and nothing else.
 *
 * Callers must reject dangerous request kinds (shell/execute, file edits/deletes, network,
 * protected writes, unknown kinds) before calling this. The entire string must be the tool
 * name (optionally preceded by `Run ` when `stripRunPrefix` is set), so a command line that
 * merely mentions a trusted tool name never matches.
 */
export function isTrustedMcpTool(
  names: readonly (string | undefined)[],
  trusted: readonly string[],
  servers: readonly string[],
  options: { separator?: '_' | '__'; stripRunPrefix?: boolean } = {},
): boolean {
  if (!trusted.length) return false;
  const separator = options.separator ?? '__';
  const pattern = options.stripRunPrefix ? /^(?:Run\s+)?(\S+)$/ : /^(\S+)$/;
  return names.some((raw) => {
    if (!raw) return false;
    const tool = pattern.exec(raw.trim())?.[1];
    const server = tool ? mcpToolServer(tool, servers, separator) : undefined;
    return !!server && trusted.includes(server);
  });
}
