/**
 * Unit tests for createGepgRealAdapter — verifies sandbox-vs-prod env,
 * api-key auth, all four endpoints (generate / inquire / cancel /
 * reconcile), and the XML serializer helper.
 *
 * All IO mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGepgRealAdapter,
  toGepgBillXml,
  extractXmlTag,
  type GepgCredentials,
} from '../adapters/gepg-real.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CREDS: GepgCredentials = Object.freeze({
  spCode: 'SP001',
  apiKey: 'apikey',
});

beforeEach(() => {
  vi.useRealTimers();
});

describe('createGepgRealAdapter — env selection', () => {
  it('defaults to sandbox base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        controlNumber: '991234567890',
        billRef: 'b-1',
        status: 'issued',
        issuedAt: '2026-05-18T00:00:00Z',
      }),
    );
    const adapter = createGepgRealAdapter({ credentials: CREDS, fetch: fetchMock });
    await adapter.generateControlNumber({
      billRef: 'b-1',
      payerName: 'John Doe',
      payerContact: '+255712345678',
      amountCents: 50_000_00,
      spCode: 'SP001',
      serviceCode: 'RENT',
      description: 'rent april',
      expiresAt: '2026-06-01',
    });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://gepg-sandbox.go.tz')).toBe(true);
  });

  it('uses production URL when env=production', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        controlNumber: '991234567890',
        billRef: 'b-1',
        status: 'issued',
        issuedAt: '2026-05-18T00:00:00Z',
      }),
    );
    const adapter = createGepgRealAdapter({
      env: 'production',
      credentials: CREDS,
      fetch: fetchMock,
    });
    await adapter.generateControlNumber({
      billRef: 'b-1',
      payerName: 'John Doe',
      payerContact: '+255712345678',
      amountCents: 50_000_00,
      spCode: 'SP001',
      serviceCode: 'RENT',
      description: 'rent april',
      expiresAt: '2026-06-01',
    });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://gepg.go.tz')).toBe(true);
  });

  it('refuses to construct without spCode/apiKey', () => {
    expect(() =>
      createGepgRealAdapter({
        credentials: { spCode: '', apiKey: '' },
        fetch: vi.fn(),
      }),
    ).toThrowError(/apiKey/);
  });
});

describe('createGepgRealAdapter — generateControlNumber', () => {
  it('returns ok with parsed body on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        controlNumber: '991234567890',
        billRef: 'b-1',
        status: 'issued',
        issuedAt: '2026-05-18T00:00:00Z',
      }),
    );
    const adapter = createGepgRealAdapter({ credentials: CREDS, fetch: fetchMock });
    const out = await adapter.generateControlNumber(
      {
        billRef: 'b-1',
        payerName: 'John Doe',
        payerContact: '+255712345678',
        amountCents: 50_000_00,
        spCode: 'SP001',
        serviceCode: 'RENT',
        description: 'rent april',
        expiresAt: '2026-06-01',
      },
      'idem-1',
    );
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.controlNumber).toBe('991234567890');
      expect(out.data.status).toBe('issued');
    }
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['x-gepg-api-key']).toBe('apikey');
    expect(headers?.['Idempotency-Key']).toBe('idem-1');
  });

  it('rejects invalid expiresAt format', async () => {
    const fetchMock = vi.fn();
    const adapter = createGepgRealAdapter({ credentials: CREDS, fetch: fetchMock });
    const out = await adapter.generateControlNumber({
      billRef: 'b-1',
      payerName: 'John Doe',
      payerContact: '+255712345678',
      amountCents: 50_000_00,
      spCode: 'SP001',
      serviceCode: 'RENT',
      description: 'rent',
      expiresAt: 'not-a-date',
    });
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createGepgRealAdapter — inquireStatus / cancel / reconcile', () => {
  it('inquireStatus GETs the correct path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        controlNumber: '991234567890',
        status: 'paid',
        paidAt: '2026-05-18T10:00:00Z',
        amountTzs: 50_000,
        payerChannel: 'm-pesa',
      }),
    );
    const adapter = createGepgRealAdapter({ credentials: CREDS, fetch: fetchMock });
    const out = await adapter.inquireStatus({ controlNumber: '991234567890' });
    expect(out.kind).toBe('ok');
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/control-numbers/991234567890/status');
  });

  it('cancelControlNumber POSTs reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { controlNumber: '991234567890', cancelled: true }),
    );
    const adapter = createGepgRealAdapter({ credentials: CREDS, fetch: fetchMock });
    const out = await adapter.cancelControlNumber({
      controlNumber: '991234567890',
      reason: 'duplicate',
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.data.cancelled).toBe(true);
  });

  it('dailyReconciliation parses entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        businessDay: '2026-05-17',
        spCode: 'SP001',
        totalAmountTzs: 100_000,
        entries: [
          { controlNumber: '99100', amountTzs: 50_000, paidAt: '2026-05-17T08:00:00Z', channel: 'm-pesa' },
          { controlNumber: '99101', amountTzs: 50_000, paidAt: '2026-05-17T14:00:00Z', channel: 'bank' },
        ],
      }),
    );
    const adapter = createGepgRealAdapter({ credentials: CREDS, fetch: fetchMock });
    const out = await adapter.dailyReconciliation({
      businessDay: '2026-05-17',
      spCode: 'SP001',
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.entries).toHaveLength(2);
    }
  });
});

describe('toGepgBillXml + extractXmlTag (XML rail helpers)', () => {
  it('emits the expected envelope and round-trips through extractXmlTag', () => {
    const xml = toGepgBillXml(
      {
        billRef: 'b-1',
        payerName: 'John <Owner>',
        payerContact: '+255712345678',
        amountCents: 50_000_00,
        spCode: 'SP001',
        serviceCode: 'RENT',
        description: 'rent',
        expiresAt: '2026-06-01',
      },
      'SP001',
    );
    expect(xml).toContain('<SpCode>SP001</SpCode>');
    expect(xml).toContain('<PayerName>John &lt;Owner&gt;</PayerName>');
    expect(xml).toContain('<AmountTzs>50000</AmountTzs>');
    expect(extractXmlTag(xml, 'BillRef')).toBe('b-1');
    expect(extractXmlTag(xml, 'NotPresent')).toBeNull();
  });
});
