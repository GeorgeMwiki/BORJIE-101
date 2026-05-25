/**
 * Audit-sink coverage for createBaseConnector.
 * Verifies that the right audit row shape (outcome, hashes, idempotency)
 * lands for each call kind: ok, failed (4xx), failed (output validation),
 * rate-limited, circuit-open. Audit failures must not break the call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createBaseConnector, type AuditSink, type ConnectorConfig } from '../base-connector.js';
import { createInMemoryAuditSink } from '../in-memory-audit-sink.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseConfig: ConnectorConfig = {
  id: 'audit-test',
  displayName: 'Audit Test',
  baseUrl: 'https://api.example.test',
  rateLimit: { rpm: 60, burst: 1 },
  retry: { maxAttempts: 1, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createBaseConnector — audit on success', () => {
  it('records outputHash + inputHash + idempotencyKey', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      audit,
    });

    await connector.call({
      path: '/charge',
      method: 'POST',
      body: { amount: 10 },
      idempotencyKey: 'idem-A',
    });

    expect(audit.entries()).toHaveLength(1);
    const row = audit.entries()[0]!;
    expect(row).toMatchObject({
      outcome: 'ok',
      idempotencyKey: 'idem-A',
      method: 'POST',
      path: '/charge',
    });
    expect(row.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.outputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('omits inputHash when no body sent', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      audit,
    });

    await connector.call({ path: '/x', method: 'GET' });

    const row = audit.entries()[0]!;
    expect(row.inputHash).toBeUndefined();
  });

  it('omits idempotencyKey when not provided', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      audit,
    });

    await connector.call({ path: '/x', method: 'GET' });

    expect(audit.entries()[0]!.idempotencyKey).toBeUndefined();
  });
});

describe('createBaseConnector — audit on failure', () => {
  it('records failed outcome on 4xx', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { message: 'bad' }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      audit,
    });

    await connector.call({ path: '/x', method: 'GET' });

    expect(audit.entries()[0]!.outcome).toBe('failed');
  });

  it('records failed outcome when output validation fails', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { wrong: 'shape' }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      audit,
    });

    await connector.call({
      path: '/x',
      method: 'GET',
      outputSchema: z.object({ id: z.string() }),
    });

    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]!.outcome).toBe('failed');
  });

  it('records rate-limited outcome', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: { ...baseConfig, rateLimit: { rpm: 60, burst: 1 } },
      fetch: fetchMock,
      audit,
    });

    await connector.call({ path: '/a', method: 'GET' });
    await connector.call({ path: '/b', method: 'GET' });

    const outcomes = audit.entries().map((e) => e.outcome);
    expect(outcomes).toContain('ok');
    expect(outcomes).toContain('rate-limited');
  });

  it('records circuit-open outcome on short-circuit', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { message: 'down' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 1, halfOpenAfterMs: 60_000 },
      },
      fetch: fetchMock,
      audit,
    });

    await connector.call({ path: '/x', method: 'GET' });
    audit.clear();
    await connector.call({ path: '/x', method: 'GET' });

    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]!.outcome).toBe('circuit-open');
  });
});

describe('createBaseConnector — audit resilience', () => {
  it('does not throw when audit.audit() rejects', async () => {
    const auditMock: AuditSink = {
      audit: vi.fn().mockRejectedValue(new Error('audit-store-down')),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      audit: auditMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
    expect(auditMock.audit).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
