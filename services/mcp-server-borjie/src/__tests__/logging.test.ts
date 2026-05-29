import { describe, it, expect } from 'vitest';
import {
  createMemoryLogSink,
  createLogLevelController,
  shouldEmit,
  isValidLogLevel,
} from '../logging.js';
import { createDispatcher } from '../dispatcher.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'log-agent',
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

describe('logging primitives', () => {
  it('records messages above the threshold and skips below', () => {
    const sink = createMemoryLogSink();
    const ctrl = createLogLevelController('warning');
    expect(shouldEmit(ctrl, 'info')).toBe(false);
    expect(shouldEmit(ctrl, 'error')).toBe(true);
    sink.emit({ level: 'error', logger: 'x', data: { a: 1 } });
    expect(sink.messages.length).toBe(1);
  });
  it('validates level strings', () => {
    expect(isValidLogLevel('info')).toBe(true);
    expect(isValidLogLevel('bogus')).toBe(false);
  });
});

describe('logging/setLevel', () => {
  it('changes the level controller', async () => {
    const ctrl = createLogLevelController('info');
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
      logLevel: ctrl,
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'logging/setLevel',
        params: { level: 'debug' },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    expect(ctrl.get()).toBe('debug');
  });
  it('rejects invalid level strings', async () => {
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
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'logging/setLevel',
        params: { level: 'banana' },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32602);
  });
});
