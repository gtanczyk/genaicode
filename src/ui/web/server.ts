import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isSandboxPolicy } from '../../agents/permissions.js';
import type { AgentResult, SandboxPolicy } from '../../agents/types.js';
import { artifactResponse } from '../../agents/artifacts.js';
import type { SessionListing } from '../../agents/sessions/index.js';
import type { AskDecision, PendingAsk } from '../../agents/sessions/answer.js';
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
  /**
   * Origins allowed to show the page in a frame (the Vite plugin's overlay). Read per request,
   * so it can grow once the host server knows its address. Default: none.
   */
  frameAncestors?: () => readonly string[];
  /**
   * Lists the sessions the agents keep (`listSessions`), for the page's Sessions view at
   * /api/sessions. `since` is epoch milliseconds. Without it the page has no such view.
   */
  sessions?: (query: { since?: number }) => Promise<WebSessionListing>;
  /** Run a turn in the named local session. Enabled only in the standalone tower. */
  sendPrompt?: (
    source: string,
    id: string,
    prompt: string,
    sandbox: SandboxPolicy | undefined,
    signal: AbortSignal,
  ) => Promise<AgentResult>;
  /** Answers a question a session holds open (`asks` of the listing), at POST /api/asks/<id>. */
  answer?: (id: string, decision: AskDecision) => Promise<boolean>;
  /** Archives sessions (`archived` false: brings them back), at POST /api/archive. */
  archive?: (sessions: Array<{ source: string; id: string }>, archived: boolean) => Promise<number>;
  /** Static files served at /assets/<name> without the token (the mascot and its bark). */
  assets?: ReadonlyMap<string, WebAsset>;
}

/**
 * `readable`: the sources (`SessionInfo.source`) whose sessions the chat can take over (`continue`).
 * `asks`: the questions held open for an answer from here.
 */
export type WebSessionListing = SessionListing & {
  readable?: string[];
  asks?: PendingAsk[];
  senders?: Array<{ agent: string; source: string; sandboxes: readonly SandboxPolicy[] }>;
};

export interface WebAsset {
  type: string;
  body: Buffer;
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
  /** Take over the session with this id (`ChatController.continueSession`). */
  | { type: 'continue'; id: string }
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
    case 'continue': {
      const id = text('id', 200);
      return id ? { type: 'continue', id } : undefined;
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
  const lifetime = new AbortController();
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
  const send = (
    res: ServerResponse,
    status: number,
    type: string,
    body: string,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
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
      const ancestors = options.frameAncestors?.() ?? [];
      return send(res, 200, 'text/html; charset=utf-8', pageHtml({ ...options.title, sessions: !!options.sessions }), {
        'content-security-policy': `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
      });
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', options.clientScript);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const asset = options.assets?.get(url.pathname.slice('/assets/'.length));
      if (!asset) return send(res, 404, 'text/plain', 'Not found');
      res.writeHead(200, {
        'content-type': asset.type,
        'content-length': asset.body.length,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      });
      return res.end(asset.body);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/artifacts/')) {
      // No token: the frame that shows an artifact would see it in its own URL. The id is
      // unguessable and opens that one artifact only.
      const found = controller.artifacts?.read(url.pathname.slice('/artifacts/'.length));
      if (!found) return send(res, 404, 'text/plain', 'Not found');
      const response = artifactResponse(found.artifact, found.body, { range: req.headers.range });
      res.writeHead(response.status, response.headers);
      return res.end(response.body);
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
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.sessions) return send(res, 404, 'application/json', '{"error":"no sessions here"}');
      const days = Number(url.searchParams.get('days'));
      const listing = await options.sessions(
        Number.isFinite(days) && days > 0 ? { since: Date.now() - Math.min(days, 3650) * 86_400_000 } : {},
      );
      return send(res, 200, 'application/json', JSON.stringify(listing));
    }
    const target = /^\/api\/sessions\/([^/]+)\/([^/]+)\/send$/.exec(url.pathname);
    if (req.method === 'POST' && target) {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.sendPrompt) return send(res, 404, 'application/json', '{"error":"no session sender here"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let source: string, id: string, prompt: string, sandbox: SandboxPolicy | undefined;
      try {
        source = decodeURIComponent(target[1]!);
        id = decodeURIComponent(target[2]!);
        const body = JSON.parse(await readBody(req));
        if (
          typeof body?.prompt !== 'string' ||
          !body.prompt.trim() ||
          body.prompt.length > 32_000 ||
          (body.sandbox !== undefined && !isSandboxPolicy(body.sandbox))
        )
          throw new Error();
        prompt = body.prompt;
        sandbox = body.sandbox;
      } catch {
        return send(res, 400, 'application/json', '{"error":"invalid session prompt or sandbox"}');
      }
      try {
        const result = await options.sendPrompt(source, id, prompt, sandbox, lifetime.signal);
        return send(
          res,
          result.ok ? 200 : 422,
          'application/json',
          JSON.stringify({ ok: result.ok, text: result.text, error: result.error }),
        );
      } catch (error) {
        return send(
          res,
          409,
          'application/json',
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        );
      }
    }
    const asked = /^\/api\/asks\/([a-f0-9]{12})$/.exec(url.pathname);
    if (req.method === 'POST' && asked) {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.answer) return send(res, 404, 'application/json', '{"error":"no questions here"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let decision: AskDecision | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { behavior?: unknown; message?: unknown };
        if (body.behavior === 'allow') decision = { behavior: 'allow' };
        else if (body.behavior === 'deny') {
          decision = { behavior: 'deny', ...(typeof body.message === 'string' ? { message: body.message } : {}) };
        }
      } catch {
        decision = undefined;
      }
      if (!decision) return send(res, 400, 'application/json', '{"error":"bad answer"}');
      const ok = await options.answer(asked[1]!, decision);
      return send(res, ok ? 200 : 409, 'application/json', JSON.stringify({ ok }));
    }
    if (req.method === 'POST' && url.pathname === '/api/archive') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.archive) return send(res, 404, 'application/json', '{"error":"no sessions here"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let request: { sessions: Array<{ source: string; id: string }>; archived: boolean } | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { sessions?: unknown; archived?: unknown };
        const sessions = Array.isArray(body.sessions) ? body.sessions : [];
        const valid = sessions.every(
          (one: unknown) =>
            typeof one === 'object' &&
            one !== null &&
            typeof (one as { source?: unknown }).source === 'string' &&
            typeof (one as { id?: unknown }).id === 'string',
        );
        if (valid && sessions.length && sessions.length <= 1000 && typeof body.archived === 'boolean') {
          request = {
            sessions: (sessions as Array<{ source: string; id: string }>).map(({ source, id }) => ({ source, id })),
            archived: body.archived,
          };
        }
      } catch {
        request = undefined;
      }
      if (!request) return send(res, 400, 'application/json', '{"error":"bad request"}');
      const changed = await options.archive(request.sessions, request.archived);
      return send(res, 200, 'application/json', JSON.stringify({ changed }));
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
      const ok = await run(controller, command);
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
        lifetime.abort();
        unsubscribe();
        if (pending) clearTimeout(pending);
        for (const stream of streams) stream.end();
        streams.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

async function run(controller: ChatController, command: WebCommand): Promise<boolean> {
  switch (command.type) {
    case 'submit':
      if (controller.submit(command.text, 'web') === 'quit') {
        controller.note('The browser UI keeps running until you stop genaicode in the terminal (Ctrl-C).');
      }
      return true;
    case 'stop':
      controller.stop();
      return true;
    case 'approve':
      return controller.approve(command.id, command.decision);
    case 'continue':
      return controller.continueSession(command.id);
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
