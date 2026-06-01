/**
 * CalendarDelivery — the `calendar` delivery channel.
 *
 * Given a normalized event (from a reminder or an autonomous time-bound item)
 * and the (tenant,user) that owns it, this:
 *
 *   1. Loads the owner's ACTIVE calendar connection.
 *   2. Opens (decrypts) the access token; refreshes + RE-SEALS it just-in-time
 *      when it is within the safety margin of expiry, decrypting the refresh
 *      token only for that call.
 *   3. Routes to the matching CalendarEventProvider and upserts the event
 *      idempotently on the source id (no dupes on retry).
 *
 * Plaintext tokens live ONLY in local variables for the duration of a single
 * provider call. The row always holds sealed blobs.
 */

import type { Logger } from 'pino';

import type { CalendarProvider } from '@borjie/database/schemas';

import {
  refreshAccessToken,
  type CalendarOAuthConfig,
  type ExchangeDeps,
} from './oauth';
import type { CalendarTokenCipher } from './token-cipher';
import type {
  ActiveConnectionRow,
  CalendarConnectionStore,
} from './connection-store';
import type {
  CalendarEventInput,
  CalendarEventProvider,
  CalendarUpsertResult,
} from './types';

/** Refresh this far ahead of the recorded expiry. */
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export type CalendarDeliveryOutcome =
  | { readonly status: 'delivered'; readonly result: CalendarUpsertResult }
  | {
      readonly status: 'no_connection';
    }
  | {
      readonly status: 'failed';
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly retryable: boolean;
    };

export interface CalendarDeliveryDeps {
  readonly store: CalendarConnectionStore;
  readonly cipher: CalendarTokenCipher;
  readonly oauthConfig: CalendarOAuthConfig;
  readonly providers: Readonly<Record<CalendarProvider, CalendarEventProvider>>;
  readonly logger: Logger;
  readonly now?: () => number;
  /** Injected into the refresh exchange (test seam). */
  readonly exchangeDeps?: ExchangeDeps;
}

export interface CalendarDelivery {
  deliver(
    tenantId: string,
    userId: string,
    event: Omit<CalendarEventInput, 'calendarId'> & {
      readonly calendarId?: string;
    },
  ): Promise<CalendarDeliveryOutcome>;
}

export function createCalendarDelivery(
  deps: CalendarDeliveryDeps,
): CalendarDelivery {
  const now = deps.now ?? (() => Date.now());

  /**
   * Return a valid (fresh) access token for the connection, refreshing +
   * re-sealing first when the current token is missing or near expiry.
   */
  async function ensureAccessToken(
    conn: ActiveConnectionRow,
  ): Promise<string> {
    const provider = conn.provider;
    const expiresAtMs = conn.tokenExpiresAt
      ? conn.tokenExpiresAt.getTime()
      : 0;
    const stillFresh =
      conn.encryptedAccessToken != null &&
      now() + REFRESH_SAFETY_MARGIN_MS < expiresAtMs;

    if (stillFresh && conn.encryptedAccessToken) {
      return deps.cipher.open(conn.encryptedAccessToken);
    }

    // Need a new access token — decrypt the refresh token ONLY for this call.
    const refreshTokenPlain = deps.cipher.open(conn.encryptedRefreshToken);
    const refreshed = await refreshAccessToken({
      provider,
      config: deps.oauthConfig,
      refreshToken: refreshTokenPlain,
      ...(deps.exchangeDeps ? { deps: deps.exchangeDeps } : {}),
    });
    // Persist the re-sealed access token (and rotated refresh token if any).
    await deps.store.updateTokens(conn.id, conn.tenantId, {
      accessToken: refreshed.accessToken,
      ...(refreshed.refreshToken
        ? { refreshToken: refreshed.refreshToken }
        : {}),
      tokenExpiresAt: new Date(refreshed.expiresAt),
    });
    return refreshed.accessToken;
  }

  return {
    async deliver(tenantId, userId, event) {
      // Pick the first active connection across the configured providers. Most
      // owners link one; if both are linked, Google is preferred.
      const order: CalendarProvider[] = ['google', 'microsoft'];
      let conn: ActiveConnectionRow | null = null;
      for (const provider of order) {
        if (!deps.providers[provider]) continue;
        const found = await deps.store.getActive(tenantId, userId, provider);
        if (found) {
          conn = found;
          break;
        }
      }
      if (!conn) {
        return { status: 'no_connection' };
      }

      const provider = conn.provider;
      const eventProvider = deps.providers[provider];
      if (!eventProvider) {
        return {
          status: 'failed',
          errorCode: 'provider_not_configured',
          errorMessage: `calendar provider not wired: ${provider}`,
          retryable: false,
        };
      }

      let accessToken: string;
      try {
        accessToken = await ensureAccessToken(conn);
      } catch (err) {
        deps.logger.warn(
          {
            channel: 'calendar',
            tenantId,
            provider,
            err: err instanceof Error ? err.message : String(err),
          },
          'calendar-delivery: token refresh failed',
        );
        return {
          status: 'failed',
          errorCode: 'token_refresh_failed',
          errorMessage: err instanceof Error ? err.message : String(err),
          retryable: true,
        };
      }

      const result = await eventProvider.upsertEvent(accessToken, {
        ...event,
        calendarId: event.calendarId ?? conn.calendarId,
      });
      if (result.status === 'failed') {
        return {
          status: 'failed',
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          retryable: result.retryable,
        };
      }
      return { status: 'delivered', result };
    },
  };
}
