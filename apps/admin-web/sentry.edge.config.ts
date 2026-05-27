/**
 * Sentry edge-runtime init for admin-web (middleware, edge routes).
 *
 * Twin of `apps/owner-web/sentry.edge.config.ts` — runs on the Vercel
 * edge transport (fetch-only, no Node APIs). Same DSN gate + pilot-mode
 * sample-rate behaviour as the server config — they share the same
 * Sentry project but emit from different runtimes so traces can be
 * stitched together in the Sentry UI.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

function resolveTracesSampleRate(): number {
  const pilot =
    process.env.BORJIE_PILOT_MODE === '1' ||
    process.env.BORJIE_PILOT_MODE?.toLowerCase() === 'true' ||
    process.env.NEXT_PUBLIC_BORJIE_PILOT_MODE === '1' ||
    process.env.NEXT_PUBLIC_BORJIE_PILOT_MODE?.toLowerCase() === 'true';
  if (pilot) return 1.0;
  return process.env.NODE_ENV === 'production' ? 0.1 : 1.0;
}

if (DSN && DSN.trim().length > 0) {
  Sentry.init({
    dsn: DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      'development',
    release: process.env.GIT_SHA ?? process.env.NEXT_PUBLIC_GIT_SHA,
    tracesSampleRate: resolveTracesSampleRate(),
  });
}
