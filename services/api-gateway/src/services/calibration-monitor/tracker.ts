/**
 * Calibration tracker - Wave CLOSED-LOOP.
 *
 * Computes the per-tenant calibration score from outcome_predictions +
 * outcome_reconciliations. Pure adapter: the DB port is injected so
 * the tracker stays testable with an in-memory stub.
 *
 * Scoring rules:
 *   - accuracy = matched / (matched + divergent). When the denominator
 *     is 0 we return 1.0 (no failures to count yet).
 *   - meanDrift averages over the SAME population as accuracy
 *     (matched + divergent), so the two metrics share a window.
 *   - calibrationCurve buckets reconciliations by the prediction's
 *     confidence into 5 bands of width 0.2; surfaces matched-fraction
 *     per band so the cockpit can show whether high-confidence
 *     predictions actually land better than low-confidence ones.
 *
 * The tracker NEVER mutates rows - it is read-only over the telemetry
 * tables. The alerter (alerter.ts) is the only writer in this package.
 */

import { sql } from 'drizzle-orm';
import type {
  CalibrationCurvePoint,
  CalibrationScore,
  CalibrationScoreInput,
} from './types';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

const DEFAULT_SINCE_DAYS = 30;
const CURVE_BAND_WIDTH = 0.2;

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

interface ReconciliationSample {
  readonly status: 'matched' | 'divergent' | 'undetermined' | 'expired';
  readonly confidence: number;
  readonly drift: number;
}

function rowToSample(r: Record<string, unknown>): ReconciliationSample | null {
  const status = typeof r.status === 'string' ? r.status : null;
  if (
    status !== 'matched' &&
    status !== 'divergent' &&
    status !== 'undetermined' &&
    status !== 'expired'
  ) {
    return null;
  }
  return {
    status,
    confidence: toNumber(r.prediction_confidence),
    drift: toNumber(r.drift_score),
  };
}

function bandFor(confidence: number): { lower: number; upper: number } {
  const clamped = Math.max(0, Math.min(1, confidence));
  const bucketIndex = Math.min(
    Math.floor(clamped / CURVE_BAND_WIDTH),
    Math.round(1 / CURVE_BAND_WIDTH) - 1,
  );
  const lower = Number((bucketIndex * CURVE_BAND_WIDTH).toFixed(2));
  const upper = Number(((bucketIndex + 1) * CURVE_BAND_WIDTH).toFixed(2));
  return { lower, upper };
}

function buildCurve(
  samples: readonly ReconciliationSample[],
): readonly CalibrationCurvePoint[] {
  // Initialise 5 fixed bands so the curve shape stays stable even with
  // few samples.
  const bands: Map<string, { lower: number; upper: number; total: number; matched: number }> =
    new Map();
  for (let i = 0; i < Math.round(1 / CURVE_BAND_WIDTH); i += 1) {
    const lower = Number((i * CURVE_BAND_WIDTH).toFixed(2));
    const upper = Number(((i + 1) * CURVE_BAND_WIDTH).toFixed(2));
    bands.set(`${lower}-${upper}`, { lower, upper, total: 0, matched: 0 });
  }
  for (const s of samples) {
    if (s.status !== 'matched' && s.status !== 'divergent') continue;
    const band = bandFor(s.confidence);
    const key = `${band.lower}-${band.upper}`;
    const slot = bands.get(key);
    if (!slot) continue;
    slot.total += 1;
    if (s.status === 'matched') slot.matched += 1;
  }
  return Object.freeze(
    Array.from(bands.values()).map((b) =>
      Object.freeze({
        confidenceLower: b.lower,
        confidenceUpper: b.upper,
        count: b.total,
        matchedFraction: b.total === 0 ? 0 : Number((b.matched / b.total).toFixed(4)),
      }),
    ),
  );
}

export interface CalibrationTrackerOptions {
  readonly db: DbLike;
  readonly now?: () => Date;
}

export interface CalibrationTracker {
  getCalibrationScore(input: CalibrationScoreInput): Promise<CalibrationScore>;
}

export function createCalibrationTracker(
  options: CalibrationTrackerOptions,
): CalibrationTracker {
  const now = options.now ?? (() => new Date());

  return {
    async getCalibrationScore(
      input: CalibrationScoreInput,
    ): Promise<CalibrationScore> {
      const sinceDays = input.sinceDays ?? DEFAULT_SINCE_DAYS;
      const actorKindFilter = input.actorKindFilter ?? null;
      const actionKindPrefix = input.actionKindPrefix ?? null;
      const sinceTs = new Date(
        now().getTime() - sinceDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      const samples: ReconciliationSample[] = [];
      let predictedCount = 0;
      try {
        // Pull predictions + their reconciliations (LEFT JOIN so we
        // also count predictions whose horizon has not yet elapsed -
        // they contribute to `predictedCount` but not to any of the
        // verdict buckets).
        const res = await options.db.execute(sql`
          SELECT p.prediction_confidence,
                 COALESCE(r.status, NULL)        AS status,
                 COALESCE(r.drift_score, 0)::numeric AS drift_score
            FROM outcome_predictions p
       LEFT JOIN outcome_reconciliations r
              ON r.prediction_id = p.id
             AND r.tenant_id     = p.tenant_id
           WHERE p.tenant_id   = ${input.tenantId}
             AND p.created_at >= ${sinceTs}
             AND (${actorKindFilter}::text IS NULL OR p.actor_kind = ${actorKindFilter})
             AND (
               ${actionKindPrefix}::text IS NULL
               OR p.action_kind LIKE (${actionKindPrefix} || '%')
             )
        `);
        for (const row of asRows(res)) {
          predictedCount += 1;
          const sample = rowToSample(row);
          if (sample) samples.push(sample);
        }
      } catch {
        // Degraded mode - return the empty-state envelope.
        return Object.freeze({
          tenantId: input.tenantId,
          sinceDays,
          actorKindFilter,
          actionKindPrefix,
          predictedCount: 0,
          matchedCount: 0,
          divergentCount: 0,
          undeterminedCount: 0,
          expiredCount: 0,
          accuracy: 1,
          meanDrift: 0,
          calibrationCurve: buildCurve([]),
          computedAt: now().toISOString(),
        });
      }

      let matched = 0;
      let divergent = 0;
      let undetermined = 0;
      let expired = 0;
      let driftSum = 0;
      let driftN = 0;
      for (const s of samples) {
        if (s.status === 'matched') matched += 1;
        else if (s.status === 'divergent') divergent += 1;
        else if (s.status === 'undetermined') undetermined += 1;
        else if (s.status === 'expired') expired += 1;
        if (s.status === 'matched' || s.status === 'divergent') {
          driftSum += s.drift;
          driftN += 1;
        }
      }
      const denom = matched + divergent;
      const accuracy = denom === 0 ? 1 : Number((matched / denom).toFixed(4));
      const meanDrift = driftN === 0 ? 0 : Number((driftSum / driftN).toFixed(4));

      return Object.freeze({
        tenantId: input.tenantId,
        sinceDays,
        actorKindFilter,
        actionKindPrefix,
        predictedCount,
        matchedCount: matched,
        divergentCount: divergent,
        undeterminedCount: undetermined,
        expiredCount: expired,
        accuracy,
        meanDrift,
        calibrationCurve: buildCurve(samples),
        computedAt: now().toISOString(),
      });
    },
  };
}

// Re-export the types so callers only need one import.
export type {
  CalibrationCurvePoint,
  CalibrationScore,
  CalibrationScoreInput,
} from './types';
