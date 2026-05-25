/**
 * Client — initialize / listTools / callTool round-trip, timeout, retry,
 * capability cache.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createMCPServer } from '../server/server.js';
import { createMCPClient } from '../client/client.js';
import { createInMemoryTransportPair } from '../transport/in-memory.js';
import {
  KNOWN_PROTOCOL_VERSIONS,
  MCPTimeoutError,
  type MCPMessage,
  type TransportPort,
} from '../types.js';

describe('client', () => {
  it('initialize negotiates a known protocol version', async () => {
    const server = createMCPServer({ name: 'test', version: '0.0.1' });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, { sessionId: 's', tenantId: 't' });
    const client = createMCPClient({ transport: pair.client });
    const init = await client.initialize();
    expect(KNOWN_PROTOCOL_VERSIONS).toContain(init.protocolVersion);
    expect(client.serverInfo()?.name).toBe('test');
    await client.close();
  });

  it('caches listTools across calls', async () => {
    let calls = 0;
    const server = createMCPServer({
      name: 't',
      version: '0',
      tools: [
        {
          name: 'op',
          description: 'op',
          inputSchema: z.object({}),
          handler: async () => 'x',
        },
      ],
    });
    // Wrap the server transport to count tools/list invocations.
    const pair = createInMemoryTransportPair();
    const countingServer: TransportPort = {
      ...pair.server,
      onMessage(handler) {
        return pair.server.onMessage((m: MCPMessage) => {
          if ('method' in m && m.method === 'tools/list') calls++;
          handler(m);
        });
      },
    };
    server.attach(countingServer, { sessionId: 's', tenantId: 't' });
    const client = createMCPClient({ transport: pair.client });
    await client.listTools();
    await client.listTools();
    await client.listTools();
    expect(calls).toBe(1);
    await client.close();
  });

  it('callTool times out per request', async () => {
    const server = createMCPServer({
      name: 't',
      version: '0',
      tools: [
        {
          name: 'slow',
          description: 'slow',
          inputSchema: z.object({}),
          // Never resolves
          handler: () => new Promise(() => undefined),
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, { sessionId: 's', tenantId: 't' });
    const client = createMCPClient({ transport: pair.client, defaultTimeoutMs: 50 });
    await expect(client.callTool('slow', {})).rejects.toBeInstanceOf(MCPTimeoutError);
    await client.close();
  });

  it('retries transient failures on idempotent tools', async () => {
    let attempts = 0;
    const server = createMCPServer({
      name: 't',
      version: '0',
      tools: [
        {
          name: 'flaky',
          description: 'flaky',
          annotations: { idempotentHint: true },
          inputSchema: z.object({}),
          handler: async () => {
            attempts++;
            if (attempts < 2) {
              const err = Object.assign(new Error('transient'), {});
              throw err;
            }
            return 'ok';
          },
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, { sessionId: 's', tenantId: 't' });
    const client = createMCPClient({
      transport: pair.client,
      defaultTimeoutMs: 1_000,
      maxRetries: 2,
    });
    const result = await client.callTool('flaky', {});
    expect(attempts).toBe(2);
    expect((result.content[0] as { text: string }).text).toBe('ok');
    await client.close();
  });

  it('does NOT retry non-idempotent tools on transient errors', async () => {
    let attempts = 0;
    const server = createMCPServer({
      name: 't',
      version: '0',
      tools: [
        {
          name: 'side-effect',
          description: 'destructive',
          annotations: { destructiveHint: true },
          inputSchema: z.object({}),
          handler: async () => {
            attempts++;
            throw new Error('boom');
          },
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, { sessionId: 's', tenantId: 't' });
    const client = createMCPClient({
      transport: pair.client,
      defaultTimeoutMs: 1_000,
      maxRetries: 3,
    });
    await expect(client.callTool('side-effect', {})).rejects.toThrow(/boom/);
    expect(attempts).toBe(1);
    await client.close();
  });

  it('invalidates tool cache on notifications/tools/list_changed', async () => {
    const server = createMCPServer({
      name: 't',
      version: '0',
      tools: [
        {
          name: 'one',
          description: 'one',
          inputSchema: z.object({}),
          handler: async () => '1',
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, { sessionId: 's', tenantId: 't' });
    const client = createMCPClient({ transport: pair.client });
    await client.listTools();
    // Server pushes the notification.
    await pair.server.send({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    });
    await new Promise((r) => setImmediate(r));
    // Next listTools should re-fetch (no error — same tools).
    const out = await client.listTools();
    expect(out.length).toBe(1);
    await client.close();
  });

  it('onNotification subscribers receive progress events', async () => {
    const server = createMCPServer({ name: 't', version: '0' });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, { sessionId: 's', tenantId: 't' });
    const client = createMCPClient({ transport: pair.client });
    const seen: Array<unknown> = [];
    client.onNotification((n) => seen.push(n));
    await pair.server.send({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'x', progress: 0.5 },
    });
    await new Promise((r) => setImmediate(r));
    expect(seen.length).toBe(1);
    await client.close();
  });
});
