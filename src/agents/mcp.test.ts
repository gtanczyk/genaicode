import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claude, claudeArgs, claudeMcpConfig } from './drivers/claude.js';
import { codex, codexMcpOverrides } from './drivers/codex.js';
import { muse } from './drivers/muse.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-mcp-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Reports its argv, the MCP config file it was given (with its mode) and one env var, as a claude result.
const reporter = join(dir, 'reporter.mjs');
writeFileSync(
  reporter,
  `import { readFileSync, statSync } from 'node:fs';
const args = process.argv.slice(2);
const at = args.indexOf('--mcp-config');
const file = at >= 0 ? args[at + 1] : undefined;
const report = {
  args,
  file,
  mode: file ? (statSync(file).mode & 0o777).toString(8) : undefined,
  config: file ? JSON.parse(readFileSync(file, 'utf8')) : undefined,
  header: process.env.GENAICODE_MCP_0_HEADER_0,
};
// Both claude's and codex's final-message shapes; each parser ignores the other's.
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(report) }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(report) } }));
console.log(JSON.stringify({ type: 'turn.completed' }));
`,
);
const bin = join(dir, 'agent');
writeFileSync(bin, `#!${process.execPath}\nimport(${JSON.stringify(reporter)});\n`, { mode: 0o755 });

const servers = [
  { name: 'docs', url: 'https://mcp.example/docs', headers: { Authorization: 'Bearer secret' } },
  { name: 'fs', command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' } },
];

describe('MCP servers', () => {
  it('builds the claude config document', () => {
    expect(claudeMcpConfig(servers)).toEqual({
      mcpServers: {
        docs: { type: 'http', url: 'https://mcp.example/docs', headers: { Authorization: 'Bearer secret' } },
        fs: { command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' } },
      },
    });
    const args = claudeArgs({ prompt: 'p', cwd: '.', mcpServers: servers }, { allowedTools: ['Read'] }, '/tmp/m.json');
    expect(args.slice(0, 6)).toEqual([
      '-p',
      '--verbose',
      '--mcp-config',
      '/tmp/m.json',
      '--allowedTools',
      'Read,mcp__docs,mcp__fs',
    ]);
  });

  it('hands claude a private config file and removes it afterwards', async () => {
    const result = await claude({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: servers }).result;
    const report = JSON.parse(result.text!);
    expect(result.ok).toBe(true);
    expect(report.mode).toBe('600');
    expect(report.config.mcpServers.docs.headers).toEqual({ Authorization: 'Bearer secret' });
    expect(report.args.join(' ')).not.toContain('secret');
    expect(existsSync(report.file)).toBe(false);
  });

  it('passes codex servers as config overrides with headers in the environment', async () => {
    const { args, env } = codexMcpOverrides(servers);
    expect(args).toEqual([
      '-c',
      'mcp_servers.docs.url="https://mcp.example/docs"',
      '-c',
      'mcp_servers.docs.env_http_headers={ "Authorization" = "GENAICODE_MCP_0_HEADER_0" }',
      '-c',
      'mcp_servers.fs.command="mcp-fs"',
      '-c',
      'mcp_servers.fs.args=["--root","."]',
      '-c',
      'mcp_servers.fs.env_vars=["LOG"]',
    ]);
    expect(env).toEqual({ GENAICODE_MCP_0_HEADER_0: 'Bearer secret', LOG: '1' });

    const result = await codex({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: servers }).result;
    const report = JSON.parse(result.text!);
    expect(report.args.slice(0, 2)).toEqual(['-c', 'mcp_servers.docs.url="https://mcp.example/docs"']);
    expect(report.args.indexOf('exec')).toBe(10);
    expect(report.args.join(' ')).not.toContain('secret');
    expect(report.header).toBe('Bearer secret');
  });

  it('refuses two codex stdio servers that need different values for one variable', async () => {
    const clash = [
      { name: 'a', command: 'mcp-a', env: { TOKEN: 'one' } },
      { name: 'b', command: 'mcp-b', env: { TOKEN: 'two' } },
    ];
    expect(() => codexMcpOverrides(clash)).toThrow(/different values for TOKEN/);
    const result = await codex({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: clash }).result;
    expect(result).toMatchObject({ status: 'failed', exitCode: null });
  });

  it('refuses servers a driver cannot attach, and bad names', async () => {
    const unsupported = await muse({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: servers }).result;
    expect(unsupported).toMatchObject({ status: 'failed', exitCode: null });
    expect(unsupported.error).toMatch(/does not support MCP servers/);

    const bad = await claude({ command: bin }).run({
      prompt: 'p',
      cwd: dir,
      mcpServers: [{ name: 'has space', url: 'https://x' }],
    }).result;
    expect(bad.error).toMatch(/Invalid MCP server name/);

    expect(statSync(dir).isDirectory()).toBe(true);
  });
});
