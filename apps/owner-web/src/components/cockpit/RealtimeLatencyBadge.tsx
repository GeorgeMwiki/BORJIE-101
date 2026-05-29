'use client';

/**
 * RT-3 — owner cockpit "Live sync" badge.
 *
 * Polls /api/v1/observability/realtime every POLL_INTERVAL_MS and
 * renders the P95 cockpit-event round-trip latency. Tiny, unobtrusive,
 * sits next to the CockpitLivePulse green dot.
 *
 * Colour bands (mirrors the 200ms SLO from
 * `Docs/RESEARCH/REALTIME_SOTA_2026-05-29.md`):
 *   - <200ms  : green (inside SLO)
 *   - <500ms  : amber (degraded)
 *   - ≥500ms  : red (breach)
 *
 * Hides itself entirely when count = 0 (no samples yet, no signal to
 * render). Bilingual sw/en label.
 */

import { useEffect, useState } from 'react';

import { API_BASE } from '@/lib/api-client';

interface LatencyStats {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
}

const POLL_INTERVAL_MS = 10_000;

function colorForP95(p95: number): string {
  if (p95 < 200) return 'bg-success/15 text-success-foreground';
  if (p95 < 500) return 'bg-warning/15 text-warning-foreground';
  return 'bg-destructive/15 text-destructive-foreground';
}

export function RealtimeLatencyBadge({
  language = 'en',
}: {
  readonly language?: 'en' | 'sw';
}): JSX.Element | null {
  const [stats, setStats] = useState<LatencyStats | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;

    const fetchOnce = async (): Promise<void> => {
      try {
        const res = await fetch(`${API_BASE}/observability/realtime`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          success: boolean;
          data: LatencyStats;
        };
        if (!cancelled && payload.success) {
          setStats(payload.data);
        }
      } catch {
        // best-effort polling; no user-visible error.
      }
    };

    void fetchOnce();
    const interval = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!stats || stats.count === 0) return null;

  const label = language === 'sw' ? 'Mawasiliano' : 'Live sync';

  return (
    <span
      data-testid="realtime-latency-badge"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${colorForP95(
        stats.p95,
      )}`}
      title={`P50 ${stats.p50} ms · P95 ${stats.p95} ms · P99 ${stats.p99} ms (n=${stats.count})`}
    >
      <span>{label}:</span>
      <span>P95 = {stats.p95} ms</span>
    </span>
  );
}
