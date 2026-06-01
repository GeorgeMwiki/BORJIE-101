/**
 * /api/v1/owner/calendar — connect / callback / status / disconnect route.
 *
 * Mounts the real Hono router against a stub CalendarChannel + injected auth/db
 * context (auth + database middleware are mocked so each endpoint runs
 * end-to-end through `app.request()`).
 *
 * Covered:
 *   - connect → 302 redirect to the provider consent URL carrying a signed state
 *     (and the right scopes); 503 when the channel / provider creds are absent;
 *     400 on an unsupported provider.
 *   - callback → exchanges the code and stores SEALED tokens (asserts the row
 *     receives ciphertext, never the plaintext returned by the exchange);
 *     400 on a bad/expired state; 400 on consent-denied.
 *   - status → token-free connection list.
 *   - disconnect → soft-revoke count, optional provider filter.
 *
 * No real network/secrets: the OAuth code exchange is stubbed (leaf `./oauth`
 * mock); the state helpers + authorize-URL builder remain real so the redirect
 * and state round-trip are genuinely exercised. The store is a spy that runs the
 * REAL cipher so the "sealed at rest" invariant is proven, not assumed.
 *
 * NOTE: the route builds its `z.enum(CALENDAR_PROVIDERS)` schemas LAZILY inside
 * createCalendarRouter (not at module top-level), so by the time these tests call
 * it the provider enum is always fully initialised. No `@borjie/database/schemas`
 * mock is needed — the earlier subpath circular-init workaround was removed once
 * that root cause was fixed. The `connect/yahoo -> 400` and
 * `disconnect?provider=microsoft -> 200` cases below are the regression guards.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { UserRole } from '../../../types/user-role';

// ── Mock auth + database middleware (hoisted). Auth/db come from globals. ────
vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_CAL_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
  // Enforce like the real guard so the suite genuinely protects the owner-only
  // restriction (HIGH-1): a non-owner role must 403, not slip through a no-op.
  requireRole:
    (...roles: string[]) =>
    async (c: any, next: any) => {
      const auth = c.get('auth');
      if (!auth) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
      }
      if (!roles.includes(auth.role)) {
        return c.json({ success: false, error: { code: 'FORBIDDEN' } }, 403);
      }
      await next();
    },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    c.set('db', (globalThis as any).__BORJIE_CAL_DB__ ?? null);
    c.set('repos', {});
    c.set('useMockData', false);
    await next();
  },
}));

// ── Stub only the OAuth code exchange. We mock the LEAF `./oauth` module (not
//    the heavy barrel) so the barrel's `export *` re-export resolves the route's
//    `exchangeAuthorizationCode` binding to our spy, while every other helper
//    (state signing, authorize-URL builder) stays REAL and the barrel→schema
//    module init order is left undisturbed.
//    `vi.hoisted` makes the spy available to the hoisted `vi.mock` factory.
const { exchangeAuthorizationCodeMock } = vi.hoisted(() => ({
  exchangeAuthorizationCodeMock: vi.fn(),
}));
vi.mock(
  '../../../services/notification-dispatch/calendar-providers/oauth',
  async (importActual) => {
    const actual = (await importActual()) as Record<string, unknown>;
    return {
      ...actual,
      exchangeAuthorizationCode: exchangeAuthorizationCodeMock,
    };
  },
);

import { Hono } from 'hono';

import { createCalendarRouter } from '../calendar.hono';
import {
  encodeOAuthState,
  GOOGLE_CALENDAR_SCOPES,
  type CalendarChannel,
} from '../../../services/notification-dispatch/calendar-providers';
import {
  createCalendarTokenCipher,
  isSealedCalendarToken,
} from '../../../services/notification-dispatch/calendar-providers/token-cipher';

const STATE_ENV = {
  CALENDAR_OAUTH_STATE_SECRET: 'route-state-secret',
} as NodeJS.ProcessEnv;

const KEY = Buffer.alloc(32, 17).toString('base64');

const oauthConfig = {
  redirectUri: 'https://api.borjie.app/api/v1/owner/calendar/callback',
  google: { clientId: 'g-id', clientSecret: 'g-secret', msTenant: 'common' },
  microsoft: { clientId: 'm-id', clientSecret: 'm-secret', msTenant: 'common' },
} as const;

/** A stub channel whose store records the values handed to it. */
function stubChannel(overrides: Partial<CalendarChannel> = {}): {
  channel: CalendarChannel;
  upsertArgs: Array<Record<string, unknown>>;
  disconnectArgs: unknown[][];
} {
  const upsertArgs: Array<Record<string, unknown>> = [];
  const disconnectArgs: unknown[][] = [];
  const cipher = createCalendarTokenCipher(KEY);

  const store = {
    upsert: vi.fn(async (input: Record<string, unknown>) => {
      // Seal here exactly as the real store would, so the test can assert the
      // persisted column would hold ciphertext (never plaintext).
      upsertArgs.push({
        ...input,
        sealedRefresh: cipher.seal(String(input.refreshToken)),
        sealedAccess: input.accessToken
          ? cipher.seal(String(input.accessToken))
          : null,
      });
      return { id: 'cal_new' };
    }),
    disconnect: vi.fn(async (...args: unknown[]) => {
      disconnectArgs.push(args);
      return 2;
    }),
    listStatus: vi.fn(async () => [
      {
        id: 'cal_1',
        provider: 'google' as const,
        calendarId: 'primary',
        scope: 'calendar',
        connectedAt: '2026-05-01T00:00:00.000Z',
        tokenExpiresAt: '2026-06-01T00:00:00.000Z',
      },
    ]),
    getActive: vi.fn(async () => null),
    updateTokens: vi.fn(async () => {}),
  };

  const channel: CalendarChannel = {
    configured: true,
    cipher,
    oauthConfig,
    providers: {} as CalendarChannel['providers'],
    store: store as unknown as CalendarChannel['store'],
    delivery: {} as CalendarChannel['delivery'],
    ...overrides,
  };
  return { channel, upsertArgs, disconnectArgs };
}

function mount(channel: CalendarChannel | null): Hono {
  const app = new Hono();
  app.route('/owner/calendar', createCalendarRouter({ channel, env: STATE_ENV }));
  return app;
}

beforeEach(() => {
  (globalThis as any).__BORJIE_CAL_AUTH__ = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: UserRole.OWNER,
  };
  (globalThis as any).__BORJIE_CAL_DB__ = {
    execute: vi.fn(async () => ({ rows: [] })),
  };
  exchangeAuthorizationCodeMock.mockReset();
});

describe('GET /owner/calendar/connect/:provider', () => {
  it('302-redirects to the Google consent URL with scopes + signed state', async () => {
    const { channel } = stubChannel();
    const res = await mount(channel).request('/owner/calendar/connect/google');

    expect(res.status).toBe(302);
    const location = res.headers.get('location') as string;
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPES.join(' '));
    expect(url.searchParams.get('redirect_uri')).toBe(oauthConfig.redirectUri);
    // State must be present and non-empty (signed CSRF/identity carrier).
    expect((url.searchParams.get('state') ?? '').length).toBeGreaterThan(10);
  });

  it('401 when unauthenticated', async () => {
    (globalThis as any).__BORJIE_CAL_AUTH__ = null;
    const { channel } = stubChannel();
    const res = await mount(channel).request('/owner/calendar/connect/google');
    expect(res.status).toBe(401);
  });

  it('403 when authenticated but not an owner (HIGH-1 least-privilege guard)', async () => {
    (globalThis as any).__BORJIE_CAL_AUTH__ = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: UserRole.ACCOUNTANT,
    };
    const { channel } = stubChannel();
    const res = await mount(channel).request('/owner/calendar/connect/google');
    expect(res.status).toBe(403);
  });

  it('503 when the channel is disabled (no token key configured)', async () => {
    const res = await mount(null).request('/owner/calendar/connect/google');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('CALENDAR_NOT_CONFIGURED');
  });

  it('400 on an unsupported provider', async () => {
    const { channel } = stubChannel();
    const res = await mount(channel).request('/owner/calendar/connect/yahoo');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('UNSUPPORTED_PROVIDER');
  });

  it('503 when the provider has no OAuth client credentials', async () => {
    const { channel } = stubChannel({
      oauthConfig: { ...oauthConfig, google: null },
    });
    const res = await mount(channel).request('/owner/calendar/connect/google');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('PROVIDER_OAUTH_NOT_CONFIGURED');
  });
});

describe('GET /owner/calendar/callback', () => {
  function validState(): string {
    return encodeOAuthState(
      { tenantId: 'tenant-1', userId: 'user-1', provider: 'google' },
      STATE_ENV,
    );
  }

  it('exchanges the code and stores SEALED tokens (never plaintext)', async () => {
    exchangeAuthorizationCodeMock.mockResolvedValue({
      accessToken: 'PLAINTEXT-ACCESS',
      refreshToken: 'PLAINTEXT-REFRESH',
      expiresAt: Date.now() + 3600_000,
      scope: 'calendar',
    });
    const { channel, upsertArgs } = stubChannel();

    const res = await mount(channel).request(
      `/owner/calendar/callback?code=auth-code&state=${encodeURIComponent(validState())}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.connected).toBe(true);
    expect(body.data.provider).toBe('google');

    // The store was handed the PLAINTEXT tokens (it seals internally) — assert
    // what would land in the column is SEALED, and round-trips back.
    expect(upsertArgs).toHaveLength(1);
    const persisted = upsertArgs[0];
    expect(persisted.tenantId).toBe('tenant-1');
    expect(persisted.userId).toBe('user-1');
    const sealedRefresh = persisted.sealedRefresh as string;
    const sealedAccess = persisted.sealedAccess as string;
    expect(isSealedCalendarToken(sealedRefresh)).toBe(true);
    expect(isSealedCalendarToken(sealedAccess)).toBe(true);
    expect(sealedRefresh).not.toContain('PLAINTEXT-REFRESH');
    expect(sealedAccess).not.toContain('PLAINTEXT-ACCESS');
    expect(channel.cipher.open(sealedRefresh)).toBe('PLAINTEXT-REFRESH');
    expect(channel.cipher.open(sealedAccess)).toBe('PLAINTEXT-ACCESS');

    // The RLS GUC was bound from the VERIFIED state tenant before the write.
    const dbExec = (globalThis as any).__BORJIE_CAL_DB__.execute;
    expect(dbExec).toHaveBeenCalled();
  });

  it('400 when the state fails verification', async () => {
    const { channel } = stubChannel();
    const res = await mount(channel).request(
      '/owner/calendar/callback?code=auth-code&state=tampered.value',
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_STATE');
  });

  it('400 when the provider reports consent denied', async () => {
    const { channel } = stubChannel();
    const res = await mount(channel).request(
      '/owner/calendar/callback?error=access_denied&error_description=nope',
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('OAUTH_CONSENT_DENIED');
  });

  it('400 when code or state is missing', async () => {
    const { channel } = stubChannel();
    const res = await mount(channel).request(
      `/owner/calendar/callback?state=${encodeURIComponent(validState())}`,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('MISSING_CODE_OR_STATE');
  });

  it('502 when the code exchange throws', async () => {
    exchangeAuthorizationCodeMock.mockRejectedValue(new Error('token endpoint 400'));
    const { channel } = stubChannel();
    const res = await mount(channel).request(
      `/owner/calendar/callback?code=bad&state=${encodeURIComponent(validState())}`,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('OAUTH_EXCHANGE_FAILED');
  });
});

describe('GET /owner/calendar/status', () => {
  it('returns the token-free connection list', async () => {
    const { channel } = stubChannel();
    const res = await mount(channel).request('/owner/calendar/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.configured).toBe(true);
    expect(body.data.connections).toHaveLength(1);
    const conn = body.data.connections[0];
    expect(conn.id).toBe('cal_1');
    // No token field leaks into the status view.
    expect(conn).not.toHaveProperty('encryptedRefreshToken');
    expect(conn).not.toHaveProperty('refreshToken');
  });

  it('reports configured:false with an empty list when the channel is disabled', async () => {
    const res = await mount(null).request('/owner/calendar/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.configured).toBe(false);
    expect(body.data.connections).toEqual([]);
  });
});

describe('DELETE /owner/calendar/disconnect', () => {
  it('soft-revokes all connections and returns the count', async () => {
    const { channel, disconnectArgs } = stubChannel();
    const res = await mount(channel).request('/owner/calendar/disconnect', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(2);
    // Scoped to (tenant,user); no provider filter passed.
    expect(disconnectArgs[0][0]).toBe('tenant-1');
    expect(disconnectArgs[0][1]).toBe('user-1');
    expect(disconnectArgs[0][2]).toBeUndefined();
  });

  it('passes the provider filter when supplied', async () => {
    const { channel, disconnectArgs } = stubChannel();
    const res = await mount(channel).request(
      '/owner/calendar/disconnect?provider=microsoft',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    expect(disconnectArgs[0][2]).toBe('microsoft');
  });

  it('503 when the channel is disabled', async () => {
    const res = await mount(null).request('/owner/calendar/disconnect', {
      method: 'DELETE',
    });
    expect(res.status).toBe(503);
  });
});
