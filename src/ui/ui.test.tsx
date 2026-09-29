import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { createChatController, NoAgentError } from './controller.js';
import { parseSlash, relativePath, shortId, toolSummary, turnFooter } from './format.js';
import { ChatApp, draftViewport, splitTranscript } from './tui/app.js';
import { parseCommand, startWebUi } from './web/server.js';

const bin = mkdtempSync(join(tmpdir(), 'genaicode-ui-'));
writeFileSync(join(bin, 'echo-agent'), '#!/bin/sh\n', { mode: 0o755 });
afterAll(() => rmSync(bin, { recursive: true, force: true }));
const env = { PATH: bin };

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
    expect(relativePath('/w/a.ts', '/w/')).toBe('a.ts');
    expect(relativePath('/elsewhere/a.ts', '/w')).toBe('/elsewhere/a.ts');
    expect(shortId('ses_f158fcc57ffelLfa0gyYTOw7e8')).toBe('…yYTOw7e8');
    expect(shortId('abc')).toBe('abc');
  });

  it('parses slash commands and leaves other text alone', () => {
    expect(parseSlash('/agent codex')).toEqual({ kind: 'agent', name: 'codex' });
    expect(parseSlash('/model')).toEqual({ kind: 'model', model: undefined });
    expect(parseSlash('/wat')).toEqual({ kind: 'unknown', name: '/wat' });
    expect(parseSlash('//etc/hosts is odd')).toBeUndefined();
    expect(parseSlash('fix the bug')).toBeUndefined();
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
    expect(frames).toContain('genaicode');
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
    });
    const base = ui.url.replace(/\?.*$/, '');
    try {
      expect(ui.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=t0k$/);
      expect((await fetch(base)).status).toBe(403);
      const page = await fetch(ui.url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('data-cwd="/w &lt;&amp;&gt;"');
      expect(await (await fetch(`${base}app.js`)).text()).toBe('console.log(1)');

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
      expect(chat.get().notices.at(-1)?.text).toMatch(/keeps running until you press Ctrl-C/);

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
});
