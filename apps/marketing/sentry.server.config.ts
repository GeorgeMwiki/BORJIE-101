/**
 * Sentry server-side init for the Borjie marketing site (Node runtime).
 *
 * Reads `SENTRY_DSN` from the server-only env. No-op when unset so dev
 * builds without a Sentry project stay silent.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN && DSN.trim().length > 0) {
  Sentry.init({
    dsn: DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      'development',
    release: process.env.GIT_SHA ?? process.env.NEXT_PUBLIC_GIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}
