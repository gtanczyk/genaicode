import { request } from 'node:http';
import { Console } from 'node:console';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
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
    expect(parseSlash('/model')).toEqual({ kind: 'model', model: undefined });
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
      `ready\n${bin}`,
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
  it('validates commands', () => {
    expect(parseCommand({ type: 'submit', text: 'hi' })).toEqual({ type: 'submit', text: 'hi' });
    expect(parseCommand({ type: 'approve', id: 'a', decision: 'maybe' })).toBeUndefined();
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
      expect((await fetch(base)).status).toBe(403);
      const page = await fetch(ui.url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      expect(await page.text()).toContain('data-cwd="/w &lt;&amp;&gt;"');
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
      expect((await post({ type: 'shell', text: 'hi' })).status).toBe(400);

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
