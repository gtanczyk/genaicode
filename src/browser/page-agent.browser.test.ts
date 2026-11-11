import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';

// `genaicode/browser` bundled for a browser and run in one: `npm run test:browser`.

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  // A Node import anywhere under the entry fails this build.
  const result = await build({
    entryPoints: ['src/browser.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'genaicodeBrowser',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});
afterAll(() => browser?.close());

it('runs a page agent with tools in a real page, with no Node in the bundle', async () => {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>shop</title><h1 id="title">Shop</h1>');
  await page.addScriptTag({ content: bundle });
  const outcome = await page.evaluate(async () => {
    const { createPageAgent, fakeLanguageModel, exposeWebMcp, webMcpSupported } = (
      window as unknown as { genaicodeBrowser: typeof import('../browser.js') }
    ).genaicodeBrowser;
    const tools = [
      {
        name: 'rename',
        description: 'Change the page heading.',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        write: true,
        run: ({ title }: Record<string, unknown>) => {
          document.getElementById('title')!.textContent = String(title);
          return 'renamed';
        },
      },
    ];
    const model = fakeLanguageModel([
      '{"action":"rename"}',
      '{"title":"Wolf shop"}',
      '{"action":"reply"}',
      'Renamed it.',
    ]);
    const agent = createPageAgent({ tools, nano: { languageModel: model.factory } });
    const remove = exposeWebMcp(tools);
    remove();
    agent.subscribe((state) => {
      for (const request of state.session.approvals) agent.approve(request.id, 'approve');
    });
    agent.send('call it Wolf shop');
    await new Promise<void>((resolve) => {
      const stop = agent.subscribe((state) => {
        if (state.session.status !== 'idle') return;
        stop();
        resolve();
      });
    });
    const [turn] = agent.get().session.turns;
    return {
      heading: document.getElementById('title')!.textContent,
      kinds: turn.entries.map((entry) => entry.kind),
      text: turn.result?.text,
      webMcp: webMcpSupported(),
      builtIn: await createPageAgent({}).refresh(),
    };
  });
  expect(outcome).toEqual({
    heading: 'Wolf shop',
    kinds: ['tool', 'approval', 'text'],
    text: 'Renamed it.',
    // Playwright's Chromium has neither WebMCP nor a built-in model.
    webMcp: false,
    builtIn: 'unavailable',
  });
  await page.close();
});
