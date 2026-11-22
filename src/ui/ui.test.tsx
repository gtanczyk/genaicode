import { request } from 'node:http';
import { Console } from 'node:console';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { PackActionError, type PackTask } from '../agents/pack.js';
import { sessionTools, type SessionInfo, type SessionSource } from '../agents/sessions/index.js';
import { TowerInbox } from '../agents/sessions/tower.js';
import { createChatController, NoAgentError } from './controller.js';
import { needsAttention, parseShell, parseSlash, relativePath, shortId, toolSummary, turnFooter } from './format.js';
import { ChatApp, draftViewport, splitTranscript } from './tui/app.js';
import { loadAssets, runChat, runWeb, startEmbeddedWeb } from './index.js';
import { parseCommand, startWebUi } from './web/server.js';

const bin = mkdtempSync(join(tmpdir(), 'genaicode-ui-'));
writeFileSync(join(bin, 'echo-agent'), '#!/bin/sh\n', { mode: 0o755 });
afterAll(() => rmSync(bin, { recursive: true, force: true }));
const env = { PATH: bin };
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
    expect(parseSlash('/wat')).toEqual({ kind: 'unknown', name: '/wat' });
    expect(parseSlash('/bark')).toEqual({ kind: 'bark' });
    expect(parseSlash('/bark off')).toEqual({ kind: 'bark', on: false });
    expect(parseSlash('/bark of')).toEqual({ kind: 'bark', invalid: 'of' });
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
    expect(notices[1].text).toMatch(/Switched to other/);
    chat.close();
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
    const yes = createChatController({ agents: [asking], agent: 'asker', cwd: '/w', env, approveAll: true });
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
      await frame('Tab for pack tasks');
      await press('\t', 't1 · worker · Ready to merge');
      await press('\x1b[B', 't2 · worker · Ready to merge');
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

  it('splits finished turns from the live one and keeps notices in order', () => {
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
    expect(split.done.map((item) => item.key)).toEqual(['header', 'n1', 't1', 'n2']);
    expect(split.live.map((t) => t.id)).toEqual([2]);
    expect(split.pending.map((n) => n.id)).toEqual([3]);
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
      expect(await missing.json()).toEqual({ ok: false, error: 'This pack task could not be found.' });

      const conflict = await post('conflict');
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({
        ok: false,
        error: 'These changes do not apply cleanly; nothing was changed.',
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
    expect(parseCommand({ type: 'approve', id: 'a', decision: 'maybe' })).toBeUndefined();
    expect(parseCommand({ type: 'continue', id: 'abcd1234' })).toEqual({ type: 'continue', id: 'abcd1234' });
    expect(parseCommand({ type: 'continue', id: '' })).toBeUndefined();
    expect(parseCommand({ type: 'submit', text: 1 })).toBeUndefined();
    expect(parseCommand({ type: 'exec', command: 'rm' })).toBeUndefined();
    expect(parseCommand(null)).toBeUndefined();
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
      expect(agent.tasks[0].mcpServers).toEqual([expect.objectContaining({ name: 'artifacts' })]);
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
