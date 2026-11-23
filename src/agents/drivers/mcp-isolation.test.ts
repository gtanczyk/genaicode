import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { markQuestionChannelServer, startQuestionChannel } from '../ask-user.js';
import { prepareCodex } from './codex.js';
import { codexHasOwnQuestionTool, codexLive, prepareCodexLive } from './codex-live.js';
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
    expect(prepared.args.slice(2, 6)).toEqual([
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
    expect(prepared.args.slice(0, 4)).toEqual([
      '-c',
      'features.plugins=false',
      '-c',
      'mcp_servers.github.enabled=false',
    ]);
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

  it('stops listing when the turn is stopped while it prepares', async () => {
    const slow = join(dir, 'codex-slow');
    writeFileSync(slow, '#!/bin/sh\n[ "$1" = mcp ] && exec sleep 20\nexit 1\n');
    chmodSync(slow, 0o755);
    const run = codexLive({ command: slow, onlyTaskMcpServers: 'when-listed' }).run({ prompt: 'go', cwd: dir });
    const started = Date.now();
    setTimeout(() => run.abort(), 50);
    expect(await run.result).toMatchObject({ status: 'aborted' });
    expect(Date.now() - started).toBeLessThan(5_000);
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
    expect(prepared.args.slice(2, 10)).toEqual([
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

  it('drops the question channel in prepareCodexLive when Codex offers its own request_user_input', async () => {
    const channel = await startQuestionChannel({ name: 'choices' });
    const unrelatedSameName = { name: 'genaicode_ask', url: 'https://mcp.example/custom' };
    const command = fakeCli('codex-plan', [{ name: 'github' }]);
    const base = { prompt: 'plan', cwd: dir, mcpServers: [app, unrelatedSameName, channel.mcpServer] };
    try {
      // Normal mode: every server reaches Codex.
      const normal = await prepareCodexLive(base, { command });
      expect(normal.args.join(' ')).toContain('mcp_servers.choices.url=');
      expect(normal.args.join(' ')).toContain('mcp_servers.genaicode_ask.url=');
      expect(normal.args.join(' ')).toContain('mcp_servers.app.url=');

      // Plan mode (task.mode or options.collaborationMode) or feature flag: only the tagged question channel is dropped;
      // unrelated caller servers (even one named genaicode_ask) stay attached.
      for (const [task, opts] of [
        [{ ...base, mode: 'plan' as const }, { command }],
        [base, { command, collaborationMode: 'plan' as const }],
        [{ ...base, extraArgs: ['-c', 'features.default_mode_request_user_input=true'] }, { command }],
        [{ ...base, extraArgs: ['-cfeatures.default_mode_request_user_input=true'] }, { command }],
        [{ ...base, extraArgs: ['--enable', 'default_mode_request_user_input'] }, { command }],
        [{ ...base, extraArgs: ['--enable=default_mode_request_user_input'] }, { command }],
        [{ ...base, extraArgs: ['--config=features.default_mode_request_user_input = true'] }, { command }],
      ] as const) {
        const prepared = await prepareCodexLive(task, opts);
        expect(prepared.args.join(' ')).not.toContain('mcp_servers.choices');
        expect(prepared.args.join(' ')).toContain('mcp_servers.genaicode_ask.url=');
        expect(prepared.args.join(' ')).toContain('mcp_servers.app.url=');
      }

      // Codex CLI precedence: --disable beats --enable, which beats -c/--config.
      expect(
        codexHasOwnQuestionTool({
          extraArgs: [
            '--disable',
            'default_mode_request_user_input',
            '-c',
            'features.default_mode_request_user_input=true',
          ],
        }),
      ).toBe(false);
      expect(
        codexHasOwnQuestionTool({
          extraArgs: [
            '--enable',
            'default_mode_request_user_input',
            '-c',
            'features.default_mode_request_user_input=false',
          ],
        }),
      ).toBe(true);
      expect(
        codexHasOwnQuestionTool({
          extraArgs: ['--disable', 'default_mode_request_user_input', '--enable', 'default_mode_request_user_input'],
        }),
      ).toBe(false);
      expect(
        codexHasOwnQuestionTool(
          {
            mode: 'default',
            extraArgs: [
              '-c',
              'features.default_mode_request_user_input=true',
              '--disable',
              'default_mode_request_user_input',
            ],
          },
          { collaborationMode: 'plan' },
        ),
      ).toBe(false);
      expect(codexHasOwnQuestionTool({ extraArgs: ['--', '--enable', 'default_mode_request_user_input'] })).toBe(false);

      // Resuming a saved Codex Plan thread with mode omitted also drops the question channel.
      const codexHome = join(dir, 'codex-home');
      const rollouts = join(codexHome, 'sessions', '2026', '11', '23');
      mkdirSync(rollouts, { recursive: true });
      const threadId = '11111111-2222-3333-4444-555555555555';
      writeFileSync(
        join(rollouts, `rollout-2026-11-23T00-00-00-${threadId}.jsonl`),
        [
          JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: dir } }),
          JSON.stringify({ type: 'turn_context', payload: { cwd: dir, collaboration_mode: { mode: 'plan' } } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'plan it' } }),
        ].join('\n') + '\n',
      );
      const resumedPlan = await prepareCodexLive(
        {
          prompt: 'continue',
          cwd: dir,
          resume: threadId,
          env: { CODEX_HOME: codexHome },
          mcpServers: [app, markQuestionChannelServer({ name: 'genaicode_ask', url: 'http://127.0.0.1:2/mcp' })],
        },
        { command },
      );
      expect(resumedPlan.args.join(' ')).not.toContain('genaicode_ask');
      expect(resumedPlan.args.join(' ')).toContain('mcp_servers.app.url=');
      // Explicit mode: 'default' leaves Plan mode and keeps the question channel.
      const leavingPlan = await prepareCodexLive(
        {
          prompt: 'implement',
          cwd: dir,
          resume: threadId,
          mode: 'default',
          env: { CODEX_HOME: codexHome },
          mcpServers: [app, markQuestionChannelServer({ name: 'genaicode_ask', url: 'http://127.0.0.1:2/mcp' })],
        },
        { command },
      );
      expect(leavingPlan.args.join(' ')).toContain('mcp_servers.genaicode_ask.url=');
    } finally {
      await channel.close();
    }
  });
});
