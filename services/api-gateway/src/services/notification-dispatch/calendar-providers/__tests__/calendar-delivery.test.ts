/**
 * CalendarDelivery — the `calendar` channel orchestration.
 *
 * Proves:
 *   1. Routing — the delivery picks the owner's ACTIVE connection and calls the
 *      matching provider (Google preferred when both linked; Microsoft when only
 *      MS is linked); no_connection when nothing is linked.
 *   2. Token refresh — when the stored access token is missing/near-expiry, it
 *      decrypts the REFRESH token, mints a fresh access token via the OAuth
 *      exchange, re-seals it through the store, and hands the FRESH token to the
 *      provider. When the access token is still fresh it is reused (no refresh).
 *   3. Idempotency — a reminder→event upsert delegates to the provider's
 *      idempotent upsert; a retry yields the SAME event id and never a duplicate
 *      (the provider is invoked with the same sourceId each time).
 *
 * No real network: the OAuth refresh runs through an injected fetcher seam; the
 * store, cipher, providers, and logger are all in-memory fakes/spies.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';

import { createCalendarDelivery } from '../calendar-delivery';
import type {
  ActiveConnectionRow,
  CalendarConnectionStore,
} from '../connection-store';
import type { CalendarTokenCipher } from '../token-cipher';
import type { CalendarOAuthConfig, Fetcher } from '../oauth';
import type {
  CalendarEventProvider,
  CalendarUpsertResult,
} from '../types';
import type { CalendarProvider } from '@borjie/database/schemas';

// ── A logger spy that satisfies the Pino surface the delivery touches. ──────
function fakeLogger(): Logger {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

// ── A cipher fake: seal/open are reversible string transforms so the test can
//    assert "the refresh token was DECRYPTED for the refresh call" and
//    "a fresh access token was RE-SEALED on write" without real crypto. ──────
function fakeCipher(): CalendarTokenCipher {
  return {
    seal: (plaintext: string) => `SEALED(${plaintext})`,
    open: (blob: string) => {
      const m = /^SEALED\((.*)\)$/.exec(blob);
      if (!m) throw new Error(`fakeCipher.open: not a sealed blob: ${blob}`);
      return m[1];
    },
  };
}

const oauthConfig: CalendarOAuthConfig = {
  redirectUri: 'https://api.borjie.app/api/v1/owner/calendar/callback',
  google: {
    clientId: 'g-id',
    clientSecret: 'g-secret',
    msTenant: 'common',
  },
  microsoft: { clientId: 'm-id', clientSecret: 'm-secret', msTenant: 'common' },
};

const NOW = 1_700_000_000_000;

function activeRow(
  partial: Partial<ActiveConnectionRow> & { provider: CalendarProvider },
): ActiveConnectionRow {
  return {
    id: 'cal_1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    encryptedRefreshToken: 'SEALED(refresh-plain)',
    encryptedAccessToken: 'SEALED(access-plain)',
    tokenExpiresAt: new Date(NOW + 60 * 60 * 1000), // fresh by default
    calendarId: 'primary',
    scope: 'calendar',
    ...partial,
  };
}

/**
 * Build a store fake. `active` maps provider → row (or null). updateTokens
 * records the re-seal so the refresh path can be asserted.
 */
function fakeStore(active: Partial<Record<CalendarProvider, ActiveConnectionRow | null>>) {
  const updateTokens = vi.fn(async () => {});
  const store: CalendarConnectionStore = {
    upsert: vi.fn(async () => ({ id: 'cal_1' })),
    disconnect: vi.fn(async () => 0),
    listStatus: vi.fn(async () => []),
    getActive: vi.fn(async (_t: string, _u: string, provider: CalendarProvider) =>
      active[provider] ?? null,
    ),
    updateTokens,
  };
  return { store, updateTokens };
}

/** A provider spy that records (accessToken, input) and returns a scripted result. */
function spyProvider(
  provider: CalendarProvider,
  result: CalendarUpsertResult,
): CalendarEventProvider & { readonly calls: Array<[string, { sourceId: string }]> } {
  const calls: Array<[string, { sourceId: string }]> = [];
  return {
    provider,
    calls,
    upsertEvent: vi.fn(async (accessToken: string, input: { sourceId: string }) => {
      calls.push([accessToken, input]);
      return result;
    }),
  } as any;
}

const event = {
  sourceId: 'reminder-1',
  summary: 'Licence renewal',
  description: 'expires soon',
  startIso: '2026-06-10T09:00:00.000Z',
};

const okCreated: CalendarUpsertResult = {
  status: 'created',
  provider: 'google',
  eventId: 'evt-1',
};

describe('CalendarDelivery — provider routing', () => {
  it('routes to Google when a Google connection is active', async () => {
    const { store } = fakeStore({ google: activeRow({ provider: 'google' }) });
    const google = spyProvider('google', okCreated);
    const microsoft = spyProvider('microsoft', { ...okCreated, provider: 'microsoft' });

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft },
      logger: fakeLogger(),
      now: () => NOW,
    });

    const outcome = await delivery.deliver('tenant-1', 'user-1', event);
    expect(outcome.status).toBe('delivered');
    expect(google.upsertEvent).toHaveBeenCalledTimes(1);
    expect(microsoft.upsertEvent).not.toHaveBeenCalled();
    // The event carried the connection's calendarId.
    const [, passedInput] = google.calls[0];
    expect((passedInput as any).calendarId).toBe('primary');
  });

  it('routes to Microsoft when only Microsoft is linked', async () => {
    const { store } = fakeStore({
      google: null,
      microsoft: activeRow({ provider: 'microsoft' }),
    });
    const google = spyProvider('google', okCreated);
    const microsoft = spyProvider('microsoft', { ...okCreated, provider: 'microsoft' });

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft },
      logger: fakeLogger(),
      now: () => NOW,
    });

    const outcome = await delivery.deliver('tenant-1', 'user-1', event);
    expect(outcome.status).toBe('delivered');
    expect(microsoft.upsertEvent).toHaveBeenCalledTimes(1);
    expect(google.upsertEvent).not.toHaveBeenCalled();
  });

  it('prefers Google when BOTH providers are linked', async () => {
    const { store } = fakeStore({
      google: activeRow({ provider: 'google' }),
      microsoft: activeRow({ provider: 'microsoft', id: 'cal_2' }),
    });
    const google = spyProvider('google', okCreated);
    const microsoft = spyProvider('microsoft', { ...okCreated, provider: 'microsoft' });

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft },
      logger: fakeLogger(),
      now: () => NOW,
    });

    await delivery.deliver('tenant-1', 'user-1', event);
    expect(google.upsertEvent).toHaveBeenCalledTimes(1);
    expect(microsoft.upsertEvent).not.toHaveBeenCalled();
  });

  it('returns no_connection when nothing is linked', async () => {
    const { store } = fakeStore({ google: null, microsoft: null });
    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: {
        google: spyProvider('google', okCreated),
        microsoft: spyProvider('microsoft', { ...okCreated, provider: 'microsoft' }),
      },
      logger: fakeLogger(),
      now: () => NOW,
    });
    const outcome = await delivery.deliver('tenant-1', 'user-1', event);
    expect(outcome.status).toBe('no_connection');
  });

  it('honours an explicit calendarId on the event over the connection default', async () => {
    const { store } = fakeStore({
      google: activeRow({ provider: 'google', calendarId: 'primary' }),
    });
    const google = spyProvider('google', okCreated);
    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft: spyProvider('microsoft', okCreated) },
      logger: fakeLogger(),
      now: () => NOW,
    });

    await delivery.deliver('tenant-1', 'user-1', {
      ...event,
      calendarId: 'work@borjie.app',
    });
    const [, passedInput] = google.calls[0];
    expect((passedInput as any).calendarId).toBe('work@borjie.app');
  });
});

describe('CalendarDelivery — access-token freshness + refresh', () => {
  it('reuses the still-fresh access token without refreshing', async () => {
    const { store, updateTokens } = fakeStore({
      google: activeRow({
        provider: 'google',
        encryptedAccessToken: 'SEALED(fresh-access)',
        tokenExpiresAt: new Date(NOW + 60 * 60 * 1000), // 1h out → fresh
      }),
    });
    const google = spyProvider('google', okCreated);
    // The OAuth fetcher must NEVER be hit on the fresh path.
    const fetcher: Fetcher = vi.fn(async () => {
      throw new Error('refresh should not be called on the fresh path');
    });

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft: spyProvider('microsoft', okCreated) },
      logger: fakeLogger(),
      now: () => NOW,
      exchangeDeps: { fetcher },
    });

    await delivery.deliver('tenant-1', 'user-1', event);

    // Provider got the DECRYPTED fresh access token; no refresh, no re-seal.
    const [token] = google.calls[0];
    expect(token).toBe('fresh-access');
    expect(fetcher).not.toHaveBeenCalled();
    expect(updateTokens).not.toHaveBeenCalled();
  });

  it('refreshes from the encrypted refresh token when the access token is expired', async () => {
    const { store, updateTokens } = fakeStore({
      google: activeRow({
        provider: 'google',
        encryptedRefreshToken: 'SEALED(the-refresh-token)',
        encryptedAccessToken: 'SEALED(stale-access)',
        tokenExpiresAt: new Date(NOW - 1000), // already expired
      }),
    });
    const google = spyProvider('google', okCreated);
    // OAuth refresh endpoint returns a brand-new access token.
    const fetcher: Fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'minted-access', expires_in: 3600 }),
      text: async () => '',
    }));

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft: spyProvider('microsoft', okCreated) },
      logger: fakeLogger(),
      now: () => NOW,
      exchangeDeps: { fetcher, now: () => NOW },
    });

    await delivery.deliver('tenant-1', 'user-1', event);

    // 1) The refresh exchange used the DECRYPTED refresh token.
    expect(fetcher).toHaveBeenCalledTimes(1);
    const refreshBody = new URLSearchParams(
      (fetcher as any).mock.calls[0][1].body as string,
    );
    expect(refreshBody.get('grant_type')).toBe('refresh_token');
    expect(refreshBody.get('refresh_token')).toBe('the-refresh-token');

    // 2) The freshly minted token was RE-SEALED back into the store, scoped to
    //    the connection id + tenant, with the new expiry.
    expect(updateTokens).toHaveBeenCalledTimes(1);
    const [id, tenantId, args] = (updateTokens as any).mock.calls[0];
    expect(id).toBe('cal_1');
    expect(tenantId).toBe('tenant-1');
    expect(args.accessToken).toBe('minted-access');
    expect(args.tokenExpiresAt).toEqual(new Date(NOW + 3600 * 1000));

    // 3) The provider was handed the FRESH access token (not the stale one).
    const [token] = google.calls[0];
    expect(token).toBe('minted-access');
  });

  it('refreshes when the token is within the 5-minute safety margin', async () => {
    const { store, updateTokens } = fakeStore({
      google: activeRow({
        provider: 'google',
        // Expires in 2 minutes — inside the 5-min margin → must refresh.
        tokenExpiresAt: new Date(NOW + 2 * 60 * 1000),
      }),
    });
    const fetcher: Fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'margin-access', expires_in: 3600 }),
      text: async () => '',
    }));
    const google = spyProvider('google', okCreated);

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft: spyProvider('microsoft', okCreated) },
      logger: fakeLogger(),
      now: () => NOW,
      exchangeDeps: { fetcher, now: () => NOW },
    });

    await delivery.deliver('tenant-1', 'user-1', event);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(updateTokens).toHaveBeenCalledTimes(1);
    expect(google.calls[0][0]).toBe('margin-access');
  });

  it('persists a rotated refresh token when the refresh response carries one', async () => {
    const { store, updateTokens } = fakeStore({
      google: activeRow({
        provider: 'google',
        encryptedAccessToken: null,
        tokenExpiresAt: null,
      }),
    });
    const fetcher: Fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'a',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      }),
      text: async () => '',
    }));

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: {
        google: spyProvider('google', okCreated),
        microsoft: spyProvider('microsoft', okCreated),
      },
      logger: fakeLogger(),
      now: () => NOW,
      exchangeDeps: { fetcher, now: () => NOW },
    });

    await delivery.deliver('tenant-1', 'user-1', event);
    const [, , args] = (updateTokens as any).mock.calls[0];
    expect(args.refreshToken).toBe('rotated-refresh');
  });

  it('fails (retryable) when the refresh exchange errors', async () => {
    const { store } = fakeStore({
      google: activeRow({
        provider: 'google',
        encryptedAccessToken: null,
        tokenExpiresAt: null,
      }),
    });
    const fetcher: Fetcher = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'invalid_grant',
    }));
    const logger = fakeLogger();

    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: {
        google: spyProvider('google', okCreated),
        microsoft: spyProvider('microsoft', okCreated),
      },
      logger,
      now: () => NOW,
      exchangeDeps: { fetcher, now: () => NOW },
    });

    const outcome = await delivery.deliver('tenant-1', 'user-1', event);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.errorCode).toBe('token_refresh_failed');
      expect(outcome.retryable).toBe(true);
    }
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('CalendarDelivery — upsert idempotency on retry', () => {
  it('passes the SAME sourceId on every attempt and surfaces created→updated', async () => {
    const { store } = fakeStore({ google: activeRow({ provider: 'google' }) });

    // First attempt: provider reports 'created'.
    const providerCreated = spyProvider('google', {
      status: 'created',
      provider: 'google',
      eventId: 'stable-evt',
    });
    const delivery1 = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google: providerCreated, microsoft: spyProvider('microsoft', okCreated) },
      logger: fakeLogger(),
      now: () => NOW,
    });
    const first = await delivery1.deliver('tenant-1', 'user-1', event);
    expect(first.status).toBe('delivered');
    if (first.status === 'delivered') {
      expect(first.result.status).toBe('created');
    }

    // Retry (same reminder): the idempotent provider now reports 'updated' for
    // the SAME event id — no duplicate.
    const providerUpdated = spyProvider('google', {
      status: 'updated',
      provider: 'google',
      eventId: 'stable-evt',
    });
    const delivery2 = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google: providerUpdated, microsoft: spyProvider('microsoft', okCreated) },
      logger: fakeLogger(),
      now: () => NOW,
    });
    const retry = await delivery2.deliver('tenant-1', 'user-1', event);
    expect(retry.status).toBe('delivered');
    if (retry.status === 'delivered') {
      expect(retry.result.status).toBe('updated');
    }

    // The provider was handed the IDENTICAL sourceId both times → same upstream
    // event identity → idempotent.
    expect(providerCreated.calls[0][1].sourceId).toBe('reminder-1');
    expect(providerUpdated.calls[0][1].sourceId).toBe('reminder-1');
    if (first.status === 'delivered' && retry.status === 'delivered') {
      expect(first.result).not.toBe(retry.result);
      // Same eventId across attempts.
      const a = first.result;
      const b = retry.result;
      if (a.status !== 'failed' && b.status !== 'failed') {
        expect(a.eventId).toBe(b.eventId);
      }
    }
  });

  it('propagates a provider failure (code/message/retryable)', async () => {
    const { store } = fakeStore({ google: activeRow({ provider: 'google' }) });
    const google = spyProvider('google', {
      status: 'failed',
      provider: 'google',
      errorCode: 'google_insert_400',
      errorMessage: 'bad event',
      retryable: false,
    });
    const delivery = createCalendarDelivery({
      store,
      cipher: fakeCipher(),
      oauthConfig,
      providers: { google, microsoft: spyProvider('microsoft', okCreated) },
      logger: fakeLogger(),
      now: () => NOW,
    });
    const outcome = await delivery.deliver('tenant-1', 'user-1', event);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.errorCode).toBe('google_insert_400');
      expect(outcome.retryable).toBe(false);
    }
  });
});
