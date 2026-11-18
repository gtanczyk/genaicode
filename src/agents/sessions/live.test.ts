import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runHook } from '../../cli/hook.js';
import { hookCommand, hooksFile, hooksStatus, installHooks, uninstallHooks } from './hooks.js';
import { listSessions } from './index.js';
import { liveDir, liveEvent, readLive, recordHook, withLive } from './live.js';
import type { SessionInfo, SessionSource } from './types.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-live-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const home = (name: string) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return { HOME: dir };
};
const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id: 's-1',
  where: 'local',
  updatedAt: 1_000_000,
  state: 'unfinished',
  ...over,
});

describe('what a hook says about a session', () => {
  it('maps the events of Claude Code and Codex', () => {
    const at = (hook_event_name: string, more: object = {}) =>
      liveEvent({ session_id: 's-1', cwd: '/work', hook_event_name, ...more });
    expect(at('UserPromptSubmit', { prompt: 'secret words' })).toEqual({ id: 's-1', cwd: '/work', state: 'working' });
    expect(at('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf x' } })).toEqual({
      id: 's-1',
      cwd: '/work',
      state: 'approval',
      tool: 'Bash',
    });
    expect(at('Notification', { notification_type: 'permission_prompt' })?.state).toBe('approval');
    expect(at('Notification', { notification_type: 'idle_prompt' })?.state).toBe('idle');
    expect(at('Notification', { notification_type: 'auth_success' })).toBeUndefined();
    expect(at('PostToolUse')).toMatchObject({ state: 'working', onlyAfterApproval: true });
    expect(at('Stop', { last_assistant_message: 'Done.' })?.state).toBe('idle');
    expect(at('SessionStart', { source: 'startup' })?.state).toBe('idle');
    expect(at('SessionStart', { source: 'compact' })).toBeUndefined();
    expect(at('SessionEnd')?.state).toBe('ended');
    expect(at('PreCompact')).toBeUndefined();
    expect(liveEvent({ hook_event_name: 'Stop' })).toBeUndefined();
    expect(liveEvent('Stop')).toBeUndefined();
  });

  it('keeps one small private record per session, without what was said', async () => {
    const env = home('records');
    const say = (hook_event_name: string, now: number, more: object = {}) =>
      recordHook('claude', { session_id: 's-1', cwd: '/work', hook_event_name, ...more }, { env, now });
    await say('UserPromptSubmit', 100, { prompt: 'secret words' });
    // A tool that needed no approval changes nothing.
    expect(await say('PostToolUse', 110, { tool_name: 'Read' })).toBeUndefined();
    await say('PermissionRequest', 120, { tool_name: 'Bash', tool_input: { command: 'secret command' } });
    expect([...(await readLive(env, 200)).values()]).toEqual([
      { agent: 'claude', id: 's-1', state: 'approval', at: 120, cwd: '/work', tool: 'Bash' },
    ]);
    const [file] = readdirSync(liveDir(env));
    expect(file).toBe('claude-s-1.json');
    expect(readFileSync(join(liveDir(env), file!), 'utf8')).not.toContain('secret');
    if (process.platform !== 'win32') expect(statSync(join(liveDir(env), file!)).mode & 0o777).toBe(0o600);
    // An event that ran earlier does not replace a later one's record.
    expect(await say('UserPromptSubmit', 90)).toBeUndefined();
    expect(await say('PostToolUse', 130)).toMatchObject({ state: 'working' });
    expect((await say('Stop', 140))?.tool).toBeUndefined();
    await say('SessionEnd', 150);
    expect((await readLive(env, 200)).size).toBe(0);
  });

  it('names the file after a hash when the id is not a plain one, and drops old records', async () => {
    const env = home('odd');
    await recordHook('codex', { session_id: '../../etc/passwd', hook_event_name: 'Stop' }, { env, now: 1000 });
    const names = readdirSync(liveDir(env));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^codex-[0-9a-f]{32}\.json$/);
    expect((await readLive(env, 2000)).get('codex:../../etc/passwd')?.state).toBe('idle');
    expect((await readLive(env, 1000 + 8 * 24 * 3600_000)).size).toBe(0);
    expect(readdirSync(liveDir(env))).toHaveLength(0);
    writeFileSync(join(liveDir(env), 'broken.json'), '{');
    expect((await readLive(env)).size).toBe(0);
  });

  it('runs as the hook command without ever failing the agent', async () => {
    const env = home('command');
    const out: string[] = [];
    const stdout = { write: (text: string) => out.push(text) };
    expect(
      await runHook('codex', JSON.stringify({ session_id: 't', hook_event_name: 'UserPromptSubmit' }), env, stdout),
    ).toBe(0);
    expect(out).toEqual([]);
    expect(await runHook('codex', JSON.stringify({ session_id: 't', hook_event_name: 'Stop' }), env, stdout)).toBe(0);
    expect(out).toEqual(['{}\n']);
    expect(await runHook('codex', 'not json', env, stdout)).toBe(0);
    expect(await runHook(undefined, undefined, env, stdout)).toBe(0);
    expect((await readLive(env)).get('codex:t')?.state).toBe('idle');
  });
});

describe('sessions with what the hooks reported', () => {
  const live = (state: 'working' | 'approval' | 'idle', at: number, tool?: string) =>
    new Map([['claude:s-1', { agent: 'claude', id: 's-1', state, at, ...(tool ? { tool } : {}) }]]);

  it('says what a session waits for', () => {
    expect(withLive([session()], live('approval', 1_000_500, 'Bash'), 1_100_000)).toEqual([
      session({ state: 'waiting', waitingFor: 'approval', waitingTool: 'Bash', updatedAt: 1_000_500 }),
    ]);
    expect(withLive([session({ state: 'active' })], live('idle', 999_990), 1_100_000)[0]).toMatchObject({
      state: 'waiting',
      waitingFor: 'reply',
      updatedAt: 1_000_000,
    });
    expect(withLive([session()], live('working', 1_000_100), 1_100_000)[0]).toMatchObject({ state: 'active' });
    expect(withLive([session({ id: 'other' })], live('idle', 1_000_000), 1_100_000)[0]).toEqual(
      session({ id: 'other' }),
    );
  });

  it('leaves out a record the session has moved past', () => {
    // Written to long after the agent stopped: the hooks missed something.
    expect(
      withLive([session({ updatedAt: 2_000_000 })], live('approval', 1_000_000), 2_000_100)[0]!.waitingFor,
    ).toBeUndefined();
    // "Working" with nothing written for half an hour: the agent is gone.
    const later = 1_000_000 + 31 * 60_000;
    expect(withLive([session()], live('working', 1_000_000), later)[0]!.state).toBe('unfinished');
  });

  it('is part of listSessions unless asked not to', async () => {
    const env = home('listed');
    const source: SessionSource = {
      name: 'claude',
      where: 'local',
      list: async () => [session({ updatedAt: Date.now() - 5000 })],
    };
    await recordHook('claude', { session_id: 's-1', hook_event_name: 'PermissionRequest', tool_name: 'Edit' }, { env });
    expect((await listSessions([source], { env })).sessions[0]).toMatchObject({
      waitingFor: 'approval',
      waitingTool: 'Edit',
    });
    expect((await listSessions([source], { env, live: false })).sessions[0]!.waitingFor).toBeUndefined();
  });
});

describe('installing the hook', () => {
  const command = '"/usr/bin/node" "/opt/genaicode/dist/cli.js" hook';

  it("adds it beside the user's own hooks, replaces an earlier install and takes it out again", async () => {
    const env = home('claude-hooks');
    const file = hooksFile('claude', env);
    mkdirSync(join(env.HOME, '.claude'));
    const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-check.sh' }] };
    writeFileSync(
      file,
      JSON.stringify({
        model: 'opus',
        hooks: { PreToolUse: [mine], Stop: [{ hooks: [{ type: 'command', command: 'beep' }] }] },
      }),
    );
    expect(await hooksStatus('claude', { env, command })).toMatchObject({ installed: false, events: [] });

    await installHooks('claude', { env, command: '"/old/node" "/old/cli.js" hook' });
    expect((await hooksStatus('claude', { env, command })).installed).toBe(false);
    const status = await installHooks('claude', { env, command });
    expect(status.installed).toBe(true);
    expect(status.command).toBe(hookCommand('claude', command));
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.model).toBe('opus');
    expect(written.hooks.PreToolUse).toEqual([mine]);
    expect(written.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'beep' }] },
      { hooks: [{ type: 'command', command: hookCommand('claude', command), timeout: 10, async: true }] },
    ]);
    // The session's end is waited for: a background hook would be cut off.
    expect(written.hooks.SessionEnd[0].hooks[0].async).toBeUndefined();
    expect(written.hooks.Notification).toHaveLength(1);

    expect(await uninstallHooks('claude', { env })).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      model: 'opus',
      hooks: { PreToolUse: [mine], Stop: [{ hooks: [{ type: 'command', command: 'beep' }] }] },
    });
    expect(await uninstallHooks('claude', { env })).toBe(false);
  });

  it('writes hooks.json for Codex and leaves a broken file alone', async () => {
    const env = { ...home('codex-hooks'), CODEX_HOME: join(root, 'codex-home') };
    const status = await installHooks('codex', { env, command });
    expect(status.file).toBe(join(root, 'codex-home', 'hooks.json'));
    expect(status.events).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PermissionRequest',
      'PostToolUse',
      'Stop',
      'SessionEnd',
    ]);
    expect(await uninstallHooks('codex', { env })).toBe(true);
    expect(JSON.parse(readFileSync(status.file, 'utf8'))).toEqual({});

    writeFileSync(status.file, '{ broken');
    await expect(installHooks('codex', { env, command })).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(status.file, 'utf8')).toBe('{ broken');
  });
});
