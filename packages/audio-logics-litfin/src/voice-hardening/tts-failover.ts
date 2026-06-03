/**
 * P95-TTFB TTS auto-failover decision (LP-27).
 *
 * Wraps the primary TTS provider with a fallback. Failover is a ROUTING
 * decision taken BEFORE the primary call (never a mid-stream switch), driven
 * by the recent P95 time-to-first-byte rollup:
 *
 *   1. Explicit ops override (env / config) beats everything.
 *   2. Otherwise, if a measured recent P95 TTFB exceeds the threshold AND a
 *      fallback is configured, route to the fallback.
 *   3. On cold start (no measurement) stay on primary — a missing rollup must
 *      never flip the system.
 *
 * Pure decision function; the latency lookup is an injected port so this
 * stays unit-testable without a metrics client.
 *
 * @module @borjie/audio-logics-litfin/voice-hardening/tts-failover
 */

export interface TtsFailoverDecision {
  readonly provider: 'primary' | 'fallback';
  readonly reason: 'ops-override-fallback' | 'ops-override-primary' | 'ttfb-breach' | 'default-primary';
}

export interface DecideTtsProviderArgs {
  /** Ops override: 'fallback' | 'primary' | undefined. */
  readonly override?: string | undefined;
  /** Recent P95 TTFB in ms, or null on cold start. */
  readonly recentTtfbP95Ms: number | null;
  /** Breach threshold in ms. Default 250. */
  readonly thresholdMs?: number;
  /** Whether a fallback provider is actually wired. */
  readonly fallbackConfigured: boolean;
}

const DEFAULT_THRESHOLD_MS = 250;

/**
 * Decide which TTS provider to route to. Pure; deterministic for a given set
 * of inputs.
 */
export function decideTtsProvider(args: DecideTtsProviderArgs): TtsFailoverDecision {
  const override = (args.override ?? '').trim().toLowerCase();
  const threshold = args.thresholdMs ?? DEFAULT_THRESHOLD_MS;

  if (override === 'fallback' && args.fallbackConfigured) {
    return { provider: 'fallback', reason: 'ops-override-fallback' };
  }
  if (override === 'primary') {
    return { provider: 'primary', reason: 'ops-override-primary' };
  }

  if (
    args.fallbackConfigured &&
    args.recentTtfbP95Ms !== null &&
    Number.isFinite(args.recentTtfbP95Ms) &&
    args.recentTtfbP95Ms > threshold
  ) {
    return { provider: 'fallback', reason: 'ttfb-breach' };
  }
  return { provider: 'primary', reason: 'default-primary' };
}

/**
 * Recent-TTFB source port. The host builds this from its latency rollup
 * (e.g. a daily P95 query). Fail-soft: returns null on any failure so the
 * decision stays on primary.
 */
export interface TtfbP95Source {
  recentP95Ms(): Promise<number | null>;
}

/**
 * Reduce a set of rollup slices to a single representative P95 — the MAX
 * across slices, so a breach on any meaningful slice trips the failover
 * rather than an average that one fast slice could mask.
 */
export function reduceRecentTtfbP95(
  rows: readonly { readonly ttfbP95Ms: number | null }[],
): number | null {
  let max: number | null = null;
  for (const row of rows) {
    if (row.ttfbP95Ms === null || !Number.isFinite(row.ttfbP95Ms)) continue;
    if (max === null || row.ttfbP95Ms > max) max = row.ttfbP95Ms;
  }
  return max;
}
