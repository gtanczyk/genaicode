import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runHook } from '../../cli/hook.js';
import { hookInput, hookOutput } from './hook-input.js';
import { hookCommand, hooksFile, hooksStatus, installHooks, uninstallHooks } from './hooks.js';
import { readLive } from './live.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-hook-input-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let homes = 0;
const home = () => {
  const dir = join(root, `h${(homes += 1)}`);
  mkdirSync(dir, { recursive: true });
  return { HOME: dir };
};

/** Run the hook as `agent` would, and what it printed. */
async function hook(env: NodeJS.ProcessEnv, agent: string, input: unknown, event?: string) {
  const out: string[] = [];
  const send = () => undefined;
  await runHook(agent, JSON.stringify(input), env, { write: (text) => out.push(text) }, send, event);
  return out.join('');
}

describe("other agents' hooks", () => {
  it("puts Gemini's events in Claude Code's words", () => {
    const base = { session_id: 'g1', cwd: '/work/api', timestamp: '2026-11-20T00:00:00Z' };
    expect(hookInput('gemini', { ...base, hook_event_name: 'BeforeAgent', prompt: 'hi' })).toEqual({
      session_id: 'g1',
      cwd: '/work/api',
      hook_event_name: 'UserPromptSubmit',
    });
    expect(
      hookInput('gemini', {
        ...base,
        hook_event_name: 'AfterTool',
        tool_name: 'run_shell_command',
        tool_input: { command: 'ls' },
      }),
    ).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'run_shell_command', tool_input: { command: 'ls' } });
    expect(hookInput('gemini', { ...base, hook_event_name: 'AfterAgent' })).toMatchObject({ hook_event_name: 'Stop' });
    expect(
      hookInput('gemini', { ...base, hook_event_name: 'Notification', notification_type: 'ToolPermission' }),
    ).toEqual({
      session_id: 'g1',
      cwd: '/work/api',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    });
    expect(hookInput('gemini', { ...base, hook_event_name: 'BeforeModel' })).toBeUndefined();
    // Claude Code's and Codex's stay as they are.
    const claude = { session_id: 'c', hook_event_name: 'Stop' };
    expect(hookInput('claude', claude)).toBe(claude);
  });

  it("names Copilot's events from the command line and reads its arguments as JSON", () => {
    const base = { sessionId: 'p1', timestamp: 1, cwd: '/work/api' };
    const asked = hookInput(
      'copilot',
      { ...base, toolName: 'bash', toolArgs: '{"command":"ls"}' },
      'permissionRequest',
    );
    expect(asked).toEqual({
      session_id: 'p1',
      cwd: '/work/api',
      tool_name: 'bash',
      tool_input: { command: 'ls' },
      hook_event_name: 'PermissionRequest',
    });
    const ran = hookInput('copilot', { ...base, toolName: 'bash', toolArgs: { command: 'ls' } }, 'postToolUse');
    expect(ran).toMatchObject({ hook_event_name: 'PostToolUse', tool_input: { command: 'ls' } });
    expect(hookInput('copilot', base, 'agentStop')).toMatchObject({ hook_event_name: 'Stop' });
    expect(hookInput('copilot', base)).toBeUndefined();
  });

  it("reads Cursor's conversation and workspace", () => {
    const input = {
      conversation_id: 'k1',
      generation_id: 'x',
      hook_event_name: 'beforeSubmitPrompt',
      workspace_roots: ['/work/api'],
      prompt: 'hi',
    };
    expect(hookInput('cursor', input)).toEqual({
      session_id: 'k1',
      cwd: '/work/api',
      hook_event_name: 'UserPromptSubmit',
    });
    expect(hookInput('cursor', { ...input, hook_event_name: 'stop' })).toMatchObject({ hook_event_name: 'Stop' });
    expect(hookOutput('cursor', 'beforeSubmitPrompt')).toBe('{"continue":true}\n');
    expect(hookOutput('cursor', 'stop')).toBe('{}\n');
    expect(hookOutput('gemini', 'AfterTool')).toBe('{}\n');
    expect(hookOutput('claude', 'Stop')).toBe('{}\n');
    expect(hookOutput('claude', 'PostToolUse')).toBeUndefined();
  });

  it('tracks a Copilot session through a question, and lets a Cursor prompt through even on bad input', async () => {
    const env = home();
    const base = { sessionId: 'p1', timestamp: 1, cwd: '/work/api' };
    await hook(env, 'copilot', base, 'userPromptSubmitted');
    // The question carries `toolInput`, the finished call `toolArgs` as JSON text: the same call.
    await hook(env, 'copilot', { ...base, toolName: 'bash', toolInput: { command: 'ls' } }, 'permissionRequest');
    expect((await readLive(env)).get('copilot:p1')).toMatchObject({ state: 'approval', tool: 'bash' });
    await hook(env, 'copilot', { ...base, toolName: 'bash', toolArgs: '{"command":"ls"}' }, 'postToolUse');
    expect((await readLive(env)).get('copilot:p1')).toMatchObject({ state: 'working' });
    await hook(env, 'copilot', base, 'agentStop');
    expect((await readLive(env)).get('copilot:p1')).toMatchObject({ state: 'idle', cwd: '/work/api' });

    const out: string[] = [];
    await runHook('cursor', 'not json', env, { write: (text) => out.push(text) }, () => undefined);
    expect(out).toEqual(['{"continue":true}\n']);
    expect(await hook(env, 'cursor', { conversation_id: 'k1', hook_event_name: 'beforeSubmitPrompt' })).toBe(
      '{"continue":true}\n',
    );
    expect((await readLive(env)).get('cursor:k1')).toMatchObject({ state: 'working' });
  });

  it('installs in each agent its own way, beside what is there, and takes it out again', async () => {
    const env = { ...home(), PATH: '' };
    const command = '"/n" "/c.js" hook';

    // Gemini: groups in settings.json, milliseconds, a name for /hooks.
    const geminiFile = hooksFile('gemini', env);
    mkdirSync(join(env.HOME, '.gemini'), { recursive: true });
    writeFileSync(
      geminiFile,
      JSON.stringify({ theme: 'dark', hooks: { AfterTool: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }),
    );
    expect(await installHooks('gemini', { env, command })).toMatchObject({ installed: true });
    const gemini = JSON.parse(readFileSync(geminiFile, 'utf8'));
    expect(gemini.theme).toBe('dark');
    expect(gemini.hooks.AfterTool).toEqual([
      { hooks: [{ type: 'command', command: 'mine' }] },
      { hooks: [{ type: 'command', name: 'genaicode', command: hookCommand('gemini', command), timeout: 10_000 }] },
    ]);
    expect(Object.keys(gemini.hooks)).toEqual(
      expect.arrayContaining(['SessionStart', 'BeforeAgent', 'AfterAgent', 'Notification', 'SessionEnd']),
    );
    await uninstallHooks('gemini', { env });
    expect(JSON.parse(readFileSync(geminiFile, 'utf8'))).toEqual({
      theme: 'dark',
      hooks: { AfterTool: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
    });

    // Copilot: a file of its own, the event on the command line, gone on uninstall.
    const copilot = await installHooks('copilot', { env, command });
    expect(copilot).toMatchObject({ installed: true, file: join(env.HOME, '.copilot', 'hooks', 'genaicode.json') });
    const written = JSON.parse(readFileSync(copilot.file, 'utf8'));
    expect(written.version).toBe(1);
    expect(written.hooks.postToolUse).toEqual([
      {
        type: 'command',
        bash: `${command} copilot postToolUse --genaicode-live`,
        powershell: `& ${command} copilot postToolUse --genaicode-live`,
        timeoutSec: 10,
      },
    ]);
    expect((await hooksStatus('copilot', { env, command: '"/other" hook' })).installed).toBe(false);
    expect(await uninstallHooks('copilot', { env })).toBe(true);
    expect(existsSync(copilot.file)).toBe(false);
    // Its folder too, made for it.
    expect(existsSync(join(env.HOME, '.copilot', 'hooks'))).toBe(false);

    // Cursor: handlers listed as they are, beside the user's.
    const cursorFile = hooksFile('cursor', env);
    mkdirSync(join(env.HOME, '.cursor'), { recursive: true });
    writeFileSync(cursorFile, JSON.stringify({ version: 1, hooks: { stop: [{ command: './hooks/beep.sh' }] } }));
    expect(await installHooks('cursor', { env, command })).toMatchObject({ installed: true });
    const cursor = JSON.parse(readFileSync(cursorFile, 'utf8'));
    expect(cursor.hooks.stop).toEqual([
      { command: './hooks/beep.sh' },
      { command: hookCommand('cursor', command), timeout: 10 },
    ]);
    // Installed again: replaced, not doubled.
    await installHooks('cursor', { env, command });
    expect(JSON.parse(readFileSync(cursorFile, 'utf8')).hooks.stop).toHaveLength(2);
    expect(await uninstallHooks('cursor', { env })).toBe(true);
    expect(JSON.parse(readFileSync(cursorFile, 'utf8'))).toEqual({
      version: 1,
      hooks: { stop: [{ command: './hooks/beep.sh' }] },
    });
    // Only genaicode's in it: no `{"version":1}` left behind.
    writeFileSync(cursorFile, '{}');
    await installHooks('cursor', { env, command });
    await uninstallHooks('cursor', { env });
    expect(existsSync(cursorFile)).toBe(false);
  });

  it('says when the Node of the installed command is gone', async () => {
    const env = home();
    const node = join(env.HOME, 'node');
    writeFileSync(node, '');
    const command = `"${node}" "${node}" hook`;
    expect((await installHooks('claude', { env, command })).missing).toBeUndefined();
    rmSync(node);
    expect(await hooksStatus('claude', { env, command })).toMatchObject({ installed: true, missing: node });
  });
});
