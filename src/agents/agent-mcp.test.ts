import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claudeMcpServers, ownMcpServers } from './agent-mcp.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-agent-mcp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('ownMcpServers', () => {
  it("reads Claude Code's user, project and local servers; a later scope wins", async () => {
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(home);
    mkdirSync(project);
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          gamedevpl: { type: 'http', url: 'https://gamedev.test/mcp', headers: { Authorization: 'Bearer k' } },
          old: { type: 'sse', url: 'https://sse.test' },
          tool: { type: 'stdio', command: 'tool', args: ['--x'], env: { A: '1' } },
        },
        projects: { [project]: { mcpServers: { tool: { command: './bin/tool', args: ['../x.js', '-v'] } } } },
      }),
    );
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { docs: { url: '${DOCS_URL:-https://docs.test}', headers: { k: '${KEY}' } } } }),
    );
    const env = { HOME: home, KEY: 'secret' };
    expect(await claudeMcpServers(project, env)).toEqual([
      { name: 'gamedevpl', url: 'https://gamedev.test/mcp', headers: { Authorization: 'Bearer k' } },
      { name: 'tool', command: join(project, 'bin/tool'), args: [join(root, 'x.js'), '-v'] },
      { name: 'docs', url: 'https://docs.test', headers: { k: 'secret' } },
    ]);
    const bare = await ownMcpServers('claude', project, { CLAUDE_CONFIG_DIR: join(root, 'none') });
    expect(bare.map((server) => server.name)).toEqual(['docs']);
    expect(await ownMcpServers('codex', project, env)).toEqual([]);
  });
});
