import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';

// `genaicode/browser` bundled for a browser and run in one: `npm run test:browser`.

let browser: Browser;
let bundle: string;
let server: Server;

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
  // WebMCP is behind this flag where the browser has it at all, and needs a secure context.
  browser = await chromium.launch({ args: ['--enable-experimental-web-platform-features'] });
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>shop</title><h1 id="title">Shop</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

it('runs a page agent with tools in a real page, with no Node in the bundle', async () => {
  const page = await browser.newPage();
  // The browser's own Prompt API (an echo in Chromium) must not answer for the fake.
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  await page.addScriptTag({ content: bundle });
  const outcome = await page.evaluate(async () => {
    const { createPageAgent, fakeLanguageModel } = (
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
    };
  });
  expect(outcome).toEqual({ heading: 'Wolf shop', kinds: ['tool', 'approval', 'text'], text: 'Renamed it.' });
  await page.close();
});

it("offers tools over the browser's own WebMCP and reads them back", async () => {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  await page.addScriptTag({ content: bundle });
  const outcome = await page.evaluate(async () => {
    const { exposeWebMcp, webMcpSupported, webMcpTools } = (
      window as unknown as { genaicodeBrowser: typeof import('../browser.js') }
    ).genaicodeBrowser;
    if (!webMcpSupported()) return null;
    const asked: string[] = [];
    const remove = exposeWebMcp(
      [
        { name: 'heading', description: 'The page heading.', run: () => document.getElementById('title')!.textContent },
        {
          name: 'rename',
          description: 'Change the page heading.',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
          write: true,
          run: ({ title }: Record<string, unknown>) => {
            document.getElementById('title')!.textContent = String(title);
            return { renamed: true };
          },
        },
      ],
      {
        confirm: (tool, args) => {
          asked.push(`${tool.name} ${JSON.stringify(args)}`);
          return args.title !== 'No';
        },
      },
    );
    const listed = await webMcpTools();
    const tool = (name: string) => listed.find((candidate) => candidate.name === name)!;
    const result = {
      listed: listed.map(({ name, write }) => `${name}:${write ? 'write' : 'read'}`).sort(),
      schema: tool('rename').inputSchema,
      read: await tool('heading').run({}),
      renamed: await tool('rename').run({ title: 'Den' }),
      heading: document.getElementById('title')!.textContent,
      declined: await Promise.resolve(tool('rename').run({ title: 'No' })).then(
        () => 'ran',
        () => 'refused',
      ),
      asked,
      left: 0,
    };
    remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    result.left = (await webMcpTools()).length;
    return result;
  });
  // Browsers without WebMCP (Playwright's older Chromium builds) have nothing to check.
  if (outcome === null) return;
  expect(outcome).toEqual({
    listed: ['heading:read', 'rename:write'],
    schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    read: 'Shop',
    renamed: '{"renamed":true}',
    heading: 'Den',
    declined: 'refused',
    asked: ['rename {"title":"Den"}', 'rename {"title":"No"}'],
    left: 0,
  });
  await page.close();
});
