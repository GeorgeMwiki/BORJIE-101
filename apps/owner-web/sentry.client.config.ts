/**
 * Sentry client-side init for owner-web.
 *
 * Picked up automatically by `@sentry/nextjs` during `next build` / `next dev`
 * — no manual import required from `app/layout.tsx`. The existing
 * `src/lib/sentry.ts` wrapper (pilot-mode aware) still owns the bilingual
 * tag-bundle so any `captureError(err, { tenantId, route })` call from app
 * code keeps emitting cohort tags after this file installs the SDK.
 *
 * Behaviour
 * ─────────
 * - `NEXT_PUBLIC_SENTRY_DSN` empty → `Sentry.init` is skipped (no-op in dev
 *   without a project hooked up). Wrapper falls back to pino logging.
 * - Pilot-mode (`NEXT_PUBLIC_BORJIE_PILOT_MODE=1`) raises `tracesSampleRate`
 *   to 1.0 so every error during the 3-5 pilot cohort window is captured.
 * - Production (no pilot) samples at 0.1 — wide enough for trend lines,
 *   narrow enough to stay inside the Sentry quota.
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
