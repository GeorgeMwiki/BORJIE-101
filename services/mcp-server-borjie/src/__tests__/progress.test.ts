import { describe, it, expect } from 'vitest';
import {
  createMemoryNotificationSink,
  createToolProgressEmitter,
  extractProgressToken,
} from '../progress.js';
import { createDispatcher } from '../dispatcher.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'pg',
    agentTokenId: 'tok-1',
    scopes: ['owner:read', 'owner:write', 'owner:draft', 'owner:reminders', 'owner:share'],
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

describe('progress primitives', () => {
  it('extracts progressToken from _meta', () => {
    expect(extractProgressToken({ _meta: { progressToken: 'pt-1' } })).toBe('pt-1');
    expect(extractProgressToken({ _meta: { progressToken: 42 } })).toBe(42);
    expect(extractProgressToken(undefined)).toBeUndefined();
    expect(extractProgressToken({})).toBeUndefined();
  });

  it('emitter pushes notifications only when a token is bound', () => {
    const sink = createMemoryNotificationSink();
    const e = createToolProgressEmitter(sink, { requestId: 1, progressToken: 'tok' });
    e.emit(20, 100, 'halfway');
    e.partial({ chunk: 1 });
    expect(sink.events.length).toBe(2);
    expect(sink.events[0]?.kind).toBe('progress');
    expect(sink.events[1]?.kind).toBe('result_partial');
  });

  it('emitter without token never emits progress', () => {
    const sink = createMemoryNotificationSink();
    const e = createToolProgressEmitter(sink, { requestId: 1 });
    e.emit(10);
    expect(sink.events.filter((x) => x.kind === 'progress').length).toBe(0);
  });

  it('dispatcher routes progress through the notification sink on tool call', async () => {
    const sink = createMemoryNotificationSink();
    const d = createDispatcher({
      gatewayClient: fakeGateway(),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor();
      },
      notificationSink: sink,
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 'r1',
        method: 'tools/call',
        params: {
          name: 'mining_drafts_list',
          arguments: {},
          _meta: { progressToken: 'pt-1' },
        },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    const progressEvents = sink.events.filter((x) => x.kind === 'progress');
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
  });
});
