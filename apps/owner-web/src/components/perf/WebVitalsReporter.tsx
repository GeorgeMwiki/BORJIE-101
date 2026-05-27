'use client';

/**
 * WebVitalsReporter — owner-web Web Vitals reporter (LCP/INP/CLS/TTFB/FCP).
 *
 * Mounts in the root layout as a side-channel client island. Subscribes
 * to the five Core Web Vitals via `web-vitals` v5 (lazy-loaded by
 * `@borjie/performance-toolkit`) and ships each measurement to the
 * `/api/perf/web-vitals` endpoint via `navigator.sendBeacon`.
 *
 * Intelligence-loss audit: ZERO. Pure additive side-channel.
 */

import { useEffect } from 'react';

import { reportWebVitals } from '@borjie/performance-toolkit/perf-metrics';
import type { WebVitalReport } from '@borjie/performance-toolkit';

interface WebVitalsReporterProps {
  readonly surface: 'owner-web';
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
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never throw into the app.
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
