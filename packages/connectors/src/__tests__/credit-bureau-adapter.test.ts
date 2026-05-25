/**
 * Unit tests for createCreditBureauAdapter — composes BaseConnector with
 * stricter rate-limit and retry settings appropriate for paid bureau APIs.
 *
 * No real bureau call ever made; fetch is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCreditBureauAdapter,
  CreditScoreReportSchema,
  FetchScoreInputSchema,
} from '../adapters/credit-bureau-adapter.js';
import { createInMemoryEventSink } from '../in-memory-event-sink.js';
import { createInMemoryAuditSink } from '../in-memory-audit-sink.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const validReport = {
  nationalId: '12345678',
  score: 720,
  band: 'good' as const,
  asOf: '2026-01-15T00:00:00Z',
  bureau: 'creditinfo',
  delinquencies: 0,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createCreditBureauAdapter — factory', () => {
  it('uses default bureauId "credit-bureau" when none provided', () => {
    const adapter = createCreditBureauAdapter({ fetch: vi.fn() });
    expect(adapter.connector.id).toBe('credit-bureau');
  });

  it('honours custom bureauId', () => {
    const adapter = createCreditBureauAdapter({
      fetch: vi.fn(),
      bureauId: 'transunion-tz',
    });
    expect(adapter.connector.id).toBe('transunion-tz');
  });

  it('uses stub baseUrl when none provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validReport));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    await adapter.fetchScore({ nationalId: '12345678' });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://stub.credit-bureau.local')).toBe(true);
  });

  it('uses overridden baseUrl when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validReport));
    const adapter = createCreditBureauAdapter({
      fetch: fetchMock,
      baseUrl: 'https://prod.bureau.test',
    });

    await adapter.fetchScore({ nationalId: '12345678' });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://prod.bureau.test')).toBe(true);
  });

  it('exposes connector health pre-call as closed/zero-errors', () => {
    const adapter = createCreditBureauAdapter({ fetch: vi.fn() });
    const health = adapter.connector.health();
    expect(health).toMatchObject({ state: 'closed', errorCount: 0, lastErrorAt: null });
  });
});

describe('createCreditBureauAdapter — fetchScore happy path', () => {
  it('returns ok with parsed report on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validReport));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: '12345678' });

    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.score).toBe(720);
      expect(out.data.band).toBe('good');
      expect(out.data.delinquencies).toBe(0);
    }
  });

  it('uses POST verb against /v1/score path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validReport));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    await adapter.fetchScore({ nationalId: '12345678' });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(url).toContain('/v1/score');
    expect(init?.method).toBe('POST');
  });

  it('serialises body as JSON containing nationalId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validReport));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    await adapter.fetchScore({ nationalId: 'A1B2C3' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBe(JSON.stringify({ nationalId: 'A1B2C3' }));
  });

  it('emits request and response events to the supplied sink', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validReport));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock, events });

    await adapter.fetchScore({ nationalId: '12345678' });

    const kinds = events.events().map((e) => e.kind);
    expect(kinds).toContain('request');
    expect(kinds).toContain('response');
  });

  it('writes a single ok audit row', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validReport));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock, audit });

    await adapter.fetchScore({ nationalId: '12345678' });

    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({ outcome: 'ok' });
  });
});

describe('createCreditBureauAdapter — input validation', () => {
  it('rejects nationalId shorter than 4 chars', async () => {
    const fetchMock = vi.fn();
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: 'abc' });

    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects nationalId longer than 64 chars', async () => {
    const fetchMock = vi.fn();
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: 'x'.repeat(65) });

    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createCreditBureauAdapter — output validation', () => {
  it('rejects score above 1000', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { ...validReport, score: 1500 }),
    );
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: '12345678' });

    expect(out.kind).toBe('validation-failed');
  });

  it('rejects unknown band', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { ...validReport, band: 'mediocre' }),
    );
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: '12345678' });

    expect(out.kind).toBe('validation-failed');
  });

  it('rejects negative delinquencies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { ...validReport, delinquencies: -5 }),
    );
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: '12345678' });

    expect(out.kind).toBe('validation-failed');
  });
});

describe('createCreditBureauAdapter — upstream errors', () => {
  it('returns upstream-error on 404 without retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { message: 'unknown id' }));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: '12345678' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.status).toBe(404);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then surfaces upstream-error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { message: 'unavailable' }));
    const adapter = createCreditBureauAdapter({ fetch: fetchMock });

    const out = await adapter.fetchScore({ nationalId: '12345678' });

    expect(out.kind).toBe('upstream-error');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('FetchScoreInputSchema / CreditScoreReportSchema', () => {
  it('accepts a valid input', () => {
    expect(FetchScoreInputSchema.safeParse({ nationalId: '12345' }).success).toBe(true);
  });

  it('accepts a valid report', () => {
    expect(CreditScoreReportSchema.safeParse(validReport).success).toBe(true);
  });

  it('rejects invalid report when score is non-integer', () => {
    expect(
      CreditScoreReportSchema.safeParse({ ...validReport, score: 720.5 }).success,
    ).toBe(false);
  });
});
