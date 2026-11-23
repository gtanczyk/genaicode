import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { antigravityMcpServers } from './drivers/antigravity.js';
import { claude, claudeArgs, claudeMcpConfig } from './drivers/claude.js';
import { codex, codexMcpOverrides } from './drivers/codex.js';
import { cursor, cursorMcpConfig } from './drivers/cursor.js';
import { gemini, geminiMcpConfig } from './drivers/gemini.js';
import { muse } from './drivers/muse.js';
import { museMcpOverrides } from './drivers/muse-mcp.js';
import { opencode } from './drivers/opencode.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-mcp-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Reports its argv, the MCP config file it was given (with its mode) and one env var, as a claude result.
const reporter = join(dir, 'reporter.mjs');
writeFileSync(
  reporter,
  `import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const at = args.indexOf('--mcp-config');
const file = at >= 0 ? args[at + 1] : undefined;
const pluginAt = args.indexOf('--plugin-dir');
const pluginDir = pluginAt >= 0 ? args[pluginAt + 1] : undefined;
const geminiFile = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
const report = {
  args,
  file,
  mode: file ? (statSync(file).mode & 0o777).toString(8) : undefined,
  config: file ? JSON.parse(readFileSync(file, 'utf8')) : undefined,
  pluginDir,
  pluginManifest: pluginDir ? JSON.parse(readFileSync(join(pluginDir, '.cursor-plugin', 'plugin.json'), 'utf8')) : undefined,
  pluginMcpMode: pluginDir ? (statSync(join(pluginDir, 'mcp.json')).mode & 0o777).toString(8) : undefined,
  pluginMcp: pluginDir ? JSON.parse(readFileSync(join(pluginDir, 'mcp.json'), 'utf8')) : undefined,
  geminiFile,
  geminiDefaults: process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH,
  geminiMode: geminiFile ? (statSync(geminiFile).mode & 0o777).toString(8) : undefined,
  geminiConfig: geminiFile ? JSON.parse(readFileSync(geminiFile, 'utf8')) : undefined,
  header: process.env.GENAICODE_MCP_0_HEADER_0,
  env: process.env.GENAICODE_MCP_1_ENV_0,
};
// Final-message shapes for claude/cursor, codex, muse and gemini; each parser ignores the others.
console.log(JSON.stringify({ type: 'result', subtype: 'success', status: 'success', is_error: false, result: JSON.stringify(report) }));
console.log(JSON.stringify({ type: 'message', role: 'assistant', content: JSON.stringify(report) }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(report) } }));
console.log(JSON.stringify({ type: 'turn.completed' }));
console.log(JSON.stringify({ payload_type: 'run.terminal.completed', payload: { text: JSON.stringify(report) } }));
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
    expect(codexMcpOverrides([{ name: 'ask', url: 'http://127.0.0.1:1/mcp', toolTimeoutSec: 600 }]).args).toContain(
      'mcp_servers.ask.tool_timeout_sec=600',
    );
    // A trusted server's tools run without asking, even where the others ask (codexLive).
    expect(codexMcpOverrides([{ name: 'ask', url: 'http://127.0.0.1:1/mcp', trusted: true }]).args).toContain(
      'mcp_servers.ask.default_tools_approval_mode="approve"',
    );

    const result = await codex({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: servers }).result;
    const report = JSON.parse(result.text!);
    expect(report.args.slice(0, 2)).toEqual(['-c', 'mcp_servers.docs.url="https://mcp.example/docs"']);
    // exec never asks, so it pre-approves the task's own servers.
    expect(report.args).toContain('mcp_servers.docs.default_tools_approval_mode="approve"');
    expect(report.args).toContain('mcp_servers.fs.default_tools_approval_mode="approve"');
    expect(report.args.indexOf('exec')).toBe(14);
    const strict = await codex({ command: bin, allowMcpTools: false }).run({
      prompt: 'p',
      cwd: dir,
      mcpServers: servers,
    }).result;
    expect(JSON.parse(strict.text!).args.join(' ')).not.toContain('default_tools_approval_mode');
    expect(report.args.join(' ')).not.toContain('secret');
    expect(report.header).toBe('Bearer secret');
  });

  it('quotes a codex server name that is not a bare TOML key', () => {
    const { args } = codexMcpOverrides([{ name: 'shop.app', url: 'http://127.0.0.1:1/mcp' }]);
    expect(args).toEqual(['-c', 'mcp_servers."shop.app".url="http://127.0.0.1:1/mcp"']);
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

  it('gives muse the servers as -c overrides, secrets by ${VAR} reference only', async () => {
    expect(museMcpOverrides(servers)).toEqual({
      args: [
        '-c',
        'mcp_servers.docs.transport="streamable_http"',
        '-c',
        'mcp_servers.docs.url="https://mcp.example/docs"',
        '-c',
        'mcp_servers.docs.headers.Authorization="${GENAICODE_MCP_0_HEADER_0}"',
        '-c',
        'mcp_servers.fs.transport="stdio"',
        '-c',
        'mcp_servers.fs.command="mcp-fs"',
        '-c',
        'mcp_servers.fs.args=["--root","."]',
        '-c',
        'mcp_servers.fs.env.LOG="${GENAICODE_MCP_1_ENV_0}"',
      ],
      env: { GENAICODE_MCP_0_HEADER_0: 'Bearer secret', GENAICODE_MCP_1_ENV_0: '1' },
    });
    const result = await muse({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: servers }).result;
    expect(result.status).toBe('completed');
    const report = JSON.parse(result.text ?? '{}') as { args: string[]; header: string; env: string };
    expect(report.args.slice(0, 3)).toEqual(['exec', '-c', 'mcp_servers.docs.transport="streamable_http"']);
    expect(report.args.at(-1)).toBe('p');
    expect(report.args.join(' ')).not.toContain('secret');
    expect(report.header).toBe('Bearer secret');
    expect(report.env).toBe('1');
  });

  it('formats antigravity ACP servers for session/new and session/resume (never in argv)', () => {
    expect(antigravityMcpServers(servers)).toEqual([
      {
        type: 'http',
        name: 'docs',
        url: 'https://mcp.example/docs',
        headers: [{ name: 'Authorization', value: 'Bearer secret' }],
      },
      {
        type: 'stdio',
        name: 'fs',
        command: 'mcp-fs',
        args: ['--root', '.'],
        env: [{ name: 'LOG', value: '1' }],
      },
    ]);
  });

  it('hands gemini a private system settings file via GEMINI_CLI_SYSTEM_SETTINGS_PATH and removes it afterwards', async () => {
    expect(
      geminiMcpConfig([
        {
          name: 'docs',
          url: 'https://mcp.example/docs',
          headers: { Authorization: 'Bearer secret' },
          toolTimeoutSec: 300,
        },
        { name: 'fs', command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' } },
      ]),
    ).toEqual({
      mcpServers: {
        docs: {
          httpUrl: 'https://mcp.example/docs',
          headers: { Authorization: 'Bearer secret' },
          timeout: 300_000,
          trust: true,
        },
        fs: { command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' }, trust: true },
      },
    });
    // With allowMcpTools: false, only trusted servers get trust: true.
    expect(
      geminiMcpConfig(
        [
          { name: 'docs', url: 'https://mcp.example/docs' },
          { name: 'genaicode_ask', url: 'http://127.0.0.1:1/mcp', trusted: true, toolTimeoutSec: 86_400 },
        ],
        { allowMcpTools: false },
      ),
    ).toEqual({
      mcpServers: {
        docs: { httpUrl: 'https://mcp.example/docs' },
        genaicode_ask: { httpUrl: 'http://127.0.0.1:1/mcp', timeout: 86_400_000, trust: true },
      },
    });

    // Preserves any existing system settings file (including JSONC comments) and original defaults path.
    const existing = join(dir, 'existing-gemini-settings.json');
    writeFileSync(
      existing,
      `// Enterprise Gemini defaults\n{\n  /* Keep theme and corp MCP */\n  "theme": "dark",\n  "mcpServers": {\n    "corp": { "httpUrl": "https://corp.example/mcp" } // URL has // inside string\n  }\n}\n`,
    );
    const baseEnv: NodeJS.ProcessEnv = { ...process.env, GEMINI_CLI_SYSTEM_SETTINGS_PATH: existing };
    delete baseEnv.GEMINI_CLI_SYSTEM_DEFAULTS_PATH;
    const result = await gemini({ command: bin }).run({
      prompt: 'p',
      cwd: dir,
      env: baseEnv,
      mcpServers: servers,
    }).result;
    const report = JSON.parse(result.text!);
    expect(result.ok).toBe(true);
    expect(report.geminiFile).not.toBe(existing);
    expect(report.geminiDefaults).toBe(join(dir, 'system-defaults.json'));
    expect(report.geminiMode).toBe('600');
    expect(report.geminiConfig).toEqual({
      theme: 'dark',
      mcpServers: {
        corp: { httpUrl: 'https://corp.example/mcp' },
        docs: { httpUrl: 'https://mcp.example/docs', headers: { Authorization: 'Bearer secret' }, trust: true },
        fs: { command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' }, trust: true },
      },
    });
    expect(report.args.join(' ')).not.toContain('secret');
    expect(existsSync(report.geminiFile)).toBe(false);
    expect(existsSync(existing)).toBe(true);

    // Retains an explicit caller GEMINI_CLI_SYSTEM_DEFAULTS_PATH unchanged.
    const customDefaults = join(dir, 'custom-defaults.json');
    const withCustomDefaults = await gemini({ command: bin }).run({
      prompt: 'p',
      cwd: dir,
      env: { ...baseEnv, GEMINI_CLI_SYSTEM_DEFAULTS_PATH: customDefaults },
      mcpServers: servers,
    }).result;
    expect(JSON.parse(withCustomDefaults.text!).geminiDefaults).toBe(customDefaults);

    // Fails rather than silently dropping an existing malformed system settings file.
    const broken = join(dir, 'broken-gemini-settings.json');
    writeFileSync(broken, '{ not valid json');
    const failed = await gemini({ command: bin }).run({
      prompt: 'p',
      cwd: dir,
      env: { ...baseEnv, GEMINI_CLI_SYSTEM_SETTINGS_PATH: broken },
      mcpServers: servers,
    }).result;
    expect(failed).toMatchObject({ status: 'failed', ok: false, exitCode: null });
    expect(failed.error).toMatch(/Existing Gemini system settings/);
  });

  it('hands cursor a private temporary --plugin-dir and removes it afterwards', async () => {
    expect(cursorMcpConfig(servers)).toEqual({
      mcpServers: {
        docs: { url: 'https://mcp.example/docs', headers: { Authorization: 'Bearer secret' } },
        fs: { command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' } },
      },
    });
    const result = await cursor({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: servers }).result;
    const report = JSON.parse(result.text!);
    expect(result.ok).toBe(true);
    expect(report.pluginManifest).toEqual({ name: 'genaicode', version: '0.0.0', mcpServers: 'mcp.json' });
    expect(report.pluginMcpMode).toBe('600');
    expect(report.pluginMcp.mcpServers.docs.headers).toEqual({ Authorization: 'Bearer secret' });
    expect(report.pluginMcp.mcpServers.fs).toEqual({ command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' } });
    expect(report.args.join(' ')).not.toContain('secret');
    // Cursor requires --plugin-dir to be at least 3 path segments deep (safe on Linux /tmp too).
    expect(report.pluginDir.split(/[/\\]/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(existsSync(report.pluginDir)).toBe(false);
    // Project directory is never touched.
    expect(existsSync(join(dir, '.cursor'))).toBe(false);
  });

  it('refuses servers a driver cannot attach, and bad names', async () => {
    const unsupported = await opencode({ command: bin }).run({ prompt: 'p', cwd: dir, mcpServers: servers }).result;
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
