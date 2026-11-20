import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runHook } from '../../cli/hook.js';
import { outputText } from '../mcp-tools.js';
import { listSessions, sessionTools, type SessionSource } from './index.js';
import { inputKey, liveDir, liveRecord } from './live.js';
import { writeNotify, type Notice } from './notify.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(agent: string) {
  const home = mkdtempSync(join(tmpdir(), 'command-preview-'));
  dirs.push(home);
  const env = { HOME: home };
  const file = join(home, 'events.jsonl');
  const source: SessionSource = {
    name: agent,
    where: 'local',
    list: async () => [
      { source: agent, agent, where: 'local', id: 'test', path: file, cwd: '/orchard', updatedAt: Date.now() },
    ],
  };
  const journal = (events: unknown[]) =>
    writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  const notices: Notice[] = [];
  const hook = (name: string, data: object = {}) =>
    runHook(
      agent,
      JSON.stringify({ session_id: 'test', cwd: '/orchard', ...data }),
      env,
      { write: () => {} },
      (notice) => notices.push(notice),
      name,
    );
  const waiting = async () => (await listSessions([source], { env })).sessions[0]!.waitingCommands;
  const tower = sessionTools([source], { env }).find((tool) => tool.name === 'sessions_waiting')!;
  return { env, file, journal, hook, waiting, notices, tower };
}

describe('pending shell commands', () => {
  it('keeps separate requests for the same command with different shell arguments', async () => {
    const { env, hook } = fixture('copilot');
    const first = { command: 'pwd', directory: '/orchard/a' };
    const second = { command: 'pwd', directory: '/orchard/b' };
    await hook('permissionRequest', { toolName: 'bash', toolInput: first });
    await hook('postToolUse', { toolName: 'bash', toolArgs: { command: 'pwd' } });
    expect(await liveRecord('copilot', 'test', env)).toMatchObject({
      state: 'approval',
      asks: [{ key: inputKey(first) }],
    });
    await hook('permissionRequest', { toolName: 'bash', toolInput: second });
    await hook('postToolUse', { toolName: 'bash', toolArgs: { command: 'pwd' } });
    expect((await liveRecord('copilot', 'test', env))?.asks).toHaveLength(2);
    await hook('postToolUse', { toolName: 'bash', toolArgs: second });
    expect((await liveRecord('copilot', 'test', env))?.asks?.map((ask) => ask.key)).toEqual([inputKey(first)]);
  });

  it('matches each native Copilot request and drops its preview at the decision, before the tool finishes', async () => {
    const { env, journal, hook, waiting, notices, tower } = fixture('copilot');
    await writeNotify({ approval: true, done: false }, env);
    const first = 'printf ' + 'x'.repeat(250) + 'first';
    const second = 'printf second';
    const requested = (id: string, command: string) => ({
      type: 'permission.requested',
      data: { requestId: id, permissionRequest: { kind: 'shell', shellType: 'bash', fullCommandText: command } },
    });
    const events = [requested('1', first), requested('2', second), requested('3', first.replace('first', 'unrelated'))];
    journal(events);
    await hook('permissionRequest', { toolName: 'bash', toolInput: { command: first, directory: '/orchard' } });
    await hook('permissionRequest', { toolName: 'bash', toolInput: { command: second } });
    const expected = [
      { tool: 'bash', command: first.slice(0, 199) + '…' },
      { tool: 'bash', command: second },
    ];
    expect(await waiting()).toEqual(expected);
    expect(outputText(await tower.call({}))).toContain('? bash: printf second');
    expect(notices.map((n) => n.body)).toEqual(['orchard: bash', 'orchard: bash']);
    const [record] = readdirSync(liveDir(env));
    const path = join(liveDir(env), record!);
    expect(readFileSync(path, 'utf8')).not.toContain('printf');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    const decided = (requestId: string) => ({ type: 'permission.completed', data: { requestId } });
    journal([...events, decided('1')]);
    expect(await waiting()).toEqual([expected[1]]);
    await hook('postToolUse', { toolName: 'bash', toolArgs: { command: second, timeout: 30 } });
    expect(await waiting()).toEqual([expected[1]]);
    journal([...events, decided('1'), decided('2')]);
    expect(await waiting()).toBeUndefined();
  });

  it('matches a Gemini shell notification to the native call, including completion, and never guesses from a pending adjacent tool', async () => {
    const { env, file, journal, hook, waiting, notices } = fixture('gemini');
    await writeNotify({ approval: true, done: false }, env);
    const command = 'printf\t\x1b[31mhello\x1b[0m\x07';
    const calls = (status: string) => ({
      type: 'gemini',
      toolCalls: [
        { id: 'a', name: 'run_shell_command', args: { command, description: 'private description' }, status },
        { id: 'b', name: 'run_shell_command', args: { command: 'other command' }, status: 'scheduled' },
      ],
    });
    const notify = (details: object) => hook('Notification', { notification_type: 'ToolPermission', details });
    journal([calls('scheduled')]);
    await notify({ type: 'edit', fileDiff: 'private content' });
    expect(await waiting()).toBeUndefined();
    await notify({ type: 'exec', command });
    expect(await waiting()).toEqual([{ tool: 'run_shell_command', command: 'printf hello' }]);
    expect(JSON.stringify(notices)).not.toContain('printf');
    expect(readFileSync(join(liveDir(env), readdirSync(liveDir(env))[0]!), 'utf8')).not.toContain('printf');
    await hook('AfterTool', { tool_name: 'run_shell_command', tool_input: { command, dir_path: '/orchard' } });
    expect(await waiting()).toEqual([{ tool: 'run_shell_command', command: 'printf hello' }]);
    journal([calls('scheduled'), calls('success')]);
    expect(await waiting()).toBeUndefined();
    rmSync(file);
    expect(await waiting()).toBeUndefined();
  });
});
