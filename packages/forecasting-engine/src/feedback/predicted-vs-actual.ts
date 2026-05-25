/**
 * predicted-vs-actual — reconcile predictions with reality.
 *
 * A record-keeper. The orchestrator emits a `Prediction` at simulate-
 * time; later, when the action's real outcome lands, the caller
 * provides the `actual` and we compute the delta.
 *
 * H2 — `relativeError` denominator now uses `max(|p50|, |actual|, ε)`
 * so a systematically-near-zero prediction (e.g. arrears for a healthy
 * property) does NOT collapse to relativeError = 0 and silently
 * short-circuit `lessonFromDelta`. Pre-fix the model could stay bad
 * forever because the feedback loop returned null.
 *
 * H3 — `createPredictionStore(tenantId)` namespaces every key as
 * `${tenantId}::${id}`. Two tenants emitting predictions with the same
 * `id` (e.g. `cashflow-2026-Q2`) no longer collide. The substrate now
 * enforces isolation; the host adapter need only pass a stable tenant
 * identifier.
 */

import type { ForecastBand, PredictedActualDelta } from '../types.js';

/**
 * Numerical floor for the relativeError denominator (H2). When BOTH p50
 * and actual are essentially zero, absoluteError is also zero and
 * relativeError settles at 0 — which is correct (the prediction was
 * perfectly accurate). The epsilon prevents NaN on a literal-zero
 * denominator, not legitimate behaviour.
 */
const REL_ERROR_EPS = 1e-9;

export interface Prediction {
  readonly id: string;
  readonly metric: string;
  readonly band: ForecastBand;
  readonly createdAtMs: number;
}

export function computeDelta(
  prediction: Prediction,
  actual: number,
): PredictedActualDelta {
  const absoluteError = Math.abs(actual - prediction.band.p50);
  // H2 — symmetric scaling: divide by the LARGEST of (|p50|, |actual|, ε).
  // This gives a useful relativeError when p50 ≈ 0 but |actual| ≠ 0
  // (the previous code returned 0 in that case and hid bad predictions).
  const denominator = Math.max(
    Math.abs(prediction.band.p50),
    Math.abs(actual),
    REL_ERROR_EPS,
  );
  const relativeError = absoluteError / denominator;
  const withinP10P90 =
    actual >= prediction.band.p10 && actual <= prediction.band.p90;
  return {
    predictionId: prediction.id,
    metric: prediction.metric,
    predictedP50: prediction.band.p50,
    actual,
    absoluteError,
    relativeError,
    withinP10P90,
  };
}

export interface PredictionStore {
  put(p: Prediction): void;
  get(id: string): Prediction | undefined;
  list(): ReadonlyArray<Prediction>;
}

/**
 * Build a tenant-scoped prediction store. Keys are namespaced as
 * `${tenantId}::${id}` so two tenants emitting predictions with the
 * same `id` do not collide.
 *
 * Pre-fix: the store was a process-singleton keyed by raw id. Tenant A
 * and tenant B both writing prediction `cashflow-2026-Q2` would
 * cross-contaminate. The substrate could not enforce isolation; only
 * the kernel-adapter's discipline.
 */
export function createPredictionStore(tenantId: string): PredictionStore {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('createPredictionStore requires a non-empty tenantId');
  }
  const namespace = `${tenantId}::`;
  let map: ReadonlyMap<string, Prediction> = new Map();
  function key(id: string): string {
    return `${namespace}${id}`;
  }
  return {
    put(p) {
      const next = new Map(map);
      next.set(key(p.id), p);
      map = next;
    },
    get(id) {
      return map.get(key(id));
    },
    list() {
      // Return values only — the namespace is an implementation detail.
      return Array.from(map.values());
    },
  };
}
