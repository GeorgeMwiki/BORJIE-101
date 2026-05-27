/**
 * Sentry client-side init for the Borjie marketing site.
 *
 * The marketing site is public (no auth gate) so we keep the surface
 * deliberately small — no pilot-cohort tags, no replay session ID.
 * `@sentry/nextjs` picks this file up automatically during the build.
 *
 * Behaviour
 * ─────────
 * - `NEXT_PUBLIC_SENTRY_DSN` empty → init is skipped (no-op in dev).
 * - Production samples at 0.1; non-prod samples at 1.0 so preview
 *   deploys surface every error in the QA dashboard.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN && DSN.trim().length > 0) {
  Sentry.init({
    dsn: DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      'development',
    release: process.env.NEXT_PUBLIC_GIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}
