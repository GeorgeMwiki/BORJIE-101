/**
 * SSE transport — endpoint discovery + inbound parsing.
 */

import { describe, it, expect } from 'vitest';
import { createSSETransport } from '../transport/sse.js';
import type { MCPMessage } from '../types.js';

function sseStream(events: Array<{ event?: string; data: string }>): Response {
  const body = events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${e.data}\n\n`)
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('SSE transport', () => {
  it('discovers POST endpoint from server-issued event', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      if (method === 'GET') {
        return sseStream([
          { event: 'endpoint', data: JSON.stringify({ uri: '/messages?sess=abc' }) },
          { event: 'message', data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }) },
        ]);
      }
      return new Response('', { status: 200 });
    };
    const t = createSSETransport({
      url: 'https://mcp.example/sse',
      fetchImpl,
      autoReconnect: false,
    });
    const received: Array<MCPMessage> = [];
    t.onMessage((m) => received.push(m));

    // Wait for stream consumption + endpoint discovery.
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(1);
    const got = received[0] as { id: number };
    expect(got.id).toBe(1);

    // Now POST should target the discovered endpoint.
    await t.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0]?.url).toContain('/messages?sess=abc');
  });

  it('handles multiline JSON frames across chunks', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return sseStream([
          { event: 'endpoint', data: JSON.stringify({ uri: '/messages' }) },
          { event: 'message', data: JSON.stringify({ jsonrpc: '2.0', id: 5, result: { value: 'multi' } }) },
        ]);
      }
      return new Response('', { status: 200 });
    };
    const t = createSSETransport({
      url: 'https://mcp.example/sse',
      fetchImpl,
      autoReconnect: false,
    });
    const received: Array<MCPMessage> = [];
    t.onMessage((m) => received.push(m));
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(1);
    const got = received[0] as { result: { value: string } };
    expect(got.result.value).toBe('multi');
  });

  it('uses pre-configured postUrl when set', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      if (method === 'GET') {
        return sseStream([
          { event: 'message', data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) },
        ]);
      }
      return new Response('', { status: 200 });
    };
    const t = createSSETransport({
      url: 'https://mcp.example/sse',
      postUrl: 'https://mcp.example/messages',
      fetchImpl,
      autoReconnect: false,
    });
    await new Promise((r) => setTimeout(r, 50));
    await t.send({ jsonrpc: '2.0', id: 2, method: 'noop' });
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts[0]?.url).toBe('https://mcp.example/messages');
  });
});
