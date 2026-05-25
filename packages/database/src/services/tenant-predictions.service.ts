/**
 * Tenant predictions + intervention opportunities — Drizzle-backed
 * adapter for the `tenant_predictions` and
 * `predictive_intervention_opportunities` tables (migration 0106).
 *
 * Adapts to the predictive-interventions agent's
 * `PredictiveInterventionRepository.insertPrediction` /
 * `insertOpportunity` / `listRecentPredictions` shape
 * (`@borjie/ai-copilot/ai-native/predictive-interventions`). The
 * port is duck-typed so this service does not compile-time-depend on
 * ai-copilot.
 *
 * `listActiveTenants` is NOT implemented here — tenancy data lives in
 * the occupancy / lease repositories. The composition root composes a
 * thin adapter that joins this service with those repos.
 *
 * Hard DB failures degrade gracefully:
 *   - inserts : log + rethrow so the agent records the gap
 *   - list    : returns [] on error
 */

import { and, desc, eq } from 'drizzle-orm';
import {

  tenantPredictions,
  predictiveInterventionOpportunities,
} from '../schemas/tenant-predictions.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

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

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function createTenantPredictionsService(
  db: DatabaseClient,
): TenantPredictionsService {
  return {
    async insertPrediction(prediction) {
      if (!prediction.id || !prediction.tenantId || !prediction.customerId) {
        throw new Error(
          'tenant-predictions.insertPrediction requires id, tenantId, and customerId',
        );
      }
      try {
        await db.insert(tenantPredictions).values({
          id: prediction.id,
          tenantId: prediction.tenantId,
          customerId: prediction.customerId,
          horizonDays: prediction.horizonDays,
          probPayOnTime: prediction.probPayOnTime,
          probPayLate: prediction.probPayLate,
          probDefault: prediction.probDefault,
          probChurn: prediction.probChurn,
          probDispute: prediction.probDispute,
          modelVersion: prediction.modelVersion,
          confidence: prediction.confidence,
          explanation: prediction.explanation,
          featureSnapshot:
            prediction.featureSnapshot as Record<string, unknown>,
          promptHash: prediction.promptHash,
          computedAt: new Date(prediction.computedAt),
        } as never);
        return prediction;
      } catch (error) {
        logger.error('tenant-predictions.insertPrediction failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('tenant-predictions.insertPrediction failed');
      }
    },

    async insertOpportunity(op) {
      if (!op.id || !op.tenantId || !op.customerId) {
        throw new Error(
          'tenant-predictions.insertOpportunity requires id, tenantId, and customerId',
        );
      }
      try {
        await db.insert(predictiveInterventionOpportunities).values({
          id: op.id,
          tenantId: op.tenantId,
          customerId: op.customerId,
          predictionId: op.predictionId,
          signalType: op.signalType,
          signalStrength: op.signalStrength,
          suggestedAction: op.suggestedAction,
          status: op.status,
          metadata: op.metadata as Record<string, unknown>,
          createdAt: new Date(op.createdAt),
        } as never);
        return op;
      } catch (error) {
        logger.error('tenant-predictions.insertOpportunity failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('tenant-predictions.insertOpportunity failed');
      }
    },

    async listRecentPredictions(tenantId, customerId, limit) {
      try {
        if (!tenantId || !customerId) return [];
        const cap = clampLimit(limit, DEFAULT_LIMIT);
        const rows = (await db
          .select()
          .from(tenantPredictions)
          .where(
            and(
              eq(tenantPredictions.tenantId, tenantId),
              eq(tenantPredictions.customerId, customerId),
            ),
          )
          .orderBy(desc(tenantPredictions.computedAt))
          .limit(cap)) as ReadonlyArray<TenantPredictionRowDb>;
        return rows.map(rowToPrediction);
      } catch (error) {
        logger.error('tenant-predictions.listRecentPredictions failed', { error: error });
        return [];
      }
    },

    async listOpenOpportunities(tenantId, limit) {
      try {
        if (!tenantId) return [];
        const cap = clampLimit(limit, DEFAULT_LIMIT);
        const rows = (await db
          .select()
          .from(predictiveInterventionOpportunities)
          .where(
            and(
              eq(predictiveInterventionOpportunities.tenantId, tenantId),
              eq(predictiveInterventionOpportunities.status, 'open'),
            ),
          )
          .orderBy(desc(predictiveInterventionOpportunities.createdAt))
          .limit(cap)) as ReadonlyArray<OpportunityRowDb>;
        return rows.map(rowToOpportunity);
      } catch (error) {
        logger.error('tenant-predictions.listOpenOpportunities failed', { error: error });
        return [];
      }
    },
  };
}

interface TenantPredictionRowDb {
  id: string;
  tenantId: string;
  customerId: string;
  horizonDays: number;
  probPayOnTime: number;
  probPayLate: number;
  probDefault: number;
  probChurn: number;
  probDispute: number;
  modelVersion: string;
  confidence: number;
  explanation: string | null;
  featureSnapshot: unknown;
  promptHash: string | null;
  computedAt: Date | string;
}

interface OpportunityRowDb {
  id: string;
  tenantId: string;
  customerId: string;
  predictionId: string | null;
  signalType: string;
  signalStrength: number;
  suggestedAction: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date | string;
}

function rowToPrediction(row: TenantPredictionRowDb): TenantPredictionShape {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    horizonDays: clampHorizon(row.horizonDays),
    probPayOnTime: Number(row.probPayOnTime),
    probPayLate: Number(row.probPayLate),
    probDefault: Number(row.probDefault),
    probChurn: Number(row.probChurn),
    probDispute: Number(row.probDispute),
    modelVersion: row.modelVersion,
    confidence: Number(row.confidence),
    explanation: row.explanation ?? '',
    featureSnapshot:
      row.featureSnapshot && typeof row.featureSnapshot === 'object'
        ? (row.featureSnapshot as Record<string, unknown>)
        : {},
    promptHash: row.promptHash,
    computedAt:
      row.computedAt instanceof Date
        ? row.computedAt.toISOString()
        : String(row.computedAt),
  };
}

function rowToOpportunity(row: OpportunityRowDb): InterventionOpportunityShape {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    predictionId: row.predictionId ?? '',
    signalType: row.signalType,
    signalStrength: Number(row.signalStrength),
    suggestedAction: row.suggestedAction ?? '',
    status: parseStatus(row.status),
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

function parseStatus(value: string): InterventionStatus {
  if (
    value === 'open' ||
    value === 'acknowledged' ||
    value === 'acted' ||
    value === 'dismissed'
  ) {
    return value;
  }
  return 'open';
}

function clampHorizon(value: number): PredictionHorizonDays {
  if (value === 30 || value === 60 || value === 90) return value;
  return 30;
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_LIMIT);
}

export { tenantPredictions, predictiveInterventionOpportunities };
