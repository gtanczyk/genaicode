import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_OK, EXIT_USAGE, main as runCli } from '../../cli/main.js';
import { createChatController } from '../../ui/controller.js';
import { createAgentSession } from '../session.js';
import type { AgentEvent, AgentResult, AgentTask, CodingAgent } from '../types.js';
import {
  claudeSessions,
  claudeTranscript,
  codexTranscript,
  findSession,
  readSession,
  type SessionInfo,
  type SessionSource,
} from './index.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-transcript-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const work = join(root, 'work');
mkdirSync(work, { recursive: true });

const user = (content: unknown, extra: object = {}) => ({
  type: 'user',
  cwd: work,
  timestamp: '2026-11-01T10:00:00.000Z',
  message: { role: 'user', content },
  ...extra,
});
const assistant = (content: unknown[]) => ({
  type: 'assistant',
  timestamp: '2026-11-01T10:01:00.000Z',
  message: { role: 'assistant', content },
});
const claudeLines = [
  // The cut of a long transcript starts mid-turn.
  assistant([{ type: 'text', text: 'left over' }]),
  user('Add CSV export'),
  assistant([
    { type: 'text', text: 'Looking.' },
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
  ]),
  user([{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'x'.repeat(50) }], is_error: true }]),
  { ...assistant([{ type: 'text', text: 'from a subagent' }]), isSidechain: true },
  assistant([{ type: 'text', text: 'Done: export works.' }]),
  user('This session is being continued', { isCompactSummary: true }),
  user('<relay from="x">Now document it</relay>', { isMeta: true }),
  { type: 'last-prompt', lastPrompt: 'Now document it' },
  assistant([{ type: 'tool_use', id: 't2', name: 'Edit', input: {} }]),
];

const claudeDir = join(root, 'claude');
mkdirSync(join(claudeDir, 'projects', '-work'), { recursive: true });
writeFileSync(
  join(claudeDir, 'projects', '-work', 'aaaa1111-0000.jsonl'),
  claudeLines
    // The lister takes a file with subagent lines for a subagent's.
    .filter((line) => !('isSidechain' in line))
    .map((line) => JSON.stringify(line))
    .join('\n'),
);
writeFileSync(
  join(claudeDir, 'projects', '-work', 'aaaa1111-9999.jsonl'),
  JSON.stringify(user('Elsewhere', { cwd: '/elsewhere' })),
);

/** An agent that records its tasks and answers `ok`. */
function recorder(name: string, extra: Partial<CodingAgent> = {}) {
  const tasks: AgentTask[] = [];
  const agent: CodingAgent = {
    name,
    command: process.execPath,
    capabilities: { resume: true },
    run(task) {
      tasks.push(task);
      const done: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'ok' };
      return {
        result: Promise.resolve(done),
        abort() {},
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
          yield { type: 'done', result: done };
        },
      };
    },
    ...extra,
  };
  return { agent, tasks };
}

describe('reading a session', () => {
  it('turns a Claude Code transcript into turns', () => {
    const turns = claudeTranscript(claudeLines, { maxToolOutput: 10 });
    expect(turns.map((turn) => [turn.id, turn.agent, turn.prompt])).toEqual([
      [1, 'claude', 'Add CSV export'],
      [2, 'claude', 'Now document it'],
    ]);
    expect(turns[0]!.entries).toEqual([
      { kind: 'text', text: 'Looking.', streaming: false },
      {
        kind: 'tool',
        id: 't1',
        name: 'Bash',
        input: { command: 'npm test' },
        output: `${'x'.repeat(10)}\n… (truncated)`,
        isError: true,
        done: true,
      },
      { kind: 'text', text: 'Done: export works.', streaming: false },
    ]);
    expect(turns[0]!.result).toMatchObject({ ok: true, text: 'Done: export works.' });
    // Unfinished there, but not running here.
    expect(turns[1]!.entries).toEqual([{ kind: 'tool', id: 't2', name: 'Edit', input: {}, done: true }]);
    expect(turns[1]!.result?.ok).toBe(true);
    expect(claudeTranscript(claudeLines, { maxTurns: 1 }).map((turn) => [turn.id, turn.prompt])).toEqual([
      [1, 'Now document it'],
    ]);
  });

  it('turns a Codex rollout into turns, in both formats', () => {
    const item = (payload: object) => ({ type: 'response_item', timestamp: '2026-11-01T10:00:00.000Z', payload });
    const message = (role: string, text: string) => item({ type: 'message', role, content: [{ text }] });
    const calls = [
      item({ type: 'function_call', call_id: 'c1', name: 'shell', arguments: '{"command":["ls"]}' }),
      item({ type: 'function_call_output', call_id: 'c1', output: 'README.md' }),
    ];
    const expected = [
      { kind: 'tool', id: 'c1', name: 'shell', input: { command: ['ls'] }, output: 'README.md', done: true },
      { kind: 'text', text: 'One file.', streaming: false },
    ];
    const older = codexTranscript([
      message('user', '<environment_context>'),
      message('user', 'List files'),
      ...calls,
      message('assistant', 'One file.'),
    ]);
    expect(older).toMatchObject([{ agent: 'codex', prompt: 'List files', entries: expected }]);
    const newer = codexTranscript([
      { type: 'event_msg', payload: { type: 'user_message', message: 'List files' } },
      message('user', 'List files'),
      ...calls,
      { type: 'event_msg', payload: { type: 'agent_message', message: 'One file.' } },
      message('assistant', 'One file.'),
    ]);
    expect(newer).toMatchObject([{ prompt: 'List files', entries: expected }]);
    expect(newer).toHaveLength(1);
    // A session resumed after a Codex upgrade holds both formats.
    const mixed = codexTranscript([
      message('user', 'First'),
      message('assistant', 'Did it.'),
      message('user', 'Again'),
      message('assistant', 'Did it.'),
      message('user', 'Make a page'),
      message('assistant', '<main>The page</main>'),
      message('user', 'Third'),
      { type: 'event_msg', payload: { type: 'user_message', message: 'Third' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } },
      message('assistant', 'Done.'),
    ]);
    expect(mixed.map((turn) => [turn.prompt, turn.result?.text])).toEqual([
      ['First', 'Did it.'],
      ['Again', 'Did it.'],
      ['Make a page', '<main>The page</main>'],
      ['Third', 'Done.'],
    ]);
  });

  it('finds a session by the start of its id and reads it through its source', async () => {
    const sources = [claudeSessions({ dir: claudeDir })];
    const found = await findSession(sources, 'aaaa1111-0');
    expect(found?.session).toMatchObject({ id: 'aaaa1111-0000', agent: 'claude', cwd: work });
    expect((await readSession(sources, found!.session)).map((turn) => turn.prompt)).toEqual([
      'Add CSV export',
      'Now document it',
    ]);
    await expect(findSession(sources, 'aaaa1111')).rejects.toThrow(/2 sessions start with/);
    expect(await findSession(sources, 'aaaa')).toBeUndefined();
    expect(await findSession(sources, 'nope-nope')).toBeUndefined();
    const listed: SessionSource = { name: 'muse', where: 'local', list: async () => [] };
    const theirs: SessionInfo = { source: 'muse', agent: 'muse', id: 'm', where: 'local', updatedAt: 1 };
    await expect(readSession([listed], theirs)).rejects.toThrow(/cannot be read yet/);
  });
});

describe('taking a session over', () => {
  const turns = claudeTranscript(claudeLines);

  it('hands adopted turns to the current agent with the next prompt', async () => {
    const cwd = mkdtempSync(join(root, 'adopt-'));
    const { agent, tasks } = recorder('codex');
    const session = createAgentSession({ agent, cwd });
    expect(session.adopt(turns)).toBe(true);
    expect(session.get().turns.map((turn) => [turn.id, turn.agent])).toEqual([
      [1, 'claude'],
      [2, 'claude'],
    ]);
    session.send('Finish the docs');
    await session.idle();
    expect(tasks[0]!.resume).toBeUndefined();
    expect(tasks[0]!.prompt).toMatch(/taking over a conversation .* \(claude\)/);
    expect(tasks[0]!.prompt).toMatch(/User: Add CSV export\nclaude: Done: export works\./);
    expect(tasks[0]!.prompt.endsWith('Finish the docs')).toBe(true);
    const turn = session.get().turns[2]!;
    expect(turn).toMatchObject({ id: 3, agent: 'codex', handoff: { turns: 2, agents: ['claude'] } });
    expect(readFileSync(join(cwd, turn.handoff!.file!), 'utf8')).toMatch(/tool `Bash` \{"command":"npm test"\}/);
    // Said once.
    session.send('And the changelog');
    await session.idle();
    expect(tasks[1]!.prompt).toBe('And the changelog');
  });

  it("resumes instead when the turns are the agent's own session", async () => {
    const { agent, tasks } = recorder('claude');
    const session = createAgentSession({ agent, cwd: work });
    expect(session.adopt(turns, { sessionId: 'aaaa1111-0000' })).toBe(true);
    expect(session.get()).toMatchObject({ sessionId: 'aaaa1111-0000' });
    session.send('Go on');
    await session.idle();
    expect(tasks[0]).toMatchObject({ prompt: 'Go on', resume: 'aaaa1111-0000' });
    expect(session.get().turns[2]!.handoff).toBeUndefined();
  });

  const env = { PATH: process.env.PATH ?? '' };
  const lastNotice = (chat: ReturnType<typeof createChatController>) => chat.get().notices.at(-1)?.text ?? '';

  it('continues a session in the chat: handed over to another agent, resumed by its own', async () => {
    const sessions = claudeSessions({ dir: claudeDir });
    const claude = recorder('claude', { sessions });
    const codex = recorder('codex', { sessions: null });
    const chat = createChatController({ agents: [codex.agent, claude.agent], agent: 'codex', cwd: work, env });
    expect(await chat.continueSession('aaaa1111-0000')).toBe(true);
    expect(lastNotice(chat)).toMatch(/Took over "Add CSV export" from claude \(2 turns\)\. codex hears it/);
    chat.submit('Finish the docs');
    await chat.session.idle();
    expect(codex.tasks[0]!.prompt).toMatch(/taking over a conversation/);
    chat.close();

    const own = createChatController({ agents: [codex.agent, claude.agent], agent: 'claude', cwd: work, env });
    own.submit('/continue aaaa1111-0000');
    await expect.poll(() => lastNotice(own)).toMatch(/Your next prompt resumes that claude session/);
    own.submit('Go on');
    await own.session.idle();
    expect(claude.tasks[0]).toMatchObject({ prompt: 'Go on', resume: 'aaaa1111-0000' });

    expect(await own.continueSession('aaaa1111-9999')).toBe(false);
    expect(lastNotice(own)).toMatch(/not from this directory\. It belongs to \/elsewhere/);
    expect(await own.continueSession('missing-id')).toBe(false);
    expect(lastNotice(own)).toMatch(/No session "missing-id"/);
    own.submit('/continue');
    expect(lastNotice(own)).toMatch(/Use \/continue <session id>/);
    own.close();
  });

  it('gives `run --from` the recap ahead of the prompt', async () => {
    const cwd = mkdtempSync(join(root, 'run-'));
    const claude = recorder('claude', { sessions: claudeSessions({ dir: claudeDir }) });
    const codex = recorder('codex', { sessions: null });
    let err = '';
    const run = (...argv: string[]) =>
      runCli({
        argv: ['run', '-a', 'codex', '-C', cwd, ...argv],
        agents: [claude.agent, codex.agent],
        env,
        cwd,
        stdout: { write: () => true },
        stderr: { write: (text: string) => void (err += text) },
        readStdin: async () => undefined,
      });
    expect(await run('--from', 'aaaa1111-0000', 'Finish the docs')).toBe(EXIT_OK);
    expect(codex.tasks[0]!.prompt).toMatch(/taking over a conversation[^]*\.handoff\.md[^]*Finish the docs$/);
    expect(await run('--from', 'missing-id', 'x')).toBe(EXIT_USAGE);
    expect(err).toMatch(/No session "missing-id" found/);
    expect(codex.tasks).toHaveLength(1);
  });
});
