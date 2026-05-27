/**
 * Sentry edge-runtime init for the Borjie marketing site (middleware,
 * edge routes). Same DSN gate as the server config — they share the
 * same Sentry project but emit from different runtimes so traces can
 * be stitched together in the Sentry UI.
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
