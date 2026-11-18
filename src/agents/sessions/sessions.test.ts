import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_OK, main as runCli } from '../../cli/main.js';
import { claudeSessions, codexSessions, groupSessions, listSessions, type SessionSource } from './index.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-sessions-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const lines = (...values: unknown[]) => values.map((value) => JSON.stringify(value)).join('\n') + '\n';

/** Write a file last modified `minutesAgo`. */
function file(path: string, content: string, minutesAgo: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  const at = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(path, at, at);
}

const claudeDir = join(root, 'claude');
const user = (text: unknown, extra: object = {}) => ({
  type: 'user',
  cwd: '/work/app',
  gitBranch: 'feat/csv',
  timestamp: '2026-11-01T10:00:00.000Z',
  message: { role: 'user', content: text },
  ...extra,
});
const assistant = (content: unknown[]) => ({
  type: 'assistant',
  cwd: '/work/app/src',
  message: { role: 'assistant', model: 'claude-sonnet-5', content },
});

file(
  join(claudeDir, 'projects', '-work-app', 'aaaa.jsonl'),
  lines(
    user('<command-name>/model</command-name>'),
    user('Add CSV export\nwith tests'),
    assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    assistant([{ type: 'text', text: 'Done: export works.' }]),
    user('Now document it'),
    assistant([{ type: 'text', text: 'Documented in README.' }]),
    { type: 'ai-title', aiTitle: 'CSV export' },
    { type: 'cost-state', totalCostUSD: 1.25 },
  ),
  30,
);
// Stops in the middle of the agent's work.
file(
  join(claudeDir, 'projects', '-work-app', 'bbbb.jsonl'),
  lines(user('Fix the flaky test'), assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])),
  600,
);
// A subagent transcript and a file with no conversation are not sessions.
file(join(claudeDir, 'projects', '-work-app', 'aaaa', 'subagents', 'agent-1.jsonl'), lines(user('sub')), 5);
file(join(claudeDir, 'projects', '-work-app', 'cccc.jsonl'), lines({ type: 'mode', mode: 'normal' }), 5);
file(join(claudeDir, 'projects', '-work-other', 'dddd.jsonl'), lines(user('Just started', { cwd: '/work/other' })), 0);

const codexDir = join(root, 'codex');
const rollout = (id: string) =>
  join(codexDir, 'sessions', '2026', '11', '02', `rollout-2026-11-02T09-00-00-${id}.jsonl`);
const ID = '01234567-89ab-cdef-0123-456789abcdef';
file(
  rollout(ID),
  lines(
    {
      type: 'session_meta',
      payload: { id: ID, cwd: '/work/app', timestamp: '2026-11-02T09:00:00Z', git: { branch: 'main' } },
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }],
      },
    },
    { type: 'turn_context', payload: { cwd: '/work/app', model: 'gpt-5.5-codex' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Review the CSV export' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Two issues found.' } },
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } },
      },
    },
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ),
  90,
);

describe('session sources', () => {
  it('reads Claude Code transcripts', async () => {
    const sessions = await claudeSessions({ dir: claudeDir }).list();
    expect(sessions.map((session) => session.id)).toEqual(['dddd', 'aaaa', 'bbbb']);
    expect(sessions[1]).toMatchObject({
      agent: 'claude',
      where: 'local',
      cwd: '/work/app',
      branch: 'feat/csv',
      title: 'CSV export',
      firstPrompt: 'Add CSV export with tests',
      lastPrompt: 'Now document it',
      lastReply: 'Documented in README.',
      model: 'claude-sonnet-5',
      costUsd: 1.25,
      state: 'waiting',
      startedAt: Date.parse('2026-11-01T10:00:00.000Z'),
    });
    expect(sessions[2]).toMatchObject({ state: 'unfinished', lastPrompt: 'Fix the flaky test' });
    expect(sessions[0]).toMatchObject({ state: 'active', cwd: '/work/other' });
  });

  it('reads Codex rollouts', async () => {
    const [session, ...rest] = await codexSessions({ dir: codexDir }).list();
    expect(rest).toEqual([]);
    expect(session).toMatchObject({
      agent: 'codex',
      id: ID,
      cwd: '/work/app',
      branch: 'main',
      firstPrompt: 'Review the CSV export',
      lastReply: 'Two issues found.',
      model: 'gpt-5.5-codex',
      usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
      state: 'waiting',
    });
  });

  it('filters by directory, age and count, and finds nothing in a missing store', async () => {
    const source = claudeSessions({ dir: claudeDir });
    expect((await source.list({ cwd: '/work/app' })).map((session) => session.id)).toEqual(['aaaa', 'bbbb']);
    expect((await source.list({ since: Date.now() - 3_600_000 })).map((session) => session.id)).toEqual([
      'dddd',
      'aaaa',
    ]);
    expect((await source.list({ limit: 1 })).map((session) => session.id)).toEqual(['dddd']);
    expect(await claudeSessions({ dir: join(root, 'missing') }).list()).toEqual([]);
    expect(await codexSessions({ env: { CODEX_HOME: join(root, 'missing') } }).list()).toEqual([]);
  });

  it('merges sources, reports the ones that fail, and groups by project', async () => {
    const broken: SessionSource = { name: 'broken', where: 'cloud', list: () => Promise.reject(new Error('no token')) };
    const { sessions, errors } = await listSessions([
      claudeSessions({ dir: claudeDir }),
      codexSessions({ dir: codexDir }),
      broken,
    ]);
    expect(errors).toEqual([{ source: 'broken', message: 'no token' }]);
    expect(sessions.map((session) => `${session.agent}:${session.id.slice(0, 4)}`)).toEqual([
      'claude:dddd',
      'claude:aaaa',
      'codex:0123',
      'claude:bbbb',
    ]);
    expect(groupSessions(sessions).map((project) => [project.name, project.key, project.agents])).toEqual([
      ['other', '/work/other', { claude: 1 }],
      ['app', '/work/app', { claude: 2, codex: 1 }],
    ]);
  });
});

describe('genaicode sessions', () => {
  const run = async (...argv: string[]) => {
    let out = '';
    let err = '';
    const code = await runCli({
      argv: ['sessions', ...argv],
      env: { HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir },
      cwd: root,
      stdout: { write: (text: string) => void (out += text) },
      stderr: { write: (text: string) => void (err += text) },
      readStdin: async () => undefined,
    });
    return { code, out, err };
  };

  it('lists sessions by project', async () => {
    const { code, out } = await run();
    expect(code).toBe(EXIT_OK);
    expect(out).toContain('app  /work/app  (claude 2, codex 1)');
    expect(out).toMatch(/○ claude\s+30m\s+waiting\s+CSV export\s+aaaa/);
    expect(out).toMatch(/○ codex\s+2h\s+waiting\s+Review the CSV export\s+0123/);
    expect(out).toMatch(/◌ claude\s+10h\s+unfinished\s+Fix the flaky test\s+bbbb/);
  });

  it('takes filters and prints JSON', async () => {
    const { out } = await run('--json', '-a', 'codex', '--since', '1w', '-n', '5');
    const rows = out
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { agent: string });
    expect(rows.map((row) => row.agent)).toEqual(['codex']);
    expect((await run('-a', 'nobody')).err).toContain('No session store');
    expect((await run('-a', 'opencode')).err).toContain('No session store');
    expect((await run('-a', 'gemini')).out).toContain('No sessions found.');
    expect((await run('--since', 'soon')).err).toContain('--since expects');
  });
});
