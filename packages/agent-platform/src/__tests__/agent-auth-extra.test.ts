/**
 * Extra tests for agent-auth.ts — covers crypto helpers, canonical
 * string construction, and edge cases of verifyAgentRequest not already
 * covered in agent-platform.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCanonicalString,
  generateAgentApiKey,
  generateAgentHmacSecret,
  hashApiKey,
  hmacSha256Hex,
  sha256Hex,
  signRequest,
  timingSafeEqual,
  verifyAgentRequest,
  type AgentRegistry,
} from '../agent-auth.js';
import type { RegisteredAgent } from '../types.js';

async function freshRegistry(
  overrides: Partial<RegisteredAgent> = {},
): Promise<{ registry: AgentRegistry; agent: RegisteredAgent; touched: number }> {
  let touched = 0;
  const agent: RegisteredAgent = Object.freeze({
    id: 'agent-x',
    name: 'X',
    description: 'd',
    ownerTenantId: 't',
    apiKeyPrefix: 'bnk_',
    apiKeyHash: await hashApiKey('plain-key'),
    hmacSecretHash: 'sec',
    scopes: ['read:cases', 'write:cases'],
    rateLimitRpm: 60,
    status: 'active',
    createdAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  });
  const registry: AgentRegistry = {
    async findById(id) {
      return id === agent.id ? agent : null;
    },
    async touchLastSeen() {
      touched += 1;
    },
  };
  return {
    registry,
    agent,
    get touched() {
      return touched;
    },
  } as never;
}

describe('crypto helpers', () => {
  it('hashApiKey returns a stable 64-hex-char SHA-256', async () => {
    const a = await hashApiKey('hello');
    const b = await hashApiKey('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs produce different hashes', async () => {
    expect(await hashApiKey('a')).not.toBe(await hashApiKey('b'));
  });

  it('sha256Hex is an alias of hashApiKey', async () => {
    expect(await sha256Hex('xyz')).toBe(await hashApiKey('xyz'));
  });

  it('hmacSha256Hex is deterministic for identical inputs', async () => {
    const a = await hmacSha256Hex('secret', 'message');
    const b = await hmacSha256Hex('secret', 'message');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hmacSha256Hex changes when secret changes', async () => {
    const a = await hmacSha256Hex('s1', 'm');
    const b = await hmacSha256Hex('s2', 'm');
    expect(a).not.toBe(b);
  });

  it('generateAgentApiKey produces a unique value per call', () => {
    const a = generateAgentApiKey();
    const b = generateAgentApiKey();
    expect(a).not.toBe(b);
    expect(a.startsWith('bnk_agent_')).toBe(true);
  });

  it('generateAgentHmacSecret returns a 64-char hex-like value', () => {
    const s = generateAgentHmacSecret();
    expect(s).toHaveLength(64);
    expect(s).toMatch(/^[0-9a-f]+$/i);
  });
});

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different content of same length', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual('a', 'ab')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('buildCanonicalString', () => {
  it('uppercases the method', async () => {
    const s = await buildCanonicalString('post', '/p', 1, '');
    expect(s.startsWith('POST\n/p\n1\n')).toBe(true);
  });

  it('contains the body sha256 as the last line', async () => {
    const s = await buildCanonicalString('GET', '/p', 1, 'body');
    const expected = await sha256Hex('body');
    expect(s.endsWith(`\n${expected}`)).toBe(true);
  });
});

describe('signRequest', () => {
  it('returns sha256= prefixed lowercase hex', async () => {
    const sig = await signRequest('POST', '/x', 100, '{}', 'secret');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe('verifyAgentRequest edge cases', () => {
  it('rejects when timestamp header is non-numeric', async () => {
    const { registry, agent } = await freshRegistry();
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/p',
        body: '',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': 'not-a-number',
          'x-agent-signature': 'sha256=abc',
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_INVALID_SIGNATURE');
  });

  it('rejects with AUTH_INVALID_KEY when registry returns null', async () => {
    const registry: AgentRegistry = {
      async findById() {
        return null;
      },
      async touchLastSeen() {
        /* no-op */
      },
    };
    const ts = Date.now();
    const sig = await signRequest('POST', '/p', ts, '', 'sec');
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/p',
        body: '',
        headers: {
          'x-agent-id': 'unknown-id',
          'x-agent-timestamp': String(ts),
          'x-agent-signature': sig,
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_INVALID_KEY');
  });

  it('returns AUTH_SUSPENDED_AGENT for suspended agents', async () => {
    const { registry, agent } = await freshRegistry({ status: 'suspended' });
    const ts = Date.now();
    const sig = await signRequest('POST', '/p', ts, '', agent.hmacSecretHash);
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/p',
        body: '',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(ts),
          'x-agent-signature': sig,
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_SUSPENDED_AGENT');
  });

  it('uses injected `now` for clock-drift checks', async () => {
    const { registry, agent } = await freshRegistry();
    // Signed with timestamp 100; allow clock-drift verifier to clock at
    // 200. With injected now=200 and default drift 5 min, this is OK.
    const ts = 100;
    const sig = await signRequest('POST', '/p', ts, '', agent.hmacSecretHash);
    const res = await verifyAgentRequest(
      { registry, now: () => 200 },
      {
        method: 'POST',
        path: '/p',
        body: '',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(ts),
          'x-agent-signature': sig,
        },
      },
    );
    expect(res.ok).toBe(true);
  });

  it('respects custom maxClockDriftMs', async () => {
    const { registry, agent } = await freshRegistry();
    const ts = 1000;
    const sig = await signRequest('POST', '/p', ts, '', agent.hmacSecretHash);
    // Now is 5_000 → drift = 4_000 ms. Default 5 min would pass; we tighten
    // to 1_000 ms so this fails.
    const res = await verifyAgentRequest(
      { registry, now: () => 5_000, maxClockDriftMs: 1_000 },
      {
        method: 'POST',
        path: '/p',
        body: '',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(ts),
          'x-agent-signature': sig,
        },
      },
    );
    expect(res.ok).toBe(false);
  });
});
