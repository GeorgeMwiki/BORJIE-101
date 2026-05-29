import { describe, it, expect } from 'vitest';
import {
  createSseHandler,
  createInMemorySseRegistry,
  formatSseEvent,
  type SseEvent,
  type SseChannel,
} from '../transports/sse.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'sse-agent',
    agentTokenId: 'tok-1',
    scopes: ['owner:read'],
    issuedAt: 0,
    expiresAt: 1_000_000,
    correlationId: 'corr-1',
  });
}

function fakeGateway(): GatewayClient {
  return Object.freeze({
    async call<T>(_input: GatewayCallInput): Promise<T> {
      return { ok: true } as T;
    },
  });
}

describe('formatSseEvent', () => {
  it('emits standard SSE framing', () => {
    const out = formatSseEvent({ event: 'message', data: '{"a":1}' });
    expect(out).toContain('event: message');
    expect(out).toContain('data: {"a":1}');
    expect(out.endsWith('\n\n')).toBe(true);
  });
  it('handles multiline data', () => {
    const out = formatSseEvent({ data: 'line1\nline2' });
    const lines = out.split('\n');
    expect(lines).toContain('data: line1');
    expect(lines).toContain('data: line2');
  });
});

describe('createSseHandler', () => {
  function mkChannel(): {
    captured: SseEvent[];
    channel: Omit<SseChannel, 'sessionId'>;
  } {
    const captured: SseEvent[] = [];
    let closed = false;
    const channel: Omit<SseChannel, 'sessionId'> = {
      send(event: SseEvent): void {
        if (!closed) captured.push(event);
      },
      close(): void {
        closed = true;
      },
    };
    return { captured, channel };
  }

  it('issues a session on connect and pushes responses on POST', async () => {
    const handler = createSseHandler({
      gatewayClient: fakeGateway(),
      registry: createInMemorySseRegistry(),
      async killSwitchOpen() {
        return false;
      },
      async resolveAuthContext() {
        return authFor();
      },
      async auditChainHash() {
        return 'h';
      },
    });
    const { captured, channel } = mkChannel();
    const bound = handler.onConnect({ bearerToken: 'tok' }, channel);
    expect(bound.sessionId).toMatch(/^sess_/);
    expect(captured[0]?.event).toBe('session');

    const resp = await handler.onPost({
      sessionId: bound.sessionId,
      bearerToken: 'tok',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect('result' in resp).toBe(true);
    expect(captured.length).toBeGreaterThanOrEqual(2);
    const last = captured[captured.length - 1];
    expect(last?.event).toBe('message');
  });

  it('resumes a session id when one is supplied', async () => {
    const handler = createSseHandler({
      gatewayClient: fakeGateway(),
      registry: createInMemorySseRegistry(),
      async killSwitchOpen() {
        return false;
      },
      async resolveAuthContext() {
        return authFor();
      },
      async auditChainHash() {
        return 'h';
      },
    });
    const { channel } = mkChannel();
    const bound = handler.onConnect(
      { bearerToken: null, resumeSessionId: 'resumed-1' },
      channel,
    );
    expect(bound.sessionId).toBe('resumed-1');
  });
});
