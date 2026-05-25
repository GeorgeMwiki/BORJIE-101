/**
 * In-memory transport pair — round-trip and close semantics.
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryTransportPair } from '../transport/in-memory.js';
import type { MCPMessage } from '../types.js';
import { MCPClosedError } from '../types.js';

function makeRequest(id: number, method: string): MCPMessage {
  return { jsonrpc: '2.0', id, method, params: {} };
}

function makeResponse(id: number, result: unknown): MCPMessage {
  return { jsonrpc: '2.0', id, result };
}

describe('createInMemoryTransportPair', () => {
  it('delivers a request from client to server', async () => {
    const { client, server } = createInMemoryTransportPair();
    const received: Array<MCPMessage> = [];
    server.onMessage((m) => received.push(m));

    await client.send(makeRequest(1, 'initialize'));
    await new Promise((r) => setImmediate(r));

    expect(received.length).toBe(1);
    const got = received[0] as { id: number; method: string };
    expect(got.id).toBe(1);
    expect(got.method).toBe('initialize');
  });

  it('delivers responses server → client', async () => {
    const { client, server } = createInMemoryTransportPair();
    const received: Array<MCPMessage> = [];
    client.onMessage((m) => received.push(m));

    await server.send(makeResponse(1, { ok: true }));
    await new Promise((r) => setImmediate(r));

    expect(received.length).toBe(1);
    const got = received[0] as { result: { ok: boolean } };
    expect(got.result.ok).toBe(true);
  });

  it('preserves ordering across many sends', async () => {
    const { client, server } = createInMemoryTransportPair();
    const received: Array<number> = [];
    server.onMessage((m) => {
      const r = m as { id?: number };
      if (typeof r.id === 'number') received.push(r.id);
    });
    for (let i = 0; i < 50; i++) {
      await client.send(makeRequest(i, 'ping'));
    }
    await new Promise((r) => setImmediate(r));
    expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('cascades close — both sides go !isOpen and fire onClose once', async () => {
    const { client, server } = createInMemoryTransportPair();
    let serverClosed = 0;
    let clientClosed = 0;
    server.onClose(() => serverClosed++);
    client.onClose(() => clientClosed++);

    await client.close();

    expect(client.isOpen).toBe(false);
    expect(server.isOpen).toBe(false);
    expect(clientClosed).toBe(1);
    expect(serverClosed).toBe(1);
  });

  it('send after close rejects with MCPClosedError', async () => {
    const { client } = createInMemoryTransportPair();
    await client.close();
    await expect(client.send(makeRequest(1, 'noop'))).rejects.toBeInstanceOf(
      MCPClosedError,
    );
  });

  it('unsubscribe handler is honored', async () => {
    const { client, server } = createInMemoryTransportPair();
    const received: Array<MCPMessage> = [];
    const unsub = server.onMessage((m) => received.push(m));
    unsub();
    await client.send(makeRequest(1, 'noop'));
    await new Promise((r) => setImmediate(r));
    expect(received.length).toBe(0);
  });
});
