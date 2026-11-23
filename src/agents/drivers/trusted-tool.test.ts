import { describe, expect, it } from 'vitest';
import { antigravityTrustedTool } from './antigravity.js';
import { museTrustedTool } from './muse-approvals.js';
import { isTrustedMcpTool, mcpToolServer, trustedMcpServers } from './trusted-tool.js';

describe('trusted MCP tool matching', () => {
  const servers = ['genaicode_ask', 'genaicode_ask_x', 'docs'];
  const trusted = ['genaicode_ask'];

  it('extracts attached and trusted server names', () => {
    expect(
      trustedMcpServers([
        { name: 'genaicode_ask', url: 'http://127.0.0.1:1/mcp', trusted: true },
        { name: 'docs', url: 'https://mcp.example' },
      ]),
    ).toEqual({ servers: ['genaicode_ask', 'docs'], trusted: ['genaicode_ask'] });
    expect(trustedMcpServers(undefined)).toEqual({ servers: [], trusted: [] });
  });

  it('resolves the longest matching server name for both single and double underscores', () => {
    expect(mcpToolServer('mcp_genaicode_ask_ask_user', servers, '_')).toBe('genaicode_ask');
    expect(mcpToolServer('mcp_genaicode_ask_x_tool', servers, '_')).toBe('genaicode_ask_x');
    expect(mcpToolServer('mcp__genaicode_ask__ask_user', servers, '__')).toBe('genaicode_ask');
    expect(mcpToolServer('mcp__genaicode_ask_x__tool', servers, '__')).toBe('genaicode_ask_x');
    // Missing tool name after separator does not match.
    expect(mcpToolServer('mcp__genaicode_ask__', servers, '__')).toBeUndefined();
    expect(mcpToolServer('mcp_genaicode_ask_', servers, '_')).toBeUndefined();
    // Unattached server does not match.
    expect(mcpToolServer('mcp__unknown__tool', servers, '__')).toBeUndefined();
  });

  it('matches only whole tool names (and never command lines or prefix look-alikes)', () => {
    expect(isTrustedMcpTool(['mcp__genaicode_ask__ask_user'], trusted, servers)).toBe(true);
    expect(isTrustedMcpTool(['  mcp__genaicode_ask__ask_user  '], trusted, servers)).toBe(true);
    expect(isTrustedMcpTool(['mcp__genaicode_ask_x__ask_user'], trusted, servers)).toBe(false);
    expect(isTrustedMcpTool(['mcp__docs__search'], trusted, servers)).toBe(false);
    expect(isTrustedMcpTool(['echo mcp__genaicode_ask__ask_user'], trusted, servers)).toBe(false);
    expect(isTrustedMcpTool(['Run mcp__genaicode_ask__ask_user'], trusted, servers)).toBe(false);
    expect(
      isTrustedMcpTool(['Run mcp_genaicode_ask_ask_user'], trusted, servers, {
        separator: '_',
        stripRunPrefix: true,
      }),
    ).toBe(true);
    expect(
      isTrustedMcpTool(['Run echo mcp_genaicode_ask_ask_user'], trusted, servers, {
        separator: '_',
        stripRunPrefix: true,
      }),
    ).toBe(false);
    expect(isTrustedMcpTool(['mcp__genaicode_ask__ask_user'], [], servers)).toBe(false);
  });

  it('guards Antigravity against execute/edit/delete kinds and look-alike servers', () => {
    const ask = (toolCall: Record<string, unknown>) => antigravityTrustedTool(toolCall, trusted, servers);
    expect(ask({ title: 'Run mcp_genaicode_ask_ask_user' })).toBe(true);
    expect(ask({ name: 'mcp_genaicode_ask_ask_user', kind: 'other' })).toBe(true);
    expect(ask({ title: 'Run mcp_genaicode_ask_x_tool' })).toBe(false);
    expect(ask({ title: 'Run mcp_docs_search' })).toBe(false);
    expect(ask({ title: 'Run echo mcp_genaicode_ask_ask_user' })).toBe(false);
    expect(ask({ title: 'mcp_genaicode_ask_ask_user', kind: 'execute' })).toBe(false);
    expect(ask({ title: 'mcp_genaicode_ask_ask_user', kind: 'edit' })).toBe(false);
    expect(ask({ title: 'mcp_genaicode_ask_ask_user', kind: 'delete' })).toBe(false);
  });

  it('guards Muse against non-tool subjects, protected writes, mismatches and look-alikes', () => {
    const ask = (params: Record<string, unknown>) => museTrustedTool(params, trusted, servers);
    expect(
      ask({
        toolName: 'mcp__genaicode_ask__ask_user',
        subject: { kind: 'tool', toolName: 'mcp__genaicode_ask__ask_user' },
        protectedWrite: false,
      }),
    ).toBe(true);
    expect(ask({ subject: { kind: 'tool', toolName: 'mcp__genaicode_ask__ask_user' } })).toBe(true);
    expect(ask({ toolName: 'mcp__genaicode_ask__ask_user', subject: { kind: 'tool' } })).toBe(true);
    // Look-alike prefix server and untrusted server.
    expect(
      ask({
        toolName: 'mcp__genaicode_ask_x__ask_user',
        subject: { kind: 'tool', toolName: 'mcp__genaicode_ask_x__ask_user' },
      }),
    ).toBe(false);
    expect(ask({ toolName: 'mcp__docs__search', subject: { kind: 'tool', toolName: 'mcp__docs__search' } })).toBe(
      false,
    );
    // Command line or whitespace in toolName.
    expect(
      ask({
        toolName: 'echo mcp__genaicode_ask__ask_user',
        subject: { kind: 'tool', toolName: 'echo mcp__genaicode_ask__ask_user' },
      }),
    ).toBe(false);
    // Disallowed subject kinds (shell, fileAccess, network, process, unixSocket, computerUseTakeover, unknown, missing).
    for (const kind of ['shell', 'fileAccess', 'network', 'process', 'unixSocket', 'computerUseTakeover', 'future']) {
      expect(
        ask({
          toolName: 'mcp__genaicode_ask__ask_user',
          subject: { kind, toolName: 'mcp__genaicode_ask__ask_user', command: 'mcp__genaicode_ask__ask_user' },
        }),
      ).toBe(false);
    }
    expect(ask({ toolName: 'mcp__genaicode_ask__ask_user' })).toBe(false);
    // Protected write always asks.
    expect(
      ask({
        toolName: 'mcp__genaicode_ask__ask_user',
        subject: { kind: 'tool', toolName: 'mcp__genaicode_ask__ask_user' },
        protectedWrite: true,
      }),
    ).toBe(false);
    // Mismatched top-level and subject tool names never auto-approve.
    expect(
      ask({
        toolName: 'mcp__docs__delete',
        subject: { kind: 'tool', toolName: 'mcp__genaicode_ask__ask_user' },
      }),
    ).toBe(false);
    // Single-underscore form does not match Muse's double-underscore scheme.
    expect(
      ask({
        toolName: 'mcp_genaicode_ask_ask_user',
        subject: { kind: 'tool', toolName: 'mcp_genaicode_ask_ask_user' },
      }),
    ).toBe(false);
    expect(
      museTrustedTool(
        {
          toolName: 'mcp__genaicode_ask__ask_user',
          subject: { kind: 'tool', toolName: 'mcp__genaicode_ask__ask_user' },
        },
        [],
        servers,
      ),
    ).toBe(false);
  });
});
