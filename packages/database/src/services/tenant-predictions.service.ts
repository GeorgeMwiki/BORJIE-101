/**
 * Tenant predictions + intervention opportunities — TODO(borjie-hard-fork) stub.
 *
 * The Drizzle adapter targeted the `tenant_predictions` and
 * `predictive_intervention_opportunities` tables (migration 0106),
 * which were dropped with the rest of the property domain. The
 * predictive-interventions agent will be re-pointed at a mining-
 * equivalent (ore-grade drift / production-shortfall predictions)
 * before this service is restored.
 */

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

export function createTenantPredictionsService(
  _db: DatabaseClient,
): TenantPredictionsService {
  return {
    async insertPrediction(prediction) {
      logger.warn(
        'tenant-predictions.insertPrediction: stub (mining-domain rewrite pending)',
        { tenantId: prediction.tenantId },
      );
      return prediction;
    },
    async insertOpportunity(op) {
      logger.warn(
        'tenant-predictions.insertOpportunity: stub (mining-domain rewrite pending)',
        { tenantId: op.tenantId },
      );
      return op;
    },
    async listRecentPredictions() {
      return [];
    },
    async listOpenOpportunities() {
      return [];
    },
  };
}
