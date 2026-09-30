import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { genaicode, type EmbeddedUiModule } from './plugin.js';

// The overlay in a real browser: `npm run test:browser` (needs `npx playwright install chromium`).

const dir = mkdtempSync(join(tmpdir(), 'genaicode-overlay-'));
writeFileSync(join(dir, 'agent'), '#!/bin/sh\n', { mode: 0o755 });
writeFileSync(
  join(dir, 'index.html'),
  `<!doctype html><html><body>
<input id="app-input" />
<button id="throw" onclick="setTimeout(() => { throw new Error('clicked too hard'); })">throw</button>
<button id="reject" onclick="Promise.reject(new Error('promise broke'))">reject</button>
<button id="log" onclick="console.error('logged', new Error('bad state'))">log</button>
</body></html>`,
);
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

let server: ViteDevServer;
let browser: Browser;
let base: string;
let page: Page;

beforeAll(async () => {
  server = await createServer({
    root: dir,
    configFile: false,
    logLevel: 'silent',
    // Vite's own error overlay would cover the page, and reload it on the next update.
    server: { port: 0, host: '127.0.0.1', hmr: { overlay: false } },
    plugins: [genaicode({ agents: [agent], loadUi })],
  });
  await server.listen();
  base = server.resolvedUrls!.local[0];
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  tasks.length = 0;
  page = await browser.newPage();
  await page.goto(base);
  // The wolf gets its picture once the session has loaded.
  await expect.poll(() => wolfStyle('backgroundImage')).toContain('/assets/wolf-64.png');
});
afterEach(async () => {
  await page?.close();
});

/** Evaluates in the overlay's shadow root. */
const inOverlay = <T, A>(fn: (root: ShadowRoot, arg: A) => T, arg?: A) =>
  page.evaluate(
    ([source, value]) => {
      const root = document.querySelector('genaicode-overlay')!.shadowRoot!;
      return (new Function(`return (${source})`)() as (root: ShadowRoot, arg: unknown) => T)(root, value);
    },
    [fn.toString(), arg] as const,
  );
const focused = () =>
  page.evaluate(() => {
    const active = document.activeElement;
    return active?.tagName === 'GENAICODE-OVERLAY'
      ? `overlay .${active.shadowRoot!.activeElement?.className}`
      : active?.id;
  });
/** What Vite's client hears when a module fails to build. */
const buildError = () =>
  server.ws.send({
    type: 'error',
    err: { message: 'Unexpected token', id: join(dir, 'main.ts'), frame: '1 | export const = ;', stack: '' },
  });
const wolfStyle = (property: 'backgroundImage') =>
  inOverlay((root, name) => (root.querySelector('.wolf') as HTMLElement).style[name as 'backgroundImage'], property);
const panelHidden = () => inOverlay((root) => (root.querySelector('.panel') as HTMLElement).hidden);
const badge = () =>
  inOverlay((root) => {
    const el = root.querySelector('.badge') as HTMLElement;
    return el.hidden ? undefined : el.textContent;
  });

describe('overlay in the browser', () => {
  it('is reached with Tab after the app, wolf first, then the panel', async () => {
    await page.click('#log');
    await expect.poll(badge).toBe('1');

    await page.focus('#reject');
    await page.keyboard.press('Tab');
    expect(await focused()).toBe('log');
    await page.keyboard.press('Tab');
    expect(await focused()).toBe('overlay .wolf');
    expect(await inOverlay((root) => root.querySelector('.wolf')!.getAttribute('aria-expanded'))).toBe('false');

    await page.keyboard.press('Enter');
    expect(await panelHidden()).toBe(false);
    expect(await inOverlay((root) => root.querySelector('.wolf')!.getAttribute('aria-expanded'))).toBe('true');
    await page.keyboard.press('Tab');
    expect(await focused()).toBe('overlay .fix');
    await page.keyboard.press('Tab');
    expect(await focused()).toBe('overlay .close');

    // Closing the panel hands the focus back to the wolf.
    await page.keyboard.press('Enter');
    expect(await panelHidden()).toBe(true);
    expect(await focused()).toBe('overlay .wolf');
  });

  it('opens the genaicode UI in a frame the page may show', async () => {
    const loaded = page.waitForResponse((response) => response.url().includes('?token='));
    await inOverlay((root) => (root.querySelector('.wolf') as HTMLElement).click());
    const response = await loaded;
    expect(response.status()).toBe(200);
    const src = await inOverlay((root) => root.querySelector('iframe')?.src);
    expect(src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}$/);
    await expect.poll(() => page.frames().some((frame) => frame.url() === src)).toBe(true);

    // The wolf toggles the panel; the frame is made once.
    await inOverlay((root) => (root.querySelector('.wolf') as HTMLElement).click());
    expect(await panelHidden()).toBe(true);
    await inOverlay((root) => (root.querySelector('.wolf') as HTMLElement).click());
    expect(await inOverlay((root) => root.querySelectorAll('iframe').length)).toBe(1);
  });

  it('collects the page errors and sends them to the agent', async () => {
    expect(await badge()).toBeUndefined();
    await page.click('#throw');
    await page.click('#reject');
    await page.click('#log');
    buildError();
    await expect.poll(badge).toBe('4');
    // The same error again is not counted twice.
    await page.click('#log');
    await page.waitForTimeout(100);
    expect(await badge()).toBe('4');

    await inOverlay((root) => (root.querySelector('.wolf') as HTMLElement).click());
    expect(await inOverlay((root) => root.querySelector('.fix')!.textContent)).toBe('Fix 4 errors');
    await inOverlay((root) => (root.querySelector('.fix') as HTMLElement).click());

    await expect.poll(() => tasks.length).toBe(1);
    const prompt = tasks[0].prompt;
    expect(prompt).toContain(`at ${base} reports these errors`);
    expect(prompt).toContain('[uncaught error] Uncaught Error: clicked too hard');
    expect(prompt).toContain('[unhandled rejection] promise broke');
    expect(prompt).toContain('[console.error] logged bad state');
    expect(prompt).toContain(`[build error] Unexpected token\n${join(dir, 'main.ts')}\n1 | export const = ;`);
    expect(await badge()).toBeUndefined();
    expect(await inOverlay((root) => (root.querySelector('.fix') as HTMLElement).hidden)).toBe(true);
  });

  it('drops the build errors once an update builds', async () => {
    await page.click('#log');
    buildError();
    await expect.poll(badge).toBe('2');
    server.ws.send({ type: 'update', updates: [] });
    await expect.poll(badge).toBe('1');
  });
});
