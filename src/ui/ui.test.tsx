import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { Console } from 'node:console';
import { PassThrough } from 'node:stream';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { supportHelp } from '../support.js';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { PackActionError, type PackTask } from '../agents/pack.js';
import type { SessionState, SessionTurn } from '../agents/session.js';
import {
  readConversations,
  saveConversation,
  SessionSendGate,
  sessionTools,
  writeTopics,
  type SessionInfo,
  type SessionSource,
} from '../agents/sessions/index.js';
import { TowerInbox } from '../agents/sessions/tower.js';
import { createChatController, NoAgentError } from './controller.js';
import {
  needsAttention,
  parseShell,
  parseSlash,
  relativePath,
  shortId,
  statusParts,
  toolSummary,
  turnFooter,
} from './format.js';
import { ChatApp, draftViewport, splitTranscript } from './tui/app.js';
import { NoticeView, TurnView } from './tui/transcript.js';
import { CHOOSE_FOLDER_LINE, loadAssets, runChat, runWeb, startEmbeddedWeb } from './index.js';
import { uiRelease } from './web/release.js';
import { inspectFolder, parseCommand, startWebUi } from './web/server.js';
import { PullRequestBusy } from './pull-requests.js';

const bin = mkdtempSync(join(tmpdir(), 'genaicode-ui-'));
writeFileSync(join(bin, 'echo-agent'), '#!/bin/sh\n', { mode: 0o755 });
afterAll(() => rmSync(bin, { recursive: true, force: true }));
const env = { PATH: bin, GENAICODE_HOME: join(bin, 'app-state') };
/** Running, not a zombie: a container's init may never reap what it inherits. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return !existsSync('/proc');
  }
};

/** Agent that answers each prompt with one tool call and a message. */
function echoAgent(name = 'echo', command = 'echo-agent'): CodingAgent & { tasks: AgentTask[] } {
  const tasks: AgentTask[] = [];
  return {
    name,
    command,
    capabilities: { resume: true },
    tasks,
    run(task): AgentRun {
      tasks.push(task);
      const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, sessionId: 's-1' };
      const events: AgentEvent[] = [
        { type: 'session', sessionId: 's-1' },
        { type: 'tool-start', id: 't', name: 'shell', input: { command: `cat ${task.cwd}/a.txt` } },
        { type: 'tool-end', id: 't', output: 'hello' },
        { type: 'message', text: `You said **${task.prompt}**` },
        { type: 'done', result },
      ];
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('format helpers', () => {
  it('summarizes tool input and paths relative to the working directory', () => {
    expect(toolSummary({ command: 'npm   test' })).toBe('npm test');
    expect(toolSummary({ filePath: '/w/src/a.ts' }, 80, '/w')).toBe('src/a.ts');
    expect(toolSummary({ other: 1 })).toBe('');
    expect(toolSummary('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(toolSummary({ command: 'a\n  b' })).toBe('a b');
    expect(relativePath('/w/a.ts', '/w/')).toBe('a.ts');
    expect(relativePath('/elsewhere/a.ts', '/w')).toBe('/elsewhere/a.ts');
    expect(shortId('ses_f158fcc57ffelLfa0gyYTOw7e8')).toBe('…yYTOw7e8');
    expect(shortId('abc')).toBe('abc');
  });

  it('parses slash commands and leaves other text alone', () => {
    expect(parseSlash('/agent codex')).toEqual({ kind: 'agent', name: 'codex' });
    expect(parseSlash('/agent codex --fresh')).toEqual({ kind: 'agent', name: 'codex', fresh: true });
    expect(parseSlash('/model')).toEqual({ kind: 'model', model: undefined });
    expect(parseSlash('/effort XHigh')).toEqual({ kind: 'effort', effort: 'xhigh' });
    expect(parseSlash('/waiting Harbor Docs')).toEqual({ kind: 'waiting', project: 'Harbor Docs' });
    expect(parseSlash('/read 01234567')).toEqual({ kind: 'read', id: '01234567' });
    expect(parseSlash('/where')).toEqual({ kind: 'where' });
    expect(parseSlash('/wat')).toEqual({ kind: 'unknown', name: '/wat' });
    expect(parseSlash('/bark')).toEqual({ kind: 'bark' });
    expect(parseSlash('/bark off')).toEqual({ kind: 'bark', on: false });
    expect(parseSlash('/bark of')).toEqual({ kind: 'bark', invalid: 'of' });
    expect(parseSlash('/plan')).toEqual({ kind: 'plan' });
    expect(parseSlash('/plan on')).toEqual({ kind: 'plan', on: true });
    expect(parseSlash('/plan off')).toEqual({ kind: 'plan', on: false });
    expect(parseSlash('/plan maybe')).toEqual({ kind: 'plan', invalid: 'maybe' });
    expect(parseSlash('/web')).toEqual({ kind: 'web', off: false });
    expect(parseSlash('/ui off')).toEqual({ kind: 'web', off: true });
    expect(parseSlash('/web now')).toEqual({ kind: 'web', off: false, invalid: 'now' });
    expect(parseSlash('//etc/hosts is odd')).toBeUndefined();
    expect(parseSlash('fix the bug')).toBeUndefined();
  });

  it('asks for attention on a new approval or a finished turn', () => {
    type State = Parameters<typeof needsAttention>[1];
    const state = (turns: Array<[number, boolean]>, approvals: string[] = []) =>
      ({
        turns: turns.map(([id, done]) => ({ id, ...(done ? { result: { ok: true } } : {}) })),
        approvals: approvals.map((id) => ({ id, kind: 'command' })),
      }) as unknown as State;
    expect(needsAttention(undefined, state([[1, true]]))).toBeUndefined();
    expect(needsAttention(state([]), state([[1, false]]))).toBeUndefined();
    expect(needsAttention(state([[1, false]]), state([[1, false]], ['a']))).toBe('approval');
    expect(needsAttention(state([[1, false]], ['a']), state([[1, false]], ['a']))).toBeUndefined();
    expect(needsAttention(state([[1, false]], ['a']), state([[1, true]]))).toBe('done');
    // Started and finished between two views.
    expect(
      needsAttention(
        state([[1, true]]),
        state([
          [1, true],
          [2, true],
        ]),
      ),
    ).toBe('done');
    // A relayed session message settling also asks for attention once.
    const idle = state([[1, true]]);
    const workingNotice = [{ id: 1, relay: { status: 'working' } }];
    const answeredNotice = [{ id: 1, relay: { status: 'answered' } }];
    expect(needsAttention(idle, idle, workingNotice, workingNotice)).toBeUndefined();
    expect(needsAttention(idle, idle, workingNotice, answeredNotice)).toBe('done');
    expect(needsAttention(idle, idle, answeredNotice, answeredNotice)).toBeUndefined();
  });

  it('describes a turn by its outcome', () => {
    const turn = { id: 1, agent: 'a', prompt: 'p', entries: [], startedAt: 0 };
    expect(turnFooter(turn, 4_000)).toBe('working 4s');
    expect(
      turnFooter({ ...turn, endedAt: 75_000, result: { status: 'completed', ok: true, exitCode: 0, signal: null } }),
    ).toBe('done in 1m 15s');
    expect(
      turnFooter({
        ...turn,
        endedAt: 1000,
        result: { status: 'failed', ok: false, exitCode: 1, signal: null, error: 'boom\nstack' },
      }),
    ).toBe('failed after 1s: boom');
  });

  it('keeps the cursor visible in a long draft', () => {
    expect(draftViewport('hello', 5, 20)).toEqual({ before: 'hello', at: ' ', after: '' });
    const view = draftViewport('abcdefghijklmnopqrstuvwxyz', 20, 10);
    expect(view.before + view.at + view.after).toHaveLength(10);
    expect(view.at).toBe('u');
  });
});

describe('chat controller', () => {
  it.each([false, true])(
    'terminal /clear preserves the old record and starts an untitled conversation (home=%s)',
    async (home) => {
      const isolated = { ...env, GENAICODE_HOME: join(bin, 'clear-' + home) };
      const chat = createChatController({ agents: [echoAgent()], cwd: bin, home, env: isolated, chatId: 'stable' });
      try {
        await chat.resourcesIdle();
        expect(await readConversations(isolated)).toEqual([]);
        chat.submit('Fix login');
        await chat.session.idle();
        chat.submit('/clear');
        expect(chat.get().conversation?.title).toBeUndefined();
        chat.submit('Write docs');
        await chat.session.idle();
        await chat.resourcesIdle();
        const rows = await readConversations(isolated);
        expect(new Set(rows.map((r) => r.id)).size).toBe(2);
        expect(rows.map((r) => r.title).sort()).toEqual(['Fix login', 'Write docs']);
      } finally {
        chat.close();
      }
    },
  );

  it('opens a short queue, refreshes it by project and previews a foreign session without an agent turn', async () => {
    const agent = echoAgent();
    const indexEnv = { ...env, GENAICODE_HOME: join(bin, 'tower-state') };
    const sessions: SessionInfo[] = Array.from({ length: 6 }, (_, i) => ({
      source: 'other',
      agent: 'other',
      where: 'local',
      id: `session${i}-part`,
      state: 'waiting',
      cwd: i === 5 ? '/projects/Harbor Docs' : '/projects/orchid',
      updatedAt: Date.now() - i * 60_000,
      ...(i === 5 ? { waitingFor: 'approval', waitingTool: 'Bash' } : {}),
    }));
    const source: SessionSource = {
      name: 'other',
      where: 'local',
      list: async () => sessions,
      read: async (_session, options) => {
        expect(options?.maxTurns).toBe(3);
        return [
          {
            id: 1,
            agent: 'other',
            prompt: 'Prepare the export.',
            startedAt: 0,
            entries: [{ kind: 'text', text: '\x1b[31mCSV or JSON?\x1b[0m\x07', streaming: false }],
          },
        ];
      },
    };
    const chat = createChatController({
      agents: [agent],
      cwd: '/unrelated',
      env: indexEnv,
      waitingOnStart: true,
      sessionTools: sessionTools([source], { env: indexEnv }),
    });
    const last = () => chat.get().notices.at(-1)?.text;
    await expect.poll(last).toContain('(5 of 6)');
    expect(last()).toContain('session5-part  approval (Bash)');
    expect(last()).not.toContain('session4-part');
    chat.submit('/waiting');
    await expect.poll(last).toContain('(6 of 6)');
    sessions[5].state = 'active';
    chat.submit('/waiting Harbor Docs', 'web');
    await expect.poll(last).toContain('/waiting Harbor Docs\nNothing waits for you');
    chat.submit('/read session5', 'web');
    await expect.poll(last).toContain('Prepare the export.');
    expect(last()).toContain('CSV or JSON?');
    expect(last()).not.toContain('\x1b');
    expect(last()).not.toContain('\x07');
    chat.submit('/read missing-id');
    await expect.poll(last).toContain('No session with id missing-id.');
    expect(chat.get().notices.at(-1)?.tone).toBe('error');
    expect(chat.get().session.turns).toEqual([]);
    expect(agent.tasks).toEqual([]);
    chat.submit('My own question');
    await chat.session.idle();
    expect(agent.tasks.map((task) => task.prompt)).toEqual(['My own question']);
    expect(agent.tasks[0].resume).toBeUndefined();
    chat.close();
  });

  it('keeps the cross-project index off in a chat without explicit session access', () => {
    const agent = echoAgent();
    const chat = createChatController({ agents: [agent], cwd: '/w', env, sessionSources: [] });
    chat.submit('/waiting', 'web');
    chat.submit('/read session0', 'web');
    expect(chat.get().notices).toHaveLength(2);
    expect(chat.get().notices.every(({ tone, text }) => tone === 'error' && text.includes('--sessions'))).toBe(true);
    expect(agent.tasks).toEqual([]);
    chat.close();
  });

  it('shows a startupNotice immediately when provided', () => {
    const chat = createChatController({
      agents: [echoAgent()],
      cwd: '/w',
      env,
      startupNotice: 'Pack: echo leads · members: echo.',
    });
    expect(chat.get().notices).toMatchObject([
      { afterTurn: 0, tone: 'info', text: 'Pack: echo leads · members: echo.' },
    ]);
    chat.close();
  });

  it('picks the first installed agent and resumes its session on the next prompt', async () => {
    const missing = echoAgent('missing', 'not-installed');
    const echo = echoAgent();
    const chat = createChatController({ agents: [missing, echo], cwd: '/w', env });
    expect(chat.get().session.agent).toBe('echo');
    expect(chat.get().agents.map((a) => [a.name, a.installed])).toEqual([
      ['missing', false],
      ['echo', true],
    ]);
    chat.submit('one');
    await chat.session.idle();
    chat.submit('two');
    await chat.session.idle();
    expect(echo.tasks.map((t) => t.resume)).toEqual([undefined, 's-1']);
    expect(echo.tasks[0].env).toBe(env);
    chat.close();
  });

  it('handles slash commands as notices placed after the current turn', async () => {
    const chat = createChatController({ agents: [echoAgent(), echoAgent('other')], cwd: '/w', env });
    chat.submit('/help');
    chat.submit('hi');
    await chat.session.idle();
    expect(chat.submit('/agent other')).toBe('ok');
    chat.submit('/nope');
    expect(chat.submit('/quit')).toBe('quit');
    const { notices, session } = chat.get();
    expect(session.agent).toBe('other');
    expect(session.sessionId).toBeUndefined();
    expect(notices.map((n) => [n.afterTurn, n.tone])).toEqual([
      [0, 'info'],
      [1, 'info'],
      [1, 'error'],
    ]);
    expect(notices[0].text).toContain(supportHelp);
    expect(notices[1].text).toMatch(/Switched to other/);
    chat.close();
  });

  it('reports canAsk per agent choice and marks agents that cannot ask in /agent', () => {
    const native = { ...echoAgent('native'), capabilities: { questions: true } };
    const mcp = { ...echoAgent('mcp'), capabilities: { mcp: true } };
    const remote = { ...echoAgent('remote'), capabilities: { mcp: true, remote: true } };
    const plain = { ...echoAgent('plain'), capabilities: {} };
    const questionChannel = {
      mcpServer: { name: 'genaicode_ask', url: 'http://127.0.0.1:1/mcp', trusted: true },
      bind() {},
    };
    const chat = createChatController({
      agents: [native, mcp, remote, plain],
      cwd: '/w',
      env,
      questionChannel,
    });
    expect(chat.get().agents.map((a) => [a.name, a.canAsk])).toEqual([
      ['native', true],
      ['mcp', true],
      ['remote', false],
      ['plain', false],
    ]);
    expect(chat.get().session.canAsk).toBe(true);
    chat.submit('/agent');
    const listing = chat.get().notices.at(-1)?.text ?? '';
    expect(listing).toContain('● native');
    expect(listing).not.toContain('native (no questions)');
    expect(listing).toContain('○ mcp');
    expect(listing).not.toContain('mcp (no questions)');
    expect(listing).toContain('○ remote (no questions)');
    expect(listing).toContain('○ plain (no questions)');
    chat.submit('/agent plain');
    expect(chat.get().session.canAsk).toBe(false);
    chat.close();
  });

  it('keeps setup turns when an agent becomes usable and preserves canAsk across updateAgents', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'genaicode-setup-continue-'));
    try {
      const claude = { ...echoAgent('claude', 'claude'), capabilities: { questions: true, resume: true } };
      const codex = { ...echoAgent('codex', 'codex'), capabilities: { resume: true } };
      const pastSession = {
        source: 'claude',
        agent: 'claude',
        id: 'old-claude-1',
        where: 'local' as const,
        cwd: '/w',
        title: 'Earlier work',
        firstPrompt: 'Audit the router',
        lastReply: 'Router looks clean.',
        updatedAt: Date.now() - 60_000,
      };
      const chat = createChatController({
        agents: [claude, codex],
        sessionSources: [
          {
            name: 'claude',
            where: 'local',
            list: async () => [pastSession],
            read: async () => [
              {
                id: 1,
                agent: 'claude',
                prompt: 'Audit the router',
                startedAt: Date.now() - 60_000,
                endedAt: Date.now() - 59_000,
                entries: [{ kind: 'text', text: 'Router looks clean.', streaming: false }],
                result: { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Router looks clean.' },
              },
            ],
          },
        ],
        cwd: '/w',
        env: { PATH: empty, GENAICODE_HOME: join(empty, 'app-state') },
        allowNoAgent: true,
      });
      expect(chat.get().setup).toBe(true);
      expect(await chat.continueSession('old-claude-1')).toBe(true);
      expect(chat.get().setup).toBe(true);
      expect(chat.get().session.turns).toHaveLength(1);
      // Do not bind an uninstalled placeholder's sessionId during setup.
      expect(chat.get().session.sessionId).toBeUndefined();
      expect(chat.get().notices.at(-1)?.text).toContain('Connect an agent to continue it');

      // Now codex becomes ready -> leaves setup, switches from placeholder claude to codex, keeps turns + canAsk.
      chat.updateAgents([
        {
          name: 'claude',
          command: 'claude',
          installed: false,
          auth: 'unknown',
          guide: {
            name: 'claude',
            command: 'claude',
            title: 'Claude Code',
            maker: 'Anthropic',
            summary: '',
            install: [],
            loginNote: '',
          },
        },
        {
          name: 'codex',
          command: 'codex',
          installed: true,
          path: '/bin/codex',
          auth: 'ready',
          guide: {
            name: 'codex',
            command: 'codex',
            title: 'Codex',
            maker: 'OpenAI',
            summary: '',
            install: [],
            loginNote: '',
          },
        },
      ]);
      expect(chat.get().setup).toBeUndefined();
      expect(chat.get().session.agent).toBe('codex');
      expect(chat.get().session.turns).toHaveLength(1);
      expect(chat.get().agents.map((a) => [a.name, a.canAsk])).toEqual([
        ['claude', true],
        ['codex', false],
      ]);
      chat.close();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('/clear empties the conversation and its notices', async () => {
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    chat.submit('hi');
    await chat.session.idle();
    chat.submit('/help');
    expect(chat.get().session.turns).toHaveLength(1);
    expect(chat.submit('/clear')).toBe('ok');
    expect(chat.get()).toMatchObject({ notices: [], session: { turns: [], sessionId: undefined } });
    chat.close();
  });

  it('/clear starts the terminal transcript over', async () => {
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    const app = render(<ChatApp controller={chat} cwd="/w" version="test" />);
    try {
      chat.submit('remember the heron');
      await chat.session.idle();
      await vi.waitFor(() => expect(app.frames.join('')).toContain('remember the heron'));
      chat.submit('/clear');
      // The header prints again, as on a cleared screen. (The test renderer keeps all it ever
      // printed; a terminal gets the escape that wipes it first.)
      await vi.waitFor(() => expect(app.lastFrame()!.split('🐺 genaicode test')).toHaveLength(3));
    } finally {
      app.unmount();
      chat.close();
    }
  });

  it('sets the effort for the next prompt with /effort, in the words the agent takes', async () => {
    const thinker = { ...echoAgent('thinker'), capabilities: { resume: true, effort: ['low', 'high'] } };
    const chat = createChatController({ agents: [thinker, echoAgent('plain')], cwd: '/w', env });
    expect(chat.get().agents.map((agent) => agent.effort)).toEqual([['low', 'high'], undefined]);
    chat.submit('/effort High');
    expect(chat.get().session.effort).toBe('high');
    chat.submit('hi');
    await chat.session.idle();
    expect(thinker.tasks[0].effort).toBe('high');
    chat.submit('/effort huge');
    expect(chat.get().notices.at(-1)).toMatchObject({ tone: 'error', text: expect.stringMatching(/low, high/) });
    expect(chat.get().session.effort).toBe('high');
    chat.submit('/effort');
    expect(chat.get().notices.at(-1)?.text).toMatch(/^Effort: high\./);
    // Another agent's word for it means nothing to the next one.
    chat.submit('/agent plain');
    expect(chat.get().session.effort).toBeUndefined();
    chat.submit('/effort low');
    expect(chat.get().notices.at(-1)).toMatchObject({ tone: 'error', text: 'plain takes no effort setting.' });
    chat.submit('/agent thinker');
    chat.submit('/effort low');
    chat.submit('/effort default');
    expect(chat.get().session.effort).toBeUndefined();
    chat.close();
    // An agent whose session keeps its effort: only a fresh session takes another.
    const fixed = {
      ...echoAgent('fixed'),
      capabilities: { resume: true, effort: ['low', 'high'], effortAtStart: true },
    };
    const kept = createChatController({ agents: [fixed], cwd: '/w', env });
    kept.submit('/effort low');
    kept.submit('hi');
    await kept.session.idle();
    kept.submit('/effort high');
    expect(kept.get().notices.at(-1)).toMatchObject({ tone: 'error', text: expect.stringMatching(/\/new/) });
    expect(kept.get().session.effort).toBe('low');
    kept.submit('/new');
    kept.submit('/effort high');
    expect(kept.get().session.effort).toBe('high');
    // While its first turn runs the session is already made with that effort.
    kept.submit('again');
    kept.submit('/effort low');
    expect(kept.get().session.effort).toBe('high');
    await kept.session.idle();
    kept.close();
    // Back at such an agent, its session is resumed at the effort it started with.
    const other = { ...echoAgent('other'), capabilities: { resume: true, effort: ['low', 'high'] } };
    const both = createChatController({ agents: [fixed, other], cwd: '/w', env, effort: 'low' });
    both.submit('hi');
    await both.session.idle();
    both.submit('/agent other');
    both.submit('/effort high');
    both.submit('/agent fixed');
    expect(both.get().session.effort).toBe('low');
    // The same when a host comes back while that agent's first turn still runs.
    both.submit('/new');
    both.submit('again');
    both.session.setAgent(other);
    both.session.setEffort('high');
    both.session.setAgent(fixed);
    expect(both.get().session.effort).toBe('low');
    await both.session.idle();
    both.close();
  });

  it('shows the reported model in the status line when the model setting is empty', () => {
    const state = {
      agent: 'claude',
      cwd: '/w',
      model: '',
      reportedModel: 'claude-x',
      status: 'idle',
      turns: [],
      queued: [],
      approvals: [],
      usage: {},
      canSteer: false,
    } as SessionState;
    expect(statusParts(state)).toContain('claude-x');
    expect(statusParts({ ...state, model: 'picked' })).not.toContain('claude-x');
  });

  it('toggles Plan mode with /plan, exposes it in agents and statusParts, and rejects unsupported agents', async () => {
    const planner = { ...echoAgent('planner'), capabilities: { resume: true, plan: true } };
    const plain = echoAgent('plain');
    const chat = createChatController({ agents: [planner, plain], cwd: '/w', env });
    expect(chat.get().agents.map((agent) => [agent.name, agent.canPlan])).toEqual([
      ['planner', true],
      ['plain', undefined],
    ]);
    chat.submit('/plan');
    expect(chat.get().session.mode).toBe('plan');
    expect(statusParts(chat.get().session)).toContain('plan');
    chat.submit('design it');
    await chat.session.idle();
    expect(planner.tasks[0].mode).toBe('plan');

    chat.submit('/plan off');
    expect(chat.get().session.mode).toBe('default');
    expect(statusParts(chat.get().session)).not.toContain('plan');
    chat.submit('build it');
    await chat.session.idle();
    expect(planner.tasks[1].mode).toBe('default');

    chat.submit('/plan bogus');
    expect(chat.get().notices.at(-1)?.tone).toBe('error');

    chat.submit('/plan on');
    chat.submit('/agent plain');
    expect(chat.get().session.mode).toBeUndefined();
    chat.submit('/plan');
    expect(chat.get().notices.at(-1)).toMatchObject({ tone: 'error', text: 'plain has no Plan mode.' });
    chat.close();
  });

  it('toggles the bark', () => {
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env, bark: false });
    expect(chat.get().bark).toBe(false);
    chat.submit('/bark');
    expect(chat.get().bark).toBe(true);
    expect(chat.get().notices.at(-1)?.text).toMatch(/Woof/);
    chat.submit('/bark on');
    expect(chat.get().bark).toBe(true);
    chat.submit('/bark off');
    expect(chat.get().bark).toBe(false);
    chat.submit('/bark of');
    expect(chat.get().bark).toBe(false);
    expect(chat.get().notices.at(-1)?.tone).toBe('error');
    chat.close();
  });

  it('approves what is waiting and what comes next with /auto', async () => {
    const decisions: string[] = [];
    const asking: CodingAgent = {
      name: 'asker',
      command: 'asker',
      capabilities: {},
      run(task): AgentRun {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        const done = (async () => {
          decisions.push(await task.onApproval!({ id: 'a1', kind: 'command', summary: 'npm i' }));
          decisions.push(await task.onApproval!({ id: 'a2', kind: 'command', summary: 'npm test' }));
          return result;
        })();
        return {
          result: done,
          abort() {},
          async *[Symbol.asyncIterator]() {
            await done;
            yield { type: 'done', result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [asking], cwd: '/w', env: { PATH: '' }, agent: 'asker' });
    expect(chat.get().autoApprove).toBe(false);
    chat.submit('fix it');
    await tick();
    expect(chat.get().session.approvals.map((a) => a.id)).toEqual(['a1']);
    chat.submit('/auto');
    await tick();
    expect(chat.get().autoApprove).toBe(true);
    expect(decisions).toEqual(['approve', 'approve']);
    expect(chat.get().session.approvals).toEqual([]);
    chat.submit('/auto off');
    expect(chat.get().autoApprove).toBe(false);
    chat.submit('/auto maybe');
    expect(chat.get().notices.at(-1)?.tone).toBe('error');
    // It holds for the chat it was set in: a new chat starts from the configured default.
    chat.submit('/auto on');
    expect(chat.get().autoApprove).toBe(true);
    await chat.session.idle();
    chat.submit('/clear');
    expect(chat.get().autoApprove).toBe(false);
    const yes = createChatController({ agents: [asking], agent: 'asker', cwd: '/w', env, approveAll: true });
    expect(yes.get().autoApprove).toBe(true);
    yes.submit('/auto off');
    expect(yes.get().autoApprove).toBe(false);
    yes.submit('/clear');
    expect(yes.get().autoApprove).toBe(true);
    yes.close();
    chat.close();
  });

  it('runs !commands in the project and ends them with /stop', async () => {
    expect(parseShell('!npm run agent')).toBe('npm run agent');
    expect(parseShell('  ! ls ')).toBe('ls');
    expect(parseShell('!')).toBe('');
    expect(parseShell('!!important')).toBeUndefined();
    expect(parseShell('hi!')).toBeUndefined();

    const agent = echoAgent();
    const chat = createChatController({ agents: [agent], cwd: bin, env: { PATH: `${bin}:/usr/bin:/bin` } });
    const texts = () => chat.get().notices.map((notice) => notice.text);
    // A character split across two writes arrives whole.
    chat.submit("!printf '\\342'; sleep 0.05; printf '\\202\\254\\n'");
    await expect.poll(() => texts().at(-1)).toContain('exit code 0');
    expect(texts()).toContain('€');
    const first = texts().length;
    chat.submit('!printf "\\033[32mready\\033[0m\\n" && pwd && exit 3');
    await expect.poll(() => texts().at(-1)).toContain('exit code 3');
    expect(texts().slice(first)).toEqual([
      '$ printf "\\033[32mready\\033[0m\\n" && pwd && exit 3',
      `ready\n${realpathSync(bin)}`,
      'printf "\\033[32mready\\033[0m\\n" && pwd && exit 3: exit code 3.',
    ]);
    expect(chat.get().notices.at(-1)?.tone).toBe('error');
    expect(agent.tasks).toHaveLength(0);

    // A dev server keeps running until /stop, children included.
    chat.submit('!sh -c "sleep 30" & sleep 30');
    await expect
      .poll(() => texts().at(-1), { timeout: 5000 })
      .toBe('sh -c "sleep 30" & sleep 30 keeps running here; /stop ends it.');
    chat.submit('/stop');
    await expect.poll(() => texts().at(-1)).toBe('sh -c "sleep 30" & sleep 30: stopped.');
    expect(texts()).toContain('Stopping the shell commands.');

    // One that ignores SIGTERM gets SIGKILL a moment later; Esc and the Stop button stop it too.
    chat.submit("!trap '' TERM; while :; do sleep 0.1; done");
    await expect.poll(() => texts().at(-1)).toBe("$ trap '' TERM; while :; do sleep 0.1; done");
    chat.stop();
    await expect
      .poll(() => texts().at(-1), { timeout: 6000 })
      .toBe("trap '' TERM; while :; do sleep 0.1; done: stopped.");

    // What outlives its shell, ignoring SIGTERM, still gets SIGKILL.
    const pidFile = join(bin, 'stubborn.pid');
    chat.submit(`!sh -c 'trap "" TERM; echo $$ > ${pidFile}; while :; do sleep 0.1; done' >/dev/null 2>&1 & wait`);
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim()).toBeTruthy();
    const stubborn = Number(readFileSync(pidFile, 'utf8'));
    chat.stop();
    await expect.poll(() => chat.get().shells).toBe(0);
    expect(alive(stubborn)).toBe(true);
    await expect.poll(() => alive(stubborn), { timeout: 6000 }).toBe(false);

    // What a finished command left running in the background ends with /stop too.
    chat.submit('!sleep 60 >/dev/null 2>&1 & echo $!');
    await expect.poll(() => texts().at(-1)).toBe('sleep 60 >/dev/null 2>&1 & echo $!: exit code 0.');
    const background = Number(texts().at(-2));
    expect(chat.get().shells).toBe(0);
    expect(alive(background)).toBe(true);
    chat.stop();
    expect(texts().at(-1)).toBe('Stopping the shell commands.');
    await expect.poll(() => alive(background)).toBe(false);

    chat.submit('!');
    expect(texts().at(-1)).toBe('Type a command after !, e.g. !npm test.');
    chat.submit('!!important');
    await expect.poll(() => agent.tasks.length).toBe(1);
    expect(agent.tasks[0].prompt).toBe('!important');
    chat.close();
  }, 30_000);

  it('shares one signal listener between chats, so a signal still ends the host', { timeout: 15_000 }, async () => {
    const shellListeners = () =>
      process.listeners('SIGTERM').filter((listener) => listener.name === 'onShellSignal').length;
    // Earlier tests' stopped commands let go within a few seconds.
    await expect.poll(shellListeners, { timeout: 5000 }).toBe(0);
    const before = process.listenerCount('SIGTERM');
    const chats = [0, 1].map(() =>
      createChatController({ agents: [echoAgent()], cwd: bin, env: { PATH: `${bin}:/usr/bin:/bin` } }),
    );
    for (const chat of chats) chat.submit('!sleep 30');
    await expect.poll(() => chats.map((chat) => chat.get().shells)).toEqual([1, 1]);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    for (const chat of chats) chat.stop();
    await expect.poll(() => process.listenerCount('SIGTERM'), { timeout: 5000 }).toBe(before);
    for (const chat of chats) chat.close();
  });

  it('opens and stops the browser UI from the terminal only', async () => {
    const calls: string[] = [];
    let running = false;
    const web = {
      async open() {
        calls.push('open');
        running = true;
        return 'http://127.0.0.1:1/?token=x';
      },
      async close() {
        calls.push('close');
        const was = running;
        running = false;
        return was;
      },
    };
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env, web });
    const last = () => chat.get().notices.at(-1)?.text;
    chat.submit('/web');
    await tick();
    expect(last()).toMatch(/^Open in the browser: http:\/\/127\.0\.0\.1:1\/\?token=x\n.*share the session/);
    chat.submit('/web', 'web');
    expect(last()).toMatch(/This is the browser UI already/);
    chat.submit('/web off', 'web');
    expect(last()).toMatch(/from the terminal/);
    chat.submit('/web off');
    await tick();
    expect(last()).toBe('Stopped the browser UI.');
    chat.submit('/web off');
    await tick();
    expect(last()).toBe('The browser UI is not running.');
    expect(calls).toEqual(['open', 'close', 'close']);
    chat.close();

    const plain = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    plain.submit('/web');
    expect(plain.get().notices.at(-1)?.text).toBe('The browser UI is not available here.');
    plain.close();
  });

  it('refuses unknown or missing agents up front', () => {
    expect(() => createChatController({ agents: [echoAgent()], agent: 'nope', cwd: '.', env })).toThrow(NoAgentError);
    expect(() => createChatController({ agents: [echoAgent('x', 'not-there')], cwd: '.', env })).toThrow(
      /No supported agent CLI/,
    );
  });
});

describe('terminal UI', () => {
  it('reviews an exact recipient and multiline draft before sending, even in auto-approve mode', async () => {
    const driver = echoAgent();
    const row: SessionInfo = {
      id: 'session-1234',
      source: 'local-echo',
      agent: driver.name,
      where: 'local',
      cwd: bin,
      updatedAt: Date.now(),
      state: 'waiting',
    };
    const owner = { ...driver, sessions: { name: row.source, where: 'local' as const, list: async () => [row] } };
    const localEnv = { ...env, GENAICODE_HOME: bin };
    const towerInbox = new TowerInbox([owner], localEnv);
    const chat = createChatController({ agents: [owner], cwd: bin, env: localEnv, approveAll: true, towerInbox });
    const app = render(<ChatApp controller={chat} cwd={bin} version="test" />);
    const frame = (s: string) => vi.waitFor(() => expect(app.lastFrame()).toContain(s));
    const text = 'Check the fixtures.\nKeep the empty row.';
    try {
      await towerInbox.proposalTool.call({ id: row.id, text });
      await frame('Ctrl+G to open');
      app.stdin.write('\x07');
      await frame('Enter review');
      app.stdin.write('\r');
      await frame(text.split('\n')[1]);
      expect(app.lastFrame()).toContain(row.id);
      expect(owner.tasks).toHaveLength(0);
      app.stdin.write('s');
      await frame('Message sent');
      expect(owner.tasks.map((t) => [t.resume, t.cwd, t.prompt])).toEqual([[row.id, bin, text]]);
      app.stdin.write('\x1b');
      await frame('Ask the agent');
    } finally {
      app.unmount();
      chat.close();
    }
  });
  it('selects a finished worker, reads its diff and confirms a discard on that task only', async () => {
    const tasks: PackTask[] = ['t1', 't2'].map((id) => ({
      id,
      prompt: `Write ${id}`,
      agent: 'worker',
      mode: 'worktree',
      cwd: '/w',
      status: 'completed',
      state: 'unmerged',
      checks: { reviewer: 'lead', command: 'npm test' },
    }));
    const actions: string[] = [];
    const agent: CodingAgent = {
      ...echoAgent(),
      run() {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        return {
          result: Promise.resolve(result),
          abort() {},
          pack: {
            lead: 'lead',
            maxParallel: 2,
            task: (id) => tasks.find((item) => item.id === id),
            async act(id, action) {
              actions.push(`${id} ${action.type}`);
              if (action.type === 'review' || action.type === 'verify') {
                const checks = tasks.find((item) => item.id === id)!.checks!;
                checks.revision = 'abc';
                checks[action.type] = {
                  revision: 'abc',
                  status: 'completed',
                  detail: action.type === 'review' ? 'No findings.' : '2 tests passed',
                };
              }
              if (action.type === 'discard') tasks.find((item) => item.id === id)!.state = 'discarded';
              return action.type === 'diff' ? '+test change' : 'Discarded';
            },
          },
          async *[Symbol.asyncIterator]() {
            for (const task of tasks) yield { type: 'subtask-start' as const, ...task };
            yield { type: 'done' as const, result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [agent], cwd: '/w', env });
    const app = render(<ChatApp controller={chat} cwd="/w" version="test" />);
    const frame = (text: string) => vi.waitFor(() => expect(app.lastFrame()).toContain(text));
    const press = async (key: string, text: string) => {
      app.stdin.write(key);
      await frame(text);
    };
    try {
      await frame('Ask the agent');
      chat.submit('write');
      await chat.session.idle();
      await frame('Tab for delegated tasks');
      // The transcript lists the newer task first, and Tab and the arrows follow it.
      await press('\t', 't2 · worker · Ready to merge');
      await press('\x1b[B', 't1 · worker · Ready to merge');
      await press('\x1b[A', 't2 · worker · Ready to merge');
      await press('d', '+test change');
      await press('\x1b', 'd diff · m merge locally');
      await press('r', 'Reviewed');
      await press('v', 'Passed');
      await press('c', '2 tests passed');
      expect(app.lastFrame()).toContain('No findings.');
      await press('\x1b', 'd diff · m merge locally');
      await press('x', 'Discard this worktree');
      expect(actions).toEqual(['t2 diff', 't2 review', 't2 verify']);
      await press('x', 't2 · worker · Discarded');
      expect(actions).toEqual(['t2 diff', 't2 review', 't2 verify', 't2 discard']);
      expect(chat.get().session.turns[0].pack?.tasks.map((item) => item.state)).toEqual(['unmerged', 'discarded']);
      await press('\t', 'Ask the agent');
    } finally {
      app.unmount();
      chat.close();
    }
  });
  it('browses delegated tasks in the order they are shown, folded ones included', async () => {
    // t1 was delegated first but ended last, so it is listed first; t2 and t3 are folded away.
    const ends: Record<string, number> = { t1: 500, t2: 100, t3: 200, t4: 300, t5: 400 };
    const tasks: PackTask[] = Object.entries(ends).map(([id, endedAt]) => ({
      id,
      prompt: `Write ${id}`,
      agent: 'worker',
      mode: 'shared',
      cwd: '/w',
      status: 'completed',
      startedAt: 0,
      endedAt,
    }));
    const agent: CodingAgent = {
      ...echoAgent(),
      run() {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        return {
          result: Promise.resolve(result),
          abort() {},
          pack: {
            lead: 'lead',
            maxParallel: 2,
            task: (id) => tasks.find((item) => item.id === id),
            act: async () => '',
          },
          async *[Symbol.asyncIterator]() {
            for (const task of tasks) yield { type: 'subtask-start' as const, ...task };
            yield { type: 'done' as const, result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [agent], cwd: '/w', env });
    const app = render(<ChatApp controller={chat} cwd="/w" version="test" />);
    const frame = (text: string) => vi.waitFor(() => expect(app.lastFrame()).toContain(text));
    const press = async (key: string, text: string) => {
      app.stdin.write(key);
      await frame(text);
    };
    try {
      await frame('Ask the agent');
      chat.submit('write');
      await chat.session.idle();
      await frame('2 earlier finished tasks');
      await press('\t', 't1 · worker · Completed');
      await press('\x1b[B', 't5 · worker · Completed');
      await press('\x1b[A', 't1 · worker · Completed');
      await press('\x1b[A', 't2 · worker · Completed');
      await press('\x1b[A', 't3 · worker · Completed');
    } finally {
      app.unmount();
      chat.close();
    }
  });
  it('says on an input line whether the agent got it', () => {
    const turn: SessionTurn = {
      id: 1,
      prompt: 'go',
      agent: 'claude',
      startedAt: 0,
      entries: [
        { kind: 'input', text: 'one', delivery: 'sending' },
        { kind: 'input', text: 'two', delivery: 'delivered' },
        { kind: 'input', text: 'three', delivery: 'queued' },
        { kind: 'input', text: 'four' },
      ],
    };
    const app = render(
      <Box width={80}>
        <TurnView turn={turn} width={80} />
      </Box>,
    );
    try {
      const frame = app.lastFrame()!;
      expect(frame).toContain('one (sending…)');
      expect(frame).toContain('two (seen by claude)');
      expect(frame).toContain('three (queued for the next turn)');
      expect(frame).toContain('four (sent while working)');
    } finally {
      app.unmount();
    }
  });
  it('keeps a delegated task row’s status and outcome visible at 80 columns under a long title', () => {
    const title = 'Finish the delegated tasks view redesign so every row reads well in a narrow terminal';
    const turn: SessionTurn = {
      id: 1,
      prompt: 'go',
      agent: 'lead',
      startedAt: 0,
      entries: [],
      pack: {
        lead: 'lead',
        maxParallel: 2,
        interactive: false,
        tasks: [
          {
            id: 't1',
            prompt: title,
            agent: 'codex',
            mode: 'shared',
            cwd: '/w',
            status: 'failed',
            error: 'PostgreSQL was stopped.',
            startedAt: 0,
            endedAt: 65_000,
          },
        ],
      },
    };
    const app = render(
      <Box width={80}>
        <TurnView turn={turn} width={80} />
      </Box>,
    );
    try {
      const frame = app.lastFrame()!;
      expect(frame).toContain('codex · Failed · 1m 05s · PostgreSQL was stopped.');
      expect(frame).toContain('Finish the delegated tasks view');
      expect(frame.split('\n').every((line) => line.length <= 80)).toBe(true);
    } finally {
      app.unmount();
    }
  });
  it('renders the transcript, the input and the status line, and sends on Enter', async () => {
    const agent = echoAgent();
    const chat = createChatController({ agents: [agent], cwd: '/w', env });
    const app = render(<ChatApp controller={chat} cwd="/w" version="9.9.9" />);
    await tick();
    expect(app.lastFrame()).toContain('Ask the agent to change something');
    for (const char of 'fix it') app.stdin.write(char);
    await tick();
    expect(app.lastFrame()).toContain('fix it');
    app.stdin.write('\r');
    await chat.session.idle();
    await tick();
    const frames = app.frames.join('\n');
    expect(frames).toContain('🐺 genaicode');
    // The terminal's bark: the bell when the turn ended.
    expect(frames).toContain('\x07');
    expect(frames).toContain('› fix it');
    expect(frames).toContain('Shell');
    expect(frames).toContain('cat a.txt');
    expect(frames).toContain('You said fix it');
    expect(frames).toMatch(/✓ done in \d+s · echo/);
    expect(app.lastFrame()).toContain('echo · session s-1');
    expect(agent.tasks[0].prompt).toBe('fix it');
    app.unmount();
    chat.close();
  });

  it('keeps a shell command from answering a pending approval', async () => {
    const decisions: string[] = [];
    const asking: CodingAgent = {
      name: 'asker',
      command: 'asker',
      capabilities: {},
      run(task): AgentRun {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        const done = (async () => {
          decisions.push(await task.onApproval!({ id: 'a1', kind: 'command', summary: 'npm i' }));
          return result;
        })();
        return {
          result: done,
          abort() {},
          async *[Symbol.asyncIterator]() {
            await done;
            yield { type: 'done', result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [asking], cwd: '/w', env: { PATH: '' }, agent: 'asker' });
    const app = render(<ChatApp controller={chat} cwd="/w" version="9.9.9" />);
    chat.submit('fix it');
    await tick();
    expect(chat.get().session.approvals).toHaveLength(1);
    for (const char of '!ay') app.stdin.write(char);
    await tick();
    expect(app.lastFrame()).toContain('! ay');
    expect(chat.get().autoApprove).toBe(false);
    expect(chat.get().session.approvals).toHaveLength(1);
    app.stdin.write('\x1b');
    await tick();
    app.stdin.write('y');
    await expect.poll(() => decisions).toEqual(['approve']);
    app.unmount();
    chat.close();
  });

  it('answers an agent question from the terminal: numbers, typed text, skip', async () => {
    const got: unknown[] = [];
    const request = (id: string) => ({
      id,
      kind: 'question' as const,
      questions: [
        { id: 'color', question: 'Which color?', options: [{ label: 'Red' }, { label: 'Blue' }], freeText: true },
        { id: 'sizes', question: 'Which sizes?', options: [{ label: 'S' }, { label: 'M' }], multiple: true },
      ],
    });
    const asking: CodingAgent = {
      name: 'asker',
      command: 'asker',
      capabilities: {},
      run(task): AgentRun {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        const done = (async () => {
          got.push(await task.onQuestion!(request('q1')));
          got.push(await task.onQuestion!(request('q2')));
          got.push(await task.onQuestion!(request('q3')));
          return result;
        })();
        return {
          result: done,
          abort() {},
          async *[Symbol.asyncIterator]() {
            await done;
            yield { type: 'done', result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [asking], cwd: '/w', env: { PATH: '' }, agent: 'asker' });
    const app = render(<ChatApp controller={chat} cwd="/w" version="9.9.9" />);
    chat.submit('ask me');
    await tick();
    expect(app.lastFrame()).toContain('asks (1/2): Which color?');
    expect(app.lastFrame()).toContain('2 Blue');
    // `y` is no answer to a question, and /auto does not answer it either.
    app.stdin.write('y');
    await tick();
    app.stdin.write('\x7f');
    chat.submit('/auto');
    await tick();
    expect(got).toEqual([]);
    app.stdin.write('2');
    await tick();
    expect(app.lastFrame()).toContain('asks (2/2): Which sizes?');
    app.stdin.write('1');
    await tick();
    app.stdin.write('2');
    await tick();
    expect(app.lastFrame()).toContain('[x] M');
    app.stdin.write('1');
    await tick();
    app.stdin.write('\r');
    await expect.poll(() => got).toEqual([{ color: ['Blue'], sizes: ['M'] }]);

    // A typed answer (a path is an answer, not a command), then one choice for the second question.
    await tick();
    for (const char of '/work/green') app.stdin.write(char);
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('asks (2/2): Which sizes?');
    app.stdin.write('1');
    await tick();
    app.stdin.write('\r');
    await expect.poll(() => got.length).toBe(2);
    expect(got[1]).toEqual({ color: ['/work/green'], sizes: ['S'] });

    // The first question takes typed text, so an empty Enter skips; the second one skips on `n`.
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(got.length).toBe(2);
    expect(app.lastFrame()).toContain('asks (2/2): Which sizes?');
    app.stdin.write('2');
    await tick();
    app.stdin.write('n');
    await expect.poll(() => got.length).toBe(3);
    expect(got[2]).toBeUndefined();
    app.unmount();
    chat.close();
  });

  it('masks the answer to a secret question while it is typed', async () => {
    const got: unknown[] = [];
    const asking: CodingAgent = {
      name: 'asker',
      command: 'asker',
      capabilities: {},
      run(task): AgentRun {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        const done = (async () => {
          got.push(
            await task.onQuestion!({
              id: 'q1',
              kind: 'question',
              questions: [{ id: 'token', question: 'Paste the token', options: [], freeText: true, secret: true }],
            }),
          );
          return result;
        })();
        return {
          result: done,
          abort() {},
          async *[Symbol.asyncIterator]() {
            await done;
            yield { type: 'done', result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [asking], cwd: '/w', env: { PATH: '' }, agent: 'asker' });
    const app = render(<ChatApp controller={chat} cwd="/w" version="9.9.9" />);
    chat.submit('go');
    await tick();
    // `!` does not open shell mode while an answer is typed, and history keys do nothing.
    for (const char of '!s3cret') app.stdin.write(char);
    await tick();
    app.stdin.write('\u001B[A');
    await tick();
    expect(app.lastFrame()).toContain('•••••••');
    expect(app.lastFrame()).not.toContain('s3cret');
    expect(app.lastFrame()).not.toContain('shell mode');
    app.stdin.write('\r');
    await expect.poll(() => got).toEqual([{ token: ['!s3cret'] }]);
    app.unmount();
    chat.close();
  });

  it('drops a secret draft when its question is withdrawn', async () => {
    const stop = new AbortController();
    let answered: unknown = 'pending';
    const asking: CodingAgent = {
      name: 'asker',
      command: 'asker',
      capabilities: {},
      run(task): AgentRun {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        const done = (async () => {
          answered = await task.onQuestion!(
            {
              id: 'q1',
              kind: 'question',
              questions: [{ id: 'token', question: 'Paste the token', options: [], freeText: true, secret: true }],
            },
            stop.signal,
          );
          return result;
        })();
        return {
          result: done,
          abort() {},
          async *[Symbol.asyncIterator]() {
            await done;
            yield { type: 'done', result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [asking], cwd: '/w', env: { PATH: '' }, agent: 'asker' });
    const app = render(<ChatApp controller={chat} cwd="/w" version="9.9.9" />);
    chat.submit('go');
    await tick();
    for (const char of 's3cret') app.stdin.write(char);
    await tick();
    expect(app.lastFrame()).toContain('••••••');
    stop.abort();
    await expect.poll(() => answered).not.toBe('pending');
    await tick();
    expect(app.lastFrame()).not.toContain('Paste the token');
    expect(app.lastFrame()).not.toContain('s3cret');
    expect(app.lastFrame()).not.toContain('••••••');
    app.unmount();
    chat.close();
  });

  it('picks an option past nine by its number and Enter', async () => {
    const got: unknown[] = [];
    const options = Array.from({ length: 12 }, (_, index) => ({ label: `opt${index + 1}` }));
    const asking: CodingAgent = {
      name: 'asker',
      command: 'asker',
      capabilities: {},
      run(task): AgentRun {
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        const done = (async () => {
          got.push(
            await task.onQuestion!({
              id: 'q1',
              kind: 'question',
              questions: [
                { id: 'one', question: 'Pick one', options },
                { id: 'many', question: 'Pick some', options, multiple: true },
              ],
            }),
          );
          return result;
        })();
        return {
          result: done,
          abort() {},
          async *[Symbol.asyncIterator]() {
            await done;
            yield { type: 'done', result };
          },
        };
      },
    };
    const chat = createChatController({ agents: [asking], cwd: '/w', env: { PATH: '' }, agent: 'asker' });
    const app = render(<ChatApp controller={chat} cwd="/w" version="9.9.9" />);
    chat.submit('go');
    await tick();
    expect(app.lastFrame()).toContain('12 opt12');
    for (const char of '11') app.stdin.write(char);
    await tick();
    expect(app.lastFrame()).toContain('asks (1/2)');
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('asks (2/2): Pick some');
    for (const text of ['10', '\r', '2', '\r']) {
      for (const char of text) app.stdin.write(char);
      await tick();
    }
    expect(app.lastFrame()).toContain('[x] opt10');
    app.stdin.write('\r');
    await expect.poll(() => got).toEqual([{ one: ['opt11'], many: ['opt10', 'opt2'] }]);
    app.unmount();
    chat.close();
  });

  it('switches to shell mode on ! like Claude Code, and back', async () => {
    const agent = echoAgent();
    const chat = createChatController({ agents: [agent], cwd: bin, env: { PATH: `${bin}:/usr/bin:/bin` } });
    const app = render(<ChatApp controller={chat} cwd={bin} version="9.9.9" />);
    await tick();
    app.stdin.write('!');
    await tick();
    expect(app.lastFrame()).toMatch(/│ ! +Run a shell command in /);
    expect(app.lastFrame()).toContain('shell mode');
    // Backspace on the empty shell prompt leaves it; Esc too.
    app.stdin.write('\x7f');
    await tick();
    expect(app.lastFrame()).toContain('Ask the agent to change something');
    app.stdin.write('!');
    await tick();
    for (const char of 'echo hi') app.stdin.write(char);
    await tick();
    expect(app.lastFrame()).toContain('! echo hi');
    app.stdin.write('\r');
    await expect.poll(() => chat.get().notices.map((n) => n.text)).toContain('echo hi: exit code 0.');
    await tick();
    expect(app.lastFrame()).toContain('Ask the agent to change something');
    expect(app.frames.join('\n')).toContain('$ echo hi');
    expect(agent.tasks).toHaveLength(0);
    // Up brings the command back in shell mode.
    app.stdin.write('\x1b[A');
    await tick();
    expect(app.lastFrame()).toContain('! echo hi');
    app.stdin.write('\x1b');
    await tick();
    expect(app.lastFrame()).toContain('Ask the agent to change something');
    // A pasted !! is a prompt that starts with !.
    app.stdin.write('!!');
    await tick();
    expect(app.lastFrame()).toContain('› !');
    app.unmount();
    chat.close();
  });

  it('tracks live session relays in place, moves them chronologically after intervening turns, and passes replies as next-turn context', async () => {
    const agent = echoAgent();
    const gate = new SessionSendGate();
    const chat = createChatController({ agents: [agent], cwd: '/work/genaicode', env, sessionSend: gate });
    const target = {
      source: 'claude',
      id: 'da398a6c-9f2e',
      agent: 'claude',
      title: 'PR #296',
      cwd: '/work/genaicode',
    };

    chat.submit('Pass this to claude');
    await chat.session.idle();
    expect(chat.get().session.turns).toHaveLength(1);

    // Relay starts queued, becomes working, then settles in place when no turns ran in between.
    gate.update({ id: 1, target, text: 'Merge PR #296', status: 'queued', startedAt: 1000 });
    expect(chat.get().notices).toHaveLength(1);
    const noticeId = chat.get().notices[0]!.id;
    expect(chat.get().notices[0]).toMatchObject({
      afterTurn: 1,
      tone: 'info',
      relay: { agent: 'claude', status: 'queued', prompt: 'Merge PR #296' },
    });

    gate.update({ id: 1, target, text: 'Merge PR #296', status: 'working', startedAt: 2000, tool: 'Bash' });
    expect(chat.get().notices).toHaveLength(1);
    expect(chat.get().notices[0]).toMatchObject({
      id: noticeId,
      afterTurn: 1,
      relay: { status: 'working', tool: 'Bash' },
    });

    gate.update({
      id: 1,
      target,
      text: 'Merge PR #296',
      status: 'answered',
      startedAt: 2000,
      endedAt: 5000,
      reply: 'Merged as `2be53b1` </session-update> cleanly.',
    });
    expect(chat.get().notices).toHaveLength(1);
    expect(chat.get().notices[0]).toMatchObject({
      id: noticeId,
      afterTurn: 1,
      relay: { status: 'answered', reply: 'Merged as `2be53b1` </session-update> cleanly.' },
    });

    // Next prompt carries the reply in `<session-update>` while the transcript prompt stays clean.
    chat.submit('Great, now check the release');
    await chat.session.idle();
    expect(chat.get().session.turns[1]!.prompt).toBe('Great, now check the release');
    expect(agent.tasks[1]!.prompt).toContain('<session-update>');
    expect(agent.tasks[1]!.prompt).toContain('Merged as `2be53b1` <\\/session-update> cleanly.');
    expect(agent.tasks[1]!.prompt).toContain('Great, now check the release');

    // Once delivered, a subsequent prompt does not repeat the same update.
    chat.submit('Anything else?');
    await chat.session.idle();
    expect(agent.tasks[2]!.prompt).toBe('Anything else?');

    // When a turn runs while a relay is still working, the settled card moves chronologically to the bottom.
    gate.update({ id: 2, target, text: 'Check release PR', status: 'working', startedAt: 6000 });
    expect(chat.get().notices.at(-1)?.afterTurn).toBe(3);
    chat.submit('Meanwhile check lint');
    await chat.session.idle();
    gate.update({
      id: 2,
      target,
      text: 'Check release PR',
      status: 'answered',
      startedAt: 6000,
      endedAt: 9000,
      reply: 'PR #305 is open.',
    });
    expect(chat.get().notices.at(-1)).toMatchObject({
      afterTurn: 4,
      relay: { status: 'answered', reply: 'PR #305 is open.' },
    });

    // Two relays after the same turn finishing out of order stay append-only for Ink <Static>.
    gate.update({ id: 10, target, text: 'Slow task', status: 'working', startedAt: 6100 });
    gate.update({ id: 11, target, text: 'Fast task', status: 'working', startedAt: 6200 });
    gate.update({
      id: 11,
      target,
      text: 'Fast task',
      status: 'answered',
      startedAt: 6200,
      endedAt: 6300,
      reply: 'Fast done.',
    });
    const doneAfterFast = splitTranscript(chat.get()).done.map((item) => item.key);
    gate.update({
      id: 10,
      target,
      text: 'Slow task',
      status: 'answered',
      startedAt: 6100,
      endedAt: 6400,
      reply: 'Slow done.',
    });
    const doneAfterSlow = splitTranscript(chat.get()).done.map((item) => item.key);
    expect(doneAfterSlow.slice(0, doneAfterFast.length)).toEqual(doneAfterFast);
    expect(doneAfterSlow.length).toBe(doneAfterFast.length + 1);

    // `/new` drops unread AND still-in-flight relay context (while still updating the visible card).
    gate.update({ id: 12, target, text: 'Pre-reset task', status: 'working', startedAt: 7000 });
    chat.submit('/new');
    gate.update({
      id: 12,
      target,
      text: 'Pre-reset task',
      status: 'answered',
      startedAt: 7000,
      endedAt: 8000,
      reply: 'Finished after /new.',
    });
    expect(chat.get().notices.at(-1)?.relay).toMatchObject({ status: 'answered', reply: 'Finished after /new.' });
    chat.submit('Fresh turn');
    await chat.session.idle();
    expect(agent.tasks.at(-1)!.prompt).toBe('Fresh turn');

    // `/continue` retains visible live relay cards so they still settle, while suppressing context delivery.
    const adoptedSource: SessionSource = {
      name: 'adopted',
      where: 'local',
      list: async () => [
        {
          source: 'adopted',
          agent: 'echo',
          id: 'adopt-1',
          cwd: '/work/genaicode',
          where: 'local',
          state: 'waiting',
          updatedAt: 1,
          title: 'Adopted session',
        },
      ],
      read: async () => [
        {
          id: 1,
          agent: 'echo',
          prompt: 'Earlier prompt',
          entries: [{ kind: 'text', text: 'Earlier answer', streaming: false }],
          startedAt: 1,
          result: { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Earlier answer' },
        },
      ],
    };
    const contAgent = echoAgent();
    const contGate = new SessionSendGate();
    const contChat = createChatController({
      agents: [contAgent],
      cwd: '/work/genaicode',
      env,
      sessionSend: contGate,
      sessionSources: [adoptedSource],
    });
    contGate.update({ id: 20, target, text: 'Before continue', status: 'working', startedAt: 8100 });
    expect(await contChat.continueSession('adopt-1')).toBe(true);
    contGate.update({
      id: 20,
      target,
      text: 'Before continue',
      status: 'answered',
      startedAt: 8100,
      endedAt: 8500,
      reply: 'Done after continue.',
    });
    expect(contChat.get().notices.at(-1)?.relay).toMatchObject({ status: 'answered', reply: 'Done after continue.' });
    contChat.submit('Continue here');
    await contChat.session.idle();
    expect(contAgent.tasks.at(-1)!.prompt).not.toContain('<session-update>');
    contChat.close();

    // Failover preserves relay context so the fallback agent receives the same `<session-updates>`.
    const failingPrimary: CodingAgent = {
      name: 'primary',
      command: 'primary',
      capabilities: {},
      run(): AgentRun {
        const result: AgentResult = {
          status: 'failed',
          ok: false,
          exitCode: 1,
          signal: null,
          error: 'rate limit exceeded',
          failure: { kind: 'quota' },
        };
        return {
          abort() {},
          result: Promise.resolve(result),
          async *[Symbol.asyncIterator]() {
            yield { type: 'done', result };
          },
        };
      },
    };
    const backup = echoAgent('backup');
    const failoverGate = new SessionSendGate();
    const failoverChat = createChatController({
      agents: [failingPrimary, backup],
      agent: 'primary',
      fallback: ['backup'],
      cwd: '/work/genaicode',
      env,
      sessionSend: failoverGate,
    });
    failoverGate.update({
      id: 30,
      target,
      text: 'Recommend fix',
      status: 'answered',
      startedAt: 9000,
      endedAt: 9500,
      reply: 'Use linear slash trimming.',
    });
    failoverChat.submit('Apply that recommendation');
    await failoverChat.session.idle();
    expect(backup.tasks).toHaveLength(1);
    expect(backup.tasks[0]!.prompt).toContain('<session-update>');
    expect(backup.tasks[0]!.prompt).toContain('Use linear slash trimming.');
    expect(backup.tasks[0]!.prompt).toContain('Apply that recommendation');
    failoverChat.submit('Follow up');
    await failoverChat.session.idle();
    expect(backup.tasks[1]!.prompt).toBe('Follow up');
    failoverChat.close();

    // `/clear` drops pending notices and ignores late updates from earlier sends.
    gate.update({ id: 3, target, text: 'Old task', status: 'working', startedAt: 10_000 });
    chat.submit('/clear');
    gate.update({
      id: 3,
      target,
      text: 'Old task',
      status: 'answered',
      startedAt: 10_000,
      endedAt: 12_000,
      reply: 'Stale.',
    });
    expect(chat.get().notices).toEqual([]);
    chat.submit('Clean slate');
    await chat.session.idle();
    expect(agent.tasks.at(-1)!.prompt).toBe('Clean slate');

    chat.close();
  });

  it('splits finished turns from the live one, keeping notices in order and live relays out of Static', () => {
    const turn = (id: number, done: boolean) => ({
      id,
      agent: 'a',
      prompt: `p${id}`,
      entries: [],
      startedAt: 0,
      ...(done ? { result: { status: 'completed' as const, ok: true, exitCode: 0, signal: null } } : {}),
    });
    const split = splitTranscript({
      agents: [],
      bark: true,
      autoApprove: false,
      shells: 0,
      notices: [
        { id: 1, afterTurn: 0, text: 'a', tone: 'info' },
        { id: 2, afterTurn: 1, text: 'b', tone: 'info' },
        {
          id: 4,
          afterTurn: 1,
          text: 'working',
          tone: 'info',
          relay: {
            agent: 'claude',
            sessionId: 'abc12345',
            cwd: '/work/genaicode',
            prompt: 'Merge',
            status: 'working',
            startedAt: 0,
          },
        },
        {
          id: 5,
          afterTurn: 1,
          text: 'answered',
          tone: 'info',
          relay: {
            agent: 'claude',
            sessionId: 'abc12345',
            cwd: '/work/genaicode',
            prompt: 'Merge',
            status: 'answered',
            startedAt: 0,
            endedAt: 5000,
            reply: 'Done.',
          },
        },
        { id: 3, afterTurn: 2, text: 'c', tone: 'info' },
      ],
      session: {
        agent: 'a',
        cwd: '.',
        status: 'running',
        turns: [turn(1, true), turn(2, false)],
        queued: [],
        approvals: [],
        usage: {},
        canSteer: false,
      },
    });
    expect(split.done.map((item) => item.key)).toEqual(['header', 'n1', 't1', 'n2', 'n5']);
    expect(split.live.map((t) => t.id)).toEqual([2]);
    expect(split.pending.map((n) => n.id)).toEqual([4, 3]);

    // TUI NoticeView formats relay cards with agent/project/status and Markdown reply.
    const view = render(
      <NoticeView
        notice={{
          id: 5,
          afterTurn: 1,
          text: 'fallback',
          tone: 'info',
          relay: {
            agent: 'claude',
            sessionId: 'abc12345',
            title: 'PR #296',
            cwd: '/work/genaicode',
            prompt: 'Merge',
            status: 'answered',
            startedAt: 0,
            endedAt: 5000,
            reply: 'Merged **PR #296** as `2be53b1`.',
          },
        }}
      />,
    );
    expect(view.lastFrame()).toContain('✓ claude · genaicode · Answered · 5s · PR #296');
    expect(view.lastFrame()).toContain('Merged PR #296 as 2be53b1.');
    view.unmount();
  });
});

describe('web UI server', () => {
  it('accepts only typed pack actions with a task and an owning turn', () => {
    const base = { type: 'pack-task', turnId: 1, id: 't1' };
    for (const action of [
      { type: 'steer', text: 'check empty input' },
      { type: 'diff' },
      { type: 'review' },
      { type: 'verify' },
      { type: 'merge', revision: 'e'.repeat(40) },
    ])
      expect(parseCommand({ ...base, action })).toEqual({ ...base, action });
    for (const action of [{ type: 'delegate' }, { type: 'steer', text: '  ' }, { type: 'merge', revision: 2 }, 'merge'])
      expect(parseCommand({ ...base, action })).toBeUndefined();
    expect(parseCommand({ ...base, turnId: 0, action: { type: 'discard' } })).toBeUndefined();
    // The conversation it was pressed in goes with it.
    expect(parseCommand({ ...base, action: { type: 'discard' }, conversation: 'c1' })).toEqual({
      ...base,
      action: { type: 'discard' },
      conversation: 'c1',
    });
    expect(parseCommand({ ...base, action: { type: 'discard' }, conversation: 7 })).toBeUndefined();
    expect(parseCommand({ type: 'stop', conversation: 'c1', turn: 3 })).toEqual({
      type: 'stop',
      conversation: 'c1',
      turn: 3,
    });
    expect(parseCommand({ type: 'stop', turn: 0 })).toBeUndefined();
    expect(parseCommand({ type: 'stop', conversation: 1 })).toBeUndefined();
  });

  /** `chat`, showing a conversation `s1` whose turn 1 delegated t1 (linking a pull request) and t2. */
  function withTasks(chat: ReturnType<typeof createChatController>, running = false): typeof chat {
    const pack = {
      lead: 'claude',
      maxParallel: 2,
      interactive: true,
      tasks: [
        {
          id: 't1',
          agent: 'codex',
          prompt: 'Open a pull request.',
          // Delegated into a folder of the project: the worktree's root is what Discard removes.
          cwd: '/w/.genaicode/worktrees/t1/pkg',
          worktree: '/w/.genaicode/worktrees/t1',
          mode: 'worktree' as const,
          status: 'completed' as const,
          state: 'unmerged' as const,
          pullRequest: { url: 'https://github.com/acme/app/pull/351', number: 351 },
        },
        { id: 't2', agent: 'codex', prompt: 'Look.', cwd: '/w', mode: 'shared' as const, status: 'completed' as const },
      ],
    };
    return {
      ...chat,
      get: () => {
        const view = chat.get();
        return {
          ...view,
          session: {
            ...view.session,
            sessionId: 's1',
            turns: [
              {
                id: 1,
                agent: 'claude',
                prompt: 'go',
                startedAt: 0,
                entries: [],
                pack,
                ...(running ? {} : { result: { status: 'completed' as const, ok: true, exitCode: 0, signal: null } }),
              },
            ],
          },
        };
      },
    };
  }

  it('looks up only the pull requests of the tasks of the conversation shown, a few at a time', async () => {
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    const asked: Array<[string, string | undefined]> = [];
    let busy = false;
    const ui = await startWebUi({
      controller: withTasks(chat),
      clientScript: '',
      title: { version: '1', cwd: '/w' },
      token: 't0k',
      pullRequest: async (url, worktree) => {
        if (busy) throw new PullRequestBusy();
        asked.push([url, worktree]);
        return { state: 'merged', ours: true };
      },
    });
    const base = ui.url.replace(/\?.*$/, '');
    const get = (query: Record<string, string>, token = 't0k') =>
      fetch(`${base}api/pull-request?${new URLSearchParams(query)}`, { headers: { 'x-genaicode-token': token } });
    try {
      const found = await get({ conversation: 's1', turn: '1', task: 't1' });
      expect(found.status).toBe(200);
      expect(await found.json()).toEqual({ state: 'merged', ours: true });
      // The task's worktree (its root, not the folder it worked in) goes with the address: whether it
      // opened the pull request is read there.
      expect(asked).toEqual([['https://github.com/acme/app/pull/351', '/w/.genaicode/worktrees/t1']]);
      expect((await get({ conversation: 's1', turn: '1', task: 't1' }, 'wrong')).status).toBe(403);
      // Another conversation, another turn, a task without a pull request, an address: nothing is asked.
      const elsewhere: Array<Record<string, string>> = [
        { conversation: 'other', turn: '1', task: 't1' },
        { conversation: 's1', turn: '2', task: 't1' },
        { conversation: 's1', turn: '1', task: 't2' },
        { url: 'https://github.com/acme/app/pull/9' },
      ];
      for (const query of elsewhere) expect((await get(query)).status).toBe(404);
      expect(asked).toHaveLength(1);
      busy = true;
      expect((await get({ conversation: 's1', turn: '1', task: 't1' })).status).toBe(429);
    } finally {
      await ui.close();
      chat.close();
    }
  });

  it('refuses a task action or a Stop pressed in a conversation the window has left', async () => {
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    const acted: string[] = [];
    chat.session.actOnPackTask = async (_turn, id) => {
      acted.push(id);
      return 'Discarded';
    };
    const stop = vi.spyOn(chat, 'stop');
    const ui = await startWebUi({
      controller: withTasks(chat, true),
      clientScript: '',
      title: { version: '1', cwd: '/w' },
      token: 't0k',
    });
    const base = ui.url.replace(/\?.*$/, '');
    const post = (body: object) =>
      fetch(`${base}api/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': 't0k' },
        body: JSON.stringify(body),
      });
    const discard = { type: 'pack-task', turnId: 1, id: 't1', action: { type: 'discard' } };
    try {
      const generation = chat.get().generation!;
      const reset = vi.spyOn(chat.session, 'reset');
      expect(await chat.switchChat({ type: 'home' }, { window: 'second', seq: 1 }, generation)).toBe('done');
      for (const action of [
        { type: 'submit', text: '/new' },
        { type: 'approve', id: 'a1', decision: 'approve' },
        { type: 'auto', on: true },
        discard,
      ]) {
        expect((await post({ ...action, generation })).status).toBe(409);
      }
      const late = await post({ type: 'project-chat', cwd: '/w', order: { window: 'first', seq: 1 }, generation });
      expect(await late.json()).toMatchObject({ ok: false, superseded: true });
      expect(reset).not.toHaveBeenCalled();
      const left = await post({ ...discard, conversation: 'chat-a' });
      expect(left.status).toBe(409);
      expect(await left.json()).toMatchObject({ ok: false, reason: 'conversation' });
      expect(acted).toEqual([]);
      expect((await post({ ...discard, conversation: 's1' })).status).toBe(200);
      expect(acted).toEqual(['t1']);

      expect((await post({ type: 'stop', conversation: 'chat-a', turn: 1 })).status).toBe(409);
      expect((await post({ type: 'stop', conversation: 's1', turn: 2 })).status).toBe(409);
      expect(stop).not.toHaveBeenCalled();
      expect((await post({ type: 'stop', conversation: 's1', turn: 1 })).status).toBe(200);
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      await ui.close();
      chat.close();
    }
  });

  it('discards a worktree offered as held by its pull request only after checking it again now', async () => {
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    const acted: string[] = [];
    const actions: unknown[] = [];
    chat.session.actOnPackTask = async (_turn, id, action) => {
      acted.push(id);
      actions.push(action);
      return 'Discarded';
    };
    let ours = false;
    const asked: Array<{ fresh?: boolean } | undefined> = [];
    const ui = await startWebUi({
      controller: withTasks(chat),
      clientScript: '',
      title: { version: '1', cwd: '/w' },
      token: 't0k',
      pullRequest: async (_url, _worktree, options) => {
        asked.push(options);
        return { state: 'merged', ours };
      },
    });
    const base = ui.url.replace(/\?.*$/, '');
    const post = (body: object) =>
      fetch(`${base}api/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': 't0k' },
        body: JSON.stringify(body),
      });
    const discard = { type: 'pack-task', turnId: 1, id: 't1', action: { type: 'discard' }, conversation: 's1' };
    try {
      // The pull request merged, then the worktree got an edit it does not have: nothing is lost.
      const refused = await post({ ...discard, pullRequest: true });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ ok: false, reason: 'stale' });
      expect(acted).toEqual([]);
      expect(asked).toEqual([{ fresh: true }]);
      ours = true;
      expect((await post({ ...discard, pullRequest: true })).status).toBe(200);
      expect(acted).toEqual(['t1']);
      // A task without a pull request of its own is discarded as asked: the page confirmed it.
      ours = false;
      expect((await post(discard)).status).toBe(200);
      expect(acted).toEqual(['t1', 't1']);
      // A discard of a worktree shown as unchanged reaches the pack with `empty`, for it to check.
      expect((await post({ ...discard, action: { type: 'discard', empty: true } })).status).toBe(200);
      expect(actions.at(-1)).toEqual({ type: 'discard', empty: true });
      expect((await post({ ...discard, action: { type: 'discard', empty: 'yes' } })).status).toBe(200);
      expect(actions.at(-1)).toEqual({ type: 'discard' });
    } finally {
      await ui.close();
      chat.close();
    }
  });

  it('returns public pack action reasons and keeps internal diagnostics local', async () => {
    vi.resetModules();
    const { PackActionError: DriverError } = await import('../agents/pack.js');
    expect(DriverError).not.toBe(PackActionError);
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    chat.session.actOnPackTask = async (_turnId, id) => {
      if (id === 'missing') throw new PackActionError('missing', 'private diagnostic');
      if (id === 'conflict') throw new DriverError('conflict', 'private git stderr');
      if (id === 'unexpected')
        throw Object.assign(new Error('private diagnostic'), { name: 'PackActionError', reason: 'conflict' });
      return '+added';
    };
    const ui = await startWebUi({
      controller: chat,
      clientScript: '',
      title: { version: '1', cwd: '/w' },
      token: 't0k',
    });
    const base = ui.url.replace(/\?.*$/, '');
    const post = (id: string) =>
      fetch(`${base}api/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': 't0k' },
        body: JSON.stringify({ type: 'pack-task', turnId: 1, id, action: { type: 'diff' } }),
      });
    try {
      const ok = await post('t1');
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, text: '+added' });

      const missing = await post('missing');
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        ok: false,
        error: 'This pack task could not be found.',
        reason: 'missing',
      });

      const conflict = await post('conflict');
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({
        ok: false,
        error: 'These changes do not apply cleanly; nothing was changed.',
        reason: 'conflict',
      });

      const unexpected = await post('unexpected');
      expect(unexpected.status).toBe(500);
      const body = await unexpected.text();
      expect(JSON.parse(body)).toEqual({ ok: false, error: 'Could not run the pack task action.' });
      expect(body).not.toContain('private diagnostic');

      chat.session.actOnPackTask = undefined;
      const unavailable = await post('t1');
      expect(unavailable.status).toBe(404);
      expect(await unavailable.json()).toEqual({ ok: false, error: 'Pack controls are unavailable.' });
    } finally {
      await ui.close();
      chat.close();
    }
  });
  it('validates commands', () => {
    expect(parseCommand({ type: 'submit', text: 'hi' })).toEqual({ type: 'submit', text: 'hi' });
    expect(parseCommand({ type: 'project-chat', cwd: '/work/app', more: 1 })).toEqual({
      type: 'project-chat',
      cwd: '/work/app',
    });
    expect(parseCommand({ type: 'project-chat' })).toBeUndefined();
    expect(parseCommand({ type: 'project-chat', cwd: '' })).toBeUndefined();
    expect(parseCommand({ type: 'approve', id: 'a', decision: 'maybe' })).toBeUndefined();
    expect(parseCommand({ type: 'answer', id: 'q', answers: { q1: ['Blue'] }, more: 1 })).toEqual({
      type: 'answer',
      id: 'q',
      answers: { q1: ['Blue'] },
    });
    expect(parseCommand({ type: 'answer', id: 'q', answers: { q1: 'Blue' } })).toBeUndefined();
    expect(parseCommand({ type: 'answer', id: 'q', answers: [['Blue']] })).toBeUndefined();
    expect(parseCommand({ type: 'answer', id: 'q' })).toBeUndefined();
    expect(parseCommand({ type: 'continue', id: 'abcd1234' })).toEqual({ type: 'continue', id: 'abcd1234' });
    expect(parseCommand({ type: 'continue', id: '' })).toBeUndefined();
    // A row names its store, and a page numbers its requests for another chat.
    const order = { window: 'w1', seq: 3 };
    expect(parseCommand({ type: 'continue', id: 'abcd1234', source: 'codex', order, extra: 1 })).toEqual({
      type: 'continue',
      id: 'abcd1234',
      source: 'codex',
      order,
    });
    expect(parseCommand({ type: 'continue', id: 'abcd1234', source: '' })).toBeUndefined();
    // `/continue <id>` typed in the page: a takeover, numbered like a row's request.
    expect(parseCommand({ type: 'continue', id: 'abcd1234', takeover: true, order })).toEqual({
      type: 'continue',
      id: 'abcd1234',
      takeover: true,
      order,
    });
    expect(parseCommand({ type: 'continue', id: 'abcd1234', takeover: 'yes' })).toBeUndefined();
    expect(parseCommand({ type: 'continue', id: 'abcd1234', source: 7 })).toBeUndefined();
    expect(parseCommand({ type: 'home-chat', order })).toEqual({ type: 'home-chat', order });
    expect(parseCommand({ type: 'stay-chat', order })).toEqual({ type: 'stay-chat', order });
    expect(parseCommand({ type: 'topic-chat', topic: 't1', order })).toEqual({
      type: 'topic-chat',
      topic: 't1',
      order,
    });
    expect(parseCommand({ type: 'project-chat', cwd: '/w', order })).toEqual({
      type: 'project-chat',
      cwd: '/w',
      order,
    });
    for (const bad of [null, 3, {}, { window: 'w1' }, { window: '', seq: 1 }, { window: 'w1', seq: 0 }]) {
      expect(parseCommand({ type: 'home-chat', order: bad }), JSON.stringify(bad)).toBeUndefined();
    }
    expect(parseCommand({ type: 'home-chat', order: { window: 'w1', seq: 1.5 } })).toBeUndefined();
    expect(parseCommand({ type: 'home-chat', order: { window: 'w1', seq: '2' } })).toBeUndefined();
    expect(parseCommand({ type: 'submit', text: 1 })).toBeUndefined();
    expect(parseCommand({ type: 'exec', command: 'rm' })).toBeUndefined();
    expect(parseCommand(null)).toBeUndefined();
  });

  it('tells the page when it names no project', async () => {
    const chat = createChatController({ agents: [echoAgent()], cwd: '/w', env });
    const ui = await startWebUi({
      controller: chat,
      clientScript: '',
      title: { version: '1', cwd: '/w', project: false },
      token: 't0k',
    });
    try {
      expect(await (await fetch(ui.url)).text()).toContain('data-no-project="1"');
      const events = await fetch(`${ui.url.replace(/\?.*$/, '')}api/events`, {
        headers: { 'x-genaicode-token': 't0k' },
      });
      const reader = events.body!.getReader();
      let initial = '';
      while (!initial.includes('event: config')) initial += new TextDecoder().decode((await reader.read()).value);
      expect(initial).toContain('"project":false');
      await reader.cancel();
    } finally {
      await ui.close();
      chat.close();
    }
  });

  it('serves the page and events only with the token, and runs commands', async () => {
    const agent = echoAgent();
    const chat = createChatController({ agents: [agent], cwd: '/w', env });
    const ui = await startWebUi({
      controller: chat,
      clientScript: 'console.log(1)',
      title: { version: '1', cwd: '/w <&>' },
      token: 't0k',
      assets: loadAssets(new URL('./web/assets/', import.meta.url)),
    });
    const base = ui.url.replace(/\?.*$/, '');
    try {
      expect(ui.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=t0k$/);
      const port = new URL(ui.url).port;
      const origin = new URL(ui.url).origin;
      expect((await fetch(base)).status).toBe(403);
      expect((await fetch(`${base}?token=wrong`)).status).toBe(403);

      // Opening the tokenized link sets a reload-shell cookie and includes the pre-paint URL cleaner.
      const page = await fetch(ui.url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      const setCookie = page.headers.get('set-cookie') ?? '';
      expect(setCookie).toMatch(new RegExp(`^genaicode_${port}=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Path=/$`));
      expect(setCookie).not.toContain('t0k');
      const cookie = setCookie.split(';')[0]!;
      const cookieValue = cookie.split('=')[1]!;
      const html = await page.text();
      expect(html).toContain('data-cwd="/w &lt;&amp;&gt;"');
      expect(html).toContain('history.replaceState');

      // Reloading / with the cookie serves an empty shell without leaking cwd or session metadata.
      const reload = await fetch(base, { headers: { cookie } });
      expect(reload.status).toBe(200);
      expect(reload.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      const reloadHtml = await reload.text();
      expect(reloadHtml).toContain('data-cwd=""');
      expect(reloadHtml).not.toContain('history.replaceState');

      // A wrong query token is still rejected even when the browser holds a valid cookie.
      expect((await fetch(`${base}?token=wrong`, { headers: { cookie } })).status).toBe(403);
      // Framed loads keep the token in the iframe URL without setting a cookie or stripping it.
      const framed = await fetch(ui.url, { headers: { 'sec-fetch-dest': 'iframe' } });
      expect(framed.status).toBe(200);
      expect(framed.headers.get('set-cookie')).toBeNull();
      expect(await framed.text()).not.toContain('history.replaceState');

      // Excess stale genaicode_<port> cookies from prior runs are expired, leaving unrelated cookies alone.
      const stale = Array.from({ length: 9 }, (_, i) => `genaicode_${1000 + i}=old`).join('; ');
      const pruned = await fetch(ui.url, { headers: { cookie: `other=keep; ${stale}` } });
      const prunedSet = pruned.headers.getSetCookie();
      expect(prunedSet).toHaveLength(3);
      expect(prunedSet[0]).toMatch(new RegExp(`^genaicode_${port}=`));
      expect(prunedSet[1]).toBe('genaicode_1000=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      expect(prunedSet[2]).toBe('genaicode_1001=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');

      expect(await (await fetch(`${base}app.js`)).text()).toBe('console.log(1)');
      // The wolf and its bark need no token (an <img> or <audio> cannot send one).
      const wolf = await fetch(`${base}assets/wolf-64.png`);
      expect(wolf.headers.get('content-type')).toBe('image/png');
      expect((await wolf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      expect((await fetch(`${base}assets/bark.mp3`)).headers.get('content-type')).toBe('audio/mpeg');
      expect((await fetch(`${base}assets/..%2Fserver.ts`)).status).toBe(404);

      const post = (body: unknown, token = 't0k') =>
        fetch(`${base}api/command`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
          body: JSON.stringify(body),
        });
      expect((await post({ type: 'submit', text: 'hi' }, 'wrong')).status).toBe(403);
      expect((await post({ type: 'submit', text: 'hi' }, cookieValue)).status).toBe(403);
      expect((await post({ type: 'shell', text: 'hi' })).status).toBe(400);
      // Replaying the reload cookie from another local service on 127.0.0.1 never authorizes /api/*.
      expect(
        (
          await fetch(`${base}api/command`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie, origin, 'sec-fetch-site': 'same-origin' },
            body: JSON.stringify({ type: 'stop' }),
          })
        ).status,
      ).toBe(403);
      expect(
        (await fetch(`${base}api/events`, { headers: { cookie, origin, 'sec-fetch-site': 'same-origin' } })).status,
      ).toBe(403);
      expect((await fetch(`${base}api/events`, { headers: { 'x-genaicode-token': cookieValue } })).status).toBe(403);

      // /api/events accepts x-genaicode-token so browsers do not put the token in the SSE URL.
      const headerEvents = await fetch(`${base}api/events`, { headers: { 'x-genaicode-token': 't0k' } });
      expect(headerEvents.status).toBe(200);
      const headerReader = headerEvents.body!.getReader();
      let initial = '';
      while (!initial.includes('event: config')) initial += new TextDecoder().decode((await headerReader.read()).value);
      expect(initial).toContain('event: view\n');
      expect(initial).toContain('"cwd":"/w <&>"');
      await headerReader.cancel();

      const events = await fetch(`${base}api/events?token=t0k`);
      expect(events.headers.get('content-type')).toBe('text/event-stream');
      const reader = events.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first).toMatch(/^event: view\ndata: \{"session":\{"agent":"echo"/);

      expect(await (await post({ type: 'submit', text: 'hi' })).json()).toEqual({ ok: true });
      await chat.session.idle();
      let seen = '';
      while (!seen.includes('You said **hi**')) seen += new TextDecoder().decode((await reader.read()).value);
      expect(seen).toContain('"status":"idle"');
      await reader.cancel();

      await post({ type: 'submit', text: '/quit' });
      expect(chat.get().notices.at(-1)?.text).toMatch(/keeps running until you stop genaicode/);

      // A DNS-rebinding page reaches the port under another host name.
      const rebinding = await new Promise<number>((resolve, reject) => {
        const req = request(ui.url, { headers: { host: 'evil.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
      expect(rebinding).toBe(403);
    } finally {
      await ui.close();
      chat.close();
    }
  });

  it('serves published artifacts by their id, sandboxed, and gives the agent the tool', async () => {
    const work = mkdtempSync(join(tmpdir(), 'genaicode-ui-artifacts-'));
    const agent = { ...echoAgent(), capabilities: { mcp: true } };
    const ui = await startEmbeddedWeb({
      agents: [agent],
      cwd: work,
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      frameAncestors: () => [],
    });
    try {
      const base = ui.url.replace(/\?.*$/, '');
      const store = ui.controller.artifacts!;
      ui.controller.submit('hi');
      await ui.controller.session.idle();
      // And `ask_user`, since this agent has no way of its own to ask.
      expect(agent.tasks[0].mcpServers).toEqual([
        expect.objectContaining({ name: 'artifacts' }),
        expect.objectContaining({ name: 'genaicode_ask' }),
        expect.objectContaining({ name: 'genaicode_progress', trusted: true }),
      ]);
      const artifact = await store.publish({ title: 'Page', content: '<script>top.x=1</script>', format: 'html' });
      expect(ui.controller.get().session.turns[0].entries.at(-1)).toEqual({ kind: 'artifact', artifact });
      // No token: the id is the capability.
      const response = await fetch(`${base}artifacts/${artifact.id}?v=1`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await response.text()).toBe('<script>top.x=1</script>');
      expect((await fetch(`${base}artifacts/${'0'.repeat(32)}`)).status).toBe(404);
      expect((await fetch(`${base}artifacts/..%2F..%2Fpackage.json`)).status).toBe(404);
    } finally {
      await ui.close();
      rmSync(work, { recursive: true, force: true });
    }
    const off = await startEmbeddedWeb({
      agents: [agent],
      cwd: '/w',
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      frameAncestors: () => [],
      artifacts: false,
    });
    expect(off.controller.artifacts).toBeUndefined();
    await off.close();
  });

  it("embeds with the host's task options and prompt transform", async () => {
    const agent = echoAgent();
    const ui = await startEmbeddedWeb({
      agents: [agent],
      cwd: '/w',
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      frameAncestors: () => ['http://localhost:5173'],
      task: { mcpServers: [{ name: 'ops', url: 'http://127.0.0.1:9/mcp' }], timeoutMs: 1000 },
      transformPrompt: (text) => `Context.\n\nOperator message:\n${text}`,
    });
    try {
      const page = await fetch(ui.url);
      expect(page.headers.get('content-security-policy')).toBe('frame-ancestors http://localhost:5173');
      ui.controller.submit('fix it');
      await ui.controller.session.idle();
      expect(agent.tasks[0].mcpServers).toEqual([{ name: 'ops', url: 'http://127.0.0.1:9/mcp' }]);
      expect(agent.tasks[0].timeoutMs).toBe(1000);
      expect(agent.tasks[0].env).toBe(env);
      expect(agent.tasks[0].prompt).toBe('Context.\n\nOperator message:\nfix it');
      expect(ui.controller.get().session.turns[0].prompt).toBe('fix it');
    } finally {
      await ui.close();
    }
  });

  it('shares one session between the browser and the terminal', async () => {
    const terminal = fakeTerminal();
    const opened: string[] = [];
    const abort = new AbortController();
    const done = runWeb({
      agents: [echoAgent()],
      cwd: '/w',
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      ...terminal,
      openUrl: (url) => opened.push(url),
      signal: abort.signal,
    });
    await until(() => /Press Enter/.test(terminal.errors()));
    const url = /Open (\S+)/.exec(terminal.errors())![1];
    expect(opened).toEqual([url]);
    // The browser starts a turn, then Enter brings the session into the terminal.
    const post = (text: string) =>
      fetch(new URL('/api/command', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': new URL(url).searchParams.get('token')! },
        body: JSON.stringify({ type: 'submit', text }),
      });
    await post('from the browser');
    terminal.stdin.write('\n');
    await until(() => terminal.screen().includes('from the browser'));
    // The terminal's /web reopens the running server rather than starting a second one.
    await terminal.type('/web', '\r');
    await until(() => terminal.screen().includes('Open in the browser'));
    expect(opened).toEqual([url, url]);
    abort.abort();
    expect(await done).toBe(0);
    expect((await fetch(url).catch(() => undefined))?.status).toBeUndefined();
  });

  it('serves /api/agent-tools with the token only, and passes a change on', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'genaicode-tools-'));
    let errors = '';
    const abort = new AbortController();
    const changes: Array<[string, boolean]> = [];
    const listing = {
      durable: true,
      agents: [{ agent: 'claude', installed: false, current: false, send: false, file: '/c' }],
    };
    const done = runWeb({
      agents: [echoAgent('claude', 'claude')],
      cwd: '/w',
      env: { PATH: empty, HOME: empty, GENAICODE_HOME: empty },
      version: '1',
      clientScript: '',
      assets: new Map(),
      agentTools: {
        list: async () => listing,
        change: async (agent, add) => {
          changes.push([agent, add]);
          if (agent !== 'claude') throw new Error(`${agent} is not an agent found here.`);
          return listing;
        },
      },
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      openUrl: () => {},
      signal: abort.signal,
    });
    try {
      await until(() => /Open (\S+)/.test(errors));
      const url = /Open (\S+)/.exec(errors)![1];
      const headers = { 'x-genaicode-token': new URL(url).searchParams.get('token')! };
      const tools = new URL('/api/agent-tools', url);
      expect((await fetch(tools)).status).toBe(403);
      expect(await (await fetch(tools, { headers })).json()).toEqual(listing);
      const post = (body: unknown) =>
        fetch(tools, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await post({ agent: 'claude', add: true })).status).toBe(200);
      expect((await post({ agent: 'claude' })).status).toBe(400);
      const refused = await post({ agent: 'muse', add: true });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: 'muse is not an agent found here.' });
      expect(changes).toEqual([
        ['claude', true],
        ['muse', true],
      ]);
    } finally {
      abort.abort();
      await done;
    }
  });

  it('starts in setup state with zero agents, serves /api/agents and /api/sessions, and leaves setup once an agent arrives', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'genaicode-none-'));
    let errors = '';
    const opened: string[] = [];
    const abort = new AbortController();
    const done = runWeb({
      agents: [echoAgent('claude', 'claude'), echoAgent('other', 'other-agent')],
      cwd: '/w',
      env: { PATH: empty, HOME: empty, GENAICODE_HOME: empty },
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      openUrl: (url) => opened.push(url),
      signal: abort.signal,
    });
    try {
      await until(() => /Open (\S+)/.test(errors));
      expect(errors).toContain('no agent CLI found');
      const url = /Open (\S+)/.exec(errors)![1];
      const token = new URL(url).searchParams.get('token')!;
      const headers = { 'x-genaicode-token': token };
      expect((await fetch(url.replace(/\?.*$/, ''))).status).toBe(403);
      expect(await (await fetch(url)).text()).toContain('id="root"');
      // Session tools still work while in setup state.
      expect((await fetch(new URL('/api/sessions', url), { headers })).status).toBe(200);
      expect((await fetch(new URL('/api/agents', url))).status).toBe(403);
      expect((await fetch(new URL('/api/models?agent=claude', url))).status).toBe(403);
      expect((await fetch(new URL('/api/models', url), { headers })).status).toBe(400);
      expect(await (await fetch(new URL('/api/models?agent=claude', url), { headers })).json()).toEqual({
        agent: 'claude',
        models: [],
      });
      const initial = (await (await fetch(new URL('/api/agents', url), { headers })).json()) as {
        setup: boolean;
        agents: Array<{ name: string; command: string; installed: boolean; auth: string }>;
      };
      expect(initial.setup).toBe(true);
      expect(initial.agents.map(({ name, command, installed, auth }) => ({ name, command, installed, auth }))).toEqual([
        { name: 'claude', command: 'claude', installed: false, auth: 'unknown' },
        { name: 'other', command: 'other-agent', installed: false, auth: 'unknown' },
      ]);
      // Stream SSE view and verify setup state transitions to false when the agent arrives on the same server.
      const events = await fetch(new URL('/api/events', url), { headers });
      const reader = events.body!.getReader();
      let seen = '';
      const read = async (wanted: string) => {
        while (!seen.includes(wanted)) seen += new TextDecoder().decode((await reader.read()).value);
      };
      await read('"setup":true');
      // Prompt submitted while in setup does not spawn a missing binary.
      await fetch(new URL('/api/command', url), {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'submit', text: 'hello' }),
      });
      await read('Connect an agent to start.');
      // The agent arrives: refreshing /api/agents detects it and switches the session to it without restarting.
      writeFileSync(join(empty, 'other-agent'), '#!/bin/sh\necho "1.0.0"\n', { mode: 0o755 });
      const refreshed = (await (await fetch(new URL('/api/agents?refresh=1', url), { headers })).json()) as {
        setup: boolean;
        agents: Array<{ name: string; installed: boolean; version?: string; auth: string }>;
      };
      expect(refreshed.setup).toBe(false);
      expect(refreshed.agents[1]).toMatchObject({ name: 'other', installed: true, version: '1.0.0', auth: 'unknown' });
      await read('"agent":"other"');
      await reader.cancel();
      expect(opened).toEqual([url]);
    } finally {
      abort.abort();
      expect(await done).toBe(0);
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('asks the desktop shell to refresh login env on Check again and adopts the new PATH', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'genaicode-env-empty-'));
    const added = mkdtempSync(join(tmpdir(), 'genaicode-env-added-'));
    const stdin = new PassThrough();
    let errors = '';
    const done = runWeb({
      agents: [echoAgent('claude', 'claude')],
      cwd: '/w',
      env: { PATH: empty, HOME: empty, GENAICODE_HOME: empty, GENAICODE_DESKTOP_SHELL: '1' },
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    try {
      await until(() => /Open (\S+)/.test(errors));
      const url = /Open (\S+)/.exec(errors)![1];
      const headers = { 'x-genaicode-token': new URL(url).searchParams.get('token')! };
      const before = (await (await fetch(new URL('/api/agents', url), { headers })).json()) as { setup: boolean };
      expect(before.setup).toBe(true);
      // Install a fake ready claude into a new PATH directory not originally in env.
      writeFileSync(
        join(added, 'claude'),
        '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.0"; exit 0; fi\nif [ "$1" = "auth" ]; then echo \'{"loggedIn":true,"subscriptionType":"pro"}\'; exit 0; fi\n',
        { mode: 0o755 },
      );
      const pending = fetch(new URL('/api/agents?refresh=1&env=1', url), { headers });
      await until(() => errors.includes('Refresh env\n'));
      stdin.write(`env ${JSON.stringify({ PATH: added })}\n`);
      const after = (await (await pending).json()) as {
        setup: boolean;
        agents: Array<{ name: string; installed: boolean; auth: string; plan?: string }>;
      };
      expect(after.setup).toBe(false);
      expect(after.agents[0]).toMatchObject({ name: 'claude', installed: true, auth: 'ready', plan: 'Pro' });
    } finally {
      stdin.end();
      expect(await done).toBe(0);
      rmSync(empty, { recursive: true, force: true });
      rmSync(added, { recursive: true, force: true });
    }
  });

  it('holds firstPrompt while in setup state and submits it once an agent becomes ready', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'genaicode-first-prompt-'));
    let errors = '';
    const abort = new AbortController();
    const done = runWeb({
      agents: [echoAgent('other', 'other-agent')],
      cwd: '/w',
      env: { PATH: empty, HOME: empty, GENAICODE_HOME: empty },
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      firstPrompt: 'Embed genaicode here',
      signal: abort.signal,
    });
    try {
      await until(() => /Open (\S+)/.test(errors));
      const url = /Open (\S+)/.exec(errors)![1];
      const headers = { 'x-genaicode-token': new URL(url).searchParams.get('token')! };
      const events = await fetch(new URL('/api/events', url), { headers });
      const reader = events.body!.getReader();
      let seen = '';
      const read = async (wanted: string) => {
        while (!seen.includes(wanted)) seen += new TextDecoder().decode((await reader.read()).value);
      };
      await read('"setup":true');
      expect(seen).not.toContain('Embed genaicode here');
      // Agent becomes available -> refreshing exits setup and automatically sends the held firstPrompt.
      writeFileSync(join(empty, 'other-agent'), '#!/bin/sh\necho "1.0.0"\n', { mode: 0o755 });
      await fetch(new URL('/api/agents?refresh=1', url), { headers });
      await read('You said **Embed genaicode here**');
      await reader.cancel();
    } finally {
      abort.abort();
      expect(await done).toBe(0);
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('the page about a missing agent stops with stdin too', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'genaicode-none-'));
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    let errors = '';
    const done = runWeb({
      agents: [echoAgent()],
      cwd: '/w',
      env: { PATH: empty, GENAICODE_HOME: join(empty, 'app-state') },
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    await until(() => /Open (\S+)/.test(errors));
    const url = /Open (\S+)/.exec(errors)![1];
    expect((await fetch(url)).status).toBe(200);
    (stdin as unknown as PassThrough).end();
    expect(await done).toBe(0);
    expect((await fetch(url).catch(() => undefined))?.status).toBeUndefined();
    // A signal stops it as well, and leaves the pipe paused so the process can end.
    const pipe = new PassThrough();
    const abort = new AbortController();
    errors = '';
    const again = runWeb({
      agents: [echoAgent()],
      cwd: '/w',
      env: { PATH: empty, GENAICODE_HOME: join(empty, 'app-state') },
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: pipe as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
      signal: abort.signal,
    });
    await until(() => /Open (\S+)/.test(errors));
    expect(pipe.isPaused()).toBe(false);
    abort.abort();
    expect(await again).toBe(0);
    expect(pipe.isPaused()).toBe(true);
    expect(pipe.listenerCount('end')).toBe(0);
    rmSync(empty, { recursive: true, force: true });
  });

  it('announces the desktop release once per version and includes releases skipped since the last launch', () => {
    const env = { GENAICODE_HOME: mkdtempSync(join(bin, 'release-')) };
    const first = uiRelease('2.35.0', env, true)();
    expect(first).toMatchObject({ announce: true, previous: undefined });

    const newer = uiRelease('2.36.0', env, true);
    const notes = newer();
    expect(notes).toMatchObject({ announce: true, previous: '2.35.0', version: '2.36.0' });
    expect(notes.notes).toContain('## 2.35.1');
    expect(notes.notes).not.toContain('## 2.35.0');
    expect(newer()).toMatchObject({ announce: false, notes: notes.notes });
    expect(uiRelease('2.36.0', env, true)().announce).toBe(false);
    expect(uiRelease('2.35.0', env, false)().announce).toBe(false);
    expect(uiRelease('2.36.0', env, true)().announce).toBe(false);
  });

  it('offers the relaunch its host app announced on stdin, and passes the click back', async () => {
    const stdin = new PassThrough();
    let errors = '';
    const done = runWeb({
      agents: [echoAgent()],
      cwd: '/w',
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    await until(() => /Open (\S+)/.test(errors));
    const url = /Open (\S+)/.exec(errors)![1];
    const headers = { 'x-genaicode-token': new URL(url).searchParams.get('token')! };
    const relaunch = (with_ = headers) => fetch(new URL('/api/relaunch', url), { method: 'POST', headers: with_ });
    // Nothing was announced: there is nothing to ask for.
    expect((await relaunch()).status).toBe(404);
    const events = await fetch(new URL('/api/events', url), { headers });
    const reader = events.body!.getReader();
    let seen = '';
    const read = async (wanted: string) => {
      while (!seen.includes(wanted)) seen += new TextDecoder().decode((await reader.read()).value);
    };
    await read('event: config');
    expect(seen).not.toContain('"update"');
    stdin.write('something else\nupdate-ready 9.9.9; rm -rf\nupdate-downloading 9.9.9\n');
    await read('"update":{"version":"9.9.9","ready":false}');
    // Still downloading: there is nothing to install yet.
    expect((await relaunch()).status).toBe(404);
    // A failed download takes it away again; an install under way is said and cannot be asked twice.
    stdin.write('update-none\nupdate-installing 9.9.9\n');
    await read('"update":{"version":"9.9.9","ready":false,"installing":true}');
    expect((await relaunch()).status).toBe(404);
    stdin.write('update-ready 9.9.9\n');
    await read('"update":{"version":"9.9.9","ready":true}');
    expect((await relaunch({ 'x-genaicode-token': 'wrong' })).status).toBe(403);
    expect(errors).not.toContain('Relaunch to update');
    expect((await relaunch()).status).toBe(200);
    expect(errors).toContain('Relaunch to update\n');
    await reader.cancel();
    stdin.end();
    expect(await done).toBe(0);
  });

  it('serves active chat and stored session transcripts, native save requests, and host toasts', async () => {
    const stdin = new PassThrough();
    let errors = '';
    const stored: SessionInfo = {
      source: 'echo-store',
      agent: 'echo',
      id: 'sess-0195abcdef',
      where: 'local',
      cwd: '/w',
      title: 'Debug chat',
      path: '/home/me/.echo/sess-0195abcdef.jsonl',
      state: 'waiting',
      updatedAt: Date.parse('2026-11-23T20:00:00.000Z'),
    };
    const longStored: SessionInfo = {
      ...stored,
      id: 'sess-0195long',
      title: 'Very long chat',
    };
    const brokenStored: SessionInfo = {
      ...stored,
      id: 'sess-0195broken',
      title: 'Missing rollout',
    };
    const agent: CodingAgent = {
      ...echoAgent(),
      sessions: {
        name: 'echo-store',
        where: 'local',
        list: async () => [stored, longStored, brokenStored],
        read: async (info, readOptions) => {
          if (info.id === brokenStored.id) throw new Error('ENOENT: rollout missing');
          if (info.id === longStored.id) {
            readOptions?.onTruncated?.('tail-bytes');
            return Array.from({ length: 205 }, (_, i) => ({
              id: i + 1,
              agent: 'echo',
              prompt: `Turn ${i + 1}`,
              entries: [],
              startedAt: 1,
            }));
          }
          return [
            {
              id: 1,
              agent: 'echo',
              prompt: 'Stored question',
              entries: [{ kind: 'text', text: 'Stored answer', streaming: false }],
              startedAt: Date.parse('2026-11-23T19:59:00.000Z'),
              endedAt: Date.parse('2026-11-23T19:59:05.000Z'),
            },
          ];
        },
      },
    };
    const done = runWeb({
      agents: [agent],
      cwd: '/w',
      env,
      version: '2.55.0',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    await until(() => /Open (\S+)/.test(errors));
    const url = /Open (\S+)/.exec(errors)![1];
    const token = new URL(url).searchParams.get('token')!;
    const headers = { 'x-genaicode-token': token };

    // Auth & format validation.
    expect((await fetch(new URL('/api/transcript', url))).status).toBe(403);
    expect((await fetch(new URL('/api/transcript?format=xml', url), { headers })).status).toBe(400);

    // Run one turn so active chat has a turn and sessionId ('s-1' from echoAgent).
    const submitRes = await fetch(new URL('/api/command', url), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'submit', text: 'Hello transcript' }),
    });
    expect(submitRes.status).toBe(200);
    await until(() => true);
    let mdText = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const res = await fetch(new URL('/api/transcript?format=md', url), { headers });
      mdText = await res.text();
      if (mdText.includes('You said **Hello transcript**')) break;
      await tick();
    }
    expect(mdText).toContain('# Genaicode transcript');
    expect(mdText).toContain('- **Version:** 2.55.0');
    expect(mdText).toContain('- **Session ID:** s-1');
    expect(mdText).toContain('Hello transcript');
    expect(mdText).toContain('You said **Hello transcript**');

    const jsonRes = await fetch(new URL('/api/transcript?format=json', url), { headers });
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get('x-genaicode-filename')).toMatch(/^genaicode-echo-s-1\.json$/);
    const jsonBody = (await jsonRes.json()) as { format: string; sessionId: string; session: { turns: unknown[] } };
    expect(jsonBody.format).toBe('genaicode-transcript');
    expect(jsonBody.sessionId).toBe('s-1');
    expect(jsonBody.session.turns).toHaveLength(1);

    // Stored session transcript (meta, md, json, and 404 on unknown).
    const storedMeta = await fetch(new URL('/api/sessions/echo-store/sess-0195abcdef/transcript?format=meta', url), {
      headers,
    });
    expect(storedMeta.status).toBe(200);
    expect(await storedMeta.json()).toMatchObject({
      agent: 'echo',
      source: 'echo-store',
      sessionId: 'sess-0195abcdef',
      sessionPath: '/home/me/.echo/sess-0195abcdef.jsonl',
      turns: 1,
      readable: true,
    });
    const storedMd = await fetch(new URL('/api/sessions/echo-store/sess-0195abcdef/transcript?format=md', url), {
      headers,
    });
    expect(storedMd.status).toBe(200);
    const storedMdText = await storedMd.text();
    expect(storedMdText).toContain('# Session transcript');
    expect(storedMdText).toContain('Stored question');
    expect(storedMdText).toContain('Stored answer');
    expect(
      (await fetch(new URL('/api/sessions/echo-store/missing/transcript?format=md', url), { headers })).status,
    ).toBe(404);

    // Truncated stored session discloses incompleteness in meta, JSON, and Markdown.
    const longJsonRes = await fetch(new URL('/api/sessions/echo-store/sess-0195long/transcript?format=json', url), {
      headers,
    });
    expect(longJsonRes.status).toBe(200);
    const longJson = (await longJsonRes.json()) as {
      truncated: boolean;
      truncatedReason?: string;
      turns: Array<{ id: number; prompt: string }>;
    };
    expect(longJson.truncated).toBe(true);
    expect(longJson.truncatedReason).toContain('8 MB');
    expect(longJson.truncatedReason).toContain('200 turns');
    expect(longJson.turns).toHaveLength(200);
    expect(longJson.turns[0]?.prompt).toBe('Turn 6');

    const longMdRes = await fetch(new URL('/api/sessions/echo-store/sess-0195long/transcript?format=md', url), {
      headers,
    });
    expect(longMdRes.status).toBe(200);
    expect(await longMdRes.text()).toContain('> **Note:** Only the last 8 MB');

    // Read failures surface as HTTP 500 instead of silently exporting empty turns.
    const brokenRes = await fetch(new URL('/api/sessions/echo-store/sess-0195broken/transcript?format=md', url), {
      headers,
    });
    expect(brokenRes.status).toBe(500);
    expect(await brokenRes.json()).toEqual({ error: 'Could not read the session transcript.' });

    // Continuing a truncated session preserves truncation metadata on active-chat exports, and /clear resets it.
    const contRes = await fetch(new URL('/api/command', url), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'continue', id: longStored.id }),
    });
    expect(contRes.status).toBe(200);
    const adoptedChat = (await contRes.json()).chat;
    expect(typeof adoptedChat).toBe('string');
    const adoptedMeta = await (
      await fetch(new URL(`/api/transcript?format=meta&chat=${adoptedChat}`, url), { headers })
    ).json();
    expect(adoptedMeta).toMatchObject({
      truncated: true,
      truncatedReason: expect.stringContaining('latest 100 turns were loaded'),
    });
    const adoptedJson = await (
      await fetch(new URL(`/api/transcript?format=json&chat=${adoptedChat}`, url), { headers })
    ).json();
    expect(adoptedJson).toMatchObject({
      truncated: true,
      truncatedReason: expect.stringContaining('8 MB'),
    });
    const adoptedMd = await (
      await fetch(new URL(`/api/transcript?format=md&chat=${adoptedChat}`, url), { headers })
    ).text();
    expect(adoptedMd).toContain('- **Incomplete:** Only the last 8 MB');

    await fetch(new URL('/api/command', url), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'submit', text: '/clear' }),
    });
    const clearedMeta = await (await fetch(new URL('/api/transcript?format=meta', url), { headers })).json();
    expect(clearedMeta.truncated).toBeUndefined();

    // HostApp nativeSave config, POST /api/save-transcript -> stderr, and stdin toast -> SSE event: toast.
    const events = await fetch(new URL('/api/events', url), { headers });
    const reader = events.body!.getReader();
    let seen = '';
    const read = async (wanted: string) => {
      while (!seen.includes(wanted)) seen += new TextDecoder().decode((await reader.read()).value);
    };
    await read('event: config');
    expect(seen).toContain('"nativeSave":true');

    const save = (body: unknown) =>
      fetch(new URL('/api/save-transcript', url), {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await save({ format: 'xml' })).status).toBe(400);
    expect((await save({ format: 'md', source: 'only-source' })).status).toBe(400);
    expect((await save({ format: 'md' })).status).toBe(200);
    expect(errors).toContain('Save transcript md\n');
    expect((await save({ format: 'json', source: 'echo-store', id: 'sess-0195abcdef' })).status).toBe(200);
    expect(errors).toContain('Save session-transcript json echo-store sess-0195abcdef\n');

    stdin.write('toast Copied session ID\n');
    await read('event: toast\ndata: {"text":"Copied session ID"}');

    await reader.cancel();
    stdin.end();
    expect(await done).toBe(0);
  });

  it('stops when stdin ended while it was still starting', async () => {
    const stdin = new PassThrough();
    stdin.end();
    stdin.resume();
    await until(() => stdin.readableEnded);
    const done = runWeb({
      agents: [echoAgent()],
      cwd: '/w',
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: () => true } as unknown as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    expect(await done).toBe(0);
  });

  it('stops when stdin ends with exitWithStdin', async () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    let errors = '';
    const done = runWeb({
      agents: [echoAgent()],
      cwd: '/w',
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    await until(() => /Open (\S+)/.test(errors));
    const url = /Open (\S+)/.exec(errors)![1];
    expect((await fetch(url)).status).toBe(200);
    (stdin as unknown as PassThrough).end();
    expect(await done).toBe(0);
    expect((await fetch(url).catch(() => undefined))?.status).toBeUndefined();
  });

  it('lists in --home mode only the recorded sessions of their own store or agent, not one sharing the id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'genaicode-own-'));
    const homeEnv = { ...env, HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    await saveConversation(
      { id: 'c1', cwd: '/p', origin: 'project', agent: 'echo', source: 'echo', sessionId: 'shared', updatedAt: 1 },
      homeEnv,
    );
    const store = (name: string): SessionSource => ({
      name,
      where: 'local',
      list: async () => [{ source: name, agent: name, id: 'shared', where: 'local', cwd: '/p', updatedAt: 1000 }],
    });
    const stdin = new PassThrough();
    let errors = '';
    const done = runWeb({
      agents: [echoAgent()],
      sessionSources: [store('echo'), store('codex')],
      cwd: join(root, 'home'),
      env: homeEnv,
      home: true,
      noProject: true,
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    try {
      await until(() => /Open (\S+)/.test(errors));
      const url = /Open (\S+)/.exec(errors)![1]!;
      const token = new URL(url).searchParams.get('token')!;
      const own = await fetch(new URL('/api/sessions?own=1', url), { headers: { 'x-genaicode-token': token } });
      const { sessions } = (await own.json()) as { sessions: SessionInfo[] };
      // Codex's session with the same id is another agent's: it stays out of this app's chats.
      expect(sessions.map((session) => `${session.source}:${session.id}`)).toEqual(['echo:shared']);
    } finally {
      stdin.end();
      expect(await done).toBe(0);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('opens the terminal chat in the browser with chat --web', async () => {
    const terminal = fakeTerminal();
    const opened: string[] = [];
    const abort = new AbortController();
    const agent = echoAgent();
    const done = runChat({
      agents: [agent],
      cwd: '/w',
      env,
      version: '1',
      clientScript: '',
      assets: new Map(),
      ...terminal,
      openWeb: true,
      openUrl: (url) => opened.push(url),
      signal: abort.signal,
    });
    await until(() => opened.length === 1);
    await terminal.type('from the terminal', '\r');
    await until(() => agent.tasks.length === 1);
    const events = await fetch(new URL(`/api/events${new URL(opened[0]).search}`, opened[0]));
    const first = new TextDecoder().decode((await events.body!.getReader().read()).value);
    expect(first).toContain('from the terminal');
    abort.abort();
    expect(await done).toBe(0);
  });

  it('names its missing-agent error for hosts that load the bundle', () => {
    expect(new NoAgentError('x').name).toBe('NoAgentError');
  });

  it('replaces the conversation with a chat picked in the sidebar in --cwd mode, and adds a takeover to it', async () => {
    const stored = (id: string, prompt: string): SessionTurn => ({
      id: 1,
      agent: 'echo',
      prompt,
      entries: [{ kind: 'text', text: `Answer to ${prompt}`, streaming: false }],
      startedAt: 1,
      result: { status: 'completed', ok: true, exitCode: 0, signal: null, text: `Answer to ${prompt}`, sessionId: id },
    });
    const prompts: Record<string, string> = { 'chat-a': 'Prompt of A', 'chat-b': 'Prompt of B' };
    const source: SessionSource = {
      name: 'echo',
      where: 'local',
      list: async () =>
        Object.keys(prompts).map((id) => ({
          source: 'echo',
          agent: 'echo',
          id,
          where: 'local',
          cwd: '/w',
          updatedAt: 1000,
        })),
      read: async (info) => [stored(info.id, prompts[info.id]!)],
    };
    const chat = createChatController({
      agents: [{ ...echoAgent(), sessions: source }],
      sessionSources: [source],
      cwd: '/w',
      env,
    });
    const shown = () => chat.get().session.turns.map((turn) => turn.prompt);
    const w1 = (seq: number) => ({ window: 'w1', seq });
    try {
      expect(await chat.switchChat({ type: 'continue', id: 'chat-a', source: 'echo' }, w1(1))).toBe('done');
      expect(shown()).toEqual(['Prompt of A']);
      chat.note('Said in A');
      // B is picked in the sidebar: A's turns and notices are not B's.
      expect(await chat.switchChat({ type: 'continue', id: 'chat-b', source: 'echo' }, w1(2))).toBe('done');
      expect(shown()).toEqual(['Prompt of B']);
      expect(chat.get().session.sessionId).toBe('chat-b');
      expect(chat.get().notices.map((one) => one.text)).toEqual([expect.stringContaining('Continuing "chat-b"')]);
      // The row of the open chat again: nothing changes.
      const before = chat.get().session;
      expect(await chat.switchChat({ type: 'continue', id: 'chat-b', source: 'echo' }, w1(3))).toBe('done');
      expect(chat.get().session).toBe(before);
      // An explicit takeover still adds to the conversation: `/continue <id>` typed in the page,
      // in the terminal, and `continueSession`.
      expect(await chat.switchChat({ type: 'continue', id: 'chat-a', takeover: true }, w1(4))).toBe('done');
      expect(shown()).toEqual(['Prompt of B', 'Prompt of A']);
      expect(chat.get().session.sessionId).toBe('chat-a');
      expect(await chat.continueSession('chat-b')).toBe(true);
      expect(shown()).toEqual(['Prompt of B', 'Prompt of A', 'Prompt of B']);
      chat.submit('/continue chat-a');
      await vi.waitFor(() => expect(shown()).toEqual(['Prompt of B', 'Prompt of A', 'Prompt of B', 'Prompt of A']));
      // A numbered takeover is ordered like any other request of its window.
      expect(await chat.switchChat({ type: 'continue', id: 'chat-b', takeover: true }, w1(4))).toBe('superseded');
      expect(shown()).toHaveLength(4);
      // And the sidebar after takeovers leaves only the chat picked.
      expect(await chat.switchChat({ type: 'continue', id: 'chat-b', source: 'echo' }, w1(5))).toBe('done');
      expect(shown()).toEqual(['Prompt of B']);
    } finally {
      chat.close();
    }
  });

  it('resolves per-conversation cwd in --home mode: topics, /where, continueSession, and host open-session', async () => {
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'home-ctrl-'));
    const homeDir = join(root, '.genaicode', 'home');
    const knights = join(root, 'src', 'knights');
    const other = join(root, 'src', 'other');
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(knights, { recursive: true });
    mkdirSync(other, { recursive: true });
    const homeEnv = { ...env, HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    await writeTopics(
      {
        topics: [
          { id: 't1', name: 'Knights' },
          { id: 't2', name: 'Cloud Only' },
        ],
        sessions: { 'echo:k1': 't1', 'echo:c1': 't2' },
      },
      homeEnv,
    );
    const sessions: SessionInfo[] = [
      { source: 'echo', agent: 'echo', id: 'k1', where: 'local', cwd: knights, title: 'Knight AI', updatedAt: 5000 },
      { source: 'echo', agent: 'echo', id: 'o1', where: 'local', cwd: other, title: 'Other task', updatedAt: 4000 },
      { source: 'echo', agent: 'echo', id: 'c1', where: 'cloud', title: 'Remote idea', updatedAt: 3000 },
    ];
    // Holds the store's answer back, for a request that is still looking when the next one comes.
    let hold: Promise<void> = Promise.resolve();
    const source: SessionSource = {
      name: 'echo',
      where: 'local',
      list: async () => {
        await hold;
        return sessions;
      },
      read: async (s) => [{ id: 1, agent: 'echo', prompt: `From ${s.title}`, entries: [], startedAt: 1 }],
    };
    const agent = { ...echoAgent(), sessions: source };
    const chat = createChatController({
      agents: [agent],
      sessionSources: [source],
      cwd: homeDir,
      env: homeEnv,
      home: true,
    });
    try {
      expect(chat.get().conversation).toMatchObject({ cwd: homeDir, origin: 'home' });
      chat.submit('/where');
      expect(chat.get().notices.at(-1)?.text).toContain(`${homeDir} (neutral home)`);

      // Opening a topic resolves its most recent non-automated existing session cwd.
      expect(await chat.startTopicChat('t1')).toBe(true);
      expect(chat.get().session.cwd).toBe(knights);
      expect(chat.get().conversation).toMatchObject({
        cwd: knights,
        origin: 'topic',
        topic: { id: 't1', name: 'Knights' },
      });
      chat.submit('/where');
      expect(chat.get().notices.at(-1)?.text).toBe(`Working directory: ${knights} · topic: Knights`);

      // Opening a topic without a local folder falls back to neutral home with origin 'unresolved'.
      expect(await chat.startTopicChat('t2')).toBe(true);
      expect(chat.get().session.cwd).toBe(homeDir);
      expect(chat.get().conversation).toMatchObject({ origin: 'unresolved', topic: { id: 't2', name: 'Cloud Only' } });

      // Continuing two sessions in sequence persists each under its own metadata (never crosses IDs/titles).
      expect(await chat.continueSession('k1')).toBe(true);
      expect(chat.get().session.cwd).toBe(knights);
      expect(chat.get().session.sessionId).toBe('k1');
      expect(chat.get().conversation).toMatchObject({
        cwd: knights,
        origin: 'session',
        title: 'Knight AI',
        topic: { id: 't1', name: 'Knights' },
      });

      expect(await chat.continueSession('o1')).toBe(true);
      expect(chat.get().session.cwd).toBe(other);
      expect(chat.get().session.sessionId).toBe('o1');
      expect(chat.get().conversation).toMatchObject({ cwd: other, origin: 'session', title: 'Other task' });

      const saved = await readConversations(homeEnv);
      const savedK1 = saved.find((item) => item.sessionId === 'k1');
      const savedO1 = saved.find((item) => item.sessionId === 'o1');
      expect(savedK1).toMatchObject({ cwd: knights, title: 'Knight AI', topicId: 't1', topicName: 'Knights' });
      expect(savedO1).toMatchObject({ cwd: other, title: 'Other task' });
      expect(savedO1?.topicId).toBeUndefined();
      expect(savedK1?.id).not.toBe(savedO1?.id);

      // Returning home resets cwd back to neutral home without overwriting the outgoing conversation.
      expect(chat.startHomeChat()).toBe(true);
      expect(chat.get().session.cwd).toBe(homeDir);
      expect(chat.get().conversation).toMatchObject({ cwd: homeDir, origin: 'home' });
      expect(chat.get().conversation?.topic).toBeUndefined();
      const afterHome = await readConversations(homeEnv);
      expect(afterHome.find((item) => item.sessionId === 'o1')).toMatchObject({ cwd: other, title: 'Other task' });

      // The sidebar's "new chat here": a fresh conversation in that project's folder.
      expect(await chat.startProjectChat(other)).toBe(true);
      expect(chat.get().session.cwd).toBe(other);
      expect(chat.get().session.turns).toEqual([]);
      expect(chat.get().conversation).toMatchObject({ cwd: other, origin: 'project' });
      expect(chat.get().conversation?.topic).toBeUndefined();
      // The home folder is the neutral home again, and what is no folder starts nothing.
      expect(await chat.startProjectChat(homeDir)).toBe(true);
      expect(chat.get().conversation).toMatchObject({ cwd: homeDir, origin: 'home' });
      expect(await chat.startProjectChat(join(root, 'src', 'missing'))).toBe(false);
      expect(await chat.startProjectChat('src/other')).toBe(false);
      expect(chat.get().session.cwd).toBe(homeDir);
      expect(chat.get().notices.at(-1)).toMatchObject({
        tone: 'error',
        text: 'No folder src/other to start a chat in.',
      });

      // A folder no session worked in is not a project, whatever the request names: the chat's
      // folder is a root of the file viewer, so the filesystem root, the home directory (here
      // `root`) and a stranger's folder are refused, also behind a symlink.
      const stranger = join(root, 'src', 'stranger');
      mkdirSync(stranger);
      symlinkSync(parse(root).root, join(root, 'src', 'to-root'));
      symlinkSync(root, join(root, 'src', 'to-home'));
      symlinkSync(stranger, join(root, 'src', 'to-stranger'));
      for (const refused of [
        parse(root).root,
        root,
        stranger,
        join(root, 'src'),
        join(root, 'src', 'to-root'),
        join(root, 'src', 'to-home'),
        join(root, 'src', 'to-stranger'),
      ]) {
        expect(await chat.startProjectChat(refused), refused).toBe(false);
        expect(chat.get().session.cwd).toBe(homeDir);
        expect(chat.get().conversation).toMatchObject({ cwd: homeDir, origin: 'home' });
        expect(chat.get().notices.at(-1)).toMatchObject({
          tone: 'error',
          text: expect.stringContaining(`${refused} is not a project folder`),
        });
      }
      // A symlink to a project is that project: the chat runs in the real folder.
      symlinkSync(other, join(root, 'src', 'to-other'));
      expect(await chat.startProjectChat(join(root, 'src', 'to-other'))).toBe(true);
      expect(chat.get().session.cwd).toBe(realpathSync(other));
      expect(chat.get().conversation).toMatchObject({ cwd: realpathSync(other), origin: 'project' });

      // "New chat here" still looks its folder up when New chat is pressed: the chat asked for last
      // stays, and the request it overtook changes nothing and says nothing.
      let free = () => {};
      hold = new Promise((resolve) => (free = resolve));
      const overtaken = chat.startProjectChat(knights);
      expect(chat.startHomeChat()).toBe(true);
      free();
      expect(await overtaken).toBe(false);
      expect(chat.get().session.cwd).toBe(homeDir);
      expect(chat.get().conversation).toMatchObject({ cwd: homeDir, origin: 'home' });
      expect(chat.get().notices).toEqual([]);
      // The same between two requests that both wait: a session opened, then a chat in a folder.
      hold = new Promise((resolve) => (free = resolve));
      const opening = chat.continueSession('k1');
      const starting = chat.startProjectChat(other);
      const topical = chat.startTopicChat('t1');
      const last = chat.startProjectChat(other);
      free();
      expect(await Promise.all([opening, starting, topical, last])).toEqual([false, false, false, true]);
      expect(chat.get().session.sessionId).toBeUndefined();
      expect(chat.get().conversation).toMatchObject({ cwd: realpathSync(other), origin: 'project' });
      expect(chat.get().conversation?.topic).toBeUndefined();
      expect(chat.get().notices).toEqual([]);
      expect(chat.startHomeChat()).toBe(true);

      // A window numbers its requests. The request made first arrives last: it is refused on
      // arrival, before it looks anything up, and the later one, still waiting, opens its chat.
      const w1 = (seq: number) => ({ window: 'w1', seq });
      hold = new Promise((resolve) => (free = resolve));
      const later = chat.switchChat({ type: 'project', cwd: knights }, w1(2));
      expect(await chat.switchChat({ type: 'project', cwd: other }, w1(1))).toBe('superseded');
      expect(await chat.switchChat({ type: 'home' }, w1(1))).toBe('superseded');
      expect(await chat.switchChat({ type: 'topic', topic: 't1' }, w1(2))).toBe('superseded');
      expect(await chat.switchChat({ type: 'continue', id: 'o1', source: 'echo' }, w1(1))).toBe('superseded');
      expect(await chat.switchChat({ type: 'stay' }, w1(2))).toBe('superseded');
      free();
      expect(await later).toBe('done');
      expect(chat.get().conversation).toMatchObject({ cwd: realpathSync(knights), origin: 'project' });
      expect(chat.get().notices).toEqual([]);
      // Also once the later one is done, and whatever the late one asks for.
      expect(await chat.switchChat({ type: 'continue', id: 'o1' }, w1(1))).toBe('superseded');
      expect(chat.get().session.sessionId).toBeUndefined();
      expect(chat.get().conversation).toMatchObject({ cwd: realpathSync(knights) });
      // Another window counts for itself, and between two windows the request that arrives last wins.
      hold = new Promise((resolve) => (free = resolve));
      const theirs = chat.switchChat({ type: 'project', cwd: other }, w1(3));
      const ours = chat.switchChat({ type: 'continue', id: 'k1', source: 'echo' }, { window: 'w2', seq: 1 });
      free();
      expect(await Promise.all([theirs, ours])).toEqual(['superseded', 'done']);
      expect(chat.get().session.sessionId).toBe('k1');
      // The chat that is open is asked for again (A, then B, then A): it stays as it is, and B,
      // which still waits, is dropped.
      hold = new Promise((resolve) => (free = resolve));
      const before = chat.get().session;
      const away = chat.switchChat({ type: 'continue', id: 'o1', source: 'echo' }, w1(4));
      const back = chat.switchChat({ type: 'continue', id: 'k1', source: 'echo' }, w1(5));
      free();
      expect(await Promise.all([away, back])).toEqual(['superseded', 'done']);
      expect(chat.get().session).toBe(before);
      expect(chat.get().notices.filter((one) => one.tone === 'error')).toEqual([]);
      // "Stay" drops what waits and changes nothing.
      hold = new Promise((resolve) => (free = resolve));
      const dropped = chat.switchChat({ type: 'project', cwd: other }, w1(6));
      expect(await chat.switchChat({ type: 'stay' }, w1(7))).toBe('done');
      free();
      expect(await dropped).toBe('superseded');
      expect(chat.get().session.sessionId).toBe('k1');
      // A refusal is not an overtaken request.
      expect(await chat.switchChat({ type: 'topic', topic: 'nope' }, w1(8))).toBe('refused');
      expect(chat.get().notices.at(-1)).toMatchObject({ tone: 'error', text: 'No topic "nope" found.' });
      expect(chat.startHomeChat()).toBe(true);
    } finally {
      chat.close();
    }

    // Two stores hold a session with the same id: the row's store says which one is opened.
    const twin = (name: string, cwd: string): SessionSource => ({
      name,
      where: 'local',
      list: async () => [{ source: name, agent: name, id: 'same-id-0001', where: 'local', cwd, updatedAt: 1000 }],
      read: async () => [{ id: 1, agent: name, prompt: `From ${name}`, entries: [], startedAt: 1 }],
    });
    const stores = [twin('echo', knights), twin('other-store', other)];
    const twins = createChatController({
      agents: [{ ...echoAgent(), sessions: stores[0]! }],
      sessionSources: stores,
      cwd: homeDir,
      env: homeEnv,
      home: true,
    });
    try {
      // The id alone does not say which.
      expect(await twins.continueSession('same-id-0001')).toBe(false);
      expect(twins.get().notices.at(-1)).toMatchObject({ tone: 'error', text: expect.stringContaining('2 sessions') });
      expect(await twins.switchChat({ type: 'continue', id: 'same-id-0001', source: 'other-store' })).toBe('done');
      expect(twins.get().session.cwd).toBe(other);
      expect(twins.get().session.turns.map((turn) => turn.prompt)).toEqual(['From other-store']);
      expect(await twins.continueSession('same-id-0001', { source: 'echo' })).toBe(true);
      expect(twins.get().session.cwd).toBe(knights);
      expect(twins.get().session.sessionId).toBe('same-id-0001');
      expect(twins.get().session.turns.map((turn) => turn.prompt)).toEqual(['From echo']);
      // A store that is not there holds nothing.
      expect(await twins.switchChat({ type: 'continue', id: 'same-id-0001', source: 'nowhere' })).toBe('refused');
      expect(twins.get().notices.at(-1)).toMatchObject({ tone: 'error', text: expect.stringContaining('No session') });
    } finally {
      twins.close();
    }

    // Host app `open-session <id>` over stdin opens that session in its directory.
    const stdin = new PassThrough();
    let errors = '';
    const done = runWeb({
      agents: [agent],
      sessionSources: [source],
      cwd: homeDir,
      env: homeEnv,
      home: true,
      noProject: true,
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    try {
      await until(() => /Open (\S+)/.test(errors));
      const url = /Open (\S+)/.exec(errors)![1]!;
      const token = new URL(url).searchParams.get('token')!;
      const events = await fetch(new URL('/api/events', url), { headers: { 'x-genaicode-token': token } });
      const reader = events.body!.getReader();
      let seen = '';
      const waitFor = async (needle: string) => {
        while (!seen.includes(needle)) seen += new TextDecoder().decode((await reader.read()).value);
      };
      await waitFor('"home":true');
      stdin.write('open-session k1\n');
      await waitFor('"title":"Knight AI"');
      expect(seen).toContain(JSON.stringify(knights));
      await reader.cancel();
    } finally {
      stdin.end();
      expect(await done).toBe(0);
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('looks a folder up, and opens one the host app chose by its exact real path', async () => {
    // Outside os.tmpdir(): a chat does not start in a temporary directory.
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = realpathSync(mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'starts-in-')));
    const homeDir = join(root, 'home');
    const repo = join(root, 'knights');
    const plain = join(root, 'notes');
    // A folder whose name ends in a space, beside one without.
    const spaced = `${plain} `;
    const linked = join(root, 'linked');
    for (const dir of [homeDir, join(repo, 'src'), plain, spaced]) mkdirSync(dir, { recursive: true });
    symlinkSync(spaced, linked);
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), 'committed\n');
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'start');
    writeFileSync(join(repo, 'src', 'draft.ts'), 'not committed yet\n');
    const homeEnv = { ...env, HOME: root, GENAICODE_HOME: join(root, '.genaicode') };
    // The test folders sit inside this repository's checkout: git must not look above them for one.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', root);

    // What the project line reads of a folder.
    expect(await inspectFolder(repo)).toEqual({ path: repo, exists: true, git: true, branch: 'main' });
    expect(await inspectFolder(`${plain}/`)).toEqual({ path: plain, exists: true, git: false });
    expect(await inspectFolder('~/knights', root)).toMatchObject({ path: repo, exists: true });
    expect(await inspectFolder('~', root)).toMatchObject({ path: root, exists: true });
    expect(await inspectFolder(join(root, 'missing'))).toEqual({ path: join(root, 'missing'), exists: false });
    expect(await inspectFolder('knights')).toBeUndefined();
    expect(await inspectFolder('  ')).toBeUndefined();

    const agent = echoAgent();
    const chat = createChatController({ agents: [agent], cwd: homeDir, env: homeEnv, home: true });
    try {
      // A folder no session worked in opens only when the person picked it in the host's dialog.
      expect(await chat.startProjectChat(join(repo, 'src'))).toBe(false);
      expect(chat.get().notices.at(-1)).toMatchObject({
        tone: 'error',
        text: expect.stringMatching(/is not a project folder/),
      });
      expect(chat.get().session.cwd).toBe(homeDir);
      // Auto-approve set in one chat does not carry to the next one.
      chat.submit('/auto on');
      expect(chat.get().autoApprove).toBe(true);
      const first = chat.get().generation!;
      // A chosen folder comes by the real path that was checked: one that resolves elsewhere is refused.
      expect(await chat.startProjectChat(linked, { chosen: true })).toBe(false);
      expect(chat.get().notices.at(-1)).toMatchObject({ tone: 'error', text: expect.stringMatching(/changed since/) });
      expect(await chat.startProjectChat(join(repo, 'src'), { chosen: true })).toBe(true);
      expect(chat.get().session.cwd).toBe(join(repo, 'src'));
      expect(chat.get().autoApprove).toBe(false);
      // Auto-approve asked for in the chat that was left does not reach this one.
      expect(chat.get().generation).toBeGreaterThan(first);
      expect(chat.setAutoApprove(true, first)).toBe(false);
      expect(chat.get().autoApprove).toBe(false);
      expect(chat.setAutoApprove(true, chat.get().generation!)).toBe(true);
      expect(chat.get().autoApprove).toBe(true);
      expect(chat.setAutoApprove(false, chat.get().generation!)).toBe(true);
      expect(chat.get().autoApprove).toBe(false);
      expect(existsSync(join(repo, '.genaicode'))).toBe(false);
    } finally {
      chat.close();
    }

    // The desktop shell has a folder dialog: the page asks, the shell answers on stdin.
    const stdin = new PassThrough();
    let errors = '';
    const done = runWeb({
      agents: [agent],
      cwd: homeDir,
      env: { ...homeEnv, GENAICODE_DESKTOP_SHELL: '1' },
      home: true,
      noProject: true,
      version: '1',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: { write: (text: string) => ((errors += text), true) } as NodeJS.WritableStream,
      open: false,
      exitWithStdin: true,
    });
    try {
      await until(() => /Open (\S+)/.test(errors));
      const url = /Open (\S+)/.exec(errors)![1]!;
      const headers = { 'x-genaicode-token': new URL(url).searchParams.get('token')! };
      const events = await fetch(new URL('/api/events', url), { headers });
      const reader = events.body!.getReader();
      let seen = '';
      while (!seen.includes('"chooseFolder":true')) seen += new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();

      expect((await fetch(new URL('/api/choose-folder', url), { method: 'POST' })).status).toBe(403);
      const asked = fetch(new URL('/api/choose-folder', url), { method: 'POST', headers });
      await until(() => errors.includes(`${CHOOSE_FOLDER_LINE} 1\n`));
      // An answer without the request's number, or with another one (a dialog given up on), is
      // not this request's.
      stdin.write(`folder ${JSON.stringify(plain)}\n`);
      stdin.write(`folder 7 ${JSON.stringify(plain)}\n`);
      stdin.write(`folder 1 ${JSON.stringify(repo)}\n`);
      expect(await (await asked).json()).toEqual({ folder: { path: repo, exists: true, git: true, branch: 'main' } });
      // A dismissed dialog chooses nothing; a late answer to the first one does not answer this one.
      const dismissed = fetch(new URL('/api/choose-folder', url), { method: 'POST', headers });
      await until(() => errors.includes(`${CHOOSE_FOLDER_LINE} 2\n`));
      stdin.write(`folder 1 ${JSON.stringify(plain)}\n`);
      stdin.write('folder 2 null\n');
      expect(await (await dismissed).json()).toEqual({});

      // What was picked there may be opened; a path only typed into a request may not.
      const start = (cwd: string) =>
        fetch(new URL('/api/command', url), {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'project-chat', cwd }),
        }).then((reply) => reply.json());
      expect(await start(plain)).toEqual({ ok: false });
      expect(await start(repo)).toMatchObject({ ok: true, chat: expect.any(String) });

      // The dialog's path is taken as it is: a name that ends in a space opens that folder and not
      // the one beside it, and a link is followed to the real folder, which the chat then runs in.
      const pick = async (path: string) => {
        const asked = errors.split(CHOOSE_FOLDER_LINE).length;
        const reply = fetch(new URL('/api/choose-folder', url), { method: 'POST', headers });
        await until(() => errors.split(CHOOSE_FOLDER_LINE).length > asked);
        stdin.write(`folder ${asked} ${JSON.stringify(path)}\n`);
        return (await reply).json();
      };
      expect(await pick(linked)).toEqual({ folder: { path: spaced, exists: true, git: false } });
      expect(await start(plain)).toEqual({ ok: false });
      const opened = await start(spaced);
      expect(opened).toMatchObject({ ok: true, chat: expect.any(String) });
      expect(await start(linked)).toMatchObject({ ok: true, chat: expect.any(String) });

      const found = await fetch(new URL(`/api/folder?path=${encodeURIComponent(plain)}`, url), { headers });
      expect(await found.json()).toEqual({ path: plain, exists: true, git: false });
      expect((await fetch(new URL('/api/folder?path=relative', url), { headers })).status).toBe(400);
      expect((await fetch(new URL(`/api/folder?path=${encodeURIComponent(plain)}`, url))).status).toBe(403);
      // The chat's own folder is asked about by its exact path: `notes ` is not the `notes` beside it.
      const exact = (path: string) =>
        fetch(new URL(`/api/folder?cwd=${encodeURIComponent(path)}`, url), { headers }).then((reply) =>
          reply.status === 200 ? reply.json() : reply.status,
        );
      expect(await exact(spaced)).toEqual({ path: spaced, exists: true, git: false });
      expect(await exact(plain)).toEqual({ path: plain, exists: true, git: false });
      expect(await exact('relative')).toBe(400);

      // With a fixed project (`--cwd`) the page asks only about the folder the chat is in.
      const fixedIn = new PassThrough();
      let fixedErrors = '';
      const fixed = runWeb({
        agents: [agent],
        cwd: repo,
        env: homeEnv,
        version: '1',
        clientScript: '',
        assets: new Map(),
        stdin: fixedIn as unknown as NodeJS.ReadStream,
        stdout: new PassThrough() as unknown as NodeJS.WriteStream,
        stderr: { write: (text: string) => ((fixedErrors += text), true) } as NodeJS.WritableStream,
        open: false,
        exitWithStdin: true,
      });
      try {
        await until(() => /Open (\S+)/.test(fixedErrors));
        const fixedUrl = /Open (\S+)/.exec(fixedErrors)![1]!;
        const fixedHeaders = { 'x-genaicode-token': new URL(fixedUrl).searchParams.get('token')! };
        const ask = (path: string) =>
          fetch(new URL(`/api/folder?path=${encodeURIComponent(path)}`, fixedUrl), { headers: fixedHeaders });
        expect(await (await ask(`${repo}/`)).json()).toEqual({ path: repo, exists: true, git: true, branch: 'main' });
        expect((await ask(plain)).status).toBe(403);
        expect((await ask(join(repo, 'src'))).status).toBe(403);
        // That very folder: `knights\` beside it is another one where `\` is no separator.
        if (process.platform !== 'win32') {
          const sibling = `${repo}\\`;
          mkdirSync(sibling);
          expect((await ask(sibling)).status).toBe(403);
          const exact = (path: string) =>
            fetch(new URL(`/api/folder?cwd=${encodeURIComponent(path)}`, fixedUrl), { headers: fixedHeaders });
          expect((await exact(sibling)).status).toBe(403);
          expect((await exact(`${repo} `)).status).toBe(403);
          expect(await (await exact(repo)).json()).toEqual({ path: repo, exists: true, git: true, branch: 'main' });
        }
      } finally {
        fixedIn.end();
        expect(await fixed).toBe(0);
      }
    } finally {
      stdin.end();
      expect(await done).toBe(0);
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** Streams that pass for a terminal, for the front ends' own Ink render. */
function fakeTerminal() {
  // Ink patches the console through `console.Console`, which Vitest's console lacks.
  (console as { Console?: typeof Console }).Console ??= Console;
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return stdin;
    },
    ref() {
      return stdin;
    },
    unref() {
      return stdin;
    },
  }) as unknown as NodeJS.ReadStream & PassThrough;
  let out = '';
  const stdout = Object.assign(new PassThrough(), {
    isTTY: true,
    columns: 100,
    rows: 30,
  }) as unknown as NodeJS.WriteStream;
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  let err = '';
  const stderr = { write: (text: string) => ((err += text), true) } as unknown as NodeJS.WritableStream;
  // One write per key: Ink reads a longer chunk as a paste, Enter included.
  const type = async (...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key);
      await tick();
    }
  };
  return { stdin, stdout, stderr, type, screen: () => out, errors: () => err };
}

async function until(check: () => boolean, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await tick();
  }
}
