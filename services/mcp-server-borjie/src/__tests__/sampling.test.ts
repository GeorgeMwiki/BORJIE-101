import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../dispatcher.js';
import {
  createEchoSamplingResponder,
  createUnsupportedSamplingResponder,
} from '../sampling.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'sampler',
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
      return {} as T;
    },
  });
}

const baseDeps = {
  gatewayClient: fakeGateway(),
  async killSwitchOpen() {
    return false;
  },
  async auditChainHash() {
    return 'hash';
  },
  async resolveAuthContext() {
    return authFor();
  },
};

describe('sampling/createMessage', () => {
  it('returns -32010 when no responder is configured', async () => {
    const d = createDispatcher({
      ...baseDeps,
      samplingResponder: createUnsupportedSamplingResponder(),
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'sampling/createMessage',
        params: { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32010);
  });

  it('delegates to the echo responder when configured', async () => {
    const d = createDispatcher({
      ...baseDeps,
      samplingResponder: createEchoSamplingResponder(),
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'sampling/createMessage',
        params: { messages: [{ role: 'user', content: { type: 'text', text: 'ping' } }] },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { role: string; content: { text: string }; model: string };
      expect(result.role).toBe('assistant');
      expect(result.content.text).toContain('ping');
      expect(result.model).toBe('borjie-echo-1');
    }
  });

  it('rejects malformed sampling payloads', async () => {
    const d = createDispatcher({
      ...baseDeps,
      samplingResponder: createEchoSamplingResponder(),
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 3,
        method: 'sampling/createMessage',
        params: { messages: [] },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32602);
  });
});
