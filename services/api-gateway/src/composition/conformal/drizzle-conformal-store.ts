/**
 * Drizzle-backed durable store for the online-ACI coverage-feedback loop.
 *
 * Persists the three sides of the loop (migration 0299):
 *   - conformal_predictions       — the emitted prediction + interval + alpha.
 *   - conformal_observations      — the landed outcome (covered or not).
 *   - conformal_calibration_state — the rolling ACI state per prediction type.
 *
 * This adapter is the IO seam for `conformal-calibration-loop.ts`: the loop is
 * pure (it folds observations through `@borjie/conformal-calibration-online`),
 * the store is the only thing that touches Postgres.
 *
 * Tenant isolation — TWO layers (CLAUDE.md hard rule):
 *   1. RLS — every `conformal_*` table FORCE-enables row-level security on the
 *      canonical `app.current_tenant_id` GUC, bound per request by
 *      databaseMiddleware (the loop is always called from a request-scoped,
 *      tenant-pinned Drizzle connection).
 *   2. Defence-in-depth — every read ALSO filters by the caller-supplied
 *      `tenantId`, and every write carries `tenantId` on the row.
 *
 * The Drizzle client is typed `DrizzleLike` (`any`) at the seam: the fluent
 * builder generics cannot be reproduced through the `@borjie/database` barrel
 * without tripping TS2709 (see `stage/drizzle-stage-advisor-db.ts` and
 * `ai-native/drizzle-repos.ts` for the rationale). Every row is mapped through
 * an explicit converter, so callers stay typed.
 *
 * No `console.log` — failures propagate to the route / loop error envelope.
 */

import { and, desc, eq } from 'drizzle-orm';
import {
  conformalPredictions,
  conformalObservations,
  conformalCalibrationState,
} from '@borjie/database';
import type {
  OnlineConformalState,
  CoverageObservation,
} from '@borjie/conformal-calibration-online';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;

/** A prediction to persist when the brain emits it. */
export interface PersistPredictionInput {
  readonly tenantId: string;
  /** Caller-stable id of the upstream prediction (1:1 with the outcome). */
  readonly predictionId: string;
  readonly predictionType: string;
  readonly predictedValue?: number;
  readonly predictedLower?: number;
  readonly predictedUpper?: number;
  /** Alpha in force when the interval was produced (audit trail). */
  readonly alphaAtEmit: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy?: string;
}

/** An outcome to persist when it lands. */
export interface PersistObservationInput {
  readonly tenantId: string;
  readonly predictionId: string;
  readonly predictionType: string;
  readonly observedValue?: number;
  /** TRUE iff the outcome fell inside the predicted interval. */
  readonly covered: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy?: string;
}

/**
 * Persisted ACI config + state for one (tenant, predictionType). `recent` is
 * the rolling coverage window so `updateConformal` resumes exactly.
 */
export interface PersistedCalibration {
  readonly targetCoverage: number;
  readonly alpha: number;
  readonly learningRate: number;
  readonly windowSize: number;
  readonly recent: ReadonlyArray<CoverageObservation>;
  readonly observationsCount: number;
}

export interface ConformalStore {
  persistPrediction(input: PersistPredictionInput): Promise<void>;
  persistObservation(input: PersistObservationInput): Promise<void>;
  /** Load the persisted ACI state, or null when none exists yet (cold start). */
  loadCalibration(
    tenantId: string,
    predictionType: string,
  ): Promise<PersistedCalibration | null>;
  /** Upsert the ACI state after an update (last-write-wins per tenant+type). */
  saveCalibration(
    tenantId: string,
    predictionType: string,
    next: OnlineConformalState,
    observationsCount: number,
  ): Promise<void>;
}

function toCoverageObservation(value: unknown): CoverageObservation | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.predictedCovered !== 'boolean') return null;
  return {
    predictedCovered: v.predictedCovered,
    observedAtIso:
      typeof v.observedAtIso === 'string'
        ? v.observedAtIso
        : new Date().toISOString(),
  };
}

function rowToCalibration(row: Record<string, unknown>): PersistedCalibration {
  const recentRaw = Array.isArray(row.recent) ? row.recent : [];
  const recent = recentRaw
    .map(toCoverageObservation)
    .filter((o): o is CoverageObservation => o !== null);
  return {
    targetCoverage: Number(row.targetCoverage ?? 0.9),
    alpha: Number(row.alpha ?? 0.1),
    learningRate: Number(row.learningRate ?? 0.05),
    windowSize: Number(row.windowSize ?? 200),
    recent,
    observationsCount: Number(row.observationsCount ?? 0),
  };
}

/**
 * Construct a Drizzle-backed `ConformalStore`. `db` MUST be the request-scoped,
 * tenant-pinned connection so RLS fires on every statement.
 */
export function createDrizzleConformalStore(db: DrizzleLike): ConformalStore {
  return {
    persistPrediction: async (input) => {
      await db
        .insert(conformalPredictions)
        .values({
          tenantId: input.tenantId,
          predictionId: input.predictionId,
          predictionType: input.predictionType,
          predictedValue: input.predictedValue ?? null,
          predictedLower: input.predictedLower ?? null,
          predictedUpper: input.predictedUpper ?? null,
          alphaAtEmit: input.alphaAtEmit,
          metadata: input.metadata ?? {},
          createdBy: input.createdBy ?? null,
        })
        // A re-emit of the same (tenant, predictionId) refreshes the interval +
        // alpha rather than erroring (idempotent persistence).
        .onConflictDoUpdate({
          target: [
            conformalPredictions.tenantId,
            conformalPredictions.predictionId,
          ],
          set: {
            predictionType: input.predictionType,
            predictedValue: input.predictedValue ?? null,
            predictedLower: input.predictedLower ?? null,
            predictedUpper: input.predictedUpper ?? null,
            alphaAtEmit: input.alphaAtEmit,
            metadata: input.metadata ?? {},
          },
        });
    },

    persistObservation: async (input) => {
      await db
        .insert(conformalObservations)
        .values({
          tenantId: input.tenantId,
          predictionId: input.predictionId,
          predictionType: input.predictionType,
          observedValue: input.observedValue ?? null,
          covered: input.covered,
          metadata: input.metadata ?? {},
          createdBy: input.createdBy ?? null,
        })
        // An outcome lands once; a duplicate delivery is a no-op (the webhook /
        // outcome feed is at-least-once — CLAUDE.md idempotency rule).
        .onConflictDoNothing({
          target: [
            conformalObservations.tenantId,
            conformalObservations.predictionId,
          ],
        });
    },

    loadCalibration: async (tenantId, predictionType) => {
      const rows = await db
        .select()
        .from(conformalCalibrationState)
        .where(
          and(
            eq(conformalCalibrationState.tenantId, tenantId),
            eq(conformalCalibrationState.predictionType, predictionType),
          ),
        )
        .orderBy(desc(conformalCalibrationState.updatedAt))
        .limit(1);
      const list = rows as Array<Record<string, unknown>>;
      if (list.length === 0) return null;
      return rowToCalibration(list[0] as Record<string, unknown>);
    },

    saveCalibration: async (tenantId, predictionType, next, observationsCount) => {
      const values = {
        tenantId,
        predictionType,
        targetCoverage: next.targetCoverage,
        alpha: next.alpha,
        learningRate: next.learningRate,
        windowSize: next.windowSize,
        // Store the bounded rolling window verbatim so a reload reconstructs
        // the exact state machine.
        recent: next.recent.map((o) => ({
          predictedCovered: o.predictedCovered,
          observedAtIso: o.observedAtIso,
        })),
        observationsCount,
        updatedAt: new Date(),
      };
      await db
        .insert(conformalCalibrationState)
        .values(values)
        .onConflictDoUpdate({
          target: [
            conformalCalibrationState.tenantId,
            conformalCalibrationState.predictionType,
          ],
          set: {
            targetCoverage: values.targetCoverage,
            alpha: values.alpha,
            learningRate: values.learningRate,
            windowSize: values.windowSize,
            recent: values.recent,
            observationsCount: values.observationsCount,
            updatedAt: values.updatedAt,
          },
        });
    },
  };
}
