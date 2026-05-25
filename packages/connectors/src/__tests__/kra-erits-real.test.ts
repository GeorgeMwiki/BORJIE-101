/**
 * Unit tests for createKraEritsRealAdapter — covers happy paths + 3
 * error paths (network timeout, 401 expired, 500 server).
 *
 * All IO mocked; no real network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createKraEritsRealAdapter,
  validateTaxPeriod,
  type KraEritsCredentials,
  type SubmitMriInput,
} from '../adapters/kra-erits-real.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CREDS: KraEritsCredentials = Object.freeze({
  username: 'A123456789Z',
  password: 'pw',
});

// April 18 2026 — well after most plausible test periods.
const NOW_MS = Date.UTC(2026, 3, 18, 12);

const VALID_INPUT: SubmitMriInput = Object.freeze({
  taxPeriod: '2026-03',
  entityPin: 'A123456789Z',
  owners: Object.freeze([
    {
      kraPin: 'A234567891Z',
      fullName: 'Owner One',
      grossKes: 100_000,
      deductionsKes: 10_000,
      propertyRef: 'unit-1',
    },
  ]) as unknown as SubmitMriInput['owners'],
  submissionRef: 'sub-1',
});

beforeEach(() => {
  vi.useRealTimers();
});

describe('validateTaxPeriod (pure)', () => {
  it('rejects malformed period', () => {
    const r = validateTaxPeriod('bad', NOW_MS);
    expect(r.ok).toBe(false);
  });

  it('rejects period still open', () => {
    const r = validateTaxPeriod('2026-04', NOW_MS);
    expect(r.ok).toBe(false);
  });

  it('rejects period >12 months old', () => {
    const r = validateTaxPeriod('2024-01', NOW_MS);
    expect(r.ok).toBe(false);
  });

  it('accepts valid closed period', () => {
    const r = validateTaxPeriod('2026-03', NOW_MS);
    expect(r.ok).toBe(true);
  });
});

describe('createKraEritsRealAdapter — factory', () => {
  it('exposes connector with id "kra-erits"', () => {
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: vi.fn(),
      clock: () => NOW_MS,
    });
    expect(adapter.connector.id).toBe('kra-erits');
  });

  it('refuses construction without username/password', () => {
    expect(() =>
      createKraEritsRealAdapter({
        credentials: { username: '', password: '' },
        fetch: vi.fn(),
      }),
    ).toThrowError(/username/);
  });

  it('selects production base URL when env=production', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          submissionId: 's1',
          status: 'queued',
        }),
      );
    const adapter = createKraEritsRealAdapter({
      env: 'production',
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri(VALID_INPUT);
    expect(out.kind).toBe('ok');
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://itax.kra.go.ke')).toBe(true);
  });
});

describe('createKraEritsRealAdapter — happy paths', () => {
  it('submitMri returns ok on 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse(200, { submissionId: 's1', status: 'queued' }));
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri(VALID_INPUT, 'idem-1');
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.submissionId).toBe('s1');
      expect(out.data.status).toBe('queued');
    }
  });

  it('getReceipt returns parsed status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          submissionId: 's1',
          status: 'accepted',
          receiptNumber: 'R-007',
          finalisedAt: '2026-04-18T10:00:00Z',
        }),
      );
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.getReceipt({ submissionId: 's1' });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.status).toBe('accepted');
      expect(out.data.receiptNumber).toBe('R-007');
    }
  });

  it('cancelFiling returns cancelled=true', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse(200, { submissionId: 's1', cancelled: true }));
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.cancelFiling({ submissionId: 's1', reason: 'wrong data' });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.cancelled).toBe(true);
    }
  });

  it('validatePeriod helper composes against current clock', () => {
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: vi.fn(),
      clock: () => NOW_MS,
    });
    const r = adapter.validatePeriod('2026-03');
    expect(r.ok).toBe(true);
  });
});

describe('createKraEritsRealAdapter — schema version gate', () => {
  it('refuses submit when schema mismatch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse(200, { version: '2.0' }));
    const adapter = createKraEritsRealAdapter({
      credentials: { ...CREDS, expectedSchemaVersion: '3.0' },
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri(VALID_INPUT);
    expect(out.kind).toBe('unconfigured');
  });

  it('accepts submit when schema matches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse(200, { version: '3.5' }))
      .mockResolvedValueOnce(jsonResponse(200, { submissionId: 's1', status: 'queued' }));
    const adapter = createKraEritsRealAdapter({
      credentials: { ...CREDS, expectedSchemaVersion: '3.5' },
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri(VALID_INPUT);
    expect(out.kind).toBe('ok');
  });
});

describe('createKraEritsRealAdapter — error paths', () => {
  it('surfaces upstream-error on 500 (after retries)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockResolvedValue(jsonResponse(500, { message: 'internal error' }));
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri(VALID_INPUT);
    expect(['upstream-error', 'transport-error']).toContain(out.kind);
  });

  it('refreshes session on 401 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-2', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse(200, { submissionId: 's-ok', status: 'queued' }));
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri(VALID_INPUT);
    expect(out.kind).toBe('ok');
  });

  it('returns transport-error when fetch rejects', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', expires_in: 1800 }))
      .mockRejectedValue(new Error('network down'));
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri(VALID_INPUT);
    expect(out.kind).toBe('transport-error');
  });

  it('returns validation-failed for malformed input', async () => {
    const fetchMock = vi.fn();
    const adapter = createKraEritsRealAdapter({
      credentials: CREDS,
      fetch: fetchMock,
      clock: () => NOW_MS,
    });
    const out = await adapter.submitMri({
      ...VALID_INPUT,
      taxPeriod: 'bad',
    });
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
