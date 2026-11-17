import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentBackend } from './backend.js';

/**
 * `backend.handle` for Node's own servers (node:http, Express, Connect, Fastify with
 * `reply.hijack()`): requests outside `basePath` go to `next`, or get 404 without it.
 * A body a framework already parsed (`req.body`) is sent on as JSON.
 */
export function toNodeListener(
  backend: AgentBackend,
): (req: IncomingMessage & { body?: unknown }, res: ServerResponse, next?: (error?: unknown) => void) => void {
  return (req, res, next) => {
    const path = target(req).split('?')[0]!;
    if (!path.startsWith(`${backend.basePath}/`)) {
      if (next) next();
      else res.writeHead(404).end();
      return;
    }
    void serve(backend, req, res).catch((error: unknown) => {
      if (next) next(error);
      else if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  };
}

async function serve(
  backend: AgentBackend,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const controller = new AbortController();
  // A response that closes before it ended means the page went away.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = req.method ?? 'GET';
  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined) {
      body =
        typeof req.body === 'string'
          ? req.body
          : req.body instanceof Uint8Array
            ? new Uint8Array(req.body)
            : JSON.stringify(req.body);
      headers.delete('content-length');
    } else {
      // Read only as fast as the backend reads, so its body limit also bounds what is buffered here.
      const chunks = req[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
      body = new ReadableStream<Uint8Array>(
        {
          async pull(out) {
            try {
              const { done, value } = await chunks.next();
              if (done) out.close();
              else out.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : value);
            } catch (error) {
              out.error(error);
            }
          },
          cancel() {
            req.destroy();
          },
        },
        { highWaterMark: 0 },
      );
    }
  }
  const request = new Request(`http://${req.headers.host ?? 'localhost'}${target(req)}`, {
    method,
    headers,
    body,
    signal: controller.signal,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
  const response = await backend.handle(request);
  const out: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    out[name] = value;
  });
  res.writeHead(response.status, out);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!res.write(value)) {
      // A page that left while the socket was full sends no 'drain', only 'close'.
      await new Promise<void>((resolve) => {
        const go = () => {
          res.off('drain', go).off('close', go).off('error', go);
          resolve();
        };
        res.on('drain', go).on('close', go).on('error', go);
      });
      if (res.destroyed) {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }
  res.end();
}

/** The full path: Express and Connect take a mount prefix (`app.use('/api/assistant', ...)`) off `req.url`. */
function target(req: IncomingMessage & { originalUrl?: string }): string {
  return req.originalUrl ?? req.url ?? '/';
}
