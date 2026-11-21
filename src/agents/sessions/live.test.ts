import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
    const asked = at('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf x' } });
    expect(asked).toMatchObject({ id: 's-1', cwd: '/work', state: 'approval', ask: { tool: 'Bash' } });
    expect(asked!.ask!.key).toMatch(/^[0-9a-f]{16}$/);
    // The finished call is the one asked about, whatever reason Codex gave for the approval.
    expect(at('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf x' } })!.answered).toEqual(asked!.ask);
    expect(
      at('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf x', description: 'why' } })!.ask,
    ).toEqual(asked!.ask);
    expect(at('Interrupt')?.state).toBe('idle');
    expect(at('Notification', { notification_type: 'permission_prompt' })?.state).toBe('approval');
    expect(at('Notification', { notification_type: 'idle_prompt' })?.state).toBe('idle');
    expect(at('Notification', { notification_type: 'auth_success' })).toBeUndefined();
    expect(at('PostToolUse')).toMatchObject({ state: 'working', answered: {} });
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
    // A tool that needed no approval changes no state.
    expect(await say('PostToolUse', 110, { tool_name: 'Read' })).toBeUndefined();
    expect((await readLive(env, 200)).get('claude:s-1')).toMatchObject({ state: 'working', at: 100, seen: 110 });
    // A question whose hook ran late, after its tool was already seen finishing, is not kept.
    expect(await say('PermissionRequest', 105, { tool_name: 'Read' })).toBeUndefined();
    await say('PermissionRequest', 120, { tool_name: 'Bash', tool_input: { command: 'secret command' } });
    expect([...(await readLive(env, 200)).values()]).toMatchObject([
      { agent: 'claude', id: 's-1', state: 'approval', at: 120, cwd: '/work', tool: 'Bash', asks: [{ tool: 'Bash' }] },
    ]);
    const [file] = readdirSync(liveDir(env));
    expect(file).toBe('claude-s-1.json');
    expect(readFileSync(join(liveDir(env), file!), 'utf8')).not.toContain('secret');
    if (process.platform !== 'win32') expect(statSync(join(liveDir(env), file!)).mode & 0o777).toBe(0o600);
    // An event that ran earlier does not replace a later one's record.
    expect(await say('UserPromptSubmit', 90)).toBeUndefined();
    // Another tool finishing beside it leaves the question open; a reminder adds none.
    expect(await say('PostToolUse', 125, { tool_name: 'Read', tool_input: { file_path: 'a' } })).toBeUndefined();
    await say('Notification', 126, { notification_type: 'permission_prompt' });
    expect((await readLive(env, 200)).get('claude:s-1')).toMatchObject({ state: 'approval', asks: [{ tool: 'Bash' }] });
    // Two questions: the session asks until both are answered.
    await say('PermissionRequest', 127, { tool_name: 'Edit', tool_input: { file_path: 'b' } });
    expect(
      await say('PostToolUse', 128, { tool_name: 'Bash', tool_input: { command: 'secret command' } }),
    ).toMatchObject({ state: 'approval', tool: 'Edit' });
    expect(await say('PostToolUseFailure', 130, { tool_name: 'Edit', tool_input: { file_path: 'b' } })).toMatchObject({
      state: 'working',
    });
    expect((await say('Stop', 140))?.tool).toBeUndefined();
    // A tool after the turn's end: another Stop hook sent the agent back to work.
    expect(await say('PostToolUse', 142, { tool_name: 'Read' })).toMatchObject({ state: 'working', at: 142 });
    await say('Stop', 143);
    await say('SessionEnd', 150);
    expect((await readLive(env, 200)).size).toBe(0);
    // A hook that started before the end and finishes after it does not bring the session back.
    expect(await say('UserPromptSubmit', 145)).toBeUndefined();
    expect(await say('PostToolUse', 160)).toBeUndefined();
    expect((await readLive(env, 200)).size).toBe(0);
    // Resumed later, it reports again; the note of the end goes after an hour.
    expect(await say('SessionStart', 170, { source: 'resume' })).toMatchObject({ state: 'idle' });
    await say('SessionEnd', 180);
    expect(readdirSync(liveDir(env))).toHaveLength(1);
    await readLive(env, 180 + 3600_001);
    expect(readdirSync(liveDir(env))).toHaveLength(0);
  });

  it('counts a reminder that came before its question once', async () => {
    const env = home('reminder-first');
    const say = (hook_event_name: string, now: number, more: object = {}) =>
      recordHook('claude', { session_id: 's-2', hook_event_name, ...more }, { env, now });
    await say('UserPromptSubmit', 1);
    await say('Notification', 2, { notification_type: 'permission_prompt' });
    await say('PermissionRequest', 3, { tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect((await readLive(env, 10)).get('claude:s-2')!.asks).toHaveLength(1);
    expect(await say('PostToolUse', 4, { tool_name: 'Bash', tool_input: { command: 'ls' } })).toMatchObject({
      state: 'working',
    });
  });

  it('keeps a question that the hook of another tool overtook', async () => {
    const env = home('overtaken');
    const say = (hook_event_name: string, now: number, more: object = {}) =>
      recordHook('claude', { session_id: 's-3', hook_event_name, ...more }, { env, now });
    await say('UserPromptSubmit', 1);
    // The Read finished after Bash asked, but its hook wrote first.
    await say('PostToolUse', 5, { tool_name: 'Read', tool_input: { file_path: 'a' } });
    await say('PermissionRequest', 4, { tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect((await readLive(env, 10)).get('claude:s-3')).toMatchObject({ state: 'approval', tool: 'Bash', seen: 5 });
    // The same for the end of a call asked about: learned late, it still answers its question.
    await say('PermissionRequest', 6, { tool_name: 'Edit', tool_input: { file_path: 'b' } });
    await say('PostToolUse', 7.5, { tool_name: 'Edit', tool_input: { file_path: 'b' } });
    await say('PostToolUse', 7, { tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect((await readLive(env, 10)).get('claude:s-3')).toMatchObject({ state: 'working', at: 7.5 });
    // A call whose end is learned before its question, both late: the question is over.
    await say('PostToolUse', 7.7, { tool_name: 'Read', tool_input: { file_path: 'c' } });
    await say('PostToolUse', 7.4, { tool_name: 'Bash', tool_input: { command: 'cat' } });
    await say('PermissionRequest', 7.3, { tool_name: 'Bash', tool_input: { command: 'cat' } });
    expect((await readLive(env, 10)).get('claude:s-3')).toMatchObject({ state: 'working' });
    // Once the turn is over, an old question is not asked any more.
    await say('Stop', 8);
    expect(await say('PermissionRequest', 6, { tool_name: 'Bash', tool_input: { command: 'pwd' } })).toBeUndefined();
    expect((await readLive(env, 10)).get('claude:s-3')!.state).toBe('idle');
    // Nor in the next turn, where the session works again.
    await say('UserPromptSubmit', 9);
    expect(await say('PermissionRequest', 6.5, { tool_name: 'Bash', tool_input: { command: 'id' } })).toBeUndefined();
    expect((await readLive(env, 10)).get('claude:s-3')!.state).toBe('working');
    // And the end of a call from the finished turn does not answer the same call asked again.
    await say('PermissionRequest', 9.5, { tool_name: 'Bash', tool_input: { command: 'ls' } });
    await say('PostToolUse', 7.2, { tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect((await readLive(env, 10)).get('claude:s-3')).toMatchObject({ state: 'approval', tool: 'Bash' });
  });

  it('takes hooks that run at the same moment one at a time', async () => {
    const env = home('together');
    const say = (hook_event_name: string, now: number) =>
      recordHook('claude', { session_id: 's-9', hook_event_name }, { env, now });
    await say('UserPromptSubmit', 1);
    await Promise.all(
      Array.from({ length: 12 }, (_, at) => say(at % 2 ? 'PermissionRequest' : 'PostToolUse', 10 + at)),
    );
    await say('Stop', 100);
    await Promise.all([say('PermissionRequest', 50), say('PostToolUse', 60), say('UserPromptSubmit', 70)]);
    expect((await readLive(env, 200)).get('claude:s-9')).toMatchObject({ state: 'idle', at: 100 });
    expect(readdirSync(liveDir(env))).toEqual(['claude-s-9.json']);
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
    // A question still open after a tool beside it finished: that hook confirms it.
    const open = new Map([
      ['claude:s-1', { agent: 'claude', id: 's-1', state: 'approval' as const, at: 1_000_000, seen: 1_120_000 }],
    ]);
    expect(withLive([session({ updatedAt: 1_121_000 })], open, 1_130_000)[0]!.waitingFor).toBe('approval');
    // Still written to long after the last hook ran: the hooks no longer report it.
    expect(
      withLive([session({ state: 'waiting', updatedAt: 9_000_000 })], live('working', 1_000_000), 9_000_100)[0]!.state,
    ).toBe('waiting');
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

  it('keeps a session whose hook is the latest news in a limited listing', async () => {
    const env = home('limited');
    const now = Date.now();
    const all = [session({ id: 'new', updatedAt: now - 60_000 }), session({ id: 'old', updatedAt: now - 300_000 })];
    const lists: Array<number | undefined> = [];
    const source: SessionSource = {
      name: 'claude',
      where: 'local',
      list: async (query) => (lists.push(query?.limit), all.slice(0, query?.limit)),
    };
    await recordHook('claude', { session_id: 'old', hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, { env });
    const { sessions } = await listSessions([source], { env, limit: 1 });
    expect(sessions.map((entry) => [entry.id, entry.waitingFor])).toEqual([['old', 'approval']]);
    expect(lists).toEqual([1, undefined]);
    // A store that looks ids up is not listed whole.
    const looked: string[] = [];
    const finder: SessionSource = {
      ...source,
      find: async (id) => (looked.push(id), all.filter((entry) => entry.id === id)),
    };
    expect((await listSessions([finder], { env, limit: 1 })).sessions[0]!.id).toBe('old');
    expect(looked).toEqual(['old']);
    // A sorting run of genaicode's own stays out, though its hook reported last.
    all[1] = session({ id: 'old', updatedAt: now - 300_000, firstPrompt: 'genaicode topics: sort...' });
    expect((await listSessions([finder], { env, limit: 1 })).sessions.map((entry) => entry.id)).toEqual(['new']);
    all[1] = session({ id: 'old', updatedAt: now - 300_000 });
    // The same for `since`: the file is older, the question is not.
    const dated: SessionSource = {
      ...source,
      list: async (query) => all.filter((entry) => entry.updatedAt >= (query?.since ?? 0)),
    };
    const recent = await listSessions([dated], { env, since: now - 120_000 });
    expect(recent.sessions.map((entry) => entry.id)).toEqual(['old', 'new']);
    expect((await listSessions([dated], { env, since: now - 120_000, live: false })).sessions).toHaveLength(1);
    expect((await listSessions([dated], { env, since: now + 60_000 })).sessions).toEqual([]);
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
    expect(written.hooks.StopFailure).toHaveLength(1);
    expect(written.hooks.PostToolUseFailure).toHaveLength(1);

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
      'Interrupt',
      'SessionEnd',
    ]);
    // Codex allows these two three seconds, and warns in every session when asked for more.
    const written = JSON.parse(readFileSync(status.file, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ timeout: number }> }>>;
    };
    expect(Object.entries(written.hooks).map(([event, [group]]) => [event, group!.hooks[0]!.timeout])).toEqual([
      ['SessionStart', 10],
      ['UserPromptSubmit', 10],
      ['PermissionRequest', 10],
      ['PostToolUse', 10],
      ['Stop', 10],
      ['Interrupt', 3],
      ['SessionEnd', 3],
    ]);
    expect(await uninstallHooks('codex', { env })).toBe(true);
    // Nothing else in it: the file goes.
    expect(existsSync(status.file)).toBe(false);

    writeFileSync(status.file, '{ broken');
    await expect(installHooks('codex', { env, command })).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(status.file, 'utf8')).toBe('{ broken');
  });
});
