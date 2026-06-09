/**
 * Tenant predictions + intervention opportunities — Drizzle-backed.
 *
 * Restores the predictive-interventions write/read path (audit finding
 * `tenant-predictions-stub-8`). The property-domain tables
 * (`tenant_predictions`, `predictive_intervention_opportunities`) were
 * dropped in the mining migration; this service now persists against the
 * closed-loop outcome-telemetry substrate (migration 0114), which is the
 * canonical mining-domain home for brain-emitted predictions:
 *
 *   - a prediction          -> `outcome_predictions` row
 *   - an open intervention  -> `outcome_predictions` row WITHOUT a
 *                              matching `outcome_observations` row (the
 *                              window is still "open" until reconciled)
 *
 * The richer property-era probability vector (probDefault, probChurn,
 * …) is preserved losslessly in the `predicted_outcome` jsonb so no
 * signal is discarded; structural fields map to real columns.
 *
 * Hard rules: tenant-scoped via RLS, immutable (never mutates the input
 * shape — we spread), pino logger only, honest-degrade ([] / rethrow-
 * free reads) on failure.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  outcomePredictions,
  outcomeObservations,
} from '../schemas/outcome-telemetry.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

export type PredictionHorizonDays = 30 | 60 | 90;

export interface TenantPredictionShape {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly horizonDays: PredictionHorizonDays;
  readonly probPayOnTime: number;
  readonly probPayLate: number;
  readonly probDefault: number;
  readonly probChurn: number;
  readonly probDispute: number;
  readonly modelVersion: string;
  readonly confidence: number;
  readonly explanation: string;
  readonly featureSnapshot: Readonly<Record<string, unknown>>;
  readonly promptHash: string | null;
  readonly computedAt: string;
}

export type InterventionStatus = 'open' | 'acknowledged' | 'acted' | 'dismissed';

export interface InterventionOpportunityShape {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly predictionId: string;
  readonly signalType: string;
  readonly signalStrength: number;
  readonly suggestedAction: string;
  readonly status: InterventionStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface TenantPredictionsService {
  insertPrediction(
    prediction: TenantPredictionShape,
  ): Promise<TenantPredictionShape>;
  insertOpportunity(
    op: InterventionOpportunityShape,
  ): Promise<InterventionOpportunityShape>;
  listRecentPredictions(
    tenantId: string,
    customerId: string,
    limit?: number,
  ): Promise<ReadonlyArray<TenantPredictionShape>>;
  listOpenOpportunities(
    tenantId: string,
    limit?: number,
  ): Promise<ReadonlyArray<InterventionOpportunityShape>>;
}

const ACTOR_KIND = 'brain';
const ACTION_KIND = 'tenant-prediction';
const OPPORTUNITY_ACTION_KIND = 'intervention-opportunity';
const TARGET_ENTITY_TYPE = 'customer';

function clampConfidence(value: number): string {
  if (!Number.isFinite(value)) return '0.000';
  return Math.min(1, Math.max(0, value)).toFixed(3);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function rowToPrediction(
  row: typeof outcomePredictions.$inferSelect,
): TenantPredictionShape {
  const p = (row.predictedOutcome ?? {}) as Record<string, unknown>;
  const horizon = row.predictionHorizonDays;
  const horizonDays: PredictionHorizonDays =
    horizon === 60 ? 60 : horizon === 90 ? 90 : 30;
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.actionTargetEntityId,
    horizonDays,
    probPayOnTime: Number(p.probPayOnTime ?? 0),
    probPayLate: Number(p.probPayLate ?? 0),
    probDefault: Number(p.probDefault ?? 0),
    probChurn: Number(p.probChurn ?? 0),
    probDispute: Number(p.probDispute ?? 0),
    modelVersion: String(p.modelVersion ?? 'unknown'),
    confidence: Number(row.predictionConfidence ?? 0),
    explanation: row.rationale ?? '',
    featureSnapshot: (p.featureSnapshot ?? {}) as Record<string, unknown>,
    promptHash: (p.promptHash as string | null) ?? null,
    computedAt: row.createdAt.toISOString(),
  };
}

function rowToOpportunity(
  row: typeof outcomePredictions.$inferSelect,
): InterventionOpportunityShape {
  const p = (row.predictedOutcome ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.actionTargetEntityId,
    predictionId: String(p.predictionId ?? row.id),
    signalType: String(p.signalType ?? 'unknown'),
    signalStrength: Number(row.predictionConfidence ?? 0),
    suggestedAction: row.rationale ?? '',
    status: (p.status as InterventionStatus) ?? 'open',
    metadata: (p.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createTenantPredictionsService(
  db: DatabaseClient,
): TenantPredictionsService {
  return {
    async insertPrediction(prediction) {
      const id = isUuid(prediction.id) ? prediction.id : randomUUID();
      try {
        await db.insert(outcomePredictions).values({
          id,
          tenantId: prediction.tenantId,
          actorKind: ACTOR_KIND,
          actorId: prediction.modelVersion || 'predictive-interventions',
          actionKind: ACTION_KIND,
          actionTargetEntityType: TARGET_ENTITY_TYPE,
          actionTargetEntityId: prediction.customerId,
          predictedOutcome: {
            probPayOnTime: prediction.probPayOnTime,
            probPayLate: prediction.probPayLate,
            probDefault: prediction.probDefault,
            probChurn: prediction.probChurn,
            probDispute: prediction.probDispute,
            modelVersion: prediction.modelVersion,
            featureSnapshot: prediction.featureSnapshot,
            promptHash: prediction.promptHash,
          },
          predictionConfidence: clampConfidence(prediction.confidence),
          predictionHorizonDays: prediction.horizonDays,
          rationale: prediction.explanation,
        });
        return { ...prediction, id };
      } catch (err) {
        logger.error('tenant-predictions.insertPrediction failed', {
          tenantId: prediction.tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
        throw new Error('Failed to persist tenant prediction');
      }
    },

    async insertOpportunity(op) {
      const id = isUuid(op.id) ? op.id : randomUUID();
      try {
        await db.insert(outcomePredictions).values({
          id,
          tenantId: op.tenantId,
          actorKind: ACTOR_KIND,
          actorId: 'predictive-interventions',
          actionKind: OPPORTUNITY_ACTION_KIND,
          actionTargetEntityType: TARGET_ENTITY_TYPE,
          actionTargetEntityId: op.customerId,
          predictedOutcome: {
            predictionId: op.predictionId,
            signalType: op.signalType,
            status: op.status,
            metadata: op.metadata,
          },
          predictionConfidence: clampConfidence(op.signalStrength),
          predictionHorizonDays: 30,
          rationale: op.suggestedAction,
        });
        return { ...op, id };
      } catch (err) {
        logger.error('tenant-predictions.insertOpportunity failed', {
          tenantId: op.tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
        throw new Error('Failed to persist intervention opportunity');
      }
    },

    async listRecentPredictions(tenantId, customerId, limit = 10) {
      try {
        const rows = await db
          .select()
          .from(outcomePredictions)
          .where(
            and(
              eq(outcomePredictions.tenantId, tenantId),
              eq(outcomePredictions.actionKind, ACTION_KIND),
              eq(outcomePredictions.actionTargetEntityId, customerId),
            ),
          )
          .orderBy(desc(outcomePredictions.createdAt))
          .limit(Math.max(1, Math.min(100, limit)));
        return rows.map(rowToPrediction);
      } catch (err) {
        logger.warn('tenant-predictions.listRecentPredictions degraded to []', {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    },

    async listOpenOpportunities(tenantId, limit = 20) {
      try {
        // "Open" = an opportunity prediction with no observation yet.
        const rows = await db
          .select({ p: outcomePredictions })
          .from(outcomePredictions)
          .leftJoin(
            outcomeObservations,
            and(
              eq(outcomeObservations.tenantId, outcomePredictions.tenantId),
              eq(outcomeObservations.predictionId, outcomePredictions.id),
            ),
          )
          .where(
            and(
              eq(outcomePredictions.tenantId, tenantId),
              eq(outcomePredictions.actionKind, OPPORTUNITY_ACTION_KIND),
              isNull(outcomeObservations.id),
              sql`coalesce(${outcomePredictions.predictedOutcome}->>'status', 'open') = 'open'`,
            ),
          )
          .orderBy(desc(outcomePredictions.createdAt))
          .limit(Math.max(1, Math.min(100, limit)));
        return rows.map((r) => rowToOpportunity(r.p));
      } catch (err) {
        logger.warn('tenant-predictions.listOpenOpportunities degraded to []', {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    },
  };
}
