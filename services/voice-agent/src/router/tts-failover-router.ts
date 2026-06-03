/**
 * P95-TTFB TTS auto-failover router (LP-27).
 *
 * Wraps `routeTts` so that, when the recent P95 time-to-first-byte for the
 * primary provider breaches a threshold, the router fails over to the
 * low-latency fallback (Cartesia Sonic-2). This is a ROUTING decision taken
 * BEFORE the session opens, never a mid-stream switch — a slow tail does not
 * tear down an in-flight stream.
 *
 * Order of precedence:
 *   1. Caller's explicit `tier === 'low-latency'` (handled by routeTts).
 *   2. Env ops override `VOICE_TTS_PROVIDER` (= 'cartesia' | 'elevenlabs').
 *   3. Measured P95 TTFB breach -> fallback.
 *   4. Otherwise the language-policy choice from routeTts.
 *
 * The latency lookup is an injected port so this stays unit-testable without
 * a metrics backend. Fail-soft: a null measurement keeps the primary choice,
 * so a broken rollup never flips the system.
 *
 * @module voice-agent/router/tts-failover-router
 */

import type { LanguageTag } from '../providers/types.js';
import { routeTts, type LatencyTier, type TtsRoutingDecision } from './tts-router.js';

/** Recent-P95 source. Returns ms, or null on cold start / failure. */
export interface TtfbP95Source {
  recentP95Ms(): Promise<number | null>;
}

export interface TtsFailoverOptions {
  readonly thresholdMs?: number;
  /** Ops override, typically `process.env.VOICE_TTS_PROVIDER`. */
  readonly override?: string | undefined;
  readonly tier?: LatencyTier;
}

export interface TtsFailoverRoutingDecision extends TtsRoutingDecision {
  readonly failoverReason: 'ops-override' | 'ttfb-breach' | 'language-policy';
  readonly recentTtfbP95Ms: number | null;
}

const DEFAULT_THRESHOLD_MS = 250;
const FALLBACK_PROVIDER = 'cartesia-sonic-2' as const;

/**
 * Resolve the TTS provider with P95-TTFB-aware failover. Pure aside from the
 * injected latency lookup.
 */
export async function routeTtsWithFailover(
  language: LanguageTag,
  source: TtfbP95Source,
  options: TtsFailoverOptions = {},
): Promise<TtsFailoverRoutingDecision> {
  const threshold = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const override = (options.override ?? '').trim().toLowerCase();
  const base = routeTts(language, options.tier ?? 'best-quality');

  // Explicit ops override beats measurement.
  if (override === 'cartesia') {
    return {
      provider: FALLBACK_PROVIDER,
      rationale: 'Ops override VOICE_TTS_PROVIDER=cartesia.',
      ...(base.live !== undefined ? { live: base.live } : {}),
      failoverReason: 'ops-override',
      recentTtfbP95Ms: null,
    };
  }
  if (override === 'elevenlabs') {
    return {
      provider: 'elevenlabs-v3',
      rationale: 'Ops override VOICE_TTS_PROVIDER=elevenlabs.',
      ...(base.live !== undefined ? { live: base.live } : {}),
      failoverReason: 'ops-override',
      recentTtfbP95Ms: null,
    };
  }

  // Automatic failover only when the primary is not already the fallback.
  let recentTtfbP95Ms: number | null = null;
  try {
    recentTtfbP95Ms = await source.recentP95Ms();
  } catch {
    recentTtfbP95Ms = null; // fail-soft: stay on the policy choice
  }

  const breached =
    base.provider !== FALLBACK_PROVIDER &&
    recentTtfbP95Ms !== null &&
    Number.isFinite(recentTtfbP95Ms) &&
    recentTtfbP95Ms > threshold;

  if (breached) {
    return {
      provider: FALLBACK_PROVIDER,
      rationale: `P95 TTFB ${recentTtfbP95Ms}ms > ${threshold}ms, failing over to Cartesia Sonic-2.`,
      failoverReason: 'ttfb-breach',
      recentTtfbP95Ms,
    };
  }

  return { ...base, failoverReason: 'language-policy', recentTtfbP95Ms };
}
