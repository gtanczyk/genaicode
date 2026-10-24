import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { createOverlay, isLoopbackHost, type Overlay, type OverlayLog } from './server.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-overlay-server-'));
writeFileSync(join(dir, 'agent'), '#!/bin/sh\n', { mode: 0o755 });
const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sameOrigin = { 'sec-fetch-site': 'same-origin' };
const quiet: OverlayLog = { info() {}, warn() {}, error() {} };

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

const start = (agents: CodingAgent[]) => async (frameAncestors: () => readonly string[]) => {
  const ui = await import('../ui/index.js');
  return ui.startEmbeddedWeb({ agents, cwd: dir, env, version: '0.0.0', frameAncestors, clientScript: '' });
};

/** A plain node:http dev server with the overlay in front of its own routes. */
async function serve(overlay: Overlay) {
  const server = createServer(async (req, res) => {
    if (await overlay.handle(req, res)) return;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(overlay.injectHtml('<!doctype html><html><head><title>app</title></head><body><h1>app</h1></body></html>'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

/** A GET with any Host header (fetch does not let a test set one). */
const get = (port: number, path: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });

describe('isLoopbackHost', () => {
  it('accepts names of this machine only', () => {
    for (const host of ['localhost:3000', 'LOCALHOST', 'app.localhost:8080', '127.0.0.1:5173', '[::1]:80'])
      expect(isLoopbackHost(host)).toBe(true);
    for (const host of [undefined, '', 'evil.com:3000', 'localhost.evil.com', '192.168.1.5:3000', '[::2]:80', 'a b'])
      expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('dev overlay on any server', () => {
  let overlay: Overlay;
  let server: Server;
  let base: string;
  let port: number;

  beforeAll(async () => {
    overlay = createOverlay(start([agent]), { captureErrors: true, log: quiet });
    ({ server, port } = await serve(overlay));
    base = `http://localhost:${port}/`;
    expect(await overlay.ready).toBeDefined();
  });
  afterAll(async () => {
    server?.close();
    await overlay?.close();
  });

  it('puts the overlay in the page head and serves it', async () => {
    const html = await (await fetch(base)).text();
    expect(html).toContain(`<head>${overlay.script}<title>`);
    expect(overlay.script).toMatch(/^<script>\(function collectEarlyErrors\(\) \{[\s\S]*\}\)\(\)<\/script>/);
    expect(overlay.script).toContain('<script type="module" src="/__genaicode/overlay.js"></script>');
    expect(overlay.injectHtml(html)).toBe(html);
    expect(overlay.injectHtml('<p>x</p>')).toBe(`${overlay.script}<p>x</p>`);
    const module = await fetch(`${base}__genaicode/overlay.js`);
    expect(module.headers.get('content-type')).toMatch(/javascript/);
    const code = await module.text();
    expect(code).toContain('genaicode-overlay');
    expect(code).toContain('{"api":"/__genaicode","captureErrors":true}, undefined);');
    // Not the overlay's: the app's own route.
    expect((await fetch(`${base}__genaicodex`)).status).toBe(200);
  });

  it('gives the UI link to the app pages on this machine only, framed by them only', async () => {
    const session = await fetch(`${base}__genaicode/session`, { headers: sameOrigin });
    const { url, agent: name } = (await session.json()) as { url: string; agent: string };
    expect(name).toBe('fixer');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}$/);
    expect((await fetch(url)).headers.get('content-security-policy')).toBe(`frame-ancestors http://localhost:${port}`);

    expect((await fetch(`${base}__genaicode/session`)).status).toBe(403);
    expect((await fetch(`${base}__genaicode/session`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(
      403,
    );
    // A DNS-rebinding page: same origin as far as the browser knows, but not a local name.
    expect(await get(port, '/__genaicode/session', { ...sameOrigin, host: `rebind.evil.com:${port}` })).toBe(403);
    expect(await get(port, '/__genaicode/session', { ...sameOrigin, host: `app.localhost:${port}` })).toBe(200);
    expect((await fetch(url)).headers.get('content-security-policy')).toContain(`http://app.localhost:${port}`);
  });

  it('sends the page errors to the agent', async () => {
    const fix = (body: unknown, site = 'same-origin') =>
      fetch(`${base}__genaicode/fix`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
        body: JSON.stringify(body),
      });
    const errors = [{ source: 'error', message: 'x is not defined' }];
    expect((await fix({ errors }, 'cross-site')).status).toBe(403);
    expect((await fix({ errors: 'boom' })).status).toBe(400);
    expect(await (await fix({ page: base, errors })).json()).toEqual({ ok: true });
    await expect.poll(() => tasks.length).toBe(1);
    expect(tasks[0].prompt).toContain(`The app running in the dev server at ${base} reports this error`);
    expect(tasks[0].prompt).toContain('1. [uncaught error] x is not defined');
    expect(tasks[0].cwd).toBe(dir);
  });
});

describe('dev overlay without an agent', () => {
  it('leaves the page alone and says why', async () => {
    const warnings: string[] = [];
    const overlay = createOverlay(start([{ ...agent, command: 'no-such-agent' }]), {
      captureErrors: true,
      log: { ...quiet, warn: (message) => warnings.push(message) },
    });
    const { server, port } = await serve(overlay);
    try {
      expect(await overlay.ready).toBeUndefined();
      expect(warnings.join()).toContain('The overlay is off.');
      const html = await (await fetch(`http://localhost:${port}/`)).text();
      expect(html).toContain('<h1>app</h1>');
      expect(html).not.toContain('__genaicode');
      expect((await fetch(`http://localhost:${port}/__genaicode/session`, { headers: sameOrigin })).status).toBe(503);
    } finally {
      server.close();
      await overlay.close();
    }
  });
});
