import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareCodex } from './codex.js';
import { prepareCopilot } from './copilot.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-mcp-isolation-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A CLI whose `mcp list --json` prints FAKE_LIST.
function fakeCli(name: string, listing: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n[ "$1" = mcp ] && printf '%s' '${JSON.stringify(listing)}' && exit 0\nexit 1\n`);
  chmodSync(file, 0o755);
  return file;
}

const app = { name: 'app', url: 'http://127.0.0.1:1/mcp' };

describe.skipIf(process.platform === 'win32')('only the task MCP servers', () => {
  it('switches off the other servers in Codex config', async () => {
    const command = fakeCli('codex', [{ name: 'github' }, { name: 'my.server' }]);
    const prepared = await prepareCodex(
      { prompt: 'go', cwd: dir, mcpServers: [app] },
      { command, onlyTaskMcpServers: true },
    );
    expect(prepared.args.slice(0, 4)).toEqual([
      '-c',
      'mcp_servers.github.enabled=false',
      '-c',
      'mcp_servers."my.server".enabled=false',
    ]);
    expect(prepared.args).toContain('mcp_servers.app.url="http://127.0.0.1:1/mcp"');
  });

  it('refuses a task server whose name Codex already has', async () => {
    const command = fakeCli('codex-clash', [{ name: 'app', transport: { type: 'stdio', command: 'app-mcp' } }]);
    await expect(
      prepareCodex({ prompt: 'go', cwd: dir, mcpServers: [app] }, { command, onlyTaskMcpServers: true }),
    ).rejects.toThrow(/already has an MCP server named "app"/);
  });

  it('keeps a valid transport on a plugin server it switches off', async () => {
    const command = fakeCli('codex-plugins', [
      { name: 'docs', transport: { type: 'stdio', command: 'docs-mcp', args: ['--x'] } },
      { name: 'web', transport: { type: 'streamable_http', url: 'https://mcp.example/web' } },
    ]);
    const prepared = await prepareCodex({ prompt: 'go', cwd: dir }, { command, onlyTaskMcpServers: true });
    expect(prepared.args.slice(0, 8)).toEqual([
      '-c',
      'mcp_servers.docs.enabled=false',
      '-c',
      'mcp_servers.docs.command="docs-mcp"',
      '-c',
      'mcp_servers.web.enabled=false',
      '-c',
      'mcp_servers.web.url="https://mcp.example/web"',
    ]);
  });

  it('disables built-in and configured Copilot servers', async () => {
    const command = fakeCli('copilot', { mcpServers: { stripe: {}, app: {} } });
    const prepared = await prepareCopilot(
      { prompt: 'go', cwd: dir, mcpServers: [app] },
      { command, allowAllTools: false, onlyTaskMcpServers: true },
    );
    prepared.cleanup?.();
    expect(prepared.args.slice(0, 2)).toEqual(['--disable-builtin-mcps', '--disable-mcp-server=stripe']);
    expect(prepared.args.at(-1)).toBe('--prompt=go');
  });

  it('refuses to run when the list cannot be read', async () => {
    const command = join(dir, 'missing');
    await expect(prepareCodex({ prompt: 'go', cwd: dir }, { command, onlyTaskMcpServers: true })).rejects.toThrow(
      /could not list/,
    );
  });
});
