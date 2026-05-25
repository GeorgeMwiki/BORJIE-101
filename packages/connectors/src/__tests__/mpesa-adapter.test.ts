/**
 * Unit tests for createMpesaAdapter — verifies the adapter composes a
 * BaseConnector with sane defaults, validates input via Zod, and surfaces
 * upstream outcomes faithfully.
 *
 * All IO is mocked (fetch + event/audit sinks). No network, no timers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMpesaAdapter, InitiatePaymentInputSchema } from '../adapters/mpesa-adapter.js';
import { createInMemoryEventSink } from '../in-memory-event-sink.js';
import { createInMemoryAuditSink } from '../in-memory-audit-sink.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createMpesaAdapter — factory', () => {
  it('exposes connector with id "mpesa"', () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaAdapter({ fetch: fetchMock });
    expect(adapter.connector.id).toBe('mpesa');
  });

  it('uses stub baseUrl when none provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { transactionId: 'TX1', status: 'pending' }),
    );
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    await adapter.initiatePayment({
      amount: 1000,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'lease-1',
      callbackUrl: 'https://app.example/cb',
    });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://stub.mpesa.local')).toBe(true);
  });

  it('respects override baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { transactionId: 'TX2', status: 'accepted' }),
    );
    const adapter = createMpesaAdapter({
      fetch: fetchMock,
      baseUrl: 'https://daraja.test',
    });

    await adapter.initiatePayment({
      amount: 5000,
      currency: 'KES',
      msisdn: '+254712345678',
      reference: 'rent-2',
      callbackUrl: 'https://app.example/cb',
    });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    // Use parsed-URL host equality (not prefix match) so the assertion
    // can't be satisfied by a misleading host like `https://daraja.testattacker.com/...`.
    expect(new URL(url).host).toBe('daraja.test');
  });

  it('exposes the underlying connector health', () => {
    const adapter = createMpesaAdapter({ fetch: vi.fn() });
    const health = adapter.connector.health();
    expect(health.state).toBe('closed');
    expect(health.errorCount).toBe(0);
  });
});

describe('createMpesaAdapter — initiatePayment happy path', () => {
  it('returns ok with parsed body on 200 success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        transactionId: 'TX-123',
        status: 'accepted',
        receiptNumber: 'R-0001',
      }),
    );
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 1500,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'inv-7',
      callbackUrl: 'https://app.example/cb',
    });

    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.transactionId).toBe('TX-123');
      expect(out.data.status).toBe('accepted');
      expect(out.data.receiptNumber).toBe('R-0001');
    }
  });

  it('passes idempotency key through to fetch headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { transactionId: 'TX9', status: 'pending' }),
    );
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    await adapter.initiatePayment(
      {
        amount: 100,
        currency: 'TZS',
        msisdn: '+255712345678',
        reference: 'r',
        callbackUrl: 'https://x.test/cb',
      },
      'idem-mpesa-1',
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBe('idem-mpesa-1');
  });

  it('emits request and response events to the supplied sink', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { transactionId: 'TX', status: 'pending' }),
    );
    const adapter = createMpesaAdapter({ fetch: fetchMock, events });

    await adapter.initiatePayment({
      amount: 200,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'r',
      callbackUrl: 'https://x.test/cb',
    });

    const kinds = events.events().map((e) => e.kind);
    expect(kinds).toContain('request');
    expect(kinds).toContain('response');
  });

  it('records audit entry on success', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { transactionId: 'TX', status: 'pending' }),
    );
    const adapter = createMpesaAdapter({ fetch: fetchMock, audit });

    await adapter.initiatePayment({
      amount: 200,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'r',
      callbackUrl: 'https://x.test/cb',
    });

    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({ outcome: 'ok', connectorId: 'mpesa' });
  });
});

describe('createMpesaAdapter — input validation', () => {
  it('returns validation-failed for negative amount', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: -1,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'x',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns validation-failed for zero amount', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 0,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'x',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns validation-failed for invalid msisdn shape', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 1000,
      currency: 'TZS',
      msisdn: 'not-a-phone',
      reference: 'x',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns validation-failed for unsupported currency', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      // @ts-expect-error testing runtime validation guard
      amount: 1000,
      currency: 'USD',
      msisdn: '+255712345678',
      reference: 'x',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('validation-failed');
  });

  it('returns validation-failed for non-URL callback', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 1000,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'x',
      callbackUrl: 'not-a-url',
    });

    expect(out.kind).toBe('validation-failed');
  });

  it('returns validation-failed when reference is empty', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 1000,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: '',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('validation-failed');
  });
});

describe('createMpesaAdapter — output validation', () => {
  it('returns validation-failed when upstream body fails schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { wrong: 'shape' }),
    );
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 1000,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'r',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('validation-failed');
  });

  it('returns validation-failed when status enum value is unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { transactionId: 'TX', status: 'mystery' }),
    );
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 1000,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'r',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('validation-failed');
  });
});

describe('createMpesaAdapter — upstream errors', () => {
  it('returns upstream-error on 4xx without retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { message: 'invalid msisdn' }));
    const adapter = createMpesaAdapter({ fetch: fetchMock });

    const out = await adapter.initiatePayment({
      amount: 1000,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'r',
      callbackUrl: 'https://x.test/cb',
    });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.status).toBe(400);
      expect(out.message).toBe('invalid msisdn');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('InitiatePaymentInputSchema', () => {
  it('accepts a well-formed Tanzania payment', () => {
    const parsed = InitiatePaymentInputSchema.safeParse({
      amount: 1000,
      currency: 'TZS',
      msisdn: '+255712345678',
      reference: 'r',
      callbackUrl: 'https://x.test/cb',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a well-formed Kenya payment', () => {
    const parsed = InitiatePaymentInputSchema.safeParse({
      amount: 250,
      currency: 'KES',
      msisdn: '+254712345678',
      reference: 'r',
      callbackUrl: 'https://x.test/cb',
    });
    expect(parsed.success).toBe(true);
  });
});
