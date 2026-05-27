/**
 * Sentry server-side init for owner-web (Node runtime — SSR / RSC / route
 * handlers). Reads `SENTRY_DSN` from the server-only env so the value is
 * never inlined into the browser bundle.
 *
 * No-op when the DSN is unset, so `next dev` without a Sentry project
 * stays silent. Pilot-mode lifts the sample rate to 1.0 to match the
 * client config — keeps the spans correlated end-to-end.
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
