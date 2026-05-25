import { describe, it, expect, vi } from 'vitest';
import {
  createPredictiveInterventions,
  baselinePrediction,
  type PredictiveInterventionRepository,
  type PredictiveInterventionEventPublisher,
  type TenantFeatureSnapshot,
  type TenantPrediction,
  type InterventionOpportunity,
} from '../predictive-interventions/index.js';
import { DEGRADED_MODEL_VERSION, type ClassifyLLMPort } from '../shared.js';

function makeRepo(features: TenantFeatureSnapshot[] = []): PredictiveInterventionRepository & {
  predictions: TenantPrediction[];
  opportunities: InterventionOpportunity[];
} {
  const predictions: TenantPrediction[] = [];
  const opportunities: InterventionOpportunity[] = [];
  return {
    predictions,
    opportunities,
    async listActiveTenants() {
      return features;
    },
    async insertPrediction(p) {
      predictions.push(p);
      return p;
    },
    async insertOpportunity(o) {
      opportunities.push(o);
      return o;
    },
    async listRecentPredictions(_t, customerId) {
      return predictions.filter((p) => p.customerId === customerId);
    },
  };
}

const baseFeatures: TenantFeatureSnapshot = {
  tenantId: 't1',
  customerId: 'c1',
  paymentOnTimeRate: 0.3,
  arrearsDays: 45,
  creditScore: 500,
  tenancyMonths: 6,
  openCases: 2,
  rollingSentiment: -0.7,
  churnSignalAvg: 0.6,
  disputeCount90d: 1,
};

describe('predictive-interventions', () => {
  it('baselinePrediction returns elevated default risk for high-arrears tenant', () => {
    const out = baselinePrediction(baseFeatures, 30);
    expect(out.probDefault).toBeGreaterThan(0.1);
    expect(out.probChurn).toBeGreaterThan(0.3);
    expect(out.probPayOnTime + out.probPayLate).toBeLessThanOrEqual(1.01);
  });

  it('runs predictOne with LLM and stores prediction + opportunities', async () => {
    const llm: ClassifyLLMPort = {
      async classify() {
        return {
          raw: JSON.stringify({
            probPayOnTime: 0.3,
            probPayLate: 0.3,
            probDefault: 0.5,
            probChurn: 0.6,
            probDispute: 0.45,
            confidence: 0.8,
            explanation: 'High arrears + negative sentiment',
          }),
          modelVersion: 'claude',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const publishOpportunity = vi.fn().mockResolvedValue(undefined);
    const publisher: PredictiveInterventionEventPublisher = { publishOpportunity };
    const repo = makeRepo();
    const svc = createPredictiveInterventions({ repo, llm, publisher });
    const out = await svc.predictOne(baseFeatures, 30);
    expect(out.probDefault).toBeCloseTo(0.5);
    expect(out.modelVersion).toBe('claude');
    expect(out.confidence).toBeCloseTo(0.8);
    expect(repo.predictions).toHaveLength(1);
    // Thresholds default 0.4/0.5/0.4/-0.5 — all four should trigger
    expect(repo.opportunities.length).toBeGreaterThanOrEqual(3);
    expect(publishOpportunity).toHaveBeenCalled();
  });

  it('falls back to baseline with low confidence when LLM is missing', async () => {
    const repo = makeRepo();
    const svc = createPredictiveInterventions({ repo });
    const out = await svc.predictOne(baseFeatures, 30);
    expect(out.modelVersion).toBe(DEGRADED_MODEL_VERSION);
    expect(out.confidence).toBeLessThan(0.5);
    expect(out.explanation).toMatch(/baseline/i);
  });

  it('runNightly produces 3 horizons per tenant', async () => {
    const repo = makeRepo([baseFeatures]);
    const svc = createPredictiveInterventions({ repo });
    const results = await svc.runNightly('t1');
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.horizonDays).sort()).toEqual([30, 60, 90]);
  });
});
