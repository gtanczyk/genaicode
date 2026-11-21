import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isSandboxPolicy } from '../../agents/permissions.js';
import { SessionSendError } from '../../agents/sessions/send.js';
import type { AgentResult, RateLimit, SandboxPolicy } from '../../agents/types.js';
import { publicPackRefusal, type PackAction } from '../../agents/pack.js';
import { artifactResponse } from '../../agents/artifacts.js';
import type { SessionListing } from '../../agents/sessions/index.js';
import type { AgentShares } from '../../agents/sessions/shares.js';
import type { AskDecision, PendingAsk } from '../../agents/sessions/answer.js';
import type { ChatController } from '../controller.js';
import type { TowerDecision } from '../../agents/sessions/tower.js';
import { pageHtml } from './page.js';
import { parseShell, parseSlash, withAttached } from '../format.js';
import { MAX_UPLOAD_BYTES, type Upload, type Uploads } from '../uploads.js';

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
  /**
   * How much of each agent's plan is used, as last seen (`knownLimits`), at GET /api/limits: the
   * page shows the chosen agent's when its session reported none yet.
   */
  limits?: () => Promise<Array<RateLimit & { agent: string }>>;
  /**
   * Which topics each agent's work went to since `since` (`topicShares`), at GET /api/shares: the
   * start screen shows it beside the plan limits.
   */
  shares?: (query: { since: number }) => Promise<AgentShares[]>;
  /** Answers a question a session holds open (`asks` of the listing), at POST /api/asks/<id>. */
  answer?: (id: string, decision: AskDecision) => Promise<boolean>;
  /** Archives sessions (`archived` false: brings them back), at POST /api/archive. */
  archive?: (sessions: Array<{ source: string; id: string }>, archived: boolean) => Promise<number>;
  /**
   * Where files the user attaches are kept (`createUploads`), at POST /api/upload: a prompt sent
   * with their ids names their paths to the agent. Without it the page takes text only.
   */
  uploads?: Uploads;
  /** Static files served at /assets/<name> without the token (the mascot and its bark). */
  assets?: ReadonlyMap<string, WebAsset>;
}

/**
 * `readable`: the sources (`SessionInfo.source`) whose sessions the chat can take over (`continue`).
 * `asks`: the questions held open for an answer from here. `topics`: what the view groups by.
 */
export type WebSessionListing = SessionListing & {
  readable?: string[];
  asks?: PendingAsk[];
  senders?: Array<{ agent: string; source: string; sandboxes: readonly SandboxPolicy[] }>;
  /** The topics kept by `genaicode topics`, and the topic id of each listed session by `source:id`. */
  topics?: Array<{ id: string; name: string }>;
  topicOf?: Record<string, string>;
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
  /** `files`: ids of uploads (POST /api/upload) that go with the prompt. */
  | { type: 'submit'; text: string; files?: string[] }
  | { type: 'stop' }
  | { type: 'approve'; id: string; decision: 'approve' | 'deny' }
  | { type: 'tower'; id: string; decision: TowerDecision }
  | { type: 'pack-task'; turnId: number; id: string; action: PackAction }
  /** Take over the session with this id (`ChatController.continueSession`). */
  | { type: 'continue'; id: string }
  | { type: 'agent'; name: string }
  | { type: 'model'; model: string };

const MAX_BODY = 64 * 1024;
/** Most files on one prompt. */
export const MAX_FILES = 8;
/** Cap on port-scoped cookies left on the host so repeated random-port runs do not bloat Cookie headers. */
const MAX_PORT_COOKIES = 8;

function secretOk(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionCookies(cookieHeader: string | undefined, currentName: string, secret: string): string[] {
  const headers = [`${currentName}=${secret}; HttpOnly; SameSite=Lax; Path=/`];
  const others: string[] = [];
  for (const part of (cookieHeader ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== currentName && /^genaicode_\d+$/.test(name) && !others.includes(name)) others.push(name);
  }
  for (const stale of others.slice(0, Math.max(0, others.length - (MAX_PORT_COOKIES - 1)))) {
    headers.push(`${stale}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }
  return headers;
}

export function parseCommand(value: unknown): WebCommand | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const command = value as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof command[key] === 'string' && (command[key] as string).length <= max ? (command[key] as string) : undefined;
  switch (command.type) {
    case 'submit': {
      const body = text('text', 32_000);
      if (body === undefined) return undefined;
      const { files } = command;
      if (files === undefined) return { type: 'submit', text: body };
      if (!Array.isArray(files) || files.length > MAX_FILES || !files.every((id) => typeof id === 'string')) {
        return undefined;
      }
      return { type: 'submit', text: body, files: files as string[] };
    }
    case 'stop':
      return { type: 'stop' };
    case 'pack-task': {
      const { turnId, action } = command;
      const id = text('id', 200);
      if (
        !id ||
        typeof turnId !== 'number' ||
        !Number.isSafeInteger(turnId) ||
        turnId < 1 ||
        !action ||
        typeof action !== 'object'
      )
        return undefined;
      const { type, text: input } = action as Record<string, unknown>;
      if (type === 'steer' && typeof input === 'string' && input.trim() && input.length <= 32_000)
        return { type: 'pack-task', turnId, id, action: { type, text: input } };
      if (type === 'merge' || type === 'diff') {
        const { revision } = action as Record<string, unknown>;
        if (
          revision !== undefined &&
          (typeof revision !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision))
        )
          return undefined;
        return { type: 'pack-task', turnId, id, action: { type, ...(revision ? { revision } : {}) } };
      }
      if (type === 'stop' || type === 'discard' || type === 'review' || type === 'verify')
        return { type: 'pack-task', turnId, id, action: { type } };
      return undefined;
    }
    case 'tower': {
      const id = text('id', 1024);
      const decision = command.decision;
      if (!id || (decision !== 'send' && decision !== 'dismiss' && decision !== 'approve' && decision !== 'deny'))
        return undefined;
      return { type: 'tower', id, decision };
    }
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
  // Separate secret for the reload-shell cookie only; cookies are shared across ports on the host,
  // so this cookie never authorizes /api/* endpoints and never returns cwd/session metadata.
  const pageCookieSecret = randomBytes(32).toString('hex');
  const streams = new Set<ServerResponse>();
  const lifetime = new AbortController();
  let port = 0;

  const allowedHost = (header: string | undefined) => {
    if (!header) return false;
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`].includes(header);
  };
  const cookieName = () => `genaicode_${port}`;
  const tokenOk = (candidate: string | null | undefined) => secretOk(candidate, token);
  const cookieOk = (req: IncomingMessage) => {
    const header = req.headers.cookie;
    if (!header) return false;
    const expectedName = cookieName();
    let ok = false;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === expectedName && secretOk(part.slice(eq + 1).trim(), pageCookieSecret)) ok = true;
    }
    return ok;
  };
  const send = (
    res: ServerResponse,
    status: number,
    type: string,
    body: string,
    headers: Record<string, string | string[]> = {},
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
      const ancestors = options.frameAncestors?.() ?? [];
      const inFrame = ancestors.length > 0 || req.headers['sec-fetch-dest'] === 'iframe';
      const queryToken = url.searchParams.get('token');
      if (queryToken !== null) {
        if (!tokenOk(queryToken)) {
          return send(res, 403, 'text/plain', 'Open the link genaicode printed in your terminal (it carries a token).');
        }
        return send(
          res,
          200,
          'text/html; charset=utf-8',
          pageHtml({ ...options.title, sessions: !!options.sessions, stripToken: !inFrame }),
          {
            'content-security-policy': `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
            ...(inFrame ? {} : { 'set-cookie': sessionCookies(req.headers.cookie, cookieName(), pageCookieSecret) }),
          },
        );
      }
      if (!cookieOk(req)) {
        return send(res, 403, 'text/plain', 'Open the link genaicode printed in your terminal (it carries a token).');
      }
      // Reload shell only: holds no cwd or session metadata because cookies are shared across ports on the host.
      return send(res, 200, 'text/html; charset=utf-8', pageHtml({ version: options.title.version, cwd: '' }), {
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
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      // No token, as for artifacts: the id is unguessable and shows that one image only.
      const found = options.uploads?.image(url.pathname.slice('/uploads/'.length));
      if (!found) return send(res, 404, 'text/plain', 'Not found');
      res.writeHead(200, {
        'content-type': found.type,
        'content-length': found.body.length,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
      });
      return res.end(found.body);
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.uploads) return send(res, 404, 'application/json', '{"error":"no uploads"}');
      const name = (url.searchParams.get('name') ?? '').slice(0, 200) || 'file';
      let body: Buffer;
      try {
        body = await readBytes(req, MAX_UPLOAD_BYTES);
      } catch {
        controller.note(`Not attached: ${name} is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 'error');
        // The rest of the body is not read.
        res.setHeader('connection', 'close');
        return send(res, 413, 'application/json', '{"error":"too large"}');
      }
      const kept = options.uploads.save(name, body);
      return send(res, 200, 'application/json', JSON.stringify({ id: kept.id, name: kept.name, size: kept.size }));
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const header = req.headers['x-genaicode-token'];
      const candidate =
        header !== undefined ? (typeof header === 'string' ? header : null) : url.searchParams.get('token');
      if (!tokenOk(candidate)) return send(res, 403, 'text/plain', 'Bad token');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        connection: 'keep-alive',
      });
      res.write(`event: view\ndata: ${JSON.stringify(controller.get())}\n\n`);
      res.write(
        `event: config\ndata: ${JSON.stringify({ cwd: options.title.cwd, sessions: !!options.sessions, uploads: !!options.uploads })}\n\n`,
      );
      streams.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(ping);
        streams.delete(res);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/limits') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      const limits = options.limits ? await options.limits().catch(() => []) : [];
      return send(res, 200, 'application/json', JSON.stringify({ limits }));
    }
    if (req.method === 'GET' && url.pathname === '/api/shares') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      const days = Number(url.searchParams.get('days'));
      const since = Date.now() - (Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 7) * 86_400_000;
      const shares = options.shares ? await options.shares({ since }).catch(() => []) : [];
      return send(res, 200, 'application/json', JSON.stringify({ shares }));
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
        if (!result.ok) return send(res, 422, 'application/json', '{"error":"The agent could not finish this turn."}');
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, text: result.text }));
      } catch (error) {
        if (error instanceof SessionSendError)
          return send(
            res,
            error.reason === 'missing' ? 404 : 409,
            'application/json',
            JSON.stringify({ error: error.publicMessage }),
          );
        return send(res, 500, 'application/json', '{"error":"Could not send the session prompt."}');
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
      if (command.type === 'pack-task') {
        if (!controller.session.actOnPackTask)
          return send(res, 404, 'application/json', '{"ok":false,"error":"Pack controls are unavailable."}');
        try {
          const text = await controller.session.actOnPackTask(command.turnId, command.id, command.action);
          return send(res, 200, 'application/json', JSON.stringify({ ok: true, text }));
        } catch (error) {
          const refusal = publicPackRefusal(error);
          if (refusal)
            return send(
              res,
              refusal.reason === 'missing' ? 404 : 409,
              'application/json',
              JSON.stringify({ ok: false, error: refusal.message }),
            );
          return send(res, 500, 'application/json', '{"ok":false,"error":"Could not run the pack task action."}');
        }
      }
      let files: Upload[] = [];
      if (command.type === 'submit' && command.files?.length) {
        const found = command.files.map((id) => options.uploads?.find(id));
        if (found.some((one) => !one)) return send(res, 400, 'application/json', '{"error":"unknown file"}');
        files = found as Upload[];
      }
      const ok = await run(controller, command, files);
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

async function run(
  controller: ChatController,
  command: Exclude<WebCommand, { type: 'pack-task' }>,
  files: readonly Upload[] = [],
): Promise<boolean> {
  switch (command.type) {
    case 'submit': {
      // A command is the host's, not the agent's: nothing there would read the files.
      const own = parseShell(command.text) !== undefined || parseSlash(command.text) !== undefined;
      if (own && files.length) controller.note('Files go with a prompt, not with a command: they were not sent.');
      const text = own
        ? command.text
        : withAttached(
            command.text,
            files.map((file) => file.path),
          );
      if (controller.submit(text, 'web') === 'quit') {
        controller.note('The browser UI keeps running until you stop genaicode in the terminal (Ctrl-C).');
      }
      return true;
    }
    case 'stop':
      controller.stop();
      return true;
    case 'approve':
      return controller.approve(command.id, command.decision);
    case 'tower':
      return controller.decideTower(command.id, command.decision);
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
  return (await readBytes(req, MAX_BODY)).toString('utf8');
}

async function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > max) throw new Error('Request too large');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error('Request too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
