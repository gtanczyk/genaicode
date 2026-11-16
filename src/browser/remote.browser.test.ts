import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAgentBackend } from '../backend/backend.js';
import { toNodeListener } from '../backend/node.js';
import { genaicode } from '../core/client.js';
import type { GenerationResult, ModelProvider } from '../core/types.js';

// `remote()` in a real page against `createAgentBackend()` on a real Node server:
// same-origin fetch with a cookie, NDJSON streaming, a page tool with approval, and the
// fallback to the built-in model. `npm run test:browser`.

let browser: Browser;
let bundle: string;
let server: Server;
let port: number;
const script: GenerationResult[] = [];

beforeAll(async () => {
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
  const provider: ModelProvider = {
    name: 'fake',
    capabilities: { tools: true },
    async generate() {
      const step = script.shift();
      if (!step) throw new Error('the script ran out');
      return step;
    },
  };
  const backend = createAgentBackend({
    client: genaicode(provider),
    secret: 'test-secret-test-secret-test-secret!',
    authorize: (request) => (/\bsession=ok\b/.test(request.headers.get('cookie') ?? '') ? { id: 'u1' } : null),
    pageTools: [
      {
        name: 'rename',
        description: 'Change the page heading.',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        write: true,
      },
    ],
  });
  const listener = toNodeListener(backend);
  browser = await chromium.launch();
  server = createServer((req, res) =>
    listener(req, res, () => {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=ok; Path=/; SameSite=Lax' });
      res.end('<!doctype html><title>shop</title><h1 id="title">Shop</h1>');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

it('bundles the backend with no Node in it', async () => {
  // `toNodeListener` only takes Node's types: the bundle must still build for a Worker.
  const result = await build({
    entryPoints: ['src/backend.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  expect(result.outputFiles[0].text).toContain('createAgentBackend');
});

it('runs a page tool the server-side model calls, after the user approves it', async () => {
  script.push(
    { parts: [{ type: 'toolCall', toolCall: { id: 'c1', name: 'rename', arguments: { title: 'Wolf shop' } } }] },
    { parts: [{ type: 'text', text: 'Renamed it.' }], usage: { inputTokens: 20, outputTokens: 4 } },
  );
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.addScriptTag({ content: bundle });
  const outcome = await page.evaluate(async () => {
    const { createPageAgent, remote } = (window as unknown as { genaicodeBrowser: typeof import('../browser.js') })
      .genaicodeBrowser;
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
    const agent = createPageAgent({ agent: remote({ url: '/api/assistant', tools }) });
    agent.subscribe((state) => {
      for (const request of state.session.approvals) agent.approve(request.id, 'approve');
    });
    agent.send('call it Wolf shop');
    await new Promise<void>((resolve) => {
      const stop = agent.subscribe((state) => {
        if (state.session.status !== 'idle' || !state.session.turns[0]?.result) return;
        stop();
        resolve();
      });
    });
    const [turn] = agent.get().session.turns;
    return {
      heading: document.getElementById('title')!.textContent,
      kinds: turn.entries.map((entry) => entry.kind),
      text: turn.result?.text,
      usage: turn.result?.usage,
    };
  });
  expect(outcome).toEqual({
    heading: 'Wolf shop',
    kinds: ['tool', 'approval', 'text'],
    text: 'Renamed it.',
    usage: { totalTokens: 24 },
  });
  await page.close();
});

it('goes on with the built-in model when the server refuses the page', async () => {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  // Signed out: the server refuses before any model call.
  await page.context().clearCookies();
  await page.addScriptTag({ content: bundle });
  const outcome = await page.evaluate(async (target) => {
    const { fakeLanguageModel, nano, remote, withFallback } = (
      window as unknown as { genaicodeBrowser: typeof import('../browser.js') }
    ).genaicodeBrowser;
    const agent = withFallback([
      remote({ url: target }),
      nano({ languageModel: fakeLanguageModel(['Hello from the page.']).factory }),
    ]);
    const run = agent.run({ prompt: 'hi', cwd: '' });
    const kinds: string[] = [];
    for await (const event of run)
      kinds.push(event.type === 'failover' ? `failover:${event.failure.kind}` : event.type);
    return { kinds, text: (await run.result).text };
  }, '/api/assistant');
  expect(outcome.text).toBe('Hello from the page.');
  expect(outcome.kinds).toContain('failover:auth');
  await page.close();
});
