import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultAgents } from '../defaults.js';
import { delegationBrief } from '../pack.js';
import { anthropicManaged } from '../drivers/anthropic-managed.js';
import { codexLive } from '../drivers/codex-live.js';
import { cursorCloud } from '../drivers/cursor-cloud.js';
import { geminiManaged } from '../drivers/gemini-managed.js';
import { openaiManaged } from '../drivers/openai-managed.js';
import { museLive } from '../drivers/muse-live.js';
import {
  agentSessionSources,
  antigravitySessions,
  codexProjects,
  codexSessions,
  copilotSessions,
  cursorSessions,
  geminiSessions,
  listSessions,
  museSessions,
  vibeSessions,
} from './index.js';

const home = mkdtempSync(join(tmpdir(), 'genaicode-stores-test-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const env = { HOME: home };

function write(file: string, content: string): string {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return file;
}

interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): { run(...values: unknown[]): unknown };
  close(): void;
}
// Typed here: the project's Node types predate `node:sqlite`.
const sqliteModule = 'node:sqlite';
const { DatabaseSync } = (await import(sqliteModule)) as { DatabaseSync: new (file: string) => Sqlite };

function database(file: string, schema: string, table: string, records: Record<string, unknown>[]): void {
  mkdirSync(join(file, '..'), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(schema);
  for (const record of records) {
    const keys = Object.keys(record);
    db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
      ...Object.values(record),
    );
  }
  db.close();
}

const jsonl = (...values: unknown[]) => values.map((value) => JSON.stringify(value)).join('\n') + '\n';
// Node 22.15 and later.
const zstdCompressSync = (zlib as { zstdCompressSync?: (data: string) => Buffer }).zstdCompressSync;
const T = Date.parse('2026-11-10T12:00:00.000Z');

describe('agent session stores', () => {
  it('resolves an old Codex thread by id before reading rollout activity', async () => {
    const dir = join(home, 'many-threads');
    const id = 'older-thread';
    const rollout = write(
      join(dir, 'old.jsonl'),
      jsonl(
        { type: 'session_meta', payload: { id, cwd: '/work/app' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Check' } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'Done' } },
      ),
    );
    database(join(dir, 'state_1.sqlite'), 'CREATE TABLE threads (id TEXT, updated_at_ms, rollout_path)', 'threads', [
      ...Array.from({ length: 201 }, (_, i) => ({ id: 'new-' + i, updated_at_ms: T + i + 1 })),
      { id, updated_at_ms: T, rollout_path: rollout },
    ]);
    const source = codexSessions({ dir });
    expect(await source.find!('older-thr')).toMatchObject([{ id, state: 'waiting' }]);
  });

  it('reads the Codex thread index, without subagents and archived threads', async () => {
    const rollout = write(
      join(
        home,
        '.codex',
        'sessions',
        '2026',
        '11',
        '10',
        'rollout-2026-11-10T12-00-00-01a1eb92-df5e-7792-87c0-f9f36a33dc4d.jsonl',
      ),
      jsonl(
        { type: 'session_meta', payload: { id: '01a1eb92-df5e-7792-87c0-f9f36a33dc4d', cwd: '/work/app' } },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'First ask' }] },
        },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Second ask' }] },
        },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All done.' }] },
        },
        {
          type: 'token_usage_record',
          payload: { thread_token_usage: { input_tokens: 40, output_tokens: 2, total_tokens: 42 } },
        },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ),
    );
    database(
      join(home, '.codex', 'state_5.sqlite'),
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path, cwd, title, name, first_user_message, model, tokens_used, git_branch, git_origin_url, created_at, updated_at, created_at_ms, updated_at_ms, source, archived)',
      'threads',
      [
        {
          id: '01a1eb92-df5e-7792-87c0-f9f36a33dc4d',
          rollout_path: rollout,
          cwd: '/work/app',
          title: 'Thread title',
          first_user_message: 'First ask',
          model: 'gpt-6',
          tokens_used: 1000,
          git_branch: 'main',
          created_at_ms: T - 5000,
          updated_at_ms: T,
          source: 'vscode',
          archived: 0,
        },
        // Codex compressed this rollout; the index still names the `.jsonl`.
        {
          id: 'packed',
          rollout_path: join(home, 'packed.jsonl'),
          cwd: '/work/app',
          updated_at_ms: T - 30_000,
          source: 'cli',
          archived: 0,
        },
        // The rollout is gone: the row is still listed.
        {
          id: 'old',
          rollout_path: join(home, 'gone.jsonl'),
          cwd: '/work/app',
          // An older pack() put its briefing in front; Codex took the first message as the title.
          title: `${delegationBrief([{ name: 'claude', installed: true, running: 0, steer: false }])}\n\nOld ask`,
          first_user_message: `${delegationBrief([])}\n\nOld ask`,
          updated_at: T / 1000 - 60,
          source: 'exec',
          archived: 0,
        },
        { id: 'helper', cwd: '/work/app', updated_at_ms: T, source: '{"subagent":"guardian"}', archived: 0 },
        { id: 'archived', cwd: '/work/app', updated_at_ms: T, source: 'vscode', archived: 1 },
      ],
    );
    write(join(home, '.codex', 'state_4.sqlite'), 'not the newest index');
    writeFileSync(
      join(home, 'packed.jsonl.zst'),
      (zstdCompressSync ?? String)(
        jsonl(
          { type: 'event_msg', payload: { type: 'user_message', message: 'Packed ask' } },
          { type: 'event_msg', payload: { type: 'agent_message', message: 'Packed reply.' } },
          { type: 'event_msg', payload: { type: 'task_complete' } },
        ),
      ),
    );
    const sessions = await codexSessions().list({ env });
    expect(sessions.map((session) => session.id)).toEqual(['01a1eb92-df5e-7792-87c0-f9f36a33dc4d', 'packed', 'old']);
    if (zstdCompressSync)
      expect(sessions[1]).toMatchObject({ lastPrompt: 'Packed ask', lastReply: 'Packed reply.', state: 'waiting' });
    expect(sessions[0]).toMatchObject({
      agent: 'codex',
      cwd: '/work/app',
      branch: 'main',
      title: 'Thread title',
      firstPrompt: 'First ask',
      lastPrompt: 'Second ask',
      lastReply: 'All done.',
      model: 'gpt-6',
      usage: { inputTokens: 40, outputTokens: 2, totalTokens: 42 },
      startedAt: T - 5000,
      updatedAt: T,
      state: 'waiting',
    });
    // The index says it was a `codex exec` run: nobody typed into it.
    expect(sessions[2]).toMatchObject({
      updatedAt: T - 60_000,
      automated: true,
      title: 'Old ask',
      firstPrompt: 'Old ask',
    });
    expect(sessions[0]!.automated).toBeUndefined();
    expect(sessions[2]!.state).toBeUndefined();

    // A rollout that grew is read again; one that did not gives the same.
    expect(await codexSessions().list({ env })).toEqual(sessions);
    appendFileSync(
      rollout,
      jsonl({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'One more thing.' }] },
      }),
    );
    expect((await codexSessions().list({ env }))[0]).toMatchObject({ lastReply: 'One more thing.' });
  });

  it("knows the Codex threads nobody started, and the desktop app's projects", async () => {
    const dir = join(home, 'codex-desktop');
    database(
      join(dir, 'state_5.sqlite'),
      'CREATE TABLE threads (id TEXT PRIMARY KEY, updated_at_ms, source, thread_source, originator)',
      'threads',
      [
        { id: 'typed', updated_at_ms: T, source: 'vscode', thread_source: 'user', originator: 'Codex Desktop' },
        { id: 'served', updated_at_ms: T - 1, source: 'vscode', thread_source: '', originator: 'Codex Desktop' },
        { id: 'studio', updated_at_ms: T - 2, source: 'vscode', thread_source: '', originator: 'genaicode' },
        { id: 'exec', updated_at_ms: T - 3, source: 'exec', thread_source: 'user', originator: 'codex_exec' },
        { id: 'tui', updated_at_ms: T - 4, source: 'cli', thread_source: 'user', originator: 'codex-tui' },
      ],
    );
    const listed = await codexSessions({ dir }).list({ env });
    expect(listed.map(({ id, automated }) => [id, automated])).toEqual([
      ['typed', undefined],
      ['served', true],
      ['studio', undefined],
      ['exec', true],
      ['tui', undefined],
    ]);
    expect(await codexProjects({ dir })).toEqual([]);
    const db = new DatabaseSync(join(dir, 'state_5.sqlite'));
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name); CREATE TABLE project_roots (project_id, path)');
    db.exec("INSERT INTO projects VALUES ('p1', 'Knights'), ('p2', 'No roots')");
    db.exec("INSERT INTO project_roots VALUES ('p1', '/work/knights'), ('p1', '/work/knights-art')");
    db.close();
    expect(await codexProjects({ dir })).toEqual([
      { id: 'p1', name: 'Knights', roots: ['/work/knights', '/work/knights-art'] },
    ]);
    expect(await codexProjects({ dir: join(home, 'no-codex') })).toEqual([]);
  });

  it('reads the Muse session index', async () => {
    database(
      join(home, '.local', 'share', 'muse', 'session-index.db'),
      'CREATE TABLE sessions (session_id TEXT PRIMARY KEY, session_log_path, workspace_root, model_id, git_branch, title, session_name, first_user_prompt, created_at_us, updated_at_us, msp_kind, status, msp_created_by_client_name, provider_id)',
      'sessions',
      [
        {
          session_id: 'm1',
          workspace_root: '/work/world',
          model_id: 'muse-spark-1.3',
          title: 'Auto title',
          session_name: 'Named',
          first_user_prompt: 'Paint the toast',
          created_at_us: (T - 1000) * 1000,
          updated_at_us: T * 1000,
          msp_kind: 'root',
          status: 'valid',
        },
        { session_id: 'm2', updated_at_us: T * 1000, msp_kind: 'subagent', status: 'valid' },
        {
          session_id: 'm4',
          msp_kind: 'root',
          updated_at_us: (T - 5) * 1000,
          msp_created_by_client_name: 'probe_client',
        },
        {
          session_id: 'm5',
          msp_kind: 'root',
          updated_at_us: (T - 6) * 1000,
          msp_created_by_client_name: 'genaicode',
          provider_id: 'echo',
        },
        {
          session_id: 'm6',
          msp_kind: 'root',
          updated_at_us: (T - 7) * 1000,
          msp_created_by_client_name: 'genaicode',
          provider_id: 'meta',
        },
        { session_id: 'm3', updated_at_us: T * 1000, msp_kind: 'root', status: 'corrupt' },
      ],
    );
    expect(await museSessions().list({ env })).toEqual([
      {
        source: 'muse',
        agent: 'muse',
        id: 'm1',
        where: 'local',
        cwd: '/work/world',
        title: 'Named',
        firstPrompt: 'Paint the toast',
        lastPrompt: 'Paint the toast',
        startedAt: T - 1000,
        updatedAt: T,
        model: 'muse-spark-1.3',
      },
      // A probe of the agent and its test provider: nobody's conversations.
      { source: 'muse', agent: 'muse', id: 'm4', where: 'local', updatedAt: T - 5, automated: true },
      { source: 'muse', agent: 'muse', id: 'm5', where: 'local', updatedAt: T - 6, automated: true },
      // An app built on genaicode started it: somebody's chat there.
      { source: 'muse', agent: 'muse', id: 'm6', where: 'local', updatedAt: T - 7 },
    ]);
  });

  it('reads both Antigravity summaries, newest row per conversation', async () => {
    const schema =
      'CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title, preview, last_modified_time, last_user_input_time, workspace_uris, status, nesting_depth, parent_conversation_id)';
    database(join(home, '.gemini', 'antigravity', 'conversation_summaries.db'), schema, 'conversation_summaries', [
      {
        conversation_id: 'a1',
        title: 'Fix ops console',
        last_modified_time: '2026-11-10 12:00:00.484148+00:00',
        workspace_uris: '["file:///work/ops"]',
        status: 'CASCADE_RUN_STATUS_IDLE',
        nesting_depth: 0,
      },
      { conversation_id: 'a2', title: 'child', last_modified_time: '2026-11-10 12:00:00+00:00', nesting_depth: 1 },
    ]);
    database(join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'), schema, 'conversation_summaries', [
      { conversation_id: 'a1', title: 'older copy', last_modified_time: '2026-11-09 12:00:00+00:00', nesting_depth: 0 },
      {
        conversation_id: 'a3',
        preview: 'Only a preview',
        last_modified_time: '2026-11-08 12:00:00+00:00',
        workspace_uris: '[]',
      },
    ]);
    const sessions = await antigravitySessions().list({ env });
    expect(sessions.map((session) => [session.id, session.title, session.cwd, session.state])).toEqual([
      ['a1', 'Fix ops console', '/work/ops', 'waiting'],
      ['a3', 'Only a preview', undefined, undefined],
    ]);
    expect(sessions[0]!.updatedAt).toBe(T + 484);
  });

  it('marks Antigravity runs a program started outside any project', async () => {
    const cliHome = { ...env, HOME: join(home, 'agy-cli') };
    const cli = 'CORTEX_TRAJECTORY_SOURCE_CLI';
    const at = '2026-11-10 12:00:00+00:00';
    database(
      join(cliHome.HOME, '.gemini', 'antigravity', 'conversation_summaries.db'),
      'CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title, last_modified_time, workspace_uris, source)',
      'conversation_summaries',
      [
        { conversation_id: 'app', last_modified_time: at, workspace_uris: '["file:///work/ops"]', source: '' },
        // A chat in an app built on genaicode runs the CLI in its project: somebody typed it.
        { conversation_id: 'studio', last_modified_time: at, workspace_uris: '["file:///work/diorama"]', source: cli },
        { conversation_id: 'errand', last_modified_time: at, workspace_uris: '[]', source: cli },
        {
          conversation_id: 'test',
          last_modified_time: at,
          workspace_uris: '["file:///Users/me/.gemini/antigravity/worktrees/genaicode/x"]',
          source: cli,
        },
        {
          conversation_id: 'task',
          last_modified_time: at,
          workspace_uris: '["file:///Users/me/.gemini/antigravity/worktrees/genaicode/y"]',
          source: '',
        },
      ],
    );
    const sessions = await antigravitySessions().list({ env: cliHome });
    expect(
      sessions
        .filter((session) => session.automated)
        .map((session) => session.id)
        .sort(),
    ).toEqual(['errand', 'test']);
  });

  it('reads Copilot workspaces and their events', async () => {
    const state = join(home, '.copilot', 'session-state');
    write(
      join(state, 'c1', 'workspace.yaml'),
      'id: c1\ncwd: /work/app\nbranch: feat\nrepository: org/app\nname: "Ship it"\ncreated_at: 2026-11-10T11:00:00.000Z\nupdated_at: 2026-11-10T12:00:00.000Z\n',
    );
    write(
      join(state, 'c1', 'events.jsonl'),
      jsonl(
        { type: 'user.message', data: { content: 'Ship the export' } },
        { type: 'assistant.message', data: { content: '', model: 'claude-sonnet-5' } },
        { type: 'tool.execution_start', data: {} },
        { type: 'assistant.message', data: { content: 'Shipped.', model: 'claude-sonnet-5' } },
        // A subagent's messages are not the conversation.
        { type: 'assistant.message', agentId: 'a1', data: { content: 'Helper says.', model: 'gpt-6-mini' } },
        { type: 'assistant.message', data: { content: 'Old helper.', model: 'gpt-6-mini', parentToolCallId: 't1' } },
      ),
    );
    write(join(state, 'c2', 'workspace.yaml'), 'id: c2\ncwd: /work/other\nupdated_at: 2026-11-09T12:00:00.000Z\n');
    // Opened and left with nothing said: no event log, unknown to the index.
    write(join(state, 'c3', 'workspace.yaml'), 'id: c3\ncwd: /work/empty\nupdated_at: 2026-11-10T13:00:00.000Z\n');
    write(join(state, 'c3', 'checkpoints', 'index.md'), '# Checkpoints\n');
    mkdirSync(join(home, '.copilot'), { recursive: true });
    const sqliteModule = 'node:sqlite';
    const { DatabaseSync } = (await import(sqliteModule)) as {
      DatabaseSync: new (file: string) => { exec(sql: string): void; close(): void };
    };
    const db = new DatabaseSync(join(home, '.copilot', 'session-store.db'));
    db.exec("CREATE TABLE sessions (id TEXT); INSERT INTO sessions VALUES ('c2');");
    db.close();
    const sessions = await copilotSessions().list({ env });
    expect(sessions.map((entry) => entry.id)).toEqual(['c1', 'c2']);
    expect(sessions[0]).toMatchObject({
      id: 'c1',
      cwd: '/work/app',
      branch: 'feat',
      repository: 'org/app',
      title: 'Ship it',
      firstPrompt: 'Ship the export',
      lastReply: 'Shipped.',
      model: 'claude-sonnet-5',
      updatedAt: T,
      state: 'waiting',
    });
    expect(sessions[1]).toMatchObject({ id: 'c2', cwd: '/work/other' });
    // Where its event log would be: reading falls back to the CLI's index when it is missing.
    expect(sessions[1]!.path).toMatch(/events\.jsonl$/);
  });

  it('reads Cursor chats, with the model from the chat database', async () => {
    const chat = join(home, '.cursor', 'chats', 'fe90cd9c', 'u1');
    write(
      join(chat, 'meta.json'),
      JSON.stringify({
        title: 'Bench',
        cwd: '/work/bench',
        createdAtMs: T - 10,
        updatedAtMs: T,
        hasConversation: true,
      }),
    );
    database(join(chat, 'store.db'), 'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)', 'meta', [
      {
        key: '0',
        value: Buffer.from(JSON.stringify({ lastUsedModel: 'grok-4.7', blobEncryptionKey: 'secret' })).toString('hex'),
      },
    ]);
    write(
      join(home, '.cursor', 'chats', 'fe90cd9c', 'u2', 'meta.json'),
      JSON.stringify({ hasConversation: false, updatedAtMs: T }),
    );
    const sessions = await cursorSessions().list({ env });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      agent: 'cursor',
      id: 'u1',
      title: 'Bench',
      cwd: '/work/bench',
      model: 'grok-4.7',
      updatedAt: T,
    });
    expect(JSON.stringify(sessions)).not.toContain('secret');
  });

  it('reads Vibe sessions with their token and cost totals', async () => {
    write(
      join(home, '.vibe', 'logs', 'session', 'session_20261110_120000_81979f86', 'meta.json'),
      JSON.stringify({
        session_id: '81979f86-48a5',
        start_time: '2026-11-10T11:00:00+00:00',
        end_time: '2026-11-10T12:00:00+00:00',
        git_branch: 'main',
        environment: { working_directory: '/work/games' },
        title: 'Tune the level',
        stats: {
          session_prompt_tokens: 900,
          session_completion_tokens: 100,
          session_total_llm_tokens: 1000,
          session_cost: 0.5,
        },
      }),
    );
    const [session] = await vibeSessions().list({ env });
    expect(session).toMatchObject({
      agent: 'vibe',
      id: '81979f86-48a5',
      cwd: '/work/games',
      branch: 'main',
      title: 'Tune the level',
      usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
      costUsd: 0.5,
    });
  });

  it('reads Gemini CLI chats and the project they belong to', async () => {
    const project = join(home, '.gemini', 'tmp', 'work');
    write(join(project, '.project_root'), '/work/site\n');
    write(
      join(project, 'chats', 'session-2026-11-10T12-00-94014439.jsonl'),
      jsonl(
        { sessionId: '94014439-aced', projectHash: 'abc', startTime: '2026-11-10T12:00:00.000Z', kind: 'main' },
        { type: 'user', content: [{ text: 'Summarize the repo' }] },
        { type: 'gemini', content: 'It is a site.', model: 'gemini-3.8-flash', tokens: { total: 10 } },
      ),
    );
    write(
      join(project, 'chats', 'session-2026-11-10T12-01-deadbeef.jsonl'),
      jsonl({ sessionId: 'deadbeef', kind: 'subagent' }, { type: 'user', content: [{ text: 'x' }] }),
    );
    const sessions = await geminiSessions().list({ env });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      agent: 'gemini',
      id: '94014439-aced',
      cwd: '/work/site',
      firstPrompt: 'Summarize the repo',
      lastReply: 'It is a site.',
      model: 'gemini-3.8-flash',
      startedAt: T,
    });
  });

  it('every built-in driver says where its sessions are, or that it has none', async () => {
    const agents = [...defaultAgents(), codexLive(), museLive()];
    const undeclared = agents.filter((agent) => agent.sessions === undefined).map((agent) => agent.name);
    expect(undeclared).toEqual([]);
    expect(agents.filter((agent) => agent.sessions === null).map((agent) => agent.name)).toEqual(['opencode']);
    const sources = agentSessionSources(agents);
    expect(sources.map((source) => source.name).sort()).toEqual(
      ['antigravity', 'claude', 'codex', 'copilot', 'cursor', 'gemini', 'muse', 'vibe'].sort(),
    );
    // A source's sessions carry the name of a driver that can resume them.
    const { sessions, errors } = await listSessions(sources, {
      env: { ...env, CLAUDE_CONFIG_DIR: join(home, 'none') },
      cwd: '/work',
    });
    expect(errors).toEqual([]);
    // Hosted drivers too: a cloud source where the platform lists sessions, `null` where it does not.
    const hosted = [
      anthropicManaged({ agent: 'agent_1', environment: 'env_1' }),
      cursorCloud(),
      geminiManaged(),
      openaiManaged(),
    ];
    expect(hosted.map((agent) => [agent.name, agent.sessions === null ? null : agent.sessions?.where])).toEqual([
      ['anthropicManaged', 'cloud'],
      ['cursorCloud', 'cloud'],
      ['geminiManaged', null],
      ['openaiManaged', null],
    ]);
    const names = new Set(agents.map((agent) => agent.name));
    expect(sessions.length).toBeGreaterThan(8);
    expect(sessions.filter((session) => !names.has(session.agent))).toEqual([]);
  });
});
