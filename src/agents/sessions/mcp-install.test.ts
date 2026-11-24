import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { installMcp, mcpConfigFile, mcpInstallStatus, uninstallMcp } from './mcp-install.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-mcp-install-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = (name: string) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return { HOME: dir };
};
const server = { command: '/usr/bin/node', args: ['/opt/genaicode/cli.js', 'sessions', 'mcp'] };
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { theme?: string; mcpServers: Record<string, Record<string, unknown>> };

describe('installMcp', () => {
  it('adds the server beside the ones declared, and takes only its own out', async () => {
    for (const agent of ['gemini', 'cursor', 'copilot'] as const) {
      const env = home(agent);
      const file = mcpConfigFile(agent, env);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify({ theme: 'dark', mcpServers: { docs: { url: 'https://mcp.example' } } }));
      expect(await mcpInstallStatus(agent, { env, server })).toMatchObject({ installed: false, current: false });

      const status = await installMcp(agent, { env, server });
      expect(status).toMatchObject({ agent, file, installed: true, current: true });
      const config = json(file);
      expect(config.theme).toBe('dark');
      expect(config.mcpServers.docs).toEqual({ url: 'https://mcp.example' });
      expect(config.mcpServers.genaicode).toMatchObject({ command: server.command, args: server.args });
      if (agent === 'copilot') expect(config.mcpServers.genaicode).toMatchObject({ type: 'local', tools: ['*'] });

      // Another genaicode's path: there, but not this one's.
      const other = { command: server.command, args: ['/elsewhere/cli.js', 'sessions', 'mcp'] };
      expect(await mcpInstallStatus(agent, { env, server: other })).toMatchObject({ installed: true, current: false });

      expect(await uninstallMcp(agent, { env, server })).toBe(true);
      expect(json(file)).toEqual({ theme: 'dark', mcpServers: { docs: { url: 'https://mcp.example' } } });
      expect(await uninstallMcp(agent, { env, server })).toBe(false);
    }
  });

  it('removes a file only its server was in', async () => {
    const env = home('alone');
    const file = mcpConfigFile('cursor', env);
    await installMcp('cursor', { env, server });
    expect(existsSync(file)).toBe(true);
    await uninstallMcp('cursor', { env, server });
    expect(existsSync(file)).toBe(false);
  });

  it('leaves a file that is not JSON as it is', async () => {
    const env = home('broken');
    const file = mcpConfigFile('cursor', env);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{ not json');
    await expect(installMcp('cursor', { env, server })).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it("goes through Claude Code's and Codex's own commands", async () => {
    const env = home('cli');
    const calls: string[][] = [];
    // Stands in for the agent: writes what its `mcp add` would.
    const run = async (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      const adding = args[1] === 'add';
      if (command.endsWith('claude')) {
        writeFileSync(
          mcpConfigFile('claude', env),
          JSON.stringify(adding ? { mcpServers: { genaicode: { type: 'stdio', ...server } } } : {}),
        );
      } else {
        const file = mcpConfigFile('codex', env);
        mkdirSync(join(file, '..'), { recursive: true });
        const table = `[mcp_servers.genaicode]\ncommand = "/usr/bin/node"\nargs = ["/opt/genaicode/cli.js", "sessions", "mcp"]\n`;
        writeFileSync(
          file,
          `model = "gpt"\n\n${adding ? table : ''}\n[mcp_servers.docs]\nurl = "https://mcp.example"\n`,
        );
      }
    };

    expect(await installMcp('claude', { env, server, run, cli: '/bin/claude' })).toMatchObject({ current: true });
    // A second install replaces: Claude Code refuses a name it has.
    await installMcp('claude', { env, server, run, cli: '/bin/claude' });
    expect(calls).toEqual([
      ['/bin/claude', 'mcp', 'add', '-s', 'user', 'genaicode', '--', server.command, ...server.args],
      ['/bin/claude', 'mcp', 'remove', '-s', 'user', 'genaicode'],
      ['/bin/claude', 'mcp', 'add', '-s', 'user', 'genaicode', '--', server.command, ...server.args],
    ]);
    expect(await uninstallMcp('claude', { env, server, run })).toBe(true);
    expect(calls.at(-1)).toEqual(['claude', 'mcp', 'remove', '-s', 'user', 'genaicode']);
    expect(await uninstallMcp('claude', { env, server, run })).toBe(false);

    calls.length = 0;
    expect(await installMcp('codex', { env, server, run })).toMatchObject({
      installed: true,
      current: true,
      command: '/usr/bin/node /opt/genaicode/cli.js sessions mcp',
    });
    expect(calls).toEqual([['codex', 'mcp', 'add', 'genaicode', '--', server.command, ...server.args]]);
    expect(await uninstallMcp('codex', { env, server, run })).toBe(true);
    expect(await mcpInstallStatus('codex', { env, server })).toMatchObject({ installed: false });
  });
});
