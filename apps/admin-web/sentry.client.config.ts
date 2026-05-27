/**
 * Sentry client-side init for admin-web (internal Borjie team console).
 *
 * Mirrors `apps/owner-web/sentry.client.config.ts` — the two web
 * surfaces stay deliberately parallel so a single doc patch updates
 * both and pilot dashboards can group by `service`. Picked up
 * automatically by `@sentry/nextjs` during `next build` / `next dev`.
 *
 * Pilot-mode (`NEXT_PUBLIC_BORJIE_PILOT_MODE=1`) raises sample rate to
 * 1.0 so the support team captures every error during the cohort
 * window. Production (no pilot) samples at 0.1.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

function resolveTracesSampleRate(): number {
  const pilot =
    process.env.NEXT_PUBLIC_BORJIE_PILOT_MODE === '1' ||
    process.env.NEXT_PUBLIC_BORJIE_PILOT_MODE?.toLowerCase() === 'true';
  if (pilot) return 1.0;
  return process.env.NODE_ENV === 'production' ? 0.1 : 1.0;
}

if (DSN && DSN.trim().length > 0) {
  Sentry.init({
    dsn: DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      'development',
    release: process.env.NEXT_PUBLIC_GIT_SHA,
    tracesSampleRate: resolveTracesSampleRate(),
  });
}
