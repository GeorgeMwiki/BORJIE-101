'use client';

/**
 * WebVitalsReporter — admin-web Web Vitals reporter.
 *
 * Lazy-loads `web-vitals` v5 via `@borjie/performance-toolkit` and ships
 * LCP/INP/CLS/TTFB/FCP via `navigator.sendBeacon` to
 * `/api/perf/web-vitals`.
 *
 * The admin console runs alongside the SessionReplay + Sensorium
 * providers. Both of those carry their own data streams (rrweb cold
 * store, 14-event sensory bus); Web Vitals is held SEPARATELY because
 * it is a per-page rendering measurement, not a behavioural signal.
 *
 * Intelligence-loss audit: ZERO. Pure additive side-channel.
 */

import { useEffect } from 'react';

import { reportWebVitals } from '@borjie/performance-toolkit/perf-metrics';
import type { WebVitalReport } from '@borjie/performance-toolkit';

import { getCsrfHeaders } from '@/lib/csrf';

interface WebVitalsReporterProps {
  readonly surface: 'admin-web';
  readonly endpoint?: string;
}

function postBeacon(endpoint: string, payload: unknown): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
    // Beacon-unsupported browser fallback. The endpoint is same-origin
    // and non-mutating w.r.t. domain state, but we still thread the
    // platform CSRF helper so it conforms to the platform-wide
    // convention enforced by `borjie/require-csrf-headers`.
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never throw from telemetry.
  }
}

export function WebVitalsReporter({
  surface,
  endpoint = '/api/perf/web-vitals',
}: WebVitalsReporterProps): null {
  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | null = null;

    void reportWebVitals((metric: WebVitalReport) => {
      if (cancelled) return;
      postBeacon(endpoint, { surface, ...metric });
    }).then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      teardown = stop;
    });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [endpoint, surface]);

  return null;
}
