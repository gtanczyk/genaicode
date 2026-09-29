import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { Plugin, ViteDevServer } from 'vite';
import { defaultAgents } from '../agents/defaults.js';
import type { CodingAgent } from '../agents/types.js';
import { mountOverlay, type OverlayConfig } from './overlay.js';

export interface GenaicodeViteOptions {
  /** Agent to start with. Default: the first installed one. */
  agent?: string;
  model?: string;
  effort?: string;
  /** Approve every permission request without asking. */
  approveAll?: boolean;
  /** Agents to offer. Default: the same headless drivers as `genaicode ui`. */
  agents?: readonly CodingAgent[];
  /** Collect the page's errors and offer to send them to the agent. Default true. */
  captureErrors?: boolean;
  /** Port of the genaicode UI on 127.0.0.1. Default: a free port. */
  port?: number;
  /** Loads the bundled front ends. Defaults to `dist/ui/index.js`; tests pass the sources. */
  loadUi?(): Promise<EmbeddedUiModule>;
}

/** What the plugin needs from the bundled front ends (see `startEmbeddedWeb` in src/ui/index.tsx). */
export interface EmbeddedUiModule {
  NoAgentError: new (...args: never[]) => Error;
  startEmbeddedWeb(options: {
    agents: readonly CodingAgent[];
    agent?: string;
    cwd: string;
    model?: string;
    effort?: string;
    approveAll?: boolean;
    version: string;
    port?: number;
    frameAncestors: () => readonly string[];
  }): Promise<{
    url: string;
    controller: { submit(text: string): unknown; get(): { session: { agent: string } } };
    close(): Promise<void>;
  }>;
}

type Embedded = Awaited<ReturnType<EmbeddedUiModule['startEmbeddedWeb']>>;

const API = '/__genaicode';
const OVERLAY_ID = 'virtual:genaicode-overlay';
const MAX_BODY = 256 * 1024;

/**
 * `genaicode/vite`: the genaicode UI inside a Vite dev server. The page gets a wolf in the
 * corner that opens the chat with a coding agent working in the project, and its errors
 * (build errors, uncaught exceptions, console.error) go to the agent with one click.
 *
 * Only `vite dev`: builds are untouched. The UI runs on its own port on 127.0.0.1, so a dev
 * server started with `--host` does not expose the agent to the network.
 */
export function genaicode(options: GenaicodeViteOptions = {}): Plugin {
  let started: Promise<Embedded | undefined> | undefined;
  let base = '/';
  // Origins the app's pages were actually opened at (e.g. app.localhost), for frame-ancestors.
  const seen = new Set<string>();

  return {
    name: 'genaicode',
    apply: 'serve',

    configResolved(config) {
      base = config.base;
    },

    configureServer(server) {
      const log = server.config.logger;
      started = (async () => {
        const ui = await (options.loadUi ?? loadBundledUi)();
        try {
          return await ui.startEmbeddedWeb({
            agents: options.agents ?? defaultAgents(),
            agent: options.agent,
            cwd: server.config.root,
            model: options.model,
            effort: options.effort,
            approveAll: options.approveAll,
            version: packageVersion(),
            port: options.port,
            frameAncestors: () => pageOrigins(server, seen),
          });
        } catch (error) {
          if (!(error instanceof ui.NoAgentError)) throw error;
          log.warn(`[genaicode] ${error.message} The overlay is off.`);
          return undefined;
        }
      })().then(
        (ui) => {
          if (ui) log.info(`  ➜  genaicode: ${ui.controller.get().session.agent} in the page, or open ${ui.url}`);
          return ui;
        },
        (error: unknown) => {
          log.error(`[genaicode] The UI did not start: ${(error as Error).message}`);
          return undefined;
        },
      );

      server.middlewares.use(API, (req, res, next) => {
        handleApi(req, res, started, (origin) => seen.add(origin), !!server.config.server.https).catch(next);
      });
    },

    resolveId(id) {
      if (id === OVERLAY_ID) return `\0${OVERLAY_ID}`;
    },

    load(id) {
      if (id !== `\0${OVERLAY_ID}`) return;
      const config: OverlayConfig = { api: API, captureErrors: options.captureErrors ?? true };
      return `(${mountOverlay.toString()})(${JSON.stringify(config)}, import.meta.hot);\n`;
    },

    async transformIndexHtml() {
      if (!(await started)) return;
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: `${base}@id/__x00__${OVERLAY_ID}` },
          // First, so the app's own startup errors are caught too. Module scripts are deferred.
          injectTo: 'head-prepend',
        },
      ];
    },

    // Vite calls this when the dev server closes or restarts.
    async buildEnd() {
      const ui = await started;
      started = undefined;
      await ui?.close();
    },
  };
}

/** The dev server's own endpoints for the overlay: the UI link, and "fix these errors". */
async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  started: Promise<Embedded | undefined> | undefined,
  onPage: (origin: string) => void,
  https: boolean,
) {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  // Only this machine: with --host the dev server also answers the network, and Sec-Fetch-Site
  // is just a header a client there could send. Then only the app's own pages: another site
  // open in the browser must not read the UI's token or start the agent.
  if (!isLoopback(req.socket.remoteAddress)) return send(403, { error: 'this machine only' });
  if (req.headers['sec-fetch-site'] !== 'same-origin') return send(403, { error: 'same-origin only' });
  const ui = await started;
  if (!ui) return send(503, { error: 'genaicode is off; see the dev server terminal' });

  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && path === '/session') {
    const origin = pageOrigin(req.headers.host, https);
    if (origin) onPage(origin);
    return send(200, { url: ui.url, agent: ui.controller.get().session.agent });
  }
  if (req.method === 'POST' && path === '/fix') {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return send(415, { error: 'expected JSON' });
    }
    let prompt: string | undefined;
    try {
      prompt = fixPrompt(JSON.parse(await readBody(req)));
    } catch {
      prompt = undefined;
    }
    if (!prompt) return send(400, { error: 'bad request' });
    ui.controller.submit(prompt);
    return send(200, { ok: true });
  }
  send(404, { error: 'not found' });
}

const SOURCES: Record<string, string> = {
  vite: 'build error',
  error: 'uncaught error',
  rejection: 'unhandled rejection',
  console: 'console.error',
};

/** The prompt for "Fix N errors", or undefined when the body is not a list of errors. */
export function fixPrompt(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const { page, errors } = body as { page?: unknown; errors?: unknown };
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const items: string[] = [];
  for (const error of errors.slice(0, 20)) {
    if (!error || typeof error !== 'object') return undefined;
    const { source, message, stack } = error as Record<string, unknown>;
    if (typeof message !== 'string' || typeof source !== 'string' || !Object.hasOwn(SOURCES, source)) return undefined;
    const trace = typeof stack === 'string' && stack && !message.includes(stack) ? `\n${stack.slice(0, 4000)}` : '';
    items.push(`${items.length + 1}. [${SOURCES[source]}] ${message.slice(0, 4000)}${trace}`);
  }
  const where = typeof page === 'string' && /^https?:\/\//.test(page) ? ` at ${page.slice(0, 500)}` : '';
  return (
    `The app running in the Vite dev server${where} reports ${items.length === 1 ? 'this error' : 'these errors'} ` +
    `in the browser. Find the cause in the code and fix it.\n\n` +
    '```\n' +
    items.join('\n\n').replace(/```/g, "'''") +
    '\n```'
  );
}

/** 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6 addresses. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** The origin a same-origin request came from, by its Host header. */
function pageOrigin(host: string | undefined, https: boolean): string | undefined {
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[\da-f:.]+\](:\d+)?$/i.test(host)) return undefined;
  return `${https ? 'https' : 'http'}://${host.toLowerCase()}`;
}

/** Where the app's pages come from, allowed to show the UI in a frame. */
function pageOrigins(server: ViteDevServer, seen: ReadonlySet<string>): string[] {
  const urls = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])];
  const origins = new Set<string>(seen);
  for (const url of urls) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // Not a URL: skip it.
    }
  }
  if (origins.size === 0) {
    // Middleware mode, or not listening yet: any local port.
    for (const origin of ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*']) origins.add(origin);
  }
  return [...origins];
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('Request too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The front ends are bundled into dist/ui by scripts/build-ui.mjs; the path is kept opaque to tsc. */
function loadBundledUi(): Promise<EmbeddedUiModule> {
  const bundle: string = new URL('../ui/index.js', import.meta.url).href;
  return import(bundle) as Promise<EmbeddedUiModule>;
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require('../../package.json') as { version: string }).version;
}
