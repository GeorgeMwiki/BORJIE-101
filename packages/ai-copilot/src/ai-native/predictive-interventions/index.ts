/**
 * Predictive intervention engine.
 *
 * Runs nightly. For each active tenant: combine payment-history,
 * sentiment-monitor signals, credit-rating, tenancy-length, cases,
 * messages → produce a probability distribution over:
 *   [will_pay_on_time, will_pay_late, will_default, will_churn, will_dispute]
 * over the next 30/60/90 days. Persist to `tenant_predictions`.
 * Emit `PredictiveInterventionOpportunity` when any probability crosses
 * a threshold.
 *
 * WHY AI-NATIVE: rolling probabilistic forecasts across the whole portfolio
 * — humans can't run statistical models per customer per horizon every
 * night. This engine does it continuously.
 */

import {
  type BudgetGuard,
  type ClassifyLLMPort,
  noopBudgetGuard,
  DEGRADED_MODEL_VERSION,
  promptHash,
  safeJsonParse,
  newId,
  clamp01,
} from '../shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PredictionHorizonDays = 30 | 60 | 90;

export interface TenantFeatureSnapshot {
  readonly tenantId: string;
  readonly customerId: string;
  readonly paymentOnTimeRate: number | null; // 0..1
  readonly arrearsDays: number | null;
  readonly creditScore: number | null; // FICO 300-850
  readonly tenancyMonths: number | null;
  readonly openCases: number;
  readonly rollingSentiment: number | null; // -1..1
  readonly churnSignalAvg: number | null; // 0..1
  readonly disputeCount90d: number;
}

export interface TenantPrediction {
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

export type InterventionSignalType =
  | 'high_default_risk'
  | 'high_churn_risk'
  | 'high_dispute_risk'
  | 'sentiment_collapse';

export interface InterventionOpportunity {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly predictionId: string;
  readonly signalType: InterventionSignalType;
  readonly signalStrength: number;
  readonly suggestedAction: string;
  readonly status: 'open' | 'acknowledged' | 'acted' | 'dismissed';
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface InterventionEvent {
  readonly type: 'PredictiveInterventionOpportunity';
  readonly tenantId: string;
  readonly customerId: string;
  readonly predictionId: string;
  readonly signalType: InterventionSignalType;
  readonly signalStrength: number;
  readonly observedAt: string;
}

export interface PredictiveInterventionRepository {
  listActiveTenants(tenantId: string): Promise<readonly TenantFeatureSnapshot[]>;
  insertPrediction(prediction: TenantPrediction): Promise<TenantPrediction>;
  insertOpportunity(op: InterventionOpportunity): Promise<InterventionOpportunity>;
  listRecentPredictions(
    tenantId: string,
    customerId: string,
  ): Promise<readonly TenantPrediction[]>;
}

export interface PredictiveInterventionEventPublisher {
  publishOpportunity(event: InterventionEvent): Promise<void>;
}

export interface PredictiveInterventionDeps {
  readonly repo: PredictiveInterventionRepository;
  readonly llm?: ClassifyLLMPort;
  readonly publisher?: PredictiveInterventionEventPublisher;
  readonly budgetGuard?: BudgetGuard;
  readonly now?: () => Date;
  readonly defaultThreshold?: number;
  readonly churnThreshold?: number;
  readonly disputeThreshold?: number;
  readonly sentimentCollapseThreshold?: number; // negative, e.g. -0.5
}

// ---------------------------------------------------------------------------
// Heuristic baseline model — used in degraded mode + as prior for the LLM
// ---------------------------------------------------------------------------

/**
 * Pure rule-based baseline. Produces a seed distribution from features.
 * When LLM is unavailable, this is the final answer (with low confidence).
 */
export function baselinePrediction(
  features: TenantFeatureSnapshot,
  horizonDays: PredictionHorizonDays,
): {
  probPayOnTime: number;
  probPayLate: number;
  probDefault: number;
  probChurn: number;
  probDispute: number;
} {
  const onTime = features.paymentOnTimeRate ?? 0.7;
  const arrears = features.arrearsDays ?? 0;
  const sentiment = features.rollingSentiment ?? 0;
  const churnAvg = features.churnSignalAvg ?? 0;
  const horizonWeight = horizonDays / 30; // scale risk with horizon

  const probDefault = clamp01(
    ((arrears > 30 ? 0.4 : arrears > 15 ? 0.25 : 0.05) + (1 - onTime) * 0.35) * horizonWeight * 0.6,
  );
  const probPayLate = clamp01((1 - onTime) * 0.6 * horizonWeight);
  const probPayOnTime = clamp01(1 - probDefault - probPayLate * 0.6);
  const probChurn = clamp01(
    (churnAvg * 0.5 + Math.max(0, -sentiment) * 0.3 + (1 - onTime) * 0.2) * horizonWeight,
  );
  const probDispute = clamp01(
    (features.disputeCount90d > 0 ? 0.35 : 0.05) + Math.max(0, -sentiment) * 0.25,
  );

  return {
    probPayOnTime,
    probPayLate,
    probDefault,
    probChurn,
    probDispute,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PREDICT_SYSTEM_PROMPT = `You are a tenant-risk probability model. Given a feature snapshot, produce
probabilities for the next window. Return ONLY JSON:
{
  "probPayOnTime": number (0..1),
  "probPayLate": number (0..1),
  "probDefault": number (0..1),
  "probChurn": number (0..1),
  "probDispute": number (0..1),
  "confidence": number (0..1),
  "explanation": string (plain language, one paragraph)
}
Rules: probabilities need not sum to 1 (they represent independent risks).
Base every number on the provided features; never invent features.`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PredictiveInterventions {
  predictOne(
    features: TenantFeatureSnapshot,
    horizonDays: PredictionHorizonDays,
  ): Promise<TenantPrediction>;
  runNightly(tenantId: string): Promise<readonly TenantPrediction[]>;
  listRecent(
    tenantId: string,
    customerId: string,
  ): Promise<readonly TenantPrediction[]>;
}

export function createPredictiveInterventions(
  deps: PredictiveInterventionDeps,
): PredictiveInterventions {
  const now = deps.now ?? (() => new Date());
  const guard = deps.budgetGuard ?? noopBudgetGuard;
  const thrDefault = deps.defaultThreshold ?? 0.4;
  const thrChurn = deps.churnThreshold ?? 0.5;
  const thrDispute = deps.disputeThreshold ?? 0.4;
  const thrSent = deps.sentimentCollapseThreshold ?? -0.5;

  async function callLLM(
    features: TenantFeatureSnapshot,
    horizonDays: PredictionHorizonDays,
    hash: string,
    system: string,
    user: string,
  ) {
    if (!deps.llm) return null;
    await guard(features.tenantId, 'predictive-interventions:predict');
    try {
      const res = await deps.llm.classify({ systemPrompt: system, userPrompt: user });
      const parsed = safeJsonParse<{
        probPayOnTime?: number;
        probPayLate?: number;
        probDefault?: number;
        probChurn?: number;
        probDispute?: number;
        confidence?: number;
        explanation?: string;
      }>(res.raw);
      if (!parsed) return null;
      return {
        modelVersion: res.modelVersion,
        probPayOnTime: clamp01(parsed.probPayOnTime),
        probPayLate: clamp01(parsed.probPayLate),
        probDefault: clamp01(parsed.probDefault),
        probChurn: clamp01(parsed.probChurn),
        probDispute: clamp01(parsed.probDispute),
        confidence: clamp01(parsed.confidence ?? 0.6),
        explanation: parsed.explanation ?? 'LLM-derived risk distribution',
      };
    } catch {
      return null;
    }
  }

  async function emitOpportunities(
    prediction: TenantPrediction,
    features: TenantFeatureSnapshot,
  ): Promise<void> {
    const observedAt = prediction.computedAt;
    const candidates: Array<{
      type: InterventionSignalType;
      strength: number;
      action: string;
    }> = [];
    if (prediction.probDefault >= thrDefault) {
      candidates.push({
        type: 'high_default_risk',
        strength: prediction.probDefault,
        action: 'Offer payment plan or eligibility-check before missed invoice.',
      });
    }
    if (prediction.probChurn >= thrChurn) {
      candidates.push({
        type: 'high_churn_risk',
        strength: prediction.probChurn,
        action: 'Proactive renewal check-in with personalized incentive.',
      });
    }
    if (prediction.probDispute >= thrDispute) {
      candidates.push({
        type: 'high_dispute_risk',
        strength: prediction.probDispute,
        action: 'Pre-emptively review ledger reconciliation + open cases.',
      });
    }
    if (features.rollingSentiment !== null && features.rollingSentiment <= thrSent) {
      candidates.push({
        type: 'sentiment_collapse',
        strength: Math.min(1, Math.abs(features.rollingSentiment)),
        action: 'Schedule 1:1 with tenant; review complaints.',
      });
    }

    for (const c of candidates) {
      const op: InterventionOpportunity = {
        id: newId('pio'),
        tenantId: prediction.tenantId,
        customerId: prediction.customerId,
        predictionId: prediction.id,
        signalType: c.type,
        signalStrength: c.strength,
        suggestedAction: c.action,
        status: 'open',
        metadata: {},
        createdAt: observedAt,
      };
      await deps.repo.insertOpportunity(op);
      if (deps.publisher) {
        await deps.publisher.publishOpportunity({
          type: 'PredictiveInterventionOpportunity',
          tenantId: prediction.tenantId,
          customerId: prediction.customerId,
          predictionId: prediction.id,
          signalType: c.type,
          signalStrength: c.strength,
          observedAt,
        });
      }
    }
  }

  return {
    async predictOne(features, horizonDays) {
      if (!features.tenantId || !features.customerId) {
        throw new Error('predictive-interventions.predictOne: missing ids');
      }
      const system = PREDICT_SYSTEM_PROMPT;
      const user = `Features: ${JSON.stringify(features)}\nHorizon: ${horizonDays} days.`;
      const hash = promptHash(system + '\n---\n' + user);
      const baseline = baselinePrediction(features, horizonDays);
      const computedAt = now().toISOString();

      const llmRes = await callLLM(features, horizonDays, hash, system, user);
      const finalDist = llmRes
        ? {
            probPayOnTime: llmRes.probPayOnTime,
            probPayLate: llmRes.probPayLate,
            probDefault: llmRes.probDefault,
            probChurn: llmRes.probChurn,
            probDispute: llmRes.probDispute,
            modelVersion: llmRes.modelVersion,
            confidence: llmRes.confidence,
            explanation: llmRes.explanation,
          }
        : {
            ...baseline,
            modelVersion: DEGRADED_MODEL_VERSION,
            confidence: 0.35,
            explanation: 'Rule-based baseline (LLM unavailable); confidence reduced.',
          };

      const prediction: TenantPrediction = {
        id: newId('tp'),
        tenantId: features.tenantId,
        customerId: features.customerId,
        horizonDays,
        probPayOnTime: finalDist.probPayOnTime,
        probPayLate: finalDist.probPayLate,
        probDefault: finalDist.probDefault,
        probChurn: finalDist.probChurn,
        probDispute: finalDist.probDispute,
        modelVersion: finalDist.modelVersion,
        confidence: finalDist.confidence,
        explanation: finalDist.explanation,
        featureSnapshot: {
          ...features,
        } as Record<string, unknown>,
        promptHash: hash,
        computedAt,
      };
      const stored = await deps.repo.insertPrediction(prediction);
      await emitOpportunities(stored, features);
      return stored;
    },

    async runNightly(tenantId) {
      const all = await deps.repo.listActiveTenants(tenantId);
      const out: TenantPrediction[] = [];
      const horizons: PredictionHorizonDays[] = [30, 60, 90];
      for (const features of all) {
        for (const h of horizons) {
          out.push(await this.predictOne(features, h));
        }
      }
      return out;
    },

    async listRecent(tenantId, customerId) {
      return deps.repo.listRecentPredictions(tenantId, customerId);
    },
  };
}
