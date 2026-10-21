import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppAgentError, type AppAgent } from './app-agent.js';
import type { AppAgentMode } from './state.js';
import { handleMcpMessage } from './mcp.js';

export interface AppAgentHandlerOptions {
  /** Where the routes live. Default `/api/agent`. The MCP endpoint is `<basePath>/mcp`. */
  basePath?: string;
  /**
   * The app's own check that the request comes from its signed-in user (a session cookie).
   * Runs for every route but the MCP endpoint, which takes the agent's bearer instead.
   * Without it the server must be on loopback: requests whose `Host` is not `localhost`,
   * `127.0.0.1` or `[::1]` (or one of `allowedHosts`) are refused, which stops DNS rebinding.
   */
  authorize?(req: IncomingMessage): boolean | Promise<boolean>;
  /** Extra `Host` names accepted without `authorize`, e.g. `myapp.localhost`. */
  allowedHosts?: readonly string[];
  /** MCP `serverInfo`. Default `{ name: agent.serverName, version: '1.0.0' }`. */
  serverInfo?: { name: string; version: string };
}

/** Handles one request; resolves false when the path is not the agent's, so the app can go on. */
export interface AppAgentHandler {
  (req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<boolean>;
  /** End the open event streams, so the server can close. */
  close(): void;
}

const MAX_BODY = 256 * 1024;

/**
 * Serve an app agent over HTTP, for any Node server (node:http, Express, Connect, Fastify
 * with `reply.hijack()`, a Vite middleware). Routes under `basePath`:
 *
 * - `GET  /state`, `GET /events` (server-sent `AppAgentState` snapshots)
 * - `POST /send {text}`, `/stop`, `/reset`, `/config {agent?, mode?}`, `/view {path}`
 * - `POST /actions/:id {decision: 'approve' | 'reject'}`, `GET /actions/:id/changes`
 * - `POST /approvals/:id {decision: 'approve' | 'deny'}`: the agent CLI's own permission prompts
 * - `POST /mcp`: the agent's MCP endpoint (bearer `agent.mcpToken`; browser requests refused)
 *
 * Requests another site started are refused (`Sec-Fetch-Site`, `Origin`).
 */
export function createAppAgentHandler(agent: AppAgent, options: AppAgentHandlerOptions = {}): AppAgentHandler {
  const base = (options.basePath ?? '/api/agent').replace(/\/$/, '');
  const serverInfo = options.serverInfo ?? { name: agent.serverName, version: '1.0.0' };
  const streams = new Set<ServerResponse>();

  const handle = async (req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return false;
    const route = url.pathname.slice(base.length) || '/';
    const method = req.method ?? 'GET';

    try {
      if (route === '/mcp') {
        // Only the agent CLI calls this; a browser always sends Origin on POST.
        if (req.headers.origin !== undefined) return json(res, 403, { error: 'forbidden' });
        if (!bearerOk(req.headers.authorization, agent.mcpToken)) return json(res, 401, { error: 'bad token' });
        if (method !== 'POST') return json(res, 405, { error: 'POST only' });
        const message = await readJson(req);
        // Again after the body: the session may have been dropped while it arrived.
        if (!bearerOk(req.headers.authorization, agent.mcpToken)) return json(res, 401, { error: 'bad token' });
        const response = await handleMcpMessage(message, agent.mcpTools(), serverInfo);
        if (response === null) {
          res.writeHead(202).end();
          return true;
        }
        return json(res, 200, response);
      }

      if (crossSite(req)) return json(res, 403, { error: 'cross-site request' });
      if (!options.authorize && !loopbackHost(req.headers.host, options.allowedHosts)) {
        return json(res, 403, { error: 'unknown host' });
      }
      if (options.authorize && !(await options.authorize(req))) return json(res, 403, { error: 'forbidden' });

      if (method === 'GET' && route === '/state') return json(res, 200, agent.get());
      if (method === 'GET' && route === '/events') {
        events(req, res, agent, streams);
        return true;
      }
      if (method === 'GET') {
        const changes = /^\/actions\/([^/]+)\/changes$/.exec(route);
        if (changes) return json(res, 200, await agent.changes(decodeURIComponent(changes[1]!)));
        return json(res, 404, { error: 'not found' });
      }
      if (method !== 'POST') return json(res, 405, { error: 'method not allowed' });

      const body = await readJson(req);
      const field = (name: string) =>
        body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;
      switch (route) {
        case '/send':
          agent.send(String(field('text') ?? ''));
          break;
        case '/stop':
          agent.stop();
          break;
        case '/reset':
          agent.reset();
          break;
        case '/config': {
          const name = field('agent');
          const mode = field('mode');
          agent.configure({
            ...(typeof name === 'string' ? { agent: name } : {}),
            ...(typeof mode === 'string' ? { mode: mode as AppAgentMode } : {}),
          });
          break;
        }
        case '/view': {
          const path = field('path');
          if (typeof path !== 'string' || path.length > 500) return json(res, 400, { error: 'path required' });
          agent.setView(path);
          res.writeHead(204).end();
          return true;
        }
        default: {
          const approval = /^\/approvals\/([^/]+)$/.exec(route);
          if (approval) {
            const answer = field('decision');
            if (answer !== 'approve' && answer !== 'deny') {
              return json(res, 400, { error: 'decision must be approve or deny' });
            }
            agent.approve(decodeURIComponent(approval[1]!), answer);
            break;
          }
          const action = /^\/actions\/([^/]+)$/.exec(route);
          const decision = field('decision');
          if (!action) return json(res, 404, { error: 'not found' });
          if (decision !== 'approve' && decision !== 'reject') {
            return json(res, 400, { error: 'decision must be approve or reject' });
          }
          agent.decide(decodeURIComponent(action[1]!), decision);
        }
      }
      return json(res, 200, agent.get());
    } catch (error) {
      const status = error instanceof AppAgentError ? error.status : error instanceof BadRequest ? 400 : 500;
      return json(res, status, { error: (error as Error).message });
    }
  };
  return Object.assign(handle, {
    close() {
      for (const stream of streams) stream.end();
      streams.clear();
    },
  });
}

class BadRequest extends Error {}

function events(req: IncomingMessage, res: ServerResponse, agent: AppAgent, streams: Set<ServerResponse>) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify(agent.get())}\n\n`);
  let timer: NodeJS.Timeout | null = null;
  // Streamed text changes the state per token; send the latest every 100 ms at most.
  const unsubscribe = agent.subscribe(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(agent.get())}\n\n`);
    }, 100);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  streams.add(res);
  const end = () => {
    streams.delete(res);
    unsubscribe();
    clearInterval(ping);
    if (timer) clearTimeout(timer);
  };
  req.on('close', end);
  res.on('close', end);
}

// A page on another site (or another local dev server) must not drive the agent.
function crossSite(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.origin;
  if (origin === undefined || req.method === 'GET') return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

// Without app auth, only a loopback name may reach the agent: a rebinding domain that resolves
// to 127.0.0.1 still sends its own name as Host.
function loopbackHost(host: string | undefined, allowed: readonly string[] = []): boolean {
  if (!host) return false;
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name === '127.0.0.1' ||
    name === '[::1]' ||
    allowed.includes(name)
  );
}

function bearerOk(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice('Bearer '.length));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}

// Frameworks that already parsed the body leave it on `req.body`.
async function readJson(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) return req.body;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new BadRequest('request too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('expected JSON');
  }
}
