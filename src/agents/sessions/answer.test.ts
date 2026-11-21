import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCli } from '../../cli/args.js';
import { runAnswerHook } from '../../cli/hook.js';
import { answerAsk, askPreview, asksDir, pendingAsks, waitForAnswer } from './answer.js';
import { hookCommand, hooksStatus, installHooks, uninstallHooks } from './hooks.js';
import { recordHook } from './live.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-answer-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let homes = 0;
const home = () => {
  const dir = join(root, `h${(homes += 1)}`);
  mkdirSync(dir, { recursive: true });
  return { HOME: dir };
};

const ask = {
  hook_event_name: 'PermissionRequest',
  session_id: 's1',
  cwd: '/work/api',
  tool_name: 'Bash',
  tool_input: { command: 'npm   test\n-- --watch=false', description: 'Run the tests' },
};

/** The one question open, once the hook has written it. */
async function opened(env: NodeJS.ProcessEnv) {
  for (let i = 0; i < 200; i += 1) {
    const [first] = await pendingAsks(env);
    if (first) return first;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('no question opened');
}

describe('answering questions from the tower', () => {
  it('previews what the tool would do, cut short', () => {
    expect(askPreview(ask.tool_input)).toBe('npm test -- --watch=false');
    expect(askPreview({ file_path: '/a/b.ts', content: 'x' })).toBe('/a/b.ts');
    expect(askPreview({ command: 'x'.repeat(500) })).toHaveLength(200);
    expect(askPreview({ other: 1 })).toBeUndefined();
    expect(askPreview('ls')).toBeUndefined();
  });

  it('holds the question open until it is approved here, then cleans up', async () => {
    const env = home();
    const waiting = waitForAnswer('claude', ask, { env, pollMs: 5 });
    const open = await opened(env);
    expect(open).toMatchObject({
      agent: 'claude',
      session: 's1',
      cwd: '/work/api',
      tool: 'Bash',
      preview: 'npm test -- --watch=false',
      pid: process.pid,
    });
    expect(statSync(join(asksDir(env), `${open.id}.json`)).mode & 0o777).toBe(0o600);
    expect(await answerAsk(open.id, { behavior: 'allow' }, env)).toBe(true);
    // Only the first answer counts.
    expect(await answerAsk(open.id, { behavior: 'deny' }, env)).toBe(false);
    expect(await waiting).toEqual({ behavior: 'allow' });
    expect(readdirSync(asksDir(env))).toEqual([]);
    expect(await answerAsk(open.id, { behavior: 'allow' }, env)).toBe(false);
    expect(await answerAsk('../../etc', { behavior: 'allow' }, env)).toBe(false);
  });

  it('prints the decision as the hook output, a denial with its reason', async () => {
    const env = home();
    const out: string[] = [];
    const running = runAnswerHook(
      'claude',
      JSON.stringify(ask),
      env,
      { write: (text) => out.push(text) },
      { pollMs: 5 },
    );
    const open = await opened(env);
    expect(await answerAsk(open.id, { behavior: 'deny', message: '  not now ' }, env)).toBe(true);
    expect(await running).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'not now' } },
    });
  });

  it('lets the agent decide when its own dialog was answered, the time ran out or it ended the hook', async () => {
    const env = home();
    // Approved in Claude Code: the tool runs, and its hook says so.
    await recordHook('claude', ask, { env });
    const answered = waitForAnswer('claude', ask, { env, pollMs: 5 });
    await opened(env);
    await recordHook('claude', { ...ask, hook_event_name: 'PostToolUse' }, { env });
    expect(await answered).toBeUndefined();
    expect(await pendingAsks(env)).toEqual([]);

    // A new prompt: the question belongs to a turn that is over.
    await recordHook('claude', ask, { env });
    const moved = waitForAnswer('claude', ask, { env, pollMs: 5 });
    await opened(env);
    await recordHook('claude', { ...ask, hook_event_name: 'UserPromptSubmit' }, { env, now: Date.now() + 10 });
    expect(await moved).toBeUndefined();

    // Another session, nothing reported.
    const other = { ...ask, session_id: 's2' };
    expect(await waitForAnswer('claude', other, { env, pollMs: 5, timeoutMs: 30 })).toBeUndefined();

    const controller = new AbortController();
    const ended = waitForAnswer('claude', other, { env, pollMs: 5, signal: controller.signal });
    await opened(env);
    controller.abort();
    expect(await ended).toBeUndefined();
    expect(readdirSync(asksDir(env))).toEqual([]);
    // Not a question: nothing is held.
    expect(await waitForAnswer('claude', { ...ask, hook_event_name: 'Stop' }, { env })).toBeUndefined();
    const out: string[] = [];
    await runAnswerHook('claude', JSON.stringify({ ...ask, hook_event_name: 'Stop' }), env, {
      write: (text) => out.push(text),
    });
    expect(out).toEqual([]);
  });

  it('waits out an answer that does not read whole yet', async () => {
    const env = home();
    const waiting = waitForAnswer('claude', ask, { env, pollMs: 5 });
    const open = await opened(env);
    const file = join(asksDir(env), `${open.id}.answer`);
    writeFileSync(file, '{"behav');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(existsSync(join(asksDir(env), `${open.id}.json`))).toBe(true);
    writeFileSync(file, '{"behavior":"allow"}');
    expect(await waiting).toEqual({ behavior: 'allow' });
  });

  it('tells an answer the hook took from one given as the hook let go', async () => {
    const env = home();
    const dir = asksDir(env);
    mkdirSync(dir, { recursive: true });
    const id = '0123456789ab';
    const file = join(dir, `${id}.json`);
    writeFileSync(file, JSON.stringify({ id, agent: 'claude', session: 's', at: 1, pid: process.pid }));
    // Nobody takes it, and the question goes: the answer reached no one.
    const answering = answerAsk(id, { behavior: 'allow' }, env);
    await new Promise((resolve) => setTimeout(resolve, 30));
    rmSync(file);
    expect(await answering).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('drops a question whose hook was killed', async () => {
    const env = home();
    const dir = asksDir(env);
    mkdirSync(dir, { recursive: true });
    const stale = { id: 'abcdef012345', agent: 'claude', session: 's', at: 1, pid: 2 ** 22 + 7 };
    writeFileSync(join(dir, `${stale.id}.json`), JSON.stringify(stale));
    writeFileSync(join(dir, 'not-a-question.json'), '{}');
    expect(await pendingAsks(env)).toEqual([]);
    expect(existsSync(join(dir, `${stale.id}.json`))).toBe(false);
    expect(await answerAsk(stale.id, { behavior: 'allow' }, env)).toBe(false);
  });

  it('installs the waiting hook for Claude Code only, and takes it out with the rest', async () => {
    const env = { ...home(), CODEX_HOME: join(root, 'codex-answer') };
    const command = '"/n" "/c.js" hook';
    const status = await installHooks('claude', { env, command, answer: true });
    expect(status).toMatchObject({ installed: true, answer: true });
    const written = JSON.parse(readFileSync(status.file, 'utf8'));
    expect(written.hooks.PermissionRequest).toEqual([
      { hooks: [{ type: 'command', command: hookCommand('claude', command), timeout: 10, async: true }] },
      { hooks: [{ type: 'command', command: hookCommand('claude', command, true), timeout: 600 }] },
    ]);
    // Installed again without it: gone.
    expect((await installHooks('claude', { env, command })).answer).toBe(false);
    await installHooks('claude', { env, command, answer: true });
    expect(await uninstallHooks('claude', { env })).toBe(true);
    expect((await hooksStatus('claude', { env, command })).events).toEqual([]);
    // Claude Code's status line keeps its plan limits, and goes with the hooks.
    const claudeFile = (await installHooks('claude', { env, command })).file;
    expect(JSON.parse(readFileSync(claudeFile, 'utf8')).statusLine).toEqual({
      type: 'command',
      command: '"/n" "/c.js" limits record --genaicode-live',
    });
    expect((await hooksStatus('claude', { env, command })).statusLine).toBe('genaicode');
    expect(await uninstallHooks('claude', { env })).toBe(true);
    expect((await hooksStatus('claude', { env, command })).statusLine).toBe('none');
    // A status line of the user's own is left as it is, by install and by uninstall.
    const own = { type: 'command', command: '~/.claude/statusline.sh' };
    mkdirSync(dirname(claudeFile), { recursive: true });
    writeFileSync(claudeFile, JSON.stringify({ statusLine: own }));
    expect((await installHooks('claude', { env, command })).statusLine).toBe('other');
    await uninstallHooks('claude', { env });
    expect(JSON.parse(readFileSync(claudeFile, 'utf8'))).toEqual({ statusLine: own });
    expect(parseCli(['limits', 'record', '--genaicode-live'])).toMatchObject({ kind: 'limits', action: 'record' });
    // Codex would hold its own prompt back while the hook waits.
    const codex = await installHooks('codex', { env, command, answer: true });
    expect(codex).toMatchObject({ installed: true, answer: false });
  });
});
