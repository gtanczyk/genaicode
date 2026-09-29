import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatController } from '../controller.js';
import { pageHtml } from './page.js';

export interface WebUiOptions {
  controller: ChatController;
  /** The bundled browser script served at /app.js. */
  clientScript: string;
  /** Shown in the page header. */
  title: { version: string; cwd: string };
  /** Default 127.0.0.1. The UI can run any command through the agent, so keep it local. */
  host?: string;
  /** Default 0 (a free port). */
  port?: number;
  /** Fixed access token, for tests. Default: 32 random bytes. */
  token?: string;
}

export interface WebUi {
  /** Open this in a browser; it carries the access token. */
  url: string;
  close(): Promise<void>;
}

/** What the browser can ask for. Anything else is rejected with 400. */
export type WebCommand =
  | { type: 'submit'; text: string }
  | { type: 'stop' }
  | { type: 'approve'; id: string; decision: 'approve' | 'deny' }
  | { type: 'agent'; name: string }
  | { type: 'model'; model: string };

const MAX_BODY = 64 * 1024;

export function parseCommand(value: unknown): WebCommand | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const command = value as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof command[key] === 'string' && (command[key] as string).length <= max ? (command[key] as string) : undefined;
  switch (command.type) {
    case 'submit': {
      const body = text('text', 32_000);
      return body === undefined ? undefined : { type: 'submit', text: body };
    }
    case 'stop':
      return { type: 'stop' };
    case 'approve': {
      const id = text('id', 200);
      const decision = command.decision;
      if (id === undefined || (decision !== 'approve' && decision !== 'deny')) return undefined;
      return { type: 'approve', id, decision };
    }
    case 'agent': {
      const name = text('name', 100);
      return name === undefined ? undefined : { type: 'agent', name };
    }
    case 'model': {
      const model = text('model', 200);
      return model === undefined ? undefined : { type: 'model', model };
    }
    default:
      return undefined;
  }
}

/** Serve the chat in a browser: one page, a server-sent event stream of views, and a command endpoint. */
export async function startWebUi(options: WebUiOptions): Promise<WebUi> {
  const { controller } = options;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? randomBytes(32).toString('hex');
  const streams = new Set<ServerResponse>();
  let port = 0;

  const allowedHost = (header: string | undefined) => {
    if (!header) return false;
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`].includes(header);
  };
  const tokenOk = (candidate: string | null | undefined) => {
    if (!candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const send = (res: ServerResponse, status: number, type: string, body: string) => {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(body);
  };

  let pending: NodeJS.Timeout | undefined;
  // Coalesce bursts of changes (streamed text) into one message carrying the latest view.
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      const data = `event: view\ndata: ${JSON.stringify(controller.get())}\n\n`;
      for (const stream of streams) stream.write(data);
    }, 40);
  };
  const unsubscribe = controller.subscribe(broadcast);

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!allowedHost(req.headers.host)) return send(res, 403, 'text/plain', 'Forbidden host');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      if (!tokenOk(url.searchParams.get('token'))) {
        return send(res, 403, 'text/plain', 'Open the link genaicode printed in your terminal (it carries a token).');
      }
      return send(res, 200, 'text/html; charset=utf-8', pageHtml(options.title));
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', options.clientScript);
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      if (!tokenOk(url.searchParams.get('token'))) return send(res, 403, 'text/plain', 'Bad token');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`event: view\ndata: ${JSON.stringify(controller.get())}\n\n`);
      streams.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(ping);
        streams.delete(res);
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/command') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let command: WebCommand | undefined;
      try {
        command = parseCommand(JSON.parse(await readBody(req)));
      } catch {
        command = undefined;
      }
      if (!command) return send(res, 400, 'application/json', '{"error":"bad command"}');
      const ok = run(controller, command);
      return send(res, 200, 'application/json', JSON.stringify({ ok }));
    }
    send(res, 404, 'text/plain', 'Not found');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'text/plain', 'Server error');
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;

  return {
    url: `http://${shown}:${port}/?token=${token}`,
    close: () =>
      new Promise((resolve) => {
        unsubscribe();
        if (pending) clearTimeout(pending);
        for (const stream of streams) stream.end();
        streams.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

function run(controller: ChatController, command: WebCommand): boolean {
  switch (command.type) {
    case 'submit':
      if (controller.submit(command.text) === 'quit') {
        controller.note('The browser UI keeps running until you press Ctrl-C where you started "genaicode ui".');
      }
      return true;
    case 'stop':
      controller.stop();
      return true;
    case 'approve':
      return controller.approve(command.id, command.decision);
    case 'agent':
      return controller.selectAgent(command.name);
    case 'model':
      controller.setModel(command.model.trim() || undefined);
      return true;
  }
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
