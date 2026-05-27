/**
 * Activation policy — score one KS against one region.
 *
 * Wave BLACKBOARD-CORE. Pure function. The control shell (next file)
 * sorts the KS registry by this scorer and picks the highest-scoring
 * one. The scorer is exposed independently so the runtime can replay
 * a scheduling decision for forensic / explain-this-pick UI.
 *
 * Formula (spec §3.2, §6):
 *
 *     score(ks, region) = priority(ks)
 *                       × freshness(ks, region.last_post_at, now)
 *                       × competence(ks, region.region_kind)
 *
 *   - priority(ks)    — the KS's static priority in [0, 1].
 *   - freshness(...)  — exp(-Δt / τ) decay, τ = 600s.
 *                       Δt is the time since this KS last activated
 *                       in this region. We approximate Δt by
 *                       region.last-post-at when a per-KS clock is
 *                       not available; this rewards KSes that haven't
 *                       spoken recently relative to the region's
 *                       overall tempo.
 *   - competence(...) — measured success rate from capability-catalogue;
 *                       0.5 fallback when no measurements exist.
 *
 * The score is in (0, 1]. The control-shell-floor (BLACKBOARD_CONSTANTS
 * .CONTROL_SHELL_FLOOR = 0.05) is the dormant threshold below which
 * no KS is activated.
 */

import { BLACKBOARD_CONSTANTS } from '../types.js';

export interface ActivationContext {
  /** The KS's static priority, in [0, 1]. */
  readonly priority: number;
  /** Δt in milliseconds — time since this KS last spoke (or region opened). */
  readonly deltaMs: number;
  /** Measured competence on this region kind, in [0, 1]. 0.5 fallback. */
  readonly competence: number;
  /** Optional override of the freshness decay τ (seconds). */
  readonly tauSeconds?: number;
}

export interface ActivationScore {
  readonly score: number;
  readonly priority: number;
  readonly freshness: number;
  readonly competence: number;
}

/** Compute freshness in (0, 1]. exp(-Δt / τ). */
export function computeFreshness(deltaMs: number, tauSeconds?: number): number {
  const tau = (tauSeconds ?? BLACKBOARD_CONSTANTS.FRESHNESS_TAU_SECONDS) * 1000;
  // Negative or NaN guard — if the caller hands us a negative Δt,
  // assume "very fresh" (just spoke) and return ~0.
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return Math.exp(-Infinity);
  return Math.exp(-deltaMs / tau);
}

/** Compute the full activation score for a KS in a region. */
export function scoreActivation(ctx: ActivationContext): ActivationScore {
  const priority = clamp01(ctx.priority);
  const competence = clamp01(ctx.competence);
  const freshness = computeFreshness(ctx.deltaMs, ctx.tauSeconds);
  const score = priority * freshness * competence;
  return Object.freeze({ score, priority, freshness, competence });
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
