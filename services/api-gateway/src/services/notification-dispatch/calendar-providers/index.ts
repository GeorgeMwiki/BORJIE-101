/**
 * `calendar` delivery channel — public surface.
 *
 * Mirrors the email-providers / sms-providers barrels: exposes the cipher, the
 * OAuth helpers, the event providers, the connection store, the delivery
 * service, and a single env-driven composition factory.
 */

import type { Logger } from 'pino';

import type { CalendarProvider } from '@borjie/database/schemas';

import {
  createCalendarTokenCipherFromEnv,
  type CalendarTokenCipher,
} from './token-cipher';
import {
  readCalendarOAuthConfigFromEnv,
  type CalendarOAuthConfig,
} from './oauth';
import { createGoogleCalendarProvider } from './google-provider';
import { createMicrosoftCalendarProvider } from './microsoft-provider';
import {
  createCalendarConnectionStore,
  type CalendarConnectionStore,
  type DrizzleLike,
} from './connection-store';
import {
  createCalendarDelivery,
  type CalendarDelivery,
} from './calendar-delivery';
import type { CalendarEventProvider } from './types';

export * from './types';
export * from './token-cipher';
export * from './oauth';
export * from './google-provider';
export * from './microsoft-provider';
export * from './connection-store';
export * from './calendar-delivery';

export interface CalendarChannel {
  readonly configured: boolean;
  readonly cipher: CalendarTokenCipher;
  readonly oauthConfig: CalendarOAuthConfig;
  readonly providers: Readonly<Record<CalendarProvider, CalendarEventProvider>>;
  readonly store: CalendarConnectionStore;
  readonly delivery: CalendarDelivery;
}

/**
 * Build the whole `calendar` channel from env + a Drizzle handle. Returns
 * `null` when the token-encryption key is absent (CALENDAR_TOKEN_KEY /
 * ENCRYPTION_MASTER_KEY) — without a key we must NOT persist tokens, so the
 * channel stays disabled and the caller logs a single boot warning. OAuth
 * client credentials being absent does NOT disable the channel construction
 * (status endpoint still works); the connect route guards per-provider config.
 */
export function createCalendarChannelFromEnv(args: {
  readonly db: DrizzleLike;
  readonly logger: Logger;
  readonly env?: NodeJS.ProcessEnv;
}): CalendarChannel | null {
  const env = args.env ?? process.env;
  const cipher = createCalendarTokenCipherFromEnv(env);
  if (!cipher) {
    args.logger.warn(
      { channel: 'calendar' },
      'calendar channel disabled: no CALENDAR_TOKEN_KEY / ENCRYPTION_MASTER_KEY (tokens would be plaintext)',
    );
    return null;
  }
  const oauthConfig = readCalendarOAuthConfigFromEnv(env);
  const providers: Record<CalendarProvider, CalendarEventProvider> = {
    google: createGoogleCalendarProvider(),
    microsoft: createMicrosoftCalendarProvider(),
  };
  const store = createCalendarConnectionStore(args.db, cipher);
  const delivery = createCalendarDelivery({
    store,
    cipher,
    oauthConfig,
    providers,
    logger: args.logger,
  });
  const configured = oauthConfig.google != null || oauthConfig.microsoft != null;
  if (!configured) {
    args.logger.warn(
      { channel: 'calendar' },
      'calendar channel: no GOOGLE_OAUTH_* / MS_OAUTH_* client credentials — connect flow will 503 until wired',
    );
  }
  return { configured, cipher, oauthConfig, providers, store, delivery };
}
