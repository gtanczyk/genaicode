import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { cliAgent } from './cli-agent.js';
import { findAllExecutables } from './discovery.js';
import { AGENT_GUIDES, agentGuide } from './drivers/catalog.js';
import { isAuthError } from './runtime.js';
import { createAgentInspector, inspectAgent, inspectAgents, isAgentUsable } from './status.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-status-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeBin(dir: string, name: string, script: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe('findAllExecutables', () => {
  it('returns multiple distinct installs in PATH order and deduplicates symlinks', () => {
    const first = join(root, 'bin-a');
    const second = join(root, 'bin-b');
    const linkDir = join(root, 'bin-link');
    const a = makeBin(first, 'codex', 'echo 1');
    const b = makeBin(second, 'codex', 'echo 2');
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(a, join(linkDir, 'codex'));
    const env = { PATH: [first, linkDir, second, first].join(delimiter) };
    expect(findAllExecutables('codex', env)).toEqual([a, b]);
  });
});

describe('inspectAgents', () => {
  const sampleAgents = [
    { name: 'vibe', command: 'vibe' },
    { name: 'codex', command: 'codex' },
    { name: 'claude', command: 'claude' },
    { name: 'gemini', command: 'gemini' },
  ];

  it('reports none installed in canonical onboarding order when PATH is empty', async () => {
    const empty = mkdtempSync(join(root, 'empty-'));
    const result = await inspectAgents(sampleAgents, { PATH: empty });
    expect(result.map((item) => item.name)).toEqual(['claude', 'codex', 'gemini', 'vibe']);
    expect(result.every((item) => !item.installed && item.auth === 'unknown')).toBe(true);
    expect(result[0]!.guide.title).toBe('Claude Code');
    expect(result[0]!.guide.install.length).toBeGreaterThan(0);
    expect(result.some(isAgentUsable)).toBe(false);
  });

  it('detects signed-in and signed-out states for Claude Code and Codex', async () => {
    const bin = mkdtempSync(join(root, 'auth-'));
    makeBin(
      bin,
      'claude',
      `if [ "$1" = "--version" ]; then echo "2.1.330 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}'
  exit 0
fi`,
    );
    makeBin(
      bin,
      'codex',
      `if [ "$1" = "--version" ]; then echo "codex-cli 0.170.0"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  echo "Not logged in" >&2
  exit 1
fi`,
    );
    makeBin(bin, 'gemini', `if [ "$1" = "--version" ]; then echo "0.12.1"; exit 0; fi`);

    const list = await inspectAgents(sampleAgents, { PATH: bin });
    const byName = new Map(list.map((item) => [item.name, item]));
    expect(byName.get('claude')).toMatchObject({
      installed: true,
      version: '2.1.330',
      auth: 'ready',
      plan: 'Max',
    });
    expect(byName.get('codex')).toMatchObject({
      installed: true,
      version: '0.170.0',
      auth: 'signed-out',
    });
    expect(byName.get('gemini')).toMatchObject({
      installed: true,
      version: '0.12.1',
      auth: 'unknown',
    });
    expect(byName.get('vibe')).toMatchObject({ installed: false, auth: 'unknown' });
    expect(isAgentUsable(byName.get('claude')!)).toBe(true);
    expect(isAgentUsable(byName.get('codex')!)).toBe(false);
    expect(isAgentUsable(byName.get('gemini')!)).toBe(true);
  });

  it('detects signed-out Claude and signed-in Codex (stderr output)', async () => {
    const bin = mkdtempSync(join(root, 'auth-flip-'));
    makeBin(
      bin,
      'claude',
      `if [ "$1" = "--version" ]; then echo "2.1.330"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":false,"authMethod":"none"}'
  exit 1
fi`,
    );
    makeBin(
      bin,
      'codex',
      `if [ "$1" = "--version" ]; then echo "codex-cli 0.170.0"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  echo "Logged in using ChatGPT" >&2
  exit 0
fi`,
    );
    const list = await inspectAgents(
      [
        { name: 'claude', command: 'claude' },
        { name: 'codex', command: 'codex' },
      ],
      { PATH: bin },
    );
    expect(list[0]).toMatchObject({ name: 'claude', installed: true, auth: 'signed-out' });
    expect(list[1]).toMatchObject({ name: 'codex', installed: true, auth: 'ready', plan: 'ChatGPT' });
  });

  it('marks a broken binary as installed with an error hint and mentions duplicate installs', async () => {
    const primary = mkdtempSync(join(root, 'broken-1-'));
    const secondary = mkdtempSync(join(root, 'broken-2-'));
    makeBin(primary, 'claude', `echo "Bad CPU type in executable" >&2; exit 126`);
    const other = makeBin(secondary, 'claude', `echo "2.1.0"; exit 0`);

    const inspected = await inspectAgent(
      { name: 'claude', command: 'claude' },
      { PATH: `${primary}${delimiter}${secondary}` },
    );
    expect(inspected).toMatchObject({
      installed: true,
      broken: true,
      auth: 'unknown',
      otherPaths: [other],
    });
    expect(inspected.hint).toContain('Bad CPU type in executable');
    expect(inspected.hint).toContain(other);
    expect(isAgentUsable(inspected)).toBe(false);
  });

  it('reports duplicate installs on a working agent in hint', async () => {
    const primary = mkdtempSync(join(root, 'dup-1-'));
    const secondary = mkdtempSync(join(root, 'dup-2-'));
    const first = makeBin(primary, 'gemini', `echo "1.0.0"`);
    const second = makeBin(secondary, 'gemini', `echo "0.9.0"`);

    const inspected = await inspectAgent(
      { name: 'gemini', command: 'gemini' },
      { PATH: `${primary}${delimiter}${secondary}` },
    );
    expect(inspected).toMatchObject({
      installed: true,
      path: first,
      otherPaths: [second],
      version: '1.0.0',
      auth: 'unknown',
    });
    expect(inspected.hint).toContain(second);
  });

  it('caches results for ttlMs and refreshes env when requested', async () => {
    const binA = mkdtempSync(join(root, 'cache-a-'));
    const binB = mkdtempSync(join(root, 'cache-b-'));
    const liveEnv: NodeJS.ProcessEnv = { PATH: binA };
    const refreshEnv = vi.fn(async () => {
      makeBin(binB, 'gemini', 'echo "1.2.3"');
      liveEnv.PATH = binB;
    });
    const updates: number[] = [];
    const inspector = createAgentInspector({
      agents: [{ name: 'gemini', command: 'gemini' }],
      getEnv: () => liveEnv,
      refreshEnv,
      ttlMs: 10_000,
      onUpdate: (agents) => updates.push(agents.filter((a) => a.installed).length),
    });

    const first = await inspector.check();
    expect(first.setup).toBe(true);
    expect(first.agents[0]!.installed).toBe(false);

    // Cached: adding a file without refresh does not re-probe yet.
    makeBin(binA, 'gemini', 'echo "1.0.0"');
    const cached = await inspector.check();
    expect(cached.agents[0]!.installed).toBe(false);
    expect(refreshEnv).not.toHaveBeenCalled();

    // Explicit refresh with env invokes refreshEnv and sees the new PATH.
    const refreshed = await inspector.check({ refresh: true, refreshEnv: true });
    expect(refreshEnv).toHaveBeenCalledTimes(1);
    expect(refreshed.setup).toBe(false);
    expect(refreshed.agents[0]).toMatchObject({ installed: true, version: '1.2.3' });
    expect(updates).toEqual([0, 1]);
  });

  it('coalesces overlapping forced refreshes so slow probes do not starve onUpdate', async () => {
    const bin = mkdtempSync(join(root, 'slow-'));
    const countFile = join(bin, 'runs');
    makeBin(bin, 'gemini', `echo x >> "${countFile}"; sleep 0.25; echo "1.0.0"`);
    const updates: number[] = [];
    const refreshEnv = vi.fn(async () => {});
    const inspector = createAgentInspector({
      agents: [{ name: 'gemini', command: 'gemini' }],
      getEnv: () => ({ PATH: `${bin}${delimiter}/usr/bin${delimiter}/bin` }),
      refreshEnv,
      onUpdate: (agents) => updates.push(agents.filter((a) => a.installed).length),
    });

    // Overlapping plain refreshes share the single in-flight probe and deliver onUpdate.
    const [first, second] = await Promise.all([inspector.check({ refresh: true }), inspector.check({ refresh: true })]);
    expect(first).toBe(second);
    expect(first.setup).toBe(false);
    expect(updates).toEqual([1]);

    // An explicit env refresh arriving while a plain probe runs serializes cleanly after it.
    const plain = inspector.check({ refresh: true });
    const withEnv = inspector.check({ refresh: true, refreshEnv: true });
    const [r1, r2] = await Promise.all([plain, withEnv]);
    expect(r1.setup).toBe(false);
    expect(r2.setup).toBe(false);
    expect(refreshEnv).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([1, 1, 1]);
  });

  it('ships guides for all 9 built-in drivers and falls back cleanly for custom agents', () => {
    expect(AGENT_GUIDES.map((g) => g.name)).toEqual([
      'claude',
      'codex',
      'copilot',
      'antigravity',
      'muse',
      'gemini',
      'cursor',
      'opencode',
      'vibe',
    ]);
    expect(agentGuide('custom', 'my-cli')).toMatchObject({
      name: 'custom',
      title: 'custom',
      command: 'my-cli',
      loginCommand: 'my-cli',
    });
  });
});

describe('auth-error mapping per driver', () => {
  const authFixtures: Array<[string, string]> = [
    ['claude: not logged in', 'Not logged in · Please run /login'],
    ['claude: invalid api key', 'Invalid API key · Please run /login'],
    ['claude: oauth expired', 'OAuth token has expired. Please run `/login`.'],
    ['claude: authentication_error', 'API Error: 401 {"type":"error","error":{"type":"authentication_error"}}'],
    ['claude: unresolved auth', 'Could not resolve authentication method. Expected either apiKey or authToken.'],
    ['codex: not logged in', 'Not logged in. Run `codex login` to authenticate.'],
    ['codex: 401 unauthorized', 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header'],
    ['codex: refresh failed', 'Your access token could not be refreshed. Please log out and sign in again.'],
    ['copilot: no auth info', 'No authentication information found. Run `copilot` and use `/login`.'],
    ['copilot: not logged into github', 'You are not logged into any GitHub hosts.'],
    ['antigravity: unauthenticated', 'UNAUTHENTICATED: Request had invalid authentication credentials.'],
    ['antigravity: sign-in required', 'Sign-in required before starting a session.'],
    ['muse: not logged in', 'Muse run failed: Not logged in'],
    ['muse: missing credentials', 'Missing credentials for Muse Code.'],
    ['gemini: auth method', 'Please set an Auth method in your ~/.gemini/settings.json'],
    ['gemini: missing key', 'GEMINI_API_KEY environment variable not set'],
    ['gemini: invalid key', 'API key not valid. Please pass a valid API key.'],
    ['gemini: failed to auth', 'Failed to authenticate with Google.'],
    ['cursor: login required', 'Not logged in. Run `cursor-agent login` to authenticate.'],
    ['cursor: missing key', 'CURSOR_API_KEY is not set'],
    ['opencode: no api key', 'No API key found for provider anthropic.'],
    ['opencode: provider creds', 'Provider credentials not configured. Run `opencode auth login`.'],
    ['vibe: missing key', 'MISTRAL_API_KEY is not set'],
  ];

  it.each(authFixtures)('classifies %s as auth error', (_label, message) => {
    expect(isAuthError(message)).toBe(true);
  });

  const nonAuthFixtures: Array<[string, string]> = [
    ['ordinary test failure', 'Tests still fail: expected 2 to be 3.'],
    ['file mentioning auth', 'Failed to compile src/auth.ts: SyntaxError'],
    ['quota / rate limit', '429: usage limit reached, try again later'],
    ['missing binary', 'ENOENT: no such file or directory'],
    ['permission denied on disk', 'EACCES: permission denied, open /etc/hosts'],
    ['generic crash', 'Command exited with code 1'],
  ];

  it.each(nonAuthFixtures)('does not misclassify %s as auth error', (_label, message) => {
    expect(isAuthError(message)).toBe(false);
  });

  it('maps stderr-only auth errors from a CLI run to failure.kind = auth', async () => {
    const bin = mkdtempSync(join(root, 'stderr-auth-'));
    const cli = makeBin(bin, 'fake-cli', 'echo "Not logged in. Run codex login." >&2; exit 1');
    const agent = cliAgent({
      name: 'codex',
      command: cli,
      args: () => [],
      createParser: () => ({ event: () => [] }),
    });
    const run = agent.run({ prompt: 'hi', cwd: root, env: process.env });
    for await (const event of run) void event;
    const result = await run.result;
    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({ kind: 'auth' });
  });
});
