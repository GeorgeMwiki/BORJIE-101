/**
 * Calendar OAuth — authorize-URL builder, signed-state round-trip, and the
 * authorization-code / refresh exchanges.
 *
 * Asserts:
 *   - Google + Microsoft authorize URLs carry the right endpoint, scopes,
 *     redirect_uri, response_type, offline-access knobs, and the opaque state.
 *   - The code exchange POSTs grant_type=authorization_code to the right token
 *     URL and requires a refresh token (offline access mandatory).
 *   - When the code exchange is paired with the store, the row holds ENCRYPTED
 *     tokens — never the plaintext returned by the provider.
 *   - Signed state round-trips and is rejected on tamper / expiry.
 *
 * No real network/secrets: the Fetcher seam is stubbed; keys are deterministic
 * test values passed by argument (never read from the real environment).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildAuthorizeUrl,
  encodeOAuthState,
  decodeOAuthState,
  exchangeAuthorizationCode,
  refreshAccessToken,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_CALENDAR_SCOPES,
  MICROSOFT_CALENDAR_SCOPES,
  microsoftAuthUrl,
  microsoftTokenUrl,
  type CalendarOAuthConfig,
  type Fetcher,
} from '../oauth';
import {
  createCalendarTokenCipher,
  isSealedCalendarToken,
} from '../token-cipher';
import {
  createCalendarConnectionStore,
  type DrizzleLike,
} from '../connection-store';

const KEY = Buffer.alloc(32, 11).toString('base64');
const STATE_ENV = { CALENDAR_OAUTH_STATE_SECRET: 'state-signing-secret' };

const config: CalendarOAuthConfig = {
  redirectUri: 'https://api.borjie.app/api/v1/owner/calendar/callback',
  google: {
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
    msTenant: 'common',
  },
  microsoft: {
    clientId: 'ms-client-id',
    clientSecret: 'ms-client-secret',
    msTenant: 'contoso-tenant',
  },
};

interface StubResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json?: unknown;
  readonly text?: string;
}

function stubFetcher(response: StubResponse): Fetcher {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.json ?? {},
    text: async () => response.text ?? '',
  }));
}

type FetchMock = ReturnType<typeof vi.fn>;

/**
 * Extract the bound values of a drizzle `sql` template. Drizzle interleaves
 * literal `StringChunk`s with the raw interpolated JS values; the bound params
 * are every chunk that is NOT a StringChunk (recursing into nested fragments).
 */
function boundStrings(query: any): string[] {
  const out: unknown[] = [];
  const visit = (node: any): void => {
    if (node == null) return;
    if (typeof node === 'string' || node instanceof Date) {
      out.push(node);
      return;
    }
    if (Array.isArray(node.queryChunks)) {
      node.queryChunks.forEach(visit);
      return;
    }
    const ctor = node.constructor?.name;
    if (ctor === 'StringChunk') return;
    if (ctor === 'Param') {
      visit(node.value);
      return;
    }
    if (ctor === 'String') out.push(node.valueOf());
  };
  for (const chunk of query?.queryChunks ?? []) visit(chunk);
  return out.filter((p): p is string => typeof p === 'string');
}

// ──────────────────────────────────────────────────────────────────────────
// Authorize-URL builder
// ──────────────────────────────────────────────────────────────────────────

describe('buildAuthorizeUrl — Google', () => {
  it('builds the consent URL with scopes, redirect, offline knobs, and state', () => {
    const url = new URL(
      buildAuthorizeUrl({ provider: 'google', config, state: 'STATE123' }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_URL);
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('google-client-id');
    expect(q.get('redirect_uri')).toBe(config.redirectUri);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe(GOOGLE_CALENDAR_SCOPES.join(' '));
    // Offline-access knobs so a refresh token is always returned.
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('include_granted_scopes')).toBe('true');
    expect(q.get('state')).toBe('STATE123');
  });
});

describe('buildAuthorizeUrl — Microsoft', () => {
  it('builds the tenant-scoped consent URL with offline_access scope + state', () => {
    const url = new URL(
      buildAuthorizeUrl({ provider: 'microsoft', config, state: 'ST8' }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(microsoftAuthUrl('contoso-tenant'));
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('ms-client-id');
    expect(q.get('redirect_uri')).toBe(config.redirectUri);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('response_mode')).toBe('query');
    expect(q.get('scope')).toBe(MICROSOFT_CALENDAR_SCOPES.join(' '));
    expect(q.get('scope')).toContain('offline_access');
    expect(q.get('state')).toBe('ST8');
  });

  it('throws when the provider is not configured', () => {
    expect(() =>
      buildAuthorizeUrl({
        provider: 'google',
        config: { ...config, google: null },
        state: 's',
      }),
    ).toThrow(/not configured/i);
  });

  it('throws when the redirect URI is missing', () => {
    expect(() =>
      buildAuthorizeUrl({
        provider: 'google',
        config: { ...config, redirectUri: '' },
        state: 's',
      }),
    ).toThrow(/redirect/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Signed state — CSRF + identity carrier
// ──────────────────────────────────────────────────────────────────────────

describe('encodeOAuthState / decodeOAuthState', () => {
  const state = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    provider: 'google' as const,
  };

  it('round-trips a signed state', () => {
    const encoded = encodeOAuthState(state, STATE_ENV);
    expect(decodeOAuthState(encoded, STATE_ENV)).toEqual(state);
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const encoded = encodeOAuthState(state, STATE_ENV);
    const [payload, mac] = encoded.split('.');
    const tampered = `${payload}x.${mac}`;
    expect(decodeOAuthState(tampered, STATE_ENV)).toBeNull();
  });

  it('rejects an expired state', () => {
    const issuedAt = 1_000_000;
    const encoded = encodeOAuthState(state, STATE_ENV, issuedAt);
    // 11 minutes later — past the 10-minute TTL.
    const later = issuedAt + 11 * 60 * 1000;
    expect(decodeOAuthState(encoded, STATE_ENV, later)).toBeNull();
  });

  it('rejects a state signed under a different secret', () => {
    const encoded = encodeOAuthState(state, STATE_ENV);
    expect(
      decodeOAuthState(encoded, { CALENDAR_OAUTH_STATE_SECRET: 'other' }),
    ).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Authorization-code exchange
// ──────────────────────────────────────────────────────────────────────────

describe('exchangeAuthorizationCode', () => {
  it('POSTs grant_type=authorization_code to the Google token URL', async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      json: {
        access_token: 'g-access',
        refresh_token: 'g-refresh',
        expires_in: 3600,
        scope: 'calendar',
      },
    });
    const tokens = await exchangeAuthorizationCode({
      provider: 'google',
      config,
      code: 'auth-code-xyz',
      deps: { fetcher, now: () => 1_000 },
    });

    expect(tokens.accessToken).toBe('g-access');
    expect(tokens.refreshToken).toBe('g-refresh');
    expect(tokens.expiresAt).toBe(1_000 + 3600 * 1000);

    const [url, init] = (fetcher as FetchMock).mock.calls[0];
    expect(url).toBe(GOOGLE_TOKEN_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-xyz');
    expect(body.get('client_id')).toBe('google-client-id');
    expect(body.get('client_secret')).toBe('google-client-secret');
    expect(body.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('POSTs to the tenant-scoped Microsoft token URL with the scope param', async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      json: {
        access_token: 'm-access',
        refresh_token: 'm-refresh',
        expires_in: 3600,
      },
    });
    await exchangeAuthorizationCode({
      provider: 'microsoft',
      config,
      code: 'code-1',
      deps: { fetcher },
    });
    const [url, init] = (fetcher as FetchMock).mock.calls[0];
    expect(url).toBe(microsoftTokenUrl('contoso-tenant'));
    const body = new URLSearchParams(init.body as string);
    expect(body.get('scope')).toBe(MICROSOFT_CALENDAR_SCOPES.join(' '));
  });

  it('rejects an empty authorization code before any HTTP call', async () => {
    const fetcher = vi.fn();
    await expect(
      exchangeAuthorizationCode({
        provider: 'google',
        config,
        code: '   ',
        deps: { fetcher: fetcher as unknown as Fetcher },
      }),
    ).rejects.toThrow(/non-empty/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('throws when offline access is missing (no refresh token returned)', async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      json: { access_token: 'a', expires_in: 3600 },
    });
    await expect(
      exchangeAuthorizationCode({
        provider: 'google',
        config,
        code: 'c',
        deps: { fetcher },
      }),
    ).rejects.toThrow(/refresh token/i);
  });

  it('throws on a non-2xx token response', async () => {
    const fetcher = stubFetcher({ ok: false, status: 400, text: 'bad' });
    await expect(
      exchangeAuthorizationCode({
        provider: 'google',
        config,
        code: 'c',
        deps: { fetcher },
      }),
    ).rejects.toThrow(/400/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Code exchange → store: tokens are ENCRYPTED at rest, never plaintext
// ──────────────────────────────────────────────────────────────────────────

describe('code exchange then store — tokens are sealed, never plaintext', () => {
  it('persists ciphertext for both refresh + access tokens', async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      json: {
        access_token: 'PLAINTEXT-ACCESS',
        refresh_token: 'PLAINTEXT-REFRESH',
        expires_in: 3600,
        scope: 'calendar',
      },
    });
    const tokens = await exchangeAuthorizationCode({
      provider: 'google',
      config,
      code: 'c',
      deps: { fetcher },
    });

    // Capture the bound parameters the store hands to the DB.
    const captured: string[][] = [];
    const db: DrizzleLike = {
      async execute(query: unknown) {
        captured.push(boundStrings(query));
        return { rows: [] };
      },
    };
    const cipher = createCalendarTokenCipher(KEY);
    const store = createCalendarConnectionStore(db, cipher);

    await store.upsert({
      tenantId: 'tenant-1',
      userId: 'user-1',
      provider: 'google',
      refreshToken: tokens.refreshToken as string,
      accessToken: tokens.accessToken,
      tokenExpiresAt: new Date(tokens.expiresAt),
      calendarId: 'primary',
      scope: tokens.scope,
    });

    const flat = captured.flat();
    // The plaintext tokens NEVER appear in any bound parameter.
    expect(flat).not.toContain('PLAINTEXT-ACCESS');
    expect(flat).not.toContain('PLAINTEXT-REFRESH');
    // Sealed blobs DO appear, and they decrypt back to the originals.
    const sealedBlobs = flat.filter(isSealedCalendarToken);
    expect(sealedBlobs.length).toBeGreaterThanOrEqual(2);
    const decrypted = sealedBlobs.map((b) => cipher.open(b));
    expect(decrypted).toContain('PLAINTEXT-ACCESS');
    expect(decrypted).toContain('PLAINTEXT-REFRESH');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Refresh exchange
// ──────────────────────────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  it('POSTs grant_type=refresh_token and computes the absolute expiry', async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      json: { access_token: 'fresh-access', expires_in: 1800 },
    });
    const tokens = await refreshAccessToken({
      provider: 'google',
      config,
      refreshToken: 'the-refresh-token',
      deps: { fetcher, now: () => 5_000 },
    });
    expect(tokens.accessToken).toBe('fresh-access');
    // No rotated refresh token in this response → null (caller keeps existing).
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.expiresAt).toBe(5_000 + 1800 * 1000);

    const [url, init] = (fetcher as FetchMock).mock.calls[0];
    expect(url).toBe(GOOGLE_TOKEN_URL);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('the-refresh-token');
  });

  it('surfaces a rotated refresh token when the provider returns one', async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      json: {
        access_token: 'a2',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      },
    });
    const tokens = await refreshAccessToken({
      provider: 'microsoft',
      config,
      refreshToken: 'old-refresh',
      deps: { fetcher },
    });
    expect(tokens.refreshToken).toBe('rotated-refresh');
  });

  it('throws on a non-2xx refresh response', async () => {
    const fetcher = stubFetcher({ ok: false, status: 401, text: 'invalid_grant' });
    await expect(
      refreshAccessToken({
        provider: 'google',
        config,
        refreshToken: 'x',
        deps: { fetcher },
      }),
    ).rejects.toThrow(/401/);
  });
});
