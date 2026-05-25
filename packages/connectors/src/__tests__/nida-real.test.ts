/**
 * Unit tests for createNidaRealAdapter — verifies sandbox-vs-prod env
 * selection, OAuth2 + api-key auth modes, retry-after handling, and
 * the 3 outcomes (verified / unverified / gateway-error).
 *
 * All IO mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNidaRealAdapter } from '../adapters/nida-real.js';

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

const HAPPY = {
  verified: true,
  name: 'Asha Mwangi',
  dob: '1990-01-01',
  photo_match_score: 0.97,
};

beforeEach(() => {
  vi.useRealTimers();
});

describe('createNidaRealAdapter — env selection', () => {
  it('defaults to sandbox base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY));
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    await adapter.verifyIdentity(VALID_INPUT);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://nivs-sandbox.nida.go.tz')).toBe(true);
  });

  it('uses production URL when env=production', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY));
    const adapter = createNidaRealAdapter({
      env: 'production',
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    await adapter.verifyIdentity(VALID_INPUT);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://nivs.nida.go.tz')).toBe(true);
  });
});

describe('createNidaRealAdapter — api-key auth', () => {
  it('sends configured header on verify', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY));
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', headerName: 'x-nida-token', key: 'tk' },
      fetch: fetchMock,
    });
    await adapter.verifyIdentity(VALID_INPUT);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['x-nida-token']).toBe('tk');
  });

  it('strips hyphens from NIDA number before forwarding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY));
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    await adapter.verifyIdentity({
      nidaNumber: '19900101-0015-000123-45',
      biometricHash: VALID_HASH,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body.nidaNumber).toBe('19900101001500012345');
  });
});

describe('createNidaRealAdapter — OAuth2 auth', () => {
  it('fetches access token then verifies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'AT', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(200, HAPPY));
    const adapter = createNidaRealAdapter({
      auth: { kind: 'oauth2', consumerKey: 'ck', consumerSecret: 'cs' },
      fetch: fetchMock,
    });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('ok');
    expect(adapter.tokenExpiryMs()).not.toBeNull();
  });
});

describe('createNidaRealAdapter — outcomes', () => {
  it('verified -> ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY));
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.data.verified).toBe(true);
  });

  it('unverified payload (verified=false) -> ok with verified=false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { ...HAPPY, verified: false, photo_match_score: 0.3 }),
    );
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.data.verified).toBe(false);
  });

  it('gateway 5xx -> upstream-error or transport-error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { message: 'unavailable' }));
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(['upstream-error', 'transport-error']).toContain(out.kind);
  });

  it('429 translates to rate-limited outcome', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { message: 'slow down' }));
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    const out = await adapter.verifyIdentity(VALID_INPUT);
    expect(out.kind).toBe('rate-limited');
  });

  it('validation-failed for malformed NIDA number', async () => {
    const fetchMock = vi.fn();
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    const out = await adapter.verifyIdentity({
      nidaNumber: 'not-valid',
      biometricHash: VALID_HASH,
    });
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validation-failed for raw biometric template', async () => {
    const fetchMock = vi.fn();
    const adapter = createNidaRealAdapter({
      auth: { kind: 'api-key', key: 'k' },
      fetch: fetchMock,
    });
    const out = await adapter.verifyIdentity({
      nidaNumber: '19900101001500012345',
      biometricHash: 'plaintext-template',
    });
    expect(out.kind).toBe('validation-failed');
  });
});
