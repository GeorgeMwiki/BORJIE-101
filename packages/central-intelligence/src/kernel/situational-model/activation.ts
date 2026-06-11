/**
 * ACT-R activation maths for the situational model — PURE functions only.
 *
 * activation(i) = baseLevel(i) + spreading(i)
 *
 * BASE LEVEL (recency × frequency) — ACT-R "optimized learning"
 * ────────────────────────────────────────────────────────────
 * The exact ACT-R base level sums each past reference's decayed strength:
 *   B_i = ln( Σ_{k=1..n} t_k^(-d) )
 * Storing every t_k is unbounded. ACT-R's standard optimized-learning
 * approximation collapses the series to its count `n` and the elapsed span
 * `L = now − firstRef`:
 *   B_i ≈ ln( n / (1 − d) ) − d · ln(L)
 * which preserves the recency×frequency shape from just (n, firstRef). We add
 * the most-recent reference's exact decayed term so a JUST-touched entity gets
 * its full recency spike (a veteran's "this is fresh") rather than the smoothed
 * average alone — a small, well-known refinement that keeps single-reference
 * and just-referenced cases well-behaved.
 *
 * SPREADING — associative salience
 * ────────────────────────────────
 * spreading(i) = Σ_j  W · S_ji
 * where the sources j are the entities entity i is associated with that are
 * THEMSELVES currently in attention, W is a shared source activation, and S_ji
 * the stored link strength. This is what makes "the licence renewal" light up
 * "the FX window" and "the rains" without anyone wiring an explicit rule.
 *
 * All times are ms epochs; all functions are total (never throw) and clamp
 * degenerate inputs (zero references, future timestamps, d≥1) to finite values
 * so a salience read can never produce NaN/Infinity that would poison ranking.
 */

import type {
  ActivationParams,
  ActivatedEntity,
  SituationEntity,
  SituationEntityKey,
} from './types.js';
import { entityKeyOf } from './types.js';

const MS_PER_SECOND = 1000;
/** Minimum elapsed span (seconds) so ln(L) stays finite for fresh entities. */
const MIN_SPAN_SECONDS = 1;

/**
 * Compute the ACT-R base-level activation for one entity at `nowMs`.
 *
 * Uses the optimized-learning approximation plus an explicit recency term for
 * the latest reference. Returns a finite number for every input:
 *   - referenceCount ≤ 0 → returns a strongly-negative floor (effectively
 *     "not in memory") instead of ln(0) = −Infinity.
 *   - future timestamps   → clamped to nowMs (span ≥ MIN_SPAN_SECONDS).
 *   - decay d ≥ 1         → clamped to just-below-1 so the (1−d) divisor is
 *     positive (ACT-R requires 0 < d < 1; we defend the boundary).
 */
export function baseLevelActivation(
  entity: SituationEntity,
  nowMs: number,
  params: ActivationParams,
): number {
  const n = entity.referenceCount;
  if (!Number.isFinite(n) || n <= 0) return BASE_LEVEL_FLOOR;

  const d = clampDecay(params.decay);

  // Elapsed span since first reference (seconds), floored so ln is finite.
  const spanMs = Math.max(0, nowMs - entity.firstReferencedAtMs);
  const spanSeconds = Math.max(MIN_SPAN_SECONDS, spanMs / MS_PER_SECOND);

  // Optimized-learning term: ln( n / (1 − d) ) − d · ln(L).
  const optimized = Math.log(n / (1 - d)) - d * Math.log(spanSeconds);

  // Explicit recency spike from the most-recent reference: t_last^(−d).
  const recencyMs = Math.max(0, nowMs - entity.lastReferencedAtMs);
  const recencySeconds = Math.max(MIN_SPAN_SECONDS, recencyMs / MS_PER_SECOND);
  const recencyTerm = Math.pow(recencySeconds, -d); // in (0, 1]

  // Blend: the optimized base shapes frequency×recency over the whole span;
  // ln(1 + recencyTerm) adds a bounded, monotone freshness bump for a
  // just-touched entity. ln(1+·) keeps it small + always finite.
  const blended = optimized + Math.log(1 + recencyTerm);
  return Number.isFinite(blended) ? blended : BASE_LEVEL_FLOOR;
}

/** Floor used when an entity has no usable reference history. */
export const BASE_LEVEL_FLOOR = -10;

/**
 * Compute the spreading activation flowing into `entity` from its associated
 * entities that are present in `present` (the current model). Sources that are
 * not in the model contribute nothing (you cannot spread from something you're
 * not holding in mind).
 */
export function spreadingActivation(
  entity: SituationEntity,
  present: ReadonlyMap<SituationEntityKey, SituationEntity>,
  params: ActivationParams,
): number {
  const links = entity.associations;
  const keys = Object.keys(links);
  if (keys.length === 0) return 0;

  const w = Number.isFinite(params.sourceActivation)
    ? params.sourceActivation
    : 0;
  let sum = 0;
  for (const sourceKey of keys) {
    if (!present.has(sourceKey)) continue;
    const strength = links[sourceKey];
    if (typeof strength === 'number' && Number.isFinite(strength)) {
      sum += w * strength;
    }
  }
  return Number.isFinite(sum) ? sum : 0;
}

/**
 * Decorate every entity in a tenant model with its computed activation at
 * `nowMs`, returned highest-activation-first. Pure: same inputs → same order.
 * Ties break by `lastReferencedAtMs` (more-recent first) then entityId so the
 * order is total + deterministic across replicas.
 */
export function activateAll(
  entities: ReadonlyArray<SituationEntity>,
  nowMs: number,
  params: ActivationParams,
): ReadonlyArray<ActivatedEntity> {
  const present = new Map<SituationEntityKey, SituationEntity>();
  for (const e of entities) {
    present.set(entityKeyOf(e.kind, e.entityId), e);
  }

  const decorated: ActivatedEntity[] = entities.map((entity) => {
    const baseLevel = baseLevelActivation(entity, nowMs, params);
    const spreading = spreadingActivation(entity, present, params);
    const activation = baseLevel + spreading;
    return Object.freeze({ entity, activation, baseLevel, spreading });
  });

  decorated.sort((a, b) => {
    if (b.activation !== a.activation) return b.activation - a.activation;
    if (b.entity.lastReferencedAtMs !== a.entity.lastReferencedAtMs) {
      return b.entity.lastReferencedAtMs - a.entity.lastReferencedAtMs;
    }
    return a.entity.entityId < b.entity.entityId ? -1 : 1;
  });
  return Object.freeze(decorated);
}

/** Clamp the ACT-R decay exponent into the open interval (0, 1). */
function clampDecay(d: number): number {
  if (!Number.isFinite(d)) return 0.5;
  if (d <= 0) return 1e-6;
  if (d >= 1) return 1 - 1e-6;
  return d;
}
