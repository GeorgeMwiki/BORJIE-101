/**
 * Tests for the outbound webhook retry worker.
 *
 * Covers:
 *   1. Success on first attempt — no retries, one attempt record written.
 *   2. Retry on 503 — retries until success.
 *   3. 4xx response is treated as permanent — dead-lettered immediately.
 *   4. Network error is retryable.
 *   5. DLQ push after exhausting 5 attempts with 503s.
 *   6. HMAC signature correctness: `t=<ts>,v1=<hmac(ts.body)>`.
 *   7. Invalid targetUrl throws before any fetch.
 *   8. Attempt record payload includes attemptNumber and statusCode.
 *   9. `backoffSecondsForAttempt` returns 1,3,9,27,81 for attempts 1..5.
 *  10. Classifier decisions (2xx/5xx/4xx/network).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { createHmac } from 'node:crypto';
import {
  createWebhookRetryWorker,
  computeWebhookSignature,
  buildSignatureHeader,
  classifyHttpResult,
  backoffSecondsForAttempt,
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  type WebhookDeliveryRepository,
  type WebhookAttemptRecord,
  type WebhookDeadLetterRecord,
  type WebhookDeliveryQueued,
} from '../workers/webhook-retry-worker';

// ---------------------------------------------------------------------------
// In-memory repository double
// ---------------------------------------------------------------------------

function makeRepo(): WebhookDeliveryRepository & {
  attempts: WebhookAttemptRecord[];
  dlq: WebhookDeadLetterRecord[];
} {
  const repo = {
    attempts: [] as WebhookAttemptRecord[],
    dlq: [] as WebhookDeadLetterRecord[],
    async recordAttempt(r: WebhookAttemptRecord) {
      // Always clone so tests can safely mutate inputs later.
      repo.attempts.push({ ...r });
    },
    async moveToDeadLetters(r: WebhookDeadLetterRecord) {
      repo.dlq.push({ ...r });
    },
    async listDeadLetters(filter: { tenantId?: string; limit?: number; offset?: number }) {
      const all = filter.tenantId
        ? repo.dlq.filter((e) => e.tenantId === filter.tenantId)
        : repo.dlq.slice();
      return all.slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? all.length));
    },
    async getDeadLetter(id: string) {
      return repo.dlq.find((e) => e.id === id) ?? null;
    },
    async markDeadLetterReplayed() {
      // no-op in these worker tests
    },
  };
  return repo;
}

const silentLogger = pino({ level: 'silent' });

function makeEvent(overrides: Partial<WebhookDeliveryQueued> = {}): WebhookDeliveryQueued {
  return {
    deliveryId: 'del-1',
    tenantId: 'tnt-1',
    targetUrl: 'https://example.test/webhook',
    eventType: 'invoice.paid',
    payload: { id: 'inv-1', amount: 1000 },
    hmacSecret: 'test-secret',
    ...overrides,
  };
}

describe('webhook retry worker', () => {
  beforeEach(() => {
    // Ensure env doesn't leak across tests.
    delete process.env.WEBHOOK_DEFAULT_HMAC_SECRET;
  });

  it('delivers on first attempt and records a single succeeded attempt', async () => {
    const repo = makeRepo();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response('{"ok":true}', { status: 200 });
    };
    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: fetchFn as typeof fetch,
      logger: silentLogger,
      // Skip real waiting.
      backoffSecondsForAttempt: () => 0,
    });

    const result = await worker.processDelivery(makeEvent());
    expect(result).toEqual({ status: 'delivered', attempts: 1, lastStatusCode: 200 });
    expect(repo.attempts).toHaveLength(1);
    expect(repo.attempts[0].status).toBe('succeeded');
    expect(repo.attempts[0].attemptNumber).toBe(1);
    expect(repo.attempts[0].statusCode).toBe(200);
    expect(repo.dlq).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('retries on 503 until a 2xx succeeds', async () => {
    const repo = makeRepo();
    const responses = [503, 503, 200];
    let i = 0;
    const fetchFn = async () =>
      new Response(null, { status: responses[i++] ?? 200 });

    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: fetchFn as typeof fetch,
      logger: silentLogger,
      backoffSecondsForAttempt: () => 0,
    });

    const result = await worker.processDelivery(makeEvent());
    expect(result.status).toBe('delivered');
    expect(result.attempts).toBe(3);
    expect(repo.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(repo.dlq).toHaveLength(0);
  });

  it('dead-letters immediately on 400 (permanent)', async () => {
    const repo = makeRepo();
    const fetchFn = async () => new Response(null, { status: 400 });

    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: fetchFn as typeof fetch,
      logger: silentLogger,
      backoffSecondsForAttempt: () => 0,
    });

    const result = await worker.processDelivery(makeEvent());
    expect(result.status).toBe('dead_lettered');
    expect(result.attempts).toBe(MAX_ATTEMPTS); // reported as max for stats
    expect(repo.dlq).toHaveLength(1);
    expect(repo.dlq[0].lastStatusCode).toBe(400);
    // Only one attempt recorded — we do not burn retries on 4xx.
    expect(repo.attempts).toHaveLength(1);
  });

  it('treats network errors as retryable and DLQs after 5 failures', async () => {
    const repo = makeRepo();
    const fetchFn = async () => {
      throw new TypeError('connect ECONNREFUSED');
    };

    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: fetchFn as typeof fetch,
      logger: silentLogger,
      backoffSecondsForAttempt: () => 0,
    });

    const result = await worker.processDelivery(makeEvent());
    expect(result.status).toBe('dead_lettered');
    expect(result.attempts).toBe(MAX_ATTEMPTS);
    expect(repo.attempts).toHaveLength(5);
    expect(repo.attempts.every((a) => a.status === 'failed')).toBe(true);
    expect(repo.dlq).toHaveLength(1);
    expect(repo.dlq[0].totalAttempts).toBe(5);
    expect(repo.dlq[0].lastError).toMatch(/ECONNREFUSED/);
  });

  it('dead-letters after exhausting 5 attempts on 503s', async () => {
    const repo = makeRepo();
    const fetchFn = async () => new Response(null, { status: 503 });
    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: fetchFn as typeof fetch,
      logger: silentLogger,
      backoffSecondsForAttempt: () => 0,
    });

    const result = await worker.processDelivery(makeEvent());
    expect(result.status).toBe('dead_lettered');
    expect(repo.attempts).toHaveLength(5);
    expect(repo.dlq[0].lastStatusCode).toBe(503);
  });

  it('signs the body with HMAC-SHA256 over `${ts}.${body}`', async () => {
    const repo = makeRepo();
    const captured: Array<{ headers: Record<string, string>; body: string }> = [];
    const fetchFn = async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured.push({
        headers: init?.headers as Record<string, string>,
        body: init?.body as string,
      });
      return new Response(null, { status: 200 });
    };

    const fixedNow = 1_700_000_000_000; // ms
    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: fetchFn as typeof fetch,
      logger: silentLogger,
      now: () => fixedNow,
    });

    await worker.processDelivery(
      makeEvent({
        hmacSecret: 'shh',
        payload: { hello: 'world' },
      })
    );

    expect(captured).toHaveLength(1);
    const body = captured[0].body;
    const ts = Math.floor(fixedNow / 1000);
    const expectedSig = createHmac('sha256', 'shh').update(`${ts}.${body}`).digest('hex');
    expect(captured[0].headers['X-Borjie-Signature']).toBe(`t=${ts},v1=${expectedSig}`);
    expect(captured[0].headers['X-Borjie-Event']).toBe('invoice.paid');
    expect(captured[0].headers['X-Borjie-Delivery']).toBe('del-1');
    expect(captured[0].headers['Content-Type']).toBe('application/json');
  });

  it('rejects invalid targetUrl before any fetch', async () => {
    const repo = makeRepo();
    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: (async () => new Response(null)) as typeof fetch,
      logger: silentLogger,
    });
    await expect(
      worker.processDelivery(makeEvent({ targetUrl: 'ftp://nope' }))
    ).rejects.toThrowError(/invalid targetUrl/);
    expect(repo.attempts).toHaveLength(0);
  });

  it('records statusCode and attemptNumber on each attempt', async () => {
    const repo = makeRepo();
    const responses = [503, 200];
    let i = 0;
    const fetchFn = async () => new Response(null, { status: responses[i++] });
    const worker = createWebhookRetryWorker({
      repository: repo,
      fetchFn: fetchFn as typeof fetch,
      logger: silentLogger,
      backoffSecondsForAttempt: () => 0,
    });
    await worker.processDelivery(makeEvent());
    expect(repo.attempts).toHaveLength(2);
    expect(repo.attempts[0]).toMatchObject({
      attemptNumber: 1,
      statusCode: 503,
      status: 'failed',
    });
    expect(repo.attempts[1]).toMatchObject({
      attemptNumber: 2,
      statusCode: 200,
      status: 'succeeded',
    });
  });
});

describe('webhook retry helpers', () => {
  it('backoffSecondsForAttempt returns the 1,3,9,27,81 ladder', () => {
    expect(BACKOFF_SECONDS).toEqual([1, 3, 9, 27, 81]);
    expect(backoffSecondsForAttempt(1)).toBe(1);
    expect(backoffSecondsForAttempt(2)).toBe(3);
    expect(backoffSecondsForAttempt(3)).toBe(9);
    expect(backoffSecondsForAttempt(4)).toBe(27);
    expect(backoffSecondsForAttempt(5)).toBe(81);
    // Clamp at upper end rather than crashing.
    expect(backoffSecondsForAttempt(99)).toBe(81);
    expect(backoffSecondsForAttempt(0)).toBe(1);
  });

  it('classifyHttpResult labels outcomes correctly', () => {
    expect(classifyHttpResult({ statusCode: 200 }).kind).toBe('success');
    expect(classifyHttpResult({ statusCode: 204 }).kind).toBe('success');
    expect(classifyHttpResult({ statusCode: 503 }).kind).toBe('retryable');
    expect(classifyHttpResult({ statusCode: 500 }).kind).toBe('retryable');
    expect(classifyHttpResult({ statusCode: 400 }).kind).toBe('permanent');
    expect(classifyHttpResult({ statusCode: 404 }).kind).toBe('permanent');
    const net = classifyHttpResult({ error: new Error('boom') });
    expect(net.kind).toBe('retryable');
    expect(net.errorMessage).toBe('boom');
  });

  it('computeWebhookSignature + buildSignatureHeader round-trip verify', () => {
    const ts = 1_700_000_000;
    const sig = computeWebhookSignature('hello', ts, 'k');
    const header = buildSignatureHeader(sig, ts);
    expect(header).toBe(`t=${ts},v1=${sig}`);
    // Simulated receiver verifies by recomputing.
    const recomputed = createHmac('sha256', 'k').update(`${ts}.hello`).digest('hex');
    expect(sig).toBe(recomputed);
  });
});
