/**
 * Public types for the forecasting-engine package.
 *
 * Everything is plain TypeScript with zod schemas for inputs that
 * cross the package boundary. Internal helpers may use looser types
 * but the public API surface must round-trip through validators.
 */

import { z } from 'zod';

// -------------------------------------------------------------
// Time-series primitives
// -------------------------------------------------------------

export interface TimePoint {
  readonly t: number; // ms since epoch
  readonly v: number;
}

export interface ForecastBand {
  readonly t: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export interface FittedModel<P> {
  readonly params: P;
  readonly residualStd: number;
  readonly sampleSize: number;
}

// -------------------------------------------------------------
// Business archetype (owner objective profile)
// -------------------------------------------------------------

export const businessArchetypeSchema = z.enum([
  'cashflow-first',
  'growth',
  'exit-prep',
  'preservation',
]);
export type BusinessArchetype = z.infer<typeof businessArchetypeSchema>;

export const ownerIntentSchema = z.object({
  archetype: businessArchetypeSchema,
  weights: z
    .object({
      cashflow: z.number().min(0).max(1),
      retention: z.number().min(0).max(1),
      compliance: z.number().min(0).max(1),
      intentAlignment: z.number().min(0).max(1),
    })
    .refine(
      (w) =>
        Math.abs(
          w.cashflow + w.retention + w.compliance + w.intentAlignment - 1,
        ) < 1e-6,
      { message: 'Objective weights must sum to 1' },
    ),
  riskTolerance: z.number().min(0).max(1), // 0 = risk-averse, 1 = aggressive
});
export type OwnerIntent = z.infer<typeof ownerIntentSchema>;

// -------------------------------------------------------------
// World model
// -------------------------------------------------------------

export interface TenantNode {
  readonly tenantId: string;
  readonly unitId: string;
  readonly tenureDays: number;
  readonly monthlyRent: number;
  readonly paymentReliability: number; // 0..1
  readonly leaseEndsAt: number; // ms
}

export interface UnitNode {
  readonly unitId: string;
  readonly propertyId: string;
  readonly microMarketId: string;
  readonly occupied: boolean;
  readonly listedRent: number;
}

export interface BusinessContext {
  readonly orgId: string;
  readonly tenants: ReadonlyArray<TenantNode>;
  readonly units: ReadonlyArray<UnitNode>;
  readonly cashBalance: number;
  readonly horizonDays: number;
  readonly nowMs: number;
  readonly ownerIntent: OwnerIntent;
  readonly historicalCashflow: ReadonlyArray<TimePoint>;
  readonly historicalOccupancy?: ReadonlyArray<TimePoint>;
}

// -------------------------------------------------------------
// Proposed action — the thing being simulated
// -------------------------------------------------------------

export const proposedActionSchema = z.object({
  kind: z.string(),
  payload: z.record(z.unknown()),
  riskTier: z.enum(['readonly', 'low-mutate', 'mutate', 'destructive']),
});
export type ProposedAction = z.infer<typeof proposedActionSchema>;

// -------------------------------------------------------------
// Outcomes
// -------------------------------------------------------------

export interface ScenarioOutcome {
  readonly scenarioName: string;
  readonly projectedNoi: ReadonlyArray<ForecastBand>;
  readonly retentionProbability: number; // 0..1, blended across tenants
  readonly complianceScore: number; // 0..1
  readonly intentAlignment: number; // 0..1
  readonly cashShortfallProbability: number; // 0..1
  readonly notes: ReadonlyArray<string>;
}

export interface ScoredOutcome extends ScenarioOutcome {
  readonly score: number;
  readonly perObjective: {
    readonly cashflow: number;
    readonly retention: number;
    readonly compliance: number;
    readonly intentAlignment: number;
  };
}

export interface RankedOutcomes {
  readonly ranked: ReadonlyArray<ScoredOutcome>;
  readonly diffView: DiffView;
  readonly paretoFront: ReadonlyArray<ScoredOutcome>;
}

export interface DiffView {
  readonly kind: 'forecasting.DiffView.v1';
  readonly recommended: string;
  readonly alternatives: ReadonlyArray<{
    readonly name: string;
    readonly score: number;
    readonly summary: string;
  }>;
  readonly tradeOffs: ReadonlyArray<string>;
}

// -------------------------------------------------------------
// Sandbox runtime
// -------------------------------------------------------------

export interface Sandbox {
  readonly runId: string;
  readonly createdAt: number;
  readonly mode: 'in-memory' | 'schema-clone';
  read<T>(key: string): Promise<T | undefined>;
  write<T>(key: string, value: T): Promise<void>;
  dispose(): Promise<void>;
  isDisposed(): boolean;
}

// -------------------------------------------------------------
// Feedback
// -------------------------------------------------------------

export interface PredictedActualDelta {
  readonly predictionId: string;
  readonly metric: string;
  readonly predictedP50: number;
  readonly actual: number;
  readonly absoluteError: number;
  readonly relativeError: number;
  readonly withinP10P90: boolean;
}

export interface ReflexionLesson {
  readonly id: string;
  readonly forMetric: string;
  readonly summary: string;
  readonly correctionHint: string;
  readonly createdAt: number;
}

// -------------------------------------------------------------
// Simulate options
// -------------------------------------------------------------

export interface SimulateOptions {
  readonly n?: number;
  readonly seed?: number;
  readonly horizonDays?: number;
}
