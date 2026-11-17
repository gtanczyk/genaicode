import { createServer, request, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { genaicode } from '../core/client.js';
import type { ModelProvider } from '../core/types.js';
import { createAgentBackend } from './backend.js';
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
});
