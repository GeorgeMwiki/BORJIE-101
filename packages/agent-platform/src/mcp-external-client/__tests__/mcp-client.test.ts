/**
 * mcp-client unit tests — fake-backed.
 *
 * We never instantiate the real SDK Client; we hand `createMcpExternalClient`
 * a fake factory + a fake auth resolver and assert the facade's behaviour
 * (idempotent connect, cached tools, close, invoke routing).
 */
import { describe, expect, it } from 'vitest';
import { createMcpExternalClient } from '../client/mcp-client.js';
import type {
  McpClientLike,
  McpToolDescriptor,
  McpToolResult,
} from '../types.js';
import { findCatalogEntry } from '../catalog/public-servers.js';

function fakeAuth(tenantId: string, entry: { id: string }) {
  return Promise.resolve({
    tenantId,
    serverId: entry.id,
    mode: 'none' as const,
  });
}

function fakeClient(tools: McpToolDescriptor[]): McpClientLike {
  let closed = false;
  return Object.freeze({
    listTools: async () => tools,
    callTool: async (name) => {
      if (closed) throw new Error('client is closed');
      const result: McpToolResult = Object.freeze({
        ok: true,
        content: Object.freeze([{ type: 'text', text: `called ${name}` }]),
      });
      return result;
    },
    close: async () => {
      closed = true;
    },
  });
}

describe('createMcpExternalClient', () => {
  const memory = findCatalogEntry('memory');
  if (!memory) throw new Error('memory catalog entry missing');

  it('connect returns a handle with the listed tools', async () => {
    const tools: McpToolDescriptor[] = [
      { name: 'set', description: 'kv set', inputSchema: {} },
    ];
    const client = createMcpExternalClient({
      factory: async () => fakeClient(tools),
      resolveAuth: fakeAuth,
    });
    const handle = await client.connect('tenant-1', memory);
    expect(handle.tools).toEqual(tools);
    expect(handle.tenantId).toBe('tenant-1');
    expect(handle.serverId).toBe('memory');
  });

  it('connect is idempotent — second call returns the same handle', async () => {
    let factoryCalls = 0;
    const client = createMcpExternalClient({
      factory: async () => {
        factoryCalls += 1;
        return fakeClient([]);
      },
      resolveAuth: fakeAuth,
    });
    const a = await client.connect('tenant-1', memory);
    const b = await client.connect('tenant-1', memory);
    expect(a).toBe(b);
    expect(factoryCalls).toBe(1);
  });

  it('different tenants get different handles', async () => {
    let factoryCalls = 0;
    const client = createMcpExternalClient({
      factory: async () => {
        factoryCalls += 1;
        return fakeClient([]);
      },
      resolveAuth: fakeAuth,
    });
    await client.connect('tenant-1', memory);
    await client.connect('tenant-2', memory);
    expect(factoryCalls).toBe(2);
    expect(client.handleCount()).toBe(2);
  });

  it('listTools after connect returns the cached descriptors', async () => {
    const tools: McpToolDescriptor[] = [
      { name: 'get', description: 'kv get', inputSchema: {} },
    ];
    const client = createMcpExternalClient({
      factory: async () => fakeClient(tools),
      resolveAuth: fakeAuth,
    });
    await client.connect('tenant-1', memory);
    const result = await client.listTools('tenant-1', 'memory');
    expect(result).toEqual(tools);
  });

  it('listTools without prior connect throws', async () => {
    const client = createMcpExternalClient({
      factory: async () => fakeClient([]),
      resolveAuth: fakeAuth,
    });
    await expect(client.listTools('tenant-x', 'memory')).rejects.toThrow(
      /no live handle/,
    );
  });

  it('invokeTool routes through the underlying client', async () => {
    const client = createMcpExternalClient({
      factory: async () => fakeClient([]),
      resolveAuth: fakeAuth,
    });
    await client.connect('tenant-1', memory);
    const result = await client.invokeTool({
      tenantId: 'tenant-1',
      serverId: 'memory',
      toolName: 'echo',
      input: {},
      correlationId: 'cor-1',
    });
    expect(result.ok).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'called echo' });
  });

  it('invokeTool throws when no handle exists', async () => {
    const client = createMcpExternalClient({
      factory: async () => fakeClient([]),
      resolveAuth: fakeAuth,
    });
    await expect(
      client.invokeTool({
        tenantId: 'tenant-zz',
        serverId: 'memory',
        toolName: 'x',
        input: {},
        correlationId: 'c',
      }),
    ).rejects.toThrow(/no live handle/);
  });

  it('closeAll empties the handle map', async () => {
    const client = createMcpExternalClient({
      factory: async () => fakeClient([]),
      resolveAuth: fakeAuth,
    });
    await client.connect('tenant-1', memory);
    await client.connect('tenant-2', memory);
    expect(client.handleCount()).toBe(2);
    await client.closeAll();
    expect(client.handleCount()).toBe(0);
  });

  it('handle.close removes only its own slot', async () => {
    const client = createMcpExternalClient({
      factory: async () => fakeClient([]),
      resolveAuth: fakeAuth,
    });
    const a = await client.connect('tenant-1', memory);
    await client.connect('tenant-2', memory);
    await a.close();
    expect(client.handleCount()).toBe(1);
  });
});
