import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, QuestionHandler } from '../types.js';
import { codexLive } from './codex-live.js';
import {
  codexConfigPath,
  isCodexTrustError,
  parseCodexProjectTrust,
  readCodexProjectTrust,
  writeCodexProjectTrust,
} from './codex-trust.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-codex-trust-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const serverScript = join(root, 'fake-codex-server.mjs');
writeFileSync(
  serverScript,
  `import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
const codexHome = process.env.CODEX_HOME;
let trusted = new Set();
const requireTrust = process.env.FAKE_REQUIRE_TRUST === '1';
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    return send({ id: msg.id, result: { codexHome } });
  }
  if (msg.method === 'config/value/write') {
    const match = /^projects\\."(.+)"\\.trust_level$/.exec(msg.params.keyPath);
    if (match) {
      const dir = JSON.parse('"' + match[1] + '"');
      if (msg.params.value === 'trusted') trusted.add(dir);
      mkdirSync(codexHome, { recursive: true });
      const file = join(codexHome, 'config.toml');
      const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
      writeFileSync(file, prev + '\\n[projects.' + JSON.stringify(dir) + ']\\ntrust_level = ' + JSON.stringify(msg.params.value) + '\\n');
    }
    return send({ id: msg.id, result: { status: 'ok' } });
  }
  if (msg.method === 'thread/start') {
    if (requireTrust && !trusted.has(msg.params.cwd)) {
      return send({ id: msg.id, error: { code: -32000, message: 'Not inside a trusted directory' } });
    }
    return send({ id: msg.id, result: { thread: { id: 'th-trust' } } });
  }
  if (msg.method === 'turn/start') {
    send({ id: msg.id, result: { turn: { id: 'tu-1' } } });
    send({ method: 'item/completed', params: { threadId: 'th-trust', item: { id: 'm1', type: 'agentMessage', text: 'ready in ' + msg.params.threadId } } });
    send({ method: 'turn/completed', params: { threadId: 'th-trust', turn: { id: 'tu-1', status: 'completed' } } });
  }
});
`,
);
const fakeCodex = join(root, 'codex');
writeFileSync(fakeCodex, `#!${process.execPath}\nimport(${JSON.stringify(serverScript)});\n`, { mode: 0o755 });

describe('codex project trust config', () => {
  it('parses, reads ancestor trust (deepest wins), and updates config.toml safely', () => {
    const parsed = parseCodexProjectTrust(`
model = "gpt-5"
# comment
[projects."/Users/me/src/knights"]
trust_level = "trusted" # inline comment

[projects."/Users/me/src/knights/untrusted-sub"]
trust_level = "untrusted"
`);
    expect(parsed.get('/Users/me/src/knights')).toBe('trusted');
    expect(parsed.get('/Users/me/src/knights/untrusted-sub')).toBe('untrusted');

    const codexHome = join(root, 'cfg-1');
    const proj = join(root, 'proj-1');
    const sub = join(proj, 'packages', 'app');
    mkdirSync(sub, { recursive: true });
    const env = { CODEX_HOME: codexHome, HOME: root };
    expect(readCodexProjectTrust(proj, env)).toBeUndefined();

    writeCodexProjectTrust(proj, 'trusted', env);
    expect(readCodexProjectTrust(proj, env)).toBe('trusted');
    expect(readCodexProjectTrust(sub, env)).toBe('trusted');

    writeCodexProjectTrust(sub, 'untrusted', env);
    expect(readCodexProjectTrust(sub, env)).toBe('untrusted');
    expect(readCodexProjectTrust(proj, env)).toBe('trusted');

    writeCodexProjectTrust(sub, 'trusted', env);
    expect(readCodexProjectTrust(sub, env)).toBe('trusted');
    const raw = readFileSync(codexConfigPath(env), 'utf8');
    expect(raw.match(/\[projects\./g)?.length).toBe(2);
    expect(isCodexTrustError(new Error('Not inside a trusted directory'))).toBe(true);
    expect(isCodexTrustError(new Error('network timeout'))).toBe(false);
  });
});

describe('codexLive trust question card', () => {
  it('asks via onQuestion on first run in a new directory, persists trust, and skips asking on later runs', async () => {
    const codexHome = join(root, 'live-1');
    const work = join(root, 'src', 'knights');
    mkdirSync(work, { recursive: true });
    const env = { ...process.env, HOME: root, GENAICODE_HOME: join(root, '.genaicode'), CODEX_HOME: codexHome };
    const asked: ApprovalRequest[] = [];
    const onQuestion: QuestionHandler = (req) => {
      asked.push(req);
      return { trust: ['Trust'] };
    };

    const first = await codexLive({ command: fakeCodex }).run({ prompt: 'hi', cwd: work, env, onQuestion }).result;
    expect(first).toMatchObject({ ok: true, text: 'ready in th-trust' });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.summary).toBe('Codex wants to work in ~/src/knights for the first time. Trust it?');
    expect(readCodexProjectTrust(work, env)).toBe('trusted');

    // Second run in the same directory does NOT ask again.
    const second = await codexLive({ command: fakeCodex }).run({ prompt: 'again', cwd: work, env, onQuestion }).result;
    expect(second.ok).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('cancels cleanly when the person declines trust, and skips trust prompt in neutral home', async () => {
    const codexHome = join(root, 'live-2');
    const work = join(root, 'src', 'secret');
    const neutralHome = join(root, '.genaicode', 'home');
    mkdirSync(work, { recursive: true });
    mkdirSync(neutralHome, { recursive: true });
    const env = { ...process.env, HOME: root, GENAICODE_HOME: join(root, '.genaicode'), CODEX_HOME: codexHome };

    const declined = await codexLive({ command: fakeCodex }).run({
      prompt: 'hi',
      cwd: work,
      env,
      onQuestion: () => ({ trust: ['Cancel'] }),
    }).result;
    expect(declined.ok).toBe(false);
    expect(declined.error).toContain('was not trusted');
    expect(readCodexProjectTrust(work, env)).toBeUndefined();

    // Neutral home never asks to trust.
    const onQuestion = vi.fn<QuestionHandler>(() => ({ trust: ['Cancel'] }));
    const homeRun = await codexLive({ command: fakeCodex }).run({
      prompt: 'co tam?',
      cwd: neutralHome,
      env,
      onQuestion,
    }).result;
    expect(homeRun.ok).toBe(true);
    expect(onQuestion).not.toHaveBeenCalled();
  });

  it('retries thread/start after a reactive trust error when the user trusts the directory', async () => {
    const codexHome = join(root, 'live-3');
    const work = join(root, 'src', 'reactive');
    mkdirSync(work, { recursive: true });
    const env = {
      ...process.env,
      HOME: root,
      GENAICODE_HOME: join(root, '.genaicode'),
      CODEX_HOME: codexHome,
      FAKE_REQUIRE_TRUST: '1',
    };
    // Pretend config.toml already has an entry so proactive check is skipped, forcing reactive path.
    writeCodexProjectTrust(realpathSync(work), 'untrusted', env);
    const onQuestion = vi.fn<QuestionHandler>(() => ({ trust: ['Trust'] }));
    const res = await codexLive({ command: fakeCodex }).run({
      prompt: 'go',
      cwd: realpathSync(work),
      env,
      onQuestion,
    }).result;
    expect(res.ok).toBe(true);
    expect(onQuestion).toHaveBeenCalledTimes(1);
  });
});
