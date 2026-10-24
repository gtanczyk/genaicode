import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { createOverlay, type Overlay } from './server.js';

// The overlay on a dev server that is not Vite, in a real browser: `npm run test:browser`.

const dir = mkdtempSync(join(tmpdir(), 'genaicode-overlay-node-'));
writeFileSync(join(dir, 'agent'), '#!/bin/sh\n', { mode: 0o755 });
const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
const html = `<!doctype html><html><head><title>game</title></head><body>
<button id="throw" onclick="setTimeout(() => { throw new Error('fireball missed'); })">throw</button>
</body></html>`;

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

let overlay: Overlay;
let server: Server;
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  overlay = createOverlay(
    async (frameAncestors) => {
      const ui = await import('../ui/index.js');
      return ui.startEmbeddedWeb({
        agents: [agent],
        cwd: dir,
        env,
        version: '0.0.0',
        frameAncestors,
        clientScript: '',
      });
    },
    { captureErrors: true, log: { info() {}, warn() {}, error() {} } },
  );
  // What `genaicode embed` writes for a project without a dev server: static files, overlay injected.
  server = createServer(async (req, res) => {
    if (await overlay.handle(req, res)) return;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(overlay.injectHtml(html));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
  page = await browser.newPage();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
  await overlay?.close();
  rmSync(dir, { recursive: true, force: true });
});

const inOverlay = <T>(fn: (root: ShadowRoot) => T) =>
  page.evaluate((source) => {
    const root = document.querySelector('genaicode-overlay')!.shadowRoot!;
    return (new Function(`return (${source})`)() as (root: ShadowRoot) => T)(root);
  }, fn.toString());

it('shows the wolf with the error count, opens the chat and sends the errors', async () => {
  await page.goto(base);
  await expect
    .poll(() => inOverlay((root) => (root.querySelector('.wolf') as HTMLElement).style.backgroundImage))
    .toContain('/assets/wolf-64.png');
  const badge = () =>
    inOverlay((root) => {
      const el = root.querySelector('.badge') as HTMLElement;
      return el.hidden ? undefined : el.textContent;
    });
  expect(await badge()).toBeUndefined();

  await page.click('#throw');
  await expect.poll(badge).toBe('1');

  const loaded = page.waitForResponse((response) => response.url().includes('?token='));
  await inOverlay((root) => (root.querySelector('.wolf') as HTMLElement).click());
  expect((await loaded).status()).toBe(200);
  const src = await inOverlay((root) => root.querySelector('iframe')?.src);
  await expect.poll(() => page.frames().some((frame) => frame.url() === src)).toBe(true);

  expect(await inOverlay((root) => root.querySelector('.fix')!.textContent)).toBe('Fix 1 error');
  await inOverlay((root) => (root.querySelector('.fix') as HTMLElement).click());
  await expect.poll(() => tasks.length).toBe(1);
  expect(tasks[0].prompt).toContain(`The app running in the dev server at ${base} reports this error`);
  expect(tasks[0].prompt).toContain('[uncaught error] Uncaught Error: fireball missed');
  expect(await badge()).toBeUndefined();
});
