import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { fixPrompt, genaicode, type EmbeddedUiModule } from './plugin.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-vite-'));
writeFileSync(join(dir, 'agent'), '#!/bin/sh\n', { mode: 0o755 });
writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><h1>app</h1></body></html>');
const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };

const tasks: AgentTask[] = [];
const agent: CodingAgent = {
  name: 'fixer',
  command: 'agent',
  capabilities: {},
  run(task): AgentRun {
    tasks.push(task);
    const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
    return {
      result: Promise.resolve(result),
      abort() {},
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', result };
      },
    };
  },
};

const loadUi = async (): Promise<EmbeddedUiModule> => {
  const ui = await import('../ui/index.js');
  return {
    NoAgentError: ui.NoAgentError,
    startEmbeddedWeb: (options) => ui.startEmbeddedWeb({ ...options, env, clientScript: '' }),
  };
};

describe('fixPrompt', () => {
  it('lists the errors and rejects anything else', () => {
    const prompt = fixPrompt({
      page: 'http://localhost:5173/',
      errors: [
        { source: 'error', message: 'x is not defined (main.ts:3:1)', stack: 'ReferenceError: x\n  at main.ts:3' },
        { source: 'vite', message: 'Failed to parse ```' },
      ],
    });
    expect(prompt).toContain('at http://localhost:5173/ reports these errors');
    expect(prompt).toContain('1. [uncaught error] x is not defined (main.ts:3:1)\nReferenceError: x');
    expect(prompt).toContain("2. [build error] Failed to parse '''");
    expect(fixPrompt({ errors: [] })).toBeUndefined();
    expect(fixPrompt({ errors: [{ source: 'shell', message: 'rm' }] })).toBeUndefined();
    expect(fixPrompt({ errors: [{ source: 'console', message: 1 }] })).toBeUndefined();
    expect(fixPrompt({ page: 'javascript:alert(1)', errors: [{ source: 'console', message: 'a' }] })).not.toContain(
      'javascript',
    );
  });
});

describe('vite plugin', () => {
  let server: ViteDevServer;
  let base: string;

  beforeAll(async () => {
    server = await createServer({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [genaicode({ agents: [agent], loadUi })],
    });
    await server.listen();
    base = server.resolvedUrls!.local[0];
  });
  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds the overlay to the page and serves it as a module', async () => {
    const html = await (await fetch(base)).text();
    expect(html).toContain('<script type="module" src="/@id/__x00__virtual:genaicode-overlay"></script>');
    const overlay = await fetch(`${base}@id/__x00__virtual:genaicode-overlay`);
    expect(overlay.headers.get('content-type')).toMatch(/javascript/);
    const code = await overlay.text();
    expect(code).toContain('genaicode-overlay');
    expect(code).toContain('{"api":"/__genaicode","captureErrors":true}');
    expect(code).toContain('import.meta.hot');
  });

  it('gives the UI link to the app only, framed by the app only', async () => {
    const session = await fetch(`${base}__genaicode/session`, { headers: { 'sec-fetch-site': 'same-origin' } });
    const { url, agent: name } = (await session.json()) as { url: string; agent: string };
    expect(name).toBe('fixer');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}$/);
    expect((await fetch(`${base}__genaicode/session`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(
      403,
    );

    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toBe(`frame-ancestors ${new URL(base).origin}`);
  });

  it('sends the page errors to the agent', async () => {
    const fix = (body: unknown, site = 'same-origin') =>
      fetch(`${base}__genaicode/fix`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
        body: JSON.stringify(body),
      });
    const errors = [{ source: 'rejection', message: 'boom' }];
    expect((await fix({ errors }, 'cross-site')).status).toBe(403);
    expect((await fix({ errors: 'boom' })).status).toBe(400);
    expect(await (await fix({ page: base, errors })).json()).toEqual({ ok: true });
    await expect.poll(() => tasks.length).toBe(1);
    expect(tasks[0].prompt).toContain('1. [unhandled rejection] boom');
    expect(tasks[0].cwd).toBe(dir);
  });
});

describe('vite plugin without an agent', () => {
  it('leaves the page alone', async () => {
    const server = await createServer({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [genaicode({ agents: [{ ...agent, command: 'no-such-agent' }], loadUi })],
    });
    try {
      await server.listen();
      const base = server.resolvedUrls!.local[0];
      expect(await (await fetch(base)).text()).not.toContain('genaicode-overlay');
      expect((await fetch(`${base}__genaicode/session`)).status).toBe(503);
    } finally {
      await server.close();
    }
  });
});
