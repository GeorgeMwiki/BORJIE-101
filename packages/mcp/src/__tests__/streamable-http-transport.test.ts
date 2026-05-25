/**
 * Streamable HTTP transport — driven by a stub fetch.
 */

import { describe, it, expect } from 'vitest';
import { createStreamableHTTPTransport } from '../transport/streamable-http.js';
import type { MCPMessage } from '../types.js';

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function sseResponse(frames: Array<unknown>, headers: Record<string, string> = {}): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

describe('streamable-http transport', () => {
  it('round-trips a request through a JSON response', async () => {
    const fetches: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      fetches.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } }, {
        'Mcp-Session-Id': 'sess-A',
      });
    };
    const t = createStreamableHTTPTransport({
      url: 'https://mcp.example/host',
      fetchImpl,
    });
    const received: Array<MCPMessage> = [];
    t.onMessage((m) => received.push(m));

    await t.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });

    expect(fetches.length).toBe(1);
    expect(fetches[0]?.init.method).toBe('POST');
    expect(received.length).toBe(1);
    const got = received[0] as { result: { ok: boolean } };
    expect(got.result.ok).toBe(true);
  });

  it('honors Mcp-Session-Id header on subsequent requests', async () => {
    const headersSeen: Array<Headers> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      headersSeen.push(new Headers(init?.headers));
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, {
        'Mcp-Session-Id': 'sess-B',
      });
    };
    const t = createStreamableHTTPTransport({
      url: 'https://mcp.example/host',
      fetchImpl,
    });
    await t.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await t.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect(headersSeen.length).toBe(2);
    expect(headersSeen[0]?.get('Mcp-Session-Id')).toBeNull();
    expect(headersSeen[1]?.get('Mcp-Session-Id')).toBe('sess-B');
  });

  it('parses SSE response when server returns text/event-stream', async () => {
    const fetchImpl: typeof fetch = async () =>
      sseResponse([
        { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 0.5 } },
        { jsonrpc: '2.0', id: 1, result: { done: true } },
      ]);
    const t = createStreamableHTTPTransport({
      url: 'https://mcp.example/host',
      fetchImpl,
    });
    const received: Array<MCPMessage> = [];
    t.onMessage((m) => received.push(m));

    await t.send({ jsonrpc: '2.0', id: 1, method: 'tools/call' });

    expect(received.length).toBe(2);
    const first = received[0] as { method: string };
    const second = received[1] as { id: number };
    expect(first.method).toBe('notifications/progress');
    expect(second.id).toBe(1);
  });

  it('throws on non-2xx response', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('boom', { status: 500 });
    const t = createStreamableHTTPTransport({
      url: 'https://mcp.example/host',
      fetchImpl,
    });
    await expect(
      t.send({ jsonrpc: '2.0', id: 1, method: 'x' }),
    ).rejects.toThrow(/500/);
  });

  it('close issues DELETE with session id (best-effort)', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: (init?.method ?? 'GET') });
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, {
        'Mcp-Session-Id': 'sess-C',
      });
    };
    const t = createStreamableHTTPTransport({
      url: 'https://mcp.example/host',
      fetchImpl,
    });
    await t.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await t.close();
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del).toBeTruthy();
  });
});
