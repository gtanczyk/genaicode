import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { collectEarlyErrors, mountOverlay, type OverlayConfig } from './client.js';

/**
 * The server side of the dev overlay (the wolf in the page's corner), shared by the Vite
 * plugin (`genaicode/vite`) and `createDevOverlay` (`genaicode/ui`) for any other dev server.
 */

/** Where the overlay's endpoints live on the dev server. */
export const API = '/__genaicode';
const MAX_BODY = 256 * 1024;

/** The genaicode UI the overlay shows: what `startEmbeddedWeb` returns. */
export interface OverlayUi {
  url: string;
  controller: { submit(text: string): unknown; get(): { session: { agent: string } } };
  close(): Promise<void>;
}

export interface OverlayLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Start the UI for the overlay. Never rejects: without an agent CLI, or when the UI fails to
 * start, it says so in the log and resolves to undefined, and the app runs on without it.
 */
export async function startOverlayUi<Ui extends OverlayUi>(
  start: () => Promise<Ui>,
  log: OverlayLog,
): Promise<Ui | undefined> {
  try {
    const ui = await start();
    log.info(`  ➜  genaicode: ${ui.controller.get().session.agent} in the page, or open ${ui.url}`);
    return ui;
  } catch (error) {
    // By name: the error class lives in the lazily loaded UI bundle.
    if ((error as Error | undefined)?.name === 'NoAgentError') {
      log.warn(`[genaicode] ${(error as Error).message} The overlay is off.`);
    } else {
      log.error(`[genaicode] The UI did not start: ${(error as Error | undefined)?.message ?? String(error)}`);
    }
    return undefined;
  }
}

/** The overlay for a dev server: its routes, and the tag that puts it in a page. */
export interface Overlay<Ui extends OverlayUi = OverlayUi> {
  /** The chat once it runs; undefined when no agent CLI is installed or it failed (see `log`). */
  readonly ready: Promise<Ui | undefined>;
  /**
   * Answers the overlay's routes under `/__genaicode/`; resolves to false for anything else,
   * so the server goes on to its own routes. Mount it before them.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** `handle` as Express / Connect middleware. */
  middleware(req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void;
  /**
   * The overlay's tags for the app's HTML: an inline error collector for the page's own
   * scripts, then `<script type="module" src="/__genaicode/overlay.js">`.
   */
  readonly script: string;
  /** Adds `script` to an HTML page, as early as possible; unchanged when the overlay is off. */
  injectHtml(html: string): string;
  close(): Promise<void>;
}

/**
 * The overlay for any Node dev server (`createDevOverlay` in src/ui.ts). `start` gets the
 * origins that may frame the chat: the app's pages that asked for the session.
 */
export function createOverlay<Ui extends OverlayUi>(
  start: (frameAncestors: () => readonly string[]) => Promise<Ui>,
  { captureErrors, log }: { captureErrors: boolean; log: OverlayLog },
): Overlay<Ui> {
  const seen = new Set<string>();
  let ui: Promise<Ui | undefined> | undefined = startOverlayUi(() => start(() => [...seen]), log);
  let off = false;
  void ui.then((started) => (off = !started));
  // The page's classic scripts run before any module: an inline collector keeps their errors.
  const script =
    (captureErrors ? `<script>(${collectEarlyErrors.toString()})()</script>` : '') +
    `<script type="module" src="${API}/overlay.js"></script>`;
  const handle = (req: IncomingMessage, res: ServerResponse) =>
    handleOverlayRequest(req, res, {
      ui,
      onPage: (origin) => seen.add(origin),
      overlay: { api: API, captureErrors },
      loopbackHosts: true,
    });
  return {
    get ready() {
      return ui ?? Promise.resolve(undefined);
    },
    handle,
    middleware(req, res, next) {
      handle(req, res).then((done) => done || next(), next);
    },
    script,
    injectHtml(html) {
      if (off || html.includes(script)) return html;
      // In <head> (else <body>, else <html>), so it loads before the app's own modules.
      const open = ['head', 'body', 'html']
        .map((tag) => new RegExp(`<${tag}(\\s[^>]*)?>`, 'i').exec(html))
        .find((match) => match);
      const at = open ? open.index + open[0].length : 0;
      return html.slice(0, at) + script + html.slice(at);
    },
    async close() {
      const started = await ui;
      ui = undefined;
      off = true;
      await started?.close();
    },
  };
}

export interface OverlayRequestContext {
  /** The UI, or undefined when it is off. */
  ui: Promise<OverlayUi | undefined> | undefined;
  /** Called with the origin of each app page that asks for the session, for frame-ancestors. */
  onPage(origin: string): void;
  /** Serve the overlay module at `/__genaicode/overlay.js` with these settings. */
  overlay: OverlayConfig;
  /** Whether the app is served over https. Default: whether this request came over TLS. */
  https?: boolean;
  /**
   * Hand the UI's token only to pages opened at a loopback name (localhost, *.localhost,
   * 127.0.0.1, [::1]), which stops DNS-rebinding pages. Vite checks the Host itself.
   */
  loopbackHosts: boolean;
}

/**
 * The overlay's endpoints: the overlay module, the UI link, and "fix these errors". Resolves
 * to false for any other URL, so the dev server goes on to its own routes.
 */
export async function handleOverlayRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: OverlayRequestContext,
): Promise<boolean> {
  const path = (req.url ?? '/').split('?')[0];
  if (path !== API && !path.startsWith(`${API}/`)) return false;
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
    return true;
  };

  // The overlay itself holds nothing secret.
  if (req.method === 'GET' && path === `${API}/overlay.js`) {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(overlayModule(context.overlay));
    return true;
  }

  // Only this machine: a dev server listening beyond loopback also answers the network, and
  // Sec-Fetch-Site is just a header a client there could send. Then only the app's own pages:
  // another site open in the browser must not read the UI's token or start the agent.
  if (!isLoopback(req.socket.remoteAddress)) return send(403, { error: 'this machine only' });
  if (context.loopbackHosts && !isLoopbackHost(req.headers.host)) return send(403, { error: 'localhost only' });
  if (req.headers['sec-fetch-site'] !== 'same-origin') return send(403, { error: 'same-origin only' });
  const ui = await context.ui;
  if (!ui) return send(503, { error: 'genaicode is off; see the dev server terminal' });

  if (req.method === 'GET' && path === `${API}/session`) {
    const origin = pageOrigin(req.headers.host, context.https ?? !!(req.socket as TLSSocket).encrypted);
    if (origin) context.onPage(origin);
    return send(200, { url: ui.url, agent: ui.controller.get().session.agent });
  }
  if (req.method === 'POST' && path === `${API}/fix`) {
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
  return send(404, { error: 'not found' });
}

/** The overlay as an ES module. `hot` is the expression for Vite's HMR client, if any. */
export function overlayModule(config: OverlayConfig, hot = 'undefined'): string {
  return `(${mountOverlay.toString()})(${JSON.stringify(config)}, ${hot});\n`;
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
    `The app running in the dev server${where} reports ${items.length === 1 ? 'this error' : 'these errors'} ` +
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

/** A Host header naming this machine: localhost, *.localhost, 127.x.x.x or [::1], any port. */
export function isLoopbackHost(host: string | undefined): boolean {
  const match = /^(\[::1\]|[\w.-]+)(:\d+)?$/.exec(host ?? '');
  if (!match) return false;
  const name = match[1].toLowerCase();
  return name === '[::1]' || name === 'localhost' || name.endsWith('.localhost') || isLoopback(name);
}

/** The origin a same-origin request came from, by its Host header. */
export function pageOrigin(host: string | undefined, https: boolean): string | undefined {
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[\da-f:.]+\](:\d+)?$/i.test(host)) return undefined;
  return `${https ? 'https' : 'http'}://${host.toLowerCase()}`;
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
