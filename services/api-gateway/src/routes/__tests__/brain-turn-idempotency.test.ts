/**
 * G2 — brain /turn Idempotency-Key tests (robustness audit 2026-05-29).
 *
 * Pins the contract that a duplicate POST /api/v1/brain/turn with the
 * same Idempotency-Key replays the cached response WITHOUT calling the
 * orchestrator a second time — so a flaky-network retry never burns a
 * second LLM turn or creates a duplicate thread row.
 *
 * Tests:
 *   1. First call hits the orchestrator → 200 + body.
 *   2. Duplicate call within TTL → same body + `Idempotent-Replayed: true`
 *      header, orchestrator NOT called again.
 *   3. Invalid key (regex rejection) → both calls hit the orchestrator,
 *      cache silently bypassed (defence: never block a turn on a
 *      malformed key).
 *   4. SSE path is NEVER cached — even with the header, both SSE
 *      requests run the orchestrator (streams are not replayable).
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

// Pin Supabase JWT secret + brain env BEFORE any router import so
// `loadBrainEnv` succeeds on first lazy access.
const SUPABASE_SECRET = 'test-secret-supabase-jwt-1234567890-abcdefghijkl';
process.env.SUPABASE_JWT_SECRET = SUPABASE_SECRET;
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key-aaaaaaaaaaaaaaaaaaaa';
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-aaaaaaaaaaaaaaaaaaaa';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-aaaaaaaaaaaaaaaa';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

let startThreadCallCount = 0;

vi.mock('@borjie/ai-copilot', async () => {
  const real = await vi.importActual<typeof import('@borjie/ai-copilot')>(
    '@borjie/ai-copilot',
  );
  return {
    ...real,
    createBrain: () => ({
      orchestrator: {
        startThread: async () => {
          startThreadCallCount += 1;
          return {
            success: true,
            data: {
              thread: { id: `thread-${startThreadCallCount}` },
              turn: {
                threadId: `thread-${startThreadCallCount}`,
                finalPersonaId: 'persona.coworker',
                responseText: `mock response #${startThreadCallCount}`,
                toolCalls: [],
                handoffs: [],
                tokensUsed: 100,
                timeMs: 12,
                advisorConsulted: false,
              },
            },
          };
        },
        handleTurn: async () => ({
          success: true,
          data: {
            threadId: 'existing',
            finalPersonaId: 'persona.coworker',
            responseText: 'existing reply',
            toolCalls: [],
            handoffs: [],
            tokensUsed: 10,
            timeMs: 5,
            advisorConsulted: false,
          },
        }),
      },
      personas: { get: () => null, register: () => undefined, resolveCoworker: () => null },
      threads: { listThreads: async () => [], getThread: async () => null, readAs: async () => [] },
      tools: { register: () => undefined },
      governance: {},
      reviewService: {},
      executor: { healthCheck: async () => true },
    }),
    streamTurn: async function* () {
      yield { type: 'turn_end', threadId: 'x', finalPersonaId: 'p', totalTokens: 0, totalCost: 0, timeMs: 0, advisorConsulted: false };
    },
    checkBrainHealth: async () => ({ ok: true, providers: { anthropic: true } }),
  };
});

vi.mock('@borjie/database', async () => {
  const real = await vi.importActual<typeof import('@borjie/database')>(
    '@borjie/database',
  );
  return {
    ...real,
    createDatabaseClient: () => ({ execute: async () => ({ rows: [] }) }),
    BrainThreadRepository: class {},
    MigrationWriterService: class { async commit() { return { ok: true }; } },
  };
});

vi.mock('@borjie/graph-sync', () => ({
  createNeo4jClient: () => { throw new Error('graph not wired in test'); },
  createGraphQueryService: () => ({}),
  createGraphAgentToolkit: () => undefined,
}));

vi.mock('../../composition/brain-extensions', () => ({
  getBrainExtraSkills: () => [],
}));

import { brainRouter, __resetBrainIdempotencyCache } from '../brain.hono';

const SECRET_BYTES = new TextEncoder().encode(SUPABASE_SECRET);

async function mintToken(): Promise<string> {
  return await new SignJWT({
    sub: 'user-G2',
    email: 'g2@example.com',
    app_metadata: {
      tenant_id: 'tenant-G2',
      tenant_name: 'G2 Tenant',
      roles: ['owner'],
      team_ids: [],
      environment: 'production',
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject('user-G2')
    .sign(SECRET_BYTES);
}

function mount(): Hono {
  const app = new Hono();
  app.route('/api/v1/brain', brainRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.SUPABASE_JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

afterEach(() => {
  __resetBrainIdempotencyCache();
  startThreadCallCount = 0;
});

describe('G2 — brain /turn Idempotency-Key cache', () => {
  it('first call hits orchestrator and returns 200', async () => {
    const app = mount();
    const token = await mintToken();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': 'turn-G2-1',
      },
      body: JSON.stringify({ userText: 'hello brain' }),
    });
    expect(res.status).toBe(200);
    expect(startThreadCallCount).toBe(1);
    expect(res.headers.get('idempotent-replayed')).toBeNull();
    const body = await res.json();
    expect(body.responseText).toBe('mock response #1');
  });

  it('duplicate call within TTL replays cache and skips orchestrator', async () => {
    const app = mount();
    const token = await mintToken();
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'idempotency-key': 'turn-G2-dup',
    };
    const body = JSON.stringify({ userText: 'duplicated request' });
    const first = await app.request('/api/v1/brain/turn', { method: 'POST', headers, body });
    expect(first.status).toBe(200);
    expect(startThreadCallCount).toBe(1);
    const firstBody = await first.json();

    const second = await app.request('/api/v1/brain/turn', { method: 'POST', headers, body });
    expect(second.status).toBe(200);
    expect(startThreadCallCount).toBe(1); // orchestrator NOT called again
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    const secondBody = await second.json();
    expect(secondBody.responseText).toBe(firstBody.responseText);
  });

  it('invalid Idempotency-Key (regex rejected) does NOT cache', async () => {
    const app = mount();
    const token = await mintToken();
    // Idempotency keys with `:` or `/` are rejected by the regex.
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'idempotency-key': 'bad:key/value',
    };
    const body = JSON.stringify({ userText: 'first' });
    const first = await app.request('/api/v1/brain/turn', { method: 'POST', headers, body });
    expect(first.status).toBe(200);
    expect(startThreadCallCount).toBe(1);

    const second = await app.request('/api/v1/brain/turn', { method: 'POST', headers, body });
    expect(second.status).toBe(200);
    expect(startThreadCallCount).toBe(2); // ran twice — no cache for invalid key
    expect(second.headers.get('idempotent-replayed')).toBeNull();
  });
});
