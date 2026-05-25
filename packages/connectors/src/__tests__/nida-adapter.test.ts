/**
 * Unit tests for createNidaAdapter — verifies the adapter composes a
 * BaseConnector with sane defaults, validates input via Zod, surfaces
 * upstream outcomes faithfully, and never lets a raw biometric template
 * leak through the schema.
 *
 * All IO is mocked (fetch + event/audit sinks). No network, no timers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNidaAdapter,
  VerifyIdentityInputSchema,
  NidaNumberSchema,
  BiometricHashSchema,
} from '../adapters/nida-adapter.js';
import { createInMemoryEventSink } from '../in-memory-event-sink.js';
import { createInMemoryAuditSink } from '../in-memory-audit-sink.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_HASH = 'a'.repeat(64);
const VALID_INPUT = {
  nidaNumber: '19900101001500012345',
  biometricHash: VALID_HASH,
};

const HAPPY_BODY = {
  verified: true,
  name: 'Asha Mwangi',
  dob: '1990-01-01',
  photo_match_score: 0.97,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createNidaAdapter — factory', () => {
  it('exposes connector with id "nida"', () => {
    const adapter = createNidaAdapter({ fetch: vi.fn() });
    expect(adapter.connector.id).toBe('nida');
  });

  it('uses stub baseUrl when none provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createNidaAdapter({ fetch: fetchMock });
    await adapter.verifyIdentity(VALID_INPUT);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://stub.nida.local')).toBe(true);
    expect(url).toContain('/v1/identity/verify');
  });

  it('respects override baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createNidaAdapter({
      fetch: fetchMock,
      baseUrl: 'https://nida.test',
    });
    await adapter.verifyIdentity(VALID_INPUT);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(new URL(url).host).toBe('nida.test');
  });
});

describe('createNidaAdapter — happy path', () => {
  it('returns ok with parsed body on 200 success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createNidaAdapter({ fetch: fetchMock });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.verified).toBe(true);
      expect(out.data.name).toBe('Asha Mwangi');
      expect(out.data.photo_match_score).toBeCloseTo(0.97);
    }
  });

  it('passes idempotency key through to fetch headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createNidaAdapter({ fetch: fetchMock });
    await adapter.verifyIdentity(VALID_INPUT, 'idem-nida-1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBe('idem-nida-1');
  });

  it('emits request + response events', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createNidaAdapter({ fetch: fetchMock, events });
    await adapter.verifyIdentity(VALID_INPUT);
    const kinds = events.events().map((e) => e.kind);
    expect(kinds).toContain('request');
    expect(kinds).toContain('response');
  });

  it('records an audit entry on success', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createNidaAdapter({ fetch: fetchMock, audit });
    await adapter.verifyIdentity(VALID_INPUT);
    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({
      outcome: 'ok',
      connectorId: 'nida',
    });
  });
});

describe('createNidaAdapter — input validation', () => {
  it('rejects nidaNumber with non-numeric characters', async () => {
    const fetchMock = vi.fn();
    const adapter = createNidaAdapter({ fetch: fetchMock });
    const out = await adapter.verifyIdentity({
      ...VALID_INPUT,
      nidaNumber: 'ABCD0000000000000000',
    });
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects nidaNumber with wrong length', async () => {
    const fetchMock = vi.fn();
    const adapter = createNidaAdapter({ fetch: fetchMock });
    const out = await adapter.verifyIdentity({
      ...VALID_INPUT,
      nidaNumber: '1234',
    });
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts hyphenated NIDA number form', () => {
    const parsed = NidaNumberSchema.safeParse('19900101-0015-000123-45');
    expect(parsed.success).toBe(true);
  });

  it('rejects a raw biometric template (non-hex)', async () => {
    const fetchMock = vi.fn();
    const adapter = createNidaAdapter({ fetch: fetchMock });
    const out = await adapter.verifyIdentity({
      ...VALID_INPUT,
      biometricHash: 'this-is-clearly-raw-fingerprint-data!!',
    });
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a biometric hash with the wrong length', () => {
    const parsed = BiometricHashSchema.safeParse('abc123');
    expect(parsed.success).toBe(false);
  });

  it('rejects uppercase-hex biometric hash', () => {
    // SHA-256 hex should be lowercase canonical.
    const parsed = BiometricHashSchema.safeParse('A'.repeat(64));
    expect(parsed.success).toBe(false);
  });
});

describe('createNidaAdapter — output validation', () => {
  it('returns validation-failed when upstream body misses fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { verified: true, name: 'A' }));
    const adapter = createNidaAdapter({ fetch: fetchMock });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('validation-failed');
  });

  it('returns validation-failed when photo_match_score out of range', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { ...HAPPY_BODY, photo_match_score: 2.5 }),
      );
    const adapter = createNidaAdapter({ fetch: fetchMock });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('validation-failed');
  });
});

describe('createNidaAdapter — upstream errors', () => {
  it('returns upstream-error on 4xx without retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { message: 'no record' }));
    const adapter = createNidaAdapter({ fetch: fetchMock });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.status).toBe(404);
      expect(out.message).toBe('no record');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('VerifyIdentityInputSchema', () => {
  it('accepts well-formed input', () => {
    expect(VerifyIdentityInputSchema.safeParse(VALID_INPUT).success).toBe(true);
  });
});
