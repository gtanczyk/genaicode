import { describe, expect, it } from 'vitest';
import { RpcError, RpcPeer } from './rpc.js';

function peer(handlers: Partial<ConstructorParameters<typeof RpcPeer>[1]> = {}) {
  const sent: Record<string, unknown>[] = [];
  const rpc = new RpcPeer((line) => sent.push(JSON.parse(line)), {
    notification: () => {},
    request: () => ({}),
    ...handlers,
  });
  return { rpc, sent };
}

describe('RpcPeer', () => {
  it('matches replies to requests', async () => {
    const { rpc, sent } = peer();
    const reply = rpc.request('ping', { a: 1 });
    expect(sent[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping', params: { a: 1 } });
    expect(rpc.receive({ jsonrpc: '2.0', id: 1, result: { pong: true } })).toBe(true);
    await expect(reply).resolves.toEqual({ pong: true });
  });

  it('rejects on error replies, timeouts and failure', async () => {
    const { rpc } = peer();
    const rejected = rpc.request('x');
    rpc.receive({ id: 1, error: { code: 5, message: 'nope' } });
    await expect(rejected).rejects.toMatchObject({ message: 'nope', code: 5 });

    await expect(rpc.request('slow', {}, 10)).rejects.toThrow(/outcome is unknown/);

    const pending = rpc.request('y');
    rpc.fail(new Error('gone'));
    await expect(pending).rejects.toThrow('gone');
    await expect(rpc.request('z')).rejects.toThrow('gone');
  });

  it('answers incoming requests and reports thrown errors', async () => {
    const { rpc, sent } = peer({
      request: (method) => {
        if (method === 'ok') return { fine: true };
        throw new RpcError('denied', -32601);
      },
    });
    rpc.receive({ id: 'a', method: 'ok' });
    rpc.receive({ id: 'b', method: 'bad' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.sort((a, b) => String(a.id).localeCompare(String(b.id)))).toEqual([
      { jsonrpc: '2.0', id: 'a', result: { fine: true } },
      { jsonrpc: '2.0', id: 'b', error: { code: -32601, message: 'denied' } },
    ]);
  });

  it('ignores values that are not JSON-RPC', () => {
    const { rpc } = peer();
    expect(rpc.receive({ hello: 1 })).toBe(false);
    expect(rpc.receive({ id: 42, result: {} })).toBe(false);
    expect(rpc.receive('text')).toBe(false);
  });
});
