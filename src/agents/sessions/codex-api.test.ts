import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { codexSessions } from './codex.js';
import { codexThreads, codexTurns, readCodexThread, type CodexServer } from './codex-api.js';
import { checkSessions } from './doctor.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-codex-api-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NOW = 1_800_000_000_000;
const thread = (id: string, updatedAt: number, more: object = {}) => ({
  id,
  preview: `prompt of ${id}`,
  ephemeral: false,
  parentThreadId: null,
  createdAt: updatedAt - 60,
  updatedAt,
  status: { type: 'notLoaded' },
  cwd: '/work/app',
  model: 'gpt-5.5-codex',
  gitInfo: { branch: 'main', originUrl: 'https://example.com/app.git', sha: null },
  name: null,
  path: null,
  ...more,
});

/** A server that answers from `pages` of threads and `turns`, and notes what it was asked. */
function fakeServer(pages: unknown[][], turns: unknown[] = []) {
  const asked: Array<{ method: string; params: Record<string, unknown> }> = [];
  const server: CodexServer = {
    async request(method, params) {
      asked.push({ method, params: params as Record<string, unknown> });
      if (method === 'thread/list') {
        const at = Number((params as { cursor: string | null }).cursor ?? 0);
        return { data: pages[at] ?? [], nextCursor: at + 1 < pages.length ? String(at + 1) : null };
      }
      if (method === 'thread/turns/list') return { data: turns, nextCursor: null };
      throw new Error(`unexpected ${method}`);
    },
    close() {},
  };
  return { server, asked };
}

describe('sessions asked of the Codex app server', () => {
  it('lists threads as sessions, page by page, until they are older than asked for', async () => {
    const seconds = NOW / 1000;
    const { server, asked } = fakeServer([
      [
        thread('a', seconds - 10, { name: 'Named', status: { type: 'active', activeFlags: ['waitingOnApproval'] } }),
        thread('helper', seconds - 20, { parentThreadId: 'a' }),
        thread('b', seconds - 3600, { cwd: '/work/other' }),
      ],
      [thread('c', seconds - 7200), thread('old', seconds - 90_000)],
      [thread('never', seconds - 99_000)],
    ]);
    const sessions = await codexThreads(server, { since: NOW - 86_400_000 }, NOW);
    expect(sessions.map((session) => session.id)).toEqual(['a', 'b', 'c']);
    expect(sessions[0]).toMatchObject({
      source: 'codex',
      title: 'Named',
      firstPrompt: 'prompt of a',
      cwd: '/work/app',
      branch: 'main',
      repository: 'https://example.com/app.git',
      model: 'gpt-5.5-codex',
      updatedAt: NOW - 10_000,
      state: 'waiting',
      waitingFor: 'approval',
    });
    // The page after the first thread older than `since` is not asked for.
    expect(asked.filter((call) => call.method === 'thread/list')).toHaveLength(2);
    expect(asked[0]!.params).toMatchObject({ sortKey: 'updated_at', useStateDbOnly: true, modelProviders: [] });
    expect(await codexThreads(server, { cwd: '/work/other' }, NOW)).toMatchObject([{ id: 'b' }]);
    expect(await codexThreads(server, { limit: 1 }, NOW)).toMatchObject([{ id: 'a' }]);
  });

  it('reads turns: prompts, messages and what the tools did', async () => {
    const turns = [
      {
        id: 't2',
        startedAt: 200,
        completedAt: 260,
        items: [
          { type: 'userMessage', id: 'i5', content: [{ type: 'text', text: 'and now?' }] },
          {
            type: 'mcpToolCall',
            id: 'i6',
            server: 'docs',
            tool: 'search',
            arguments: { q: 'x' },
            error: { message: 'no' },
          },
          { type: 'agentMessage', id: 'i7', text: 'Nothing found.' },
        ],
      },
      {
        id: 't1',
        startedAt: 100,
        completedAt: 160,
        items: [
          {
            type: 'userMessage',
            id: 'i1',
            content: [
              { type: 'text', text: 'fix the tests' },
              { type: 'localImage', path: '/x.png' },
            ],
          },
          { type: 'reasoning', id: 'i2', summary: ['thinking'], content: [] },
          {
            type: 'commandExecution',
            id: 'i3',
            command: 'npm test',
            cwd: '/work/app',
            aggregatedOutput: '1 failed',
            exitCode: 1,
          },
          {
            type: 'fileChange',
            id: 'i4',
            changes: [{ path: 'a.ts', kind: 'update', diff: '+x' }],
            status: 'completed',
          },
          { type: 'agentMessage', id: 'i8', text: 'Fixed.' },
        ],
      },
    ];
    const { server, asked } = fakeServer([], turns);
    const read = await readCodexThread(server, 'a', { maxTurns: 10 });
    expect(asked[0]!.params).toMatchObject({ threadId: 'a', sortDirection: 'desc', itemsView: 'full', limit: 10 });
    expect(read.map((turn) => turn.prompt)).toEqual(['fix the tests', 'and now?']);
    expect(read[0]!.entries).toMatchObject([
      { kind: 'tool', name: 'shell', input: { command: 'npm test' }, output: '1 failed', isError: true, done: true },
      { kind: 'tool', name: 'apply_patch', input: { files: ['a.ts'] }, done: true },
      { kind: 'text', text: 'Fixed.' },
    ]);
    expect(read[1]!.entries).toMatchObject([{ kind: 'tool', name: 'docs.search', isError: true }, { kind: 'text' }]);
    expect(read[0]!.startedAt).toBe(100_000);
    expect(codexTurns([null, { items: 'no' }])).toEqual([]);
  });
});

/** A `codex` on the PATH that answers `app-server` requests from a script. */
function fakeCodex(name: string, body: string): { PATH: string } {
  const bin = join(root, name, 'bin');
  mkdirSync(bin, { recursive: true });
  const file = join(bin, 'codex');
  writeFileSync(
    file,
    `#!${process.execPath}
const lines = require('node:readline').createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (result) => process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n');
  ${body}
});
`,
  );
  chmodSync(file, 0o755);
  return { PATH: `${bin}${delimiter}${dirname(process.execPath)}` };
}

describe.skipIf(process.platform === 'win32')('codexSessions over the app server', () => {
  const seconds = Math.floor(Date.now() / 1000) - 600;
  const answers = `
  if (message.method === 'initialize') reply({ codexHome: process.env.CODEX_HOME });
  else if (message.method === 'thread/list') reply({ data: [${JSON.stringify(thread('from-api', seconds))}], nextCursor: null });
  else if (message.method === 'thread/turns/list') reply({ data: [{ id: 't', items: [
    { type: 'userMessage', id: '1', content: [{ type: 'text', text: 'hello' }] },
    { type: 'agentMessage', id: '2', text: 'hi' }] }], nextCursor: null });
  else process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'no' } }) + '\\n');`;

  it('asks the server when told to, and reads the files otherwise or when it fails', async () => {
    const env = { ...fakeCodex('works', answers), HOME: join(root, 'home') };
    const viaApi = await codexSessions({ via: 'app-server' }).list({ env });
    expect(viaApi).toMatchObject([{ id: 'from-api', cwd: '/work/app', firstPrompt: 'prompt of from-api' }]);
    expect(await codexSessions({ via: 'app-server', env }).read!(viaApi[0]!)).toMatchObject([
      { prompt: 'hello', entries: [{ kind: 'text', text: 'hi' }] },
    ]);
    // Listed with an environment of its own, a session is read through the same server.
    const own = codexSessions();
    const [mine] = await own.list({ env: { ...env, GENAICODE_CODEX_SESSIONS: 'app-server' } });
    expect(await own.read!(mine!)).toMatchObject([{ prompt: 'hello' }]);
    // By default nothing is started: the (empty) files are what there is.
    expect(await codexSessions().list({ env })).toEqual([]);
    expect(await codexSessions().list({ env: { ...env, GENAICODE_CODEX_SESSIONS: 'auto' } })).toHaveLength(1);
    // A server that dies, and no Codex at all, both fall back to the files.
    const broken = { ...fakeCodex('broken', 'process.exit(1);'), HOME: join(root, 'home') };
    expect(await codexSessions({ via: 'app-server' }).list({ env: broken })).toEqual([]);
    expect(await codexSessions({ via: 'auto' }).list({ env: { HOME: join(root, 'home'), PATH: '' } })).toEqual([]);
  });

  it('lets the doctor compare what was read with what Codex itself lists', async () => {
    const many = Array.from({ length: 6 }, (_, at) => thread(`t${at}`, seconds - at));
    const env = {
      ...fakeCodex(
        'six',
        `if (message.method === 'thread/list') reply({ data: ${JSON.stringify(many)}, nextCursor: null }); else reply({});`,
      ),
      HOME: join(root, 'home'),
    };
    const [check] = await checkSessions([codexSessions()], { env, reference: true });
    expect(check!.reference).toEqual({ listed: 6, missing: 6 });
    expect(check!.problems).toContain('codex itself lists 6 sessions; 6 of them were not read');
    const [quiet] = await checkSessions([codexSessions()], { env });
    expect(quiet!.reference).toBeUndefined();
  });
});
