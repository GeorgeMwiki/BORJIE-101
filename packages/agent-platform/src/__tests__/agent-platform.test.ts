import { describe, expect, it } from 'vitest';
import {
  verifyAgentRequest,
  signRequest,
  hashApiKey,
  generateAgentApiKey,
  generateAgentHmacSecret,
  timingSafeEqual,
  type AgentRegistry,
  type RegisteredAgent,
  type AgentScope,
  getCorrelationId,
  correlationHeaders,
  forwardHeaders,
  checkIdempotency,
  cacheIdempotencyResponse,
  createInMemoryIdempotencyStore,
  createAgentError,
  getErrorHttpStatus,
  isRetryableError,
  generateAgentCard,
  deliverToSubscription,
  type WebhookStore,
  type WebhookSubscription,
  type WebhookDelivery,
  type FetchLike,
} from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_SCOPES: ReadonlyArray<AgentScope> = [
  'read:cases',
  'write:cases',
  'read:graph',
  'read:tenants',
  'execute:skills',
];

async function makeRegistry(
  agent: Partial<RegisteredAgent> = {},
): Promise<{ registry: AgentRegistry; agent: RegisteredAgent }> {
  const full: RegisteredAgent = Object.freeze({
    id: 'agent-1',
    name: 'Test Agent',
    description: 'unit',
    ownerTenantId: 'tenant-a',
    apiKeyPrefix: 'bnk_',
    apiKeyHash: await hashApiKey('plain'),
    hmacSecretHash: 'secret-hash-value',
    scopes: ALL_SCOPES,
    rateLimitRpm: 60,
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    metadata: {},
    ...agent,
  });
  const registry: AgentRegistry = {
    async findById(id) {
      return id === full.id ? full : null;
    },
    async touchLastSeen() {
      /* no-op */
    },
  };
  return { registry, agent: full };
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

describe('error codes', () => {
  it('creates a structured error envelope', () => {
    const err = createAgentError(
      'RATE_LIMIT_EXCEEDED',
      { remaining: 0 },
      undefined,
      'cid',
    );
    expect(err.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(60_000);
    expect(err.correlationId).toBe('cid');
  });

  it('maps error codes to HTTP statuses', () => {
    expect(getErrorHttpStatus('AUTH_SCOPE_DENIED')).toBe(403);
    expect(getErrorHttpStatus('IDEMPOTENCY_CONFLICT')).toBe(409);
    expect(getErrorHttpStatus('RATE_LIMIT_EXCEEDED')).toBe(429);
    expect(getErrorHttpStatus('INTERNAL_ERROR')).toBe(500);
  });

  it('exposes retryability', () => {
    expect(isRetryableError('AUTH_INVALID_KEY')).toBe(false);
    expect(isRetryableError('UPSTREAM_TIMEOUT')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Correlation ID
// ---------------------------------------------------------------------------

describe('correlation id', () => {
  it('extracts from X-Request-Id when present', () => {
    expect(getCorrelationId({ 'x-request-id': 'abc' })).toBe('abc');
  });

  it('falls back to X-Correlation-Id', () => {
    expect(getCorrelationId({ 'x-correlation-id': 'xyz' })).toBe('xyz');
  });

  it('generates a UUID when absent', () => {
    const id = getCorrelationId({});
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns response headers with the id in both styles', () => {
    const h = correlationHeaders('id-1');
    expect(h['X-Request-Id']).toBe('id-1');
    expect(h['X-Correlation-Id']).toBe('id-1');
  });

  it('forwardHeaders merges correlation into other headers', () => {
    const h = forwardHeaders('id-2', { 'X-Extra': 'v' });
    expect(h['X-Request-Id']).toBe('id-2');
    expect(h['X-Extra']).toBe('v');
  });
});

// ---------------------------------------------------------------------------
// Agent auth
// ---------------------------------------------------------------------------

describe('agent auth', () => {
  it('rejects calls with missing signature headers', async () => {
    const { registry } = await makeRegistry();
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/api/v1/cases',
        body: '{}',
        headers: {},
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_REQUIRED');
  });

  it('authenticates a correctly signed request and propagates correlation id', async () => {
    const { registry, agent } = await makeRegistry();
    const timestamp = Date.now();
    const sig = await signRequest(
      'POST',
      '/api/v1/cases',
      timestamp,
      '{"x":1}',
      agent.hmacSecretHash,
    );
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/api/v1/cases',
        body: '{"x":1}',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(timestamp),
          'x-agent-signature': sig,
          'x-request-id': 'trace-xyz',
        },
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.agent.id).toBe(agent.id);
      expect(res.correlationId).toBe('trace-xyz');
    }
  });

  it('rejects a signature mismatch', async () => {
    const { registry, agent } = await makeRegistry();
    const timestamp = Date.now();
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/api/v1/cases',
        body: '{"x":1}',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(timestamp),
          'x-agent-signature': 'sha256=wrongwrongwrong',
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_INVALID_SIGNATURE');
  });

  it('rejects a stale timestamp (replay protection)', async () => {
    const { registry, agent } = await makeRegistry();
    const old = Date.now() - 30 * 60 * 1000;
    const sig = await signRequest(
      'POST',
      '/api/v1/cases',
      old,
      '{}',
      agent.hmacSecretHash,
    );
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/api/v1/cases',
        body: '{}',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(old),
          'x-agent-signature': sig,
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_INVALID_SIGNATURE');
  });

  it('rejects a revoked agent', async () => {
    const { registry, agent } = await makeRegistry({ status: 'revoked' });
    const timestamp = Date.now();
    const sig = await signRequest(
      'POST',
      '/p',
      timestamp,
      '{}',
      agent.hmacSecretHash,
    );
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/p',
        body: '{}',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(timestamp),
          'x-agent-signature': sig,
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_REVOKED_AGENT');
  });

  it('enforces required scopes', async () => {
    const { registry, agent } = await makeRegistry({
      scopes: ['read:cases'],
    });
    const timestamp = Date.now();
    const sig = await signRequest(
      'POST',
      '/p',
      timestamp,
      '{}',
      agent.hmacSecretHash,
    );
    const res = await verifyAgentRequest(
      { registry },
      {
        method: 'POST',
        path: '/p',
        body: '{}',
        headers: {
          'x-agent-id': agent.id,
          'x-agent-timestamp': String(timestamp),
          'x-agent-signature': sig,
        },
      },
      ['write:cases'],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('AUTH_SCOPE_DENIED');
  });

  it('generateAgentApiKey returns the expected prefix', () => {
    expect(generateAgentApiKey()).toMatch(/^bnk_agent_/);
    expect(generateAgentHmacSecret()).toHaveLength(64);
  });

  it('timingSafeEqual returns false for different-length strings', () => {
    expect(timingSafeEqual('a', 'aa')).toBe(false);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('returns fresh for GET requests even with a key', async () => {
    const store = createInMemoryIdempotencyStore();
    const r = await checkIdempotency({
      store,
      method: 'GET',
      headers: { 'x-idempotency-key': 'k1' },
      body: '{}',
      agentId: 'a',
    });
    expect(r.kind).toBe('fresh');
  });

  it('dedupes duplicate POSTs — second call returns cached response', async () => {
    const store = createInMemoryIdempotencyStore();
    const body = '{"amount":100}';

    const first = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'pay-1' },
      body,
      agentId: 'agent-a',
    });
    expect(first.kind).toBe('fresh');
    if (first.kind === 'fresh') {
      expect(first.idempotencyKey).toBe('pay-1');
      await cacheIdempotencyResponse({
        store,
        idempotencyKey: first.idempotencyKey!,
        agentId: 'agent-a',
        method: 'POST',
        path: '/payments',
        requestHash: first.requestHash!,
        statusCode: 200,
        responseBody: '{"id":"pay-1","status":"ok"}',
      });
    }

    const second = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'pay-1' },
      body,
      agentId: 'agent-a',
    });
    expect(second.kind).toBe('replayed');
    if (second.kind === 'replayed') {
      expect(second.statusCode).toBe(200);
      expect(second.responseBody).toContain('pay-1');
    }
  });

  it('reports conflict when same key is used with a different body', async () => {
    const store = createInMemoryIdempotencyStore();
    const first = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'k' },
      body: '{"a":1}',
      agentId: 'a',
    });
    if (first.kind === 'fresh') {
      await cacheIdempotencyResponse({
        store,
        idempotencyKey: first.idempotencyKey!,
        agentId: 'a',
        method: 'POST',
        path: '/x',
        requestHash: first.requestHash!,
        statusCode: 200,
        responseBody: '{}',
      });
    }
    const conflict = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'k' },
      body: '{"a":2}', // different body
      agentId: 'a',
    });
    expect(conflict.kind).toBe('conflict');
  });

  it('does not cache error responses', async () => {
    const store = createInMemoryIdempotencyStore();
    await cacheIdempotencyResponse({
      store,
      idempotencyKey: 'err',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 500,
      responseBody: '{"error":"boom"}',
    });
    const r = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'err' },
      body: '',
      agentId: 'a',
    });
    expect(r.kind).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

describe('agent card', () => {
  it('builds a card with provider + capability sections', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api.borjie.com',
      tools: [
        {
          name: 'list_maintenance_cases',
          description: 'list cases',
          inputSchema: {},
          requiredScopes: ['read:cases'],
          category: 'cases',
        },
      ],
      resources: [
        {
          uri: 'borjie://portfolio/overview',
          name: 'Portfolio',
          description: 'overview',
          mimeType: 'application/json',
        },
      ],
    });
    expect(card.name).toBe('BORJIE Agent Platform');
    expect(card.authentication.schemes).toContain('hmac-sha256');
    expect(card.tools).toHaveLength(1);
    expect(card.resources).toHaveLength(1);
    expect(card.capabilities.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// Webhook delivery
// ---------------------------------------------------------------------------

describe('webhook delivery', () => {
  function makeStore(): { store: WebhookStore; events: WebhookDelivery[]; updates: Record<string, unknown>[] } {
    const events: WebhookDelivery[] = [];
    const updates: Record<string, unknown>[] = [];
    const store: WebhookStore = {
      async recordPending(d) {
        events.push(d);
      },
      async updateDelivery(id, patch) {
        updates.push({ id, ...patch });
      },
      async incrementSubscriptionFailure(id, n, pause) {
        updates.push({ id, failureCount: n, pause });
      },
      async markSubscriptionDelivered(id, iso) {
        updates.push({ id, deliveredAt: iso });
      },
    };
    return { store, events, updates };
  }

  const sub: WebhookSubscription = Object.freeze({
    id: 'sub-1',
    agentId: 'agent-1',
    tenantId: 'tenant-a',
    eventTypes: ['case.created'],
    url: 'https://callback.example.com/hook',
    secretHash: 'shhh',
    status: 'active',
    failureCount: 0,
    createdAt: new Date().toISOString(),
  });

  it('delivers on first-attempt 200', async () => {
    const { store, updates } = makeStore();
    const fetchLike: FetchLike = async () => ({ status: 200, ok: true });
    const delivery = await deliverToSubscription(
      {
        fetch: fetchLike,
        store,
        retryDelaysMs: [10, 20, 30],
      },
      sub,
      {
        eventType: 'case.created',
        eventId: 'evt-1',
        correlationId: 'cid',
        tenantId: 'tenant-a',
        occurredAt: new Date().toISOString(),
        data: { caseId: 'c1' },
      },
    );
    expect(delivery.status).toBe('delivered');
    expect(updates.some((u) => 'deliveredAt' in u)).toBe(true);
  });

  it('pauses subscription after repeated failures', async () => {
    const { store, updates } = makeStore();
    const fetchLike: FetchLike = async () => ({ status: 500, ok: false });
    const delivery = await deliverToSubscription(
      {
        fetch: fetchLike,
        store,
        retryDelaysMs: [1, 1, 1],
        maxConsecutiveFailures: 1,
      },
      { ...sub, failureCount: 0 },
      {
        eventType: 'case.created',
        eventId: 'evt-2',
        correlationId: 'cid2',
        tenantId: 'tenant-a',
        occurredAt: new Date().toISOString(),
        data: {},
      },
    );
    expect(delivery.status).toBe('failed');
    const pauseUpdate = updates.find(
      (u) => 'pause' in u && u.pause === true,
    );
    expect(pauseUpdate).toBeDefined();
  });
});
