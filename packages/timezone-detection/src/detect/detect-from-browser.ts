/**
 * Browser-side detection via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
 *
 * This is the **canonical** SOTA approach as of 2026 — supported by all
 * evergreen browsers and Node 20+ (V8 ships tzdata 2024b+). The legacy
 * `jstz` library is no longer needed because every browser now exposes
 * the timezone directly.
 *
 * In server code, pass the value transparently via an `X-Timezone` HTTP
 * header (set by the SPA on every request). The server should NEVER call
 * this function — it would return the **server's** timezone.
 */

import type { DetectionResult, TimezoneId } from '../types.js';
import { isValidTimezone } from './validate.js';

export interface DetectFromBrowserOptions {
  /** Override for tests / SSR. Pass the value already lifted from the client. */
  readonly clientReportedTimezone?: TimezoneId | null;
}

/**
 * Returns a `DetectionResult` (`source: 'browser'`, confidence 0.95) when
 * a valid timezone is supplied, otherwise `null` so the composite
 * resolver can fall through.
 */
export function detectFromBrowser(
  opts: DetectFromBrowserOptions = {},
): DetectionResult | null {
  let candidate: string | null = opts.clientReportedTimezone ?? null;

  if (!candidate) {
    try {
      candidate = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      candidate = null;
    }
  }

  if (!candidate || !isValidTimezone(candidate)) return null;

  return {
    timezone: candidate,
    source: 'browser',
    confidence: 0.95,
    reason: 'Intl.DateTimeFormat().resolvedOptions().timeZone',
  };
}
