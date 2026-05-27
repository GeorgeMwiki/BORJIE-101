'use client';

/**
 * WebVitalsReporter — marketing Web Vitals reporter.
 *
 * Marketing has the strictest perf budget (LCP ≤ 1.5 s, CLS ≤ 0.05). We
 * lazy-load `web-vitals` v5 via `@borjie/performance-toolkit`, ship
 * LCP/INP/CLS/TTFB/FCP via `navigator.sendBeacon` to
 * `/api/perf/web-vitals`, and otherwise stay completely out of the
 * critical path.
 *
 * Intelligence-loss audit: ZERO. Pure additive observer.
 */

import { useEffect } from 'react';

import { reportWebVitals } from '@borjie/performance-toolkit/perf-metrics';
import type { WebVitalReport } from '@borjie/performance-toolkit';

interface WebVitalsReporterProps {
  readonly surface: 'marketing';
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
