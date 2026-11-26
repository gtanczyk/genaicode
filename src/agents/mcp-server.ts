import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleMcpMessage, rpcError, type McpSkill, type McpTool } from './mcp-tools.js';
import type { McpServer } from './types.js';

export interface LocalMcpServerOptions {
  /** MCP server name the agent sees. */
  name: string;
  tools: readonly McpTool[];
  /** When to use the tools, in a sentence or two: sent with `initialize`, for the agent's model. */
  instructions?: string;
  /** Skills served beside the tools, to agents that speak MCP 2026-07-28. */
  skills?: readonly McpSkill[];
  /** Largest request body, in bytes. Default 1 MiB. */
  maxBody?: number;
}

export interface LocalMcpServer {
  /** Give this to the agent in `AgentTask.mcpServers`. */
  mcpServer: McpServer;
  close(): Promise<void>;
}

/**
 * Serve `tools` over MCP (streamable HTTP, JSON responses) on a random loopback port, behind a
 * random bearer token.
 */
export function startLocalMcpServer({ tools, ...options }: LocalMcpServerOptions): Promise<LocalMcpServer> {
  return startScopedLocalMcpServer(options, () => tools);
}

/** Resolve tools for each authenticated request. A revoked turn returns undefined. */
export async function startScopedLocalMcpServer(
  options: Omit<LocalMcpServerOptions, 'tools'>,
  toolsForRequest: (target: string) => readonly McpTool[] | undefined,
) {
  const { name, instructions, skills } = options;
  const expected = Buffer.from(`Bearer ${randomBytes(32).toString('hex')}`);
  const maxBody = options.maxBody ?? 1024 * 1024;
  let port = 0;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const reply = (status: number, body?: unknown) => {
      if (response.headersSent || response.destroyed) return;
      if (body === undefined) response.writeHead(status).end();
      else response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    // A rebinding domain sends its own name as Host; a browser always sends Origin on POST.
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '')) return reply(403);
    if (request.headers.origin !== undefined) return reply(403);
    const given = Buffer.from(request.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reply(401);
    const target = request.url ?? '';
    if (request.method !== 'POST' || target.split('?')[0] !== '/mcp') return reply(405);
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) {
        reply(413);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', () => reply(400));
    request.once('end', () => {
      let message: unknown;
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      }
      const available = toolsForRequest(target);
      if (!available) return reply(404);
      const acceptsSse = /\btext\/event-stream\b/i.test(request.headers.accept ?? '');
      let sse = false;
      const writeEvent = (payload: object) => {
        if (response.destroyed || response.writableEnded) return;
        if (!sse) {
          if (response.headersSent) return;
          sse = true;
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          response.flushHeaders?.();
        }
        response.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      handleMcpMessage(
        message,
        available,
        {
          name: `genaicode-${name}`,
          version: '1',
          ...(instructions ? { instructions } : {}),
          ...(skills ? { skills } : {}),
        },
        undefined,
        acceptsSse ? writeEvent : undefined,
      )
        .then((answer) => {
          if (sse) {
            if (answer !== null) writeEvent(answer);
            if (!response.destroyed && !response.writableEnded) response.end();
          } else {
            if (answer === null) reply(202);
            else reply(200, answer);
          }
        })
        .catch(() => {
          if (sse) {
            const id = (message as { id?: unknown })?.id;
            writeEvent(
              rpcError(typeof id === 'string' || typeof id === 'number' ? id : null, -32603, 'Internal error'),
            );
            if (!response.destroyed && !response.writableEnded) response.end();
          } else {
            reply(500);
          }
        });
    });
  });
  // A tool may hold its answer for minutes (waiting on other agents).
  server.requestTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  server.unref();

  return {
    mcpServer: { name, url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: expected.toString() } },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** One listener per tool family, with revocable capabilities for each chat. */
export function scopedMcpServers() {
  const scopes = new Map<string, readonly McpTool[]>();
  const servers = new Map<string, ReturnType<typeof startScopedLocalMcpServer>>();
  const open = async ({ tools, ...options }: LocalMcpServerOptions): Promise<LocalMcpServer> => {
    let pending = servers.get(options.name);
    if (!pending) {
      pending = startScopedLocalMcpServer(options, (target) => scopes.get(options.name + ':' + target));
      servers.set(options.name, pending);
      pending.catch(() => servers.delete(options.name));
    }
    const server = await pending;
    const url = new URL(server.mcpServer.url);
    url.searchParams.set('scope', randomBytes(24).toString('hex'));
    const key = options.name + ':' + url.pathname + url.search;
    scopes.set(key, tools);
    return {
      mcpServer: { ...server.mcpServer, url: url.href },
      async close() {
        scopes.delete(key);
      },
    };
  };
  return {
    open,
    async close() {
      scopes.clear();
      await Promise.all([...servers.values()].map(async (server) => (await server).close()));
    },
  };
}
