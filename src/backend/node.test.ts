import { EventEmitter } from 'node:events';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { genaicode } from '../core/client.js';
import type { ModelProvider } from '../core/types.js';
import { createAgentBackend, type AgentBackend } from './backend.js';
import { toNodeListener } from './node.js';

const provider: ModelProvider = {
  name: 'fake',
  async generate() {
    return { parts: [{ type: 'text', text: 'hi' }] };
  },
};

describe('toNodeListener', () => {
  it('reads a body no faster than the backend does', async () => {
    let current: IncomingMessage | undefined;
    let readWhileAuthorizing = 0;
    const backend = createAgentBackend({
      client: genaicode(provider),
      secret: 'test-secret-test-secret-test-secret!',
      authorize: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        readWhileAuthorizing = current!.socket.bytesRead;
        return { id: 'u1' };
      },
    });
    const listener = toNodeListener(backend);
    const server = createServer((req, res) => {
      current = req;
      listener(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            port,
            host: '127.0.0.1',
            method: 'POST',
            path: '/api/assistant/turn',
            headers: { 'content-type': 'application/json' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.on('error', (error) => (readWhileAuthorizing ? resolve(0) : reject(error)));
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        let left = 128; // 8 MB, chunked
        const pump = () => {
          while (left > 0) {
            left--;
            if (!req.write(chunk)) return void req.once('drain', pump);
          }
          req.end();
        };
        pump();
      });
      expect(readWhileAuthorizing).toBeGreaterThan(0);
      expect(readWhileAuthorizing).toBeLessThan(2 * 1024 * 1024);
      expect([0, 413]).toContain(status);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  it('answers 413 to a chunked body over the limit', async () => {
    const backend = createAgentBackend({
      client: genaicode(provider),
      secret: 'test-secret-test-secret-test-secret!',
      public: true,
      limits: { maxBodyBytes: 1024 },
    });
    const server = createServer(toNodeListener(backend));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const text = JSON.stringify({ prompt: 'x'.repeat(2048) });
      // A stream body has no Content-Length: the limit is found while reading.
      const body = new ReadableStream<Uint8Array>({
        start(out) {
          out.enqueue(new TextEncoder().encode(text));
          out.close();
        },
      });
      const response = await fetch(`http://127.0.0.1:${port}/api/assistant/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit);
      expect(response.status).toBe(413);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('serves a backend mounted on a path, with a body a framework read into a Buffer', async () => {
    const backend = createAgentBackend({
      client: genaicode(provider),
      secret: 'test-secret-test-secret-test-secret!',
      public: true,
    });
    const listener = toNodeListener(backend);
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        // What app.use('/api/assistant', express.raw(), listener) leaves on the request.
        Object.assign(req, {
          originalUrl: req.url,
          url: req.url!.slice('/api/assistant'.length),
          body: Buffer.concat(chunks),
        });
        listener(req, res, () => res.writeHead(404).end());
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/assistant/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'x' }),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"status":"completed"');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('stops reading the answer when the page leaves while the socket is full', async () => {
    let cancelled = false;
    const backend: AgentBackend = {
      basePath: '/api/assistant',
      handle: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(out) {
              out.enqueue(new Uint8Array(16));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    };
    const req = Object.assign(new EventEmitter(), { url: '/api/assistant/info', method: 'GET', headers: {} });
    const res = Object.assign(new EventEmitter(), {
      writableFinished: false,
      destroyed: false,
      headersSent: false,
      writeHead() {
        return res;
      },
      write: () => false,
      end() {},
      destroy() {},
    });
    toNodeListener(backend)(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await new Promise((resolve) => setTimeout(resolve, 10));
    res.destroyed = true;
    res.emit('close');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cancelled).toBe(true);
  });
});
