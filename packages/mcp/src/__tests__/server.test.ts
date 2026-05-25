/**
 * Server framework — tools/resources/prompts surface, dispatch, tenant
 * scoping, audit, policy.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createMCPServer } from '../server/server.js';
import { createInMemoryTransportPair } from '../transport/in-memory.js';
import { createMCPClient } from '../client/client.js';
import type { AuditEvent, SessionContext } from '../types.js';

function makeSession(overrides?: Partial<SessionContext>): SessionContext {
  return {
    sessionId: 'sess-1',
    tenantId: 't-1',
    principalId: 'u-alice',
    correlationId: 'cor-1',
    ...overrides,
  };
}

describe('server framework', () => {
  it('tools/list returns each tool with derived JSON Schema', async () => {
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      tools: [
        {
          name: 'greet',
          description: 'Say hello',
          inputSchema: z.object({ name: z.string() }),
          handler: async ({ name }) => `hello, ${name}`,
        },
      ],
    });

    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession());
    const client = createMCPClient({ transport: pair.client });

    const tools = await client.listTools();
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe('greet');
    const schema = tools[0]?.inputSchema as { type: string; properties: { name: { type: string } } };
    expect(schema.type).toBe('object');
    expect(schema.properties.name.type).toBe('string');
    await client.close();
  });

  it('tools/call dispatches to the right handler with validated args', async () => {
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      tools: [
        {
          name: 'add',
          description: 'Sum two ints',
          inputSchema: z.object({ a: z.number().int(), b: z.number().int() }),
          handler: async ({ a, b }) => ({ content: [{ type: 'text' as const, text: String(a + b) }] }),
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession());
    const client = createMCPClient({ transport: pair.client });

    const result = await client.callTool('add', { a: 2, b: 3 });
    expect(result.content[0]).toEqual({ type: 'text', text: '5' });
    await client.close();
  });

  it('tools/call rejects invalid args via InvalidParams', async () => {
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      tools: [
        {
          name: 'add',
          description: 'sum',
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          handler: async () => 'ok',
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession());
    const client = createMCPClient({ transport: pair.client });

    await expect(client.callTool('add', { a: 'oops' })).rejects.toThrow(
      /Invalid arguments/,
    );
    await client.close();
  });

  it('rejects tool call with tenantId mismatch + audits the denial', async () => {
    const events: Array<AuditEvent> = [];
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      audit: { append(e) { events.push(e); } },
      tools: [
        {
          name: 'echo',
          description: 'echo',
          inputSchema: z.object({}).passthrough(),
          handler: async (_args, ctx) => `tenant=${ctx.tenantId}`,
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession({ tenantId: 't-1' }));
    const client = createMCPClient({ transport: pair.client });

    await expect(
      client.callTool('echo', { tenantId: 't-EVIL' }),
    ).rejects.toThrow(/tenant/i);
    const denials = events.filter((e) => e.outcome === 'denied');
    expect(denials.length).toBeGreaterThanOrEqual(1);
    expect(denials[0]?.metadata?.reason).toBe('tenant-scope-violation');
    await client.close();
  });

  it('audits successful tool calls', async () => {
    const events: Array<AuditEvent> = [];
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      audit: { append(e) { events.push(e); } },
      tools: [
        {
          name: 'ping',
          description: 'p',
          inputSchema: z.object({}),
          handler: async () => 'pong',
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession());
    const client = createMCPClient({ transport: pair.client });
    await client.callTool('ping', {});
    const success = events.filter((e) => e.outcome === 'success');
    expect(success.length).toBe(1);
    expect(success[0]?.action).toBe('mcp.tool.call');
    expect(success[0]?.target).toBe('tool:ping');
    expect(success[0]?.tenantId).toBe('t-1');
    await client.close();
  });

  it('policyHook can deny tool calls', async () => {
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      policyHook: () => false,
      tools: [
        {
          name: 'restricted',
          description: 'restricted',
          inputSchema: z.object({}),
          handler: async () => 'should-not-run',
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession());
    const client = createMCPClient({ transport: pair.client });
    await expect(client.callTool('restricted', {})).rejects.toThrow(/policy/);
    await client.close();
  });

  it('resources/list + resources/read round-trip', async () => {
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      resources: [
        {
          uri: 'mem://hello.txt',
          name: 'Hello',
          mimeType: 'text/plain',
          async contentProvider() {
            return { uri: 'mem://hello.txt', mimeType: 'text/plain', text: 'hi' };
          },
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession());
    const client = createMCPClient({ transport: pair.client });
    const list = await client.listResources();
    expect(list[0]?.uri).toBe('mem://hello.txt');
    const content = await client.readResource('mem://hello.txt');
    expect(content[0]?.text).toBe('hi');
    await client.close();
  });

  it('prompts/list + prompts/get round-trip', async () => {
    const server = createMCPServer({
      name: 'test',
      version: '0.0.1',
      prompts: [
        {
          name: 'greet_owner',
          description: 'Greet a property owner',
          arguments: [{ name: 'owner', required: true }],
          render({ owner }: { owner: string }) {
            return {
              messages: [{ role: 'user', content: { type: 'text', text: `Hi ${owner}` } }],
            };
          },
        },
      ],
    });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, makeSession());
    const client = createMCPClient({ transport: pair.client });
    const list = await client.listPrompts();
    expect(list[0]?.name).toBe('greet_owner');
    const out = await client.getPrompt('greet_owner', { owner: 'Alice' });
    expect(out.messages[0]?.content).toEqual({ type: 'text', text: 'Hi Alice' });
    await client.close();
  });
});
