import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareCodex } from './codex.js';
import { prepareCodexLive } from './codex-live.js';
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

  it('switches them off for the live Codex driver too, or says why it could not', async () => {
    const command = fakeCli('codex-live', [{ name: 'github' }]);
    const task = { prompt: 'go', cwd: dir, mcpServers: [app] };
    const prepared = await prepareCodexLive(task, { command, onlyTaskMcpServers: true });
    expect(prepared.args.slice(0, 2)).toEqual(['-c', 'mcp_servers.github.enabled=false']);
    expect(prepared.args.at(-1)).toBe('app-server');
    expect((await prepareCodexLive(task, { command })).args).not.toContain('mcp_servers.github.enabled=false');

    // A Codex that cannot list its servers: a failed run, or a note and its own servers.
    const old = fakeCli('codex-old', 'not a list');
    await expect(prepareCodexLive(task, { command: old, onlyTaskMcpServers: true })).rejects.toThrow(/MCP server list/);
    const notes: string[] = [];
    const lenient = await prepareCodexLive(
      task,
      { command: old, onlyTaskMcpServers: 'when-listed' },
      { emit: (event) => void (event.type === 'stderr' && notes.push(event.text)) },
    );
    expect(lenient.args.at(-1)).toBe('app-server');
    expect(notes.join('')).toMatch(/runs with its own MCP servers/);
    // A task server that reuses a name is refused either way.
    const clash = fakeCli('codex-live-clash', [{ name: 'app' }]);
    await expect(prepareCodexLive(task, { command: clash, onlyTaskMcpServers: 'when-listed' })).rejects.toThrow(
      /already has an MCP server named "app"/,
    );
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

  it("lists servers with the task's environment, not the host's", async () => {
    const file = join(dir, 'codex-env');
    writeFileSync(file, `#!/bin/sh\n[ -n "$APP_SECRET" ] && printf '[{"name":"leaked"}]' || printf '[]'\n`);
    chmodSync(file, 0o755);
    process.env.APP_SECRET = 'x';
    try {
      const prepared = await prepareCodex(
        { prompt: 'go', cwd: dir, env: { PATH: process.env.PATH ?? '' } },
        { command: file, onlyTaskMcpServers: true },
      );
      expect(prepared.args.join(' ')).not.toContain('leaked');
    } finally {
      delete process.env.APP_SECRET;
    }
  });

  it('refuses to run when the list cannot be read', async () => {
    const command = join(dir, 'missing');
    await expect(prepareCodex({ prompt: 'go', cwd: dir }, { command, onlyTaskMcpServers: true })).rejects.toThrow(
      /could not list/,
    );
  });
});
