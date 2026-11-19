import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runHook } from '../../cli/hook.js';
import type { LiveRecord } from './live.js';
import { noticeFor, notifyFile, readNotify, sendNotice, writeNotify, type Notice } from './notify.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-notify-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let homes = 0;
const home = () => ({ HOME: join(root, `h${(homes += 1)}`) });

const record = (over: Partial<LiveRecord>): LiveRecord => ({
  agent: 'claude',
  id: 's',
  state: 'working',
  at: 1,
  cwd: '/work/api',
  ...over,
});
const on = { approval: true, done: false };

describe('notifications', () => {
  it('keeps the settings beside the hook reports, off until turned on', async () => {
    const env = home();
    expect(await readNotify(env)).toEqual({ approval: false, done: false });
    await writeNotify({ approval: true, done: true }, env);
    expect(await readNotify(env)).toEqual({ approval: true, done: true });
    expect(notifyFile(env)).toBe(join(env.HOME, '.genaicode', 'notify.json'));
    expect(statSync(notifyFile(env)).mode & 0o777).toBe(0o600);
  });

  it('tells of a new question, not of one already known', () => {
    const asks = record({ state: 'approval', tool: 'Bash', asks: [{ tool: 'Bash', key: 'a' }] });
    expect(noticeFor(record({}), asks, on)).toEqual({ title: 'claude asks for approval', body: 'api: Bash' });
    expect(noticeFor(asks, asks, on)).toBeUndefined();
    const two = record({ state: 'approval', tool: 'Bash', asks: [{ tool: 'Bash' }, { tool: 'Edit' }] });
    expect(noticeFor(asks, two, on)).toEqual({ title: 'claude asks for approval', body: 'api: Edit' });
    const again = record({
      state: 'approval',
      tool: 'Bash',
      asks: [
        { tool: 'Bash', key: 'a' },
        { tool: 'Bash', key: 'a' },
      ],
    });
    expect(noticeFor(asks, again, on)).toBeUndefined();
    expect(noticeFor(record({}), asks, { approval: false, done: false })).toBeUndefined();
  });

  it('tells of a turn that ended only when asked to', () => {
    const idle = record({ state: 'idle' });
    expect(noticeFor(record({}), idle, on)).toBeUndefined();
    expect(noticeFor(record({}), idle, { approval: true, done: true })).toEqual({
      title: 'claude finished its turn',
      body: 'api: your move',
    });
    expect(noticeFor(idle, idle, { approval: true, done: true })).toBeUndefined();
  });

  it('passes the text as arguments, never through a shell', () => {
    const calls: Array<[string, string[]]> = [];
    const run = (command: string, args: string[]) => void calls.push([command, args]);
    const notice = { title: 'claude asks "x"', body: "it's; rm -rf" };
    expect(sendNotice(notice, { platform: 'darwin', run })).toBe(true);
    expect(calls[0]![0]).toBe('osascript');
    expect(calls[0]![1].slice(-2)).toEqual([notice.title, notice.body]);
    expect(sendNotice(notice, { platform: 'linux', run })).toBe(true);
    expect(calls[1]).toEqual(['notify-send', ['--app-name=genaicode', '--', notice.title, notice.body]]);
    expect(sendNotice(notice, { platform: 'win32', run })).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('has the hook send one when a session asks, once per question', async () => {
    const env = home();
    const sent: Notice[] = [];
    const send = (notice: Notice) => void sent.push(notice);
    const out = { write: () => undefined };
    const hook = (event: Record<string, unknown>) =>
      runHook('claude', JSON.stringify({ session_id: 's', cwd: '/work/api', ...event }), env, out, send);
    const ask = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } };
    await hook({ hook_event_name: 'UserPromptSubmit' });
    await hook(ask);
    expect(sent).toEqual([]);
    await writeNotify({ approval: true, done: false }, env);
    await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    await hook(ask);
    await hook(ask);
    await hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    expect(sent).toEqual([{ title: 'claude asks for approval', body: 'api: Bash' }]);
    await hook({ hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: 'a.ts' } });
    expect(sent[1]).toEqual({ title: 'claude asks for approval', body: 'api: Edit' });
  });
});
