/**
 * Churn Predictor Service
 * AI-powered tenant churn risk prediction
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { CHURN_PREDICTION_PROMPT } from '../prompts/index.js';
import {
  type AnthropicClient,
  createAnthropicClient,
  generateStructured,
  ModelTier,
} from '../providers/anthropic-client.js';
import {
  calculateChurnBaseline,
  type ChurnBaselineInput,
  type DeterministicChurnResult,
} from './risk/churn-baseline-calculator.js';

/**
 * Pluggable churn model contract. The default implementation
 * (`DeterministicChurnModel`) uses the weighted calculator; future ML models
 * (e.g. XGBoost, gradient-boosted trees) can implement the same interface.
 */
export interface IChurnModel {
  readonly name: string;
  predict(input: ChurnBaselineInput): Promise<DeterministicChurnResult>;
}

export class DeterministicChurnModel implements IChurnModel {
  readonly name = 'deterministic-weighted-v1';
  async predict(
    input: ChurnBaselineInput,
  ): Promise<DeterministicChurnResult> {
    return calculateChurnBaseline(input);
  }
}

export const ChurnRiskLevel = {
  VERY_HIGH: 'VERY_HIGH',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  VERY_LOW: 'VERY_LOW',
} as const;

export type ChurnRiskLevel = (typeof ChurnRiskLevel)[keyof typeof ChurnRiskLevel];

export interface CustomerData {
  customerId: string;
  tenantSince: string;
  leaseEndDate: string;
  rentAmount: number;
  paymentHistory: {
    onTimePayments: number;
    latePayments: number;
    missedPayments: number;
    averageDaysLate?: number;
  };
  maintenanceRequests: {
    total: number;
    openCount: number;
    averageResolutionDays: number;
    satisfactionRating?: number;
  };
  communicationHistory: {
    complaintsCount: number;
    inquiriesCount: number;
    lastContactDate?: string;
    sentimentTrend?: 'positive' | 'neutral' | 'negative' | 'declining';
  };
  renewalHistory?: { previousRenewals: number; declinedOffers: number };
  marketContext?: {
    areaRentTrend: 'increasing' | 'stable' | 'decreasing';
    competitorAvailability: 'high' | 'medium' | 'low';
    marketRentComparison: number;
  };
}

export interface ChurnDriver {
  factor: string;
  impact: 'high' | 'medium' | 'low';
  direction: 'increases_risk' | 'decreases_risk';
  details: string;
  actionable: boolean;
}

export interface RetentionRecommendation {
  action: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  expectedImpact: string;
  estimatedCost?: string;
  timeframe: string;
}

export interface ChurnPredictionResult {
  score: number;
  riskLevel: ChurnRiskLevel;
  confidence: number;
  drivers: ChurnDriver[];
  positiveFactors: string[];
  warningSignals: string[];
  retentionRecommendations: RetentionRecommendation[];
  predictedChurnWindow?: string;
  lifetimeValueAtRisk: number;
  renewalProbability: number;
  reasoning: string;
}

const ChurnPredictionResultSchema = z.object({
  score: z.number().min(0).max(100),
  riskLevel: z.enum(['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW']),
  confidence: z.number().min(0).max(1),
  drivers: z.array(z.object({
    factor: z.string(),
    impact: z.enum(['high', 'medium', 'low']),
    direction: z.enum(['increases_risk', 'decreases_risk']),
    details: z.string(),
    actionable: z.boolean(),
  })),
  positiveFactors: z.array(z.string()),
  warningSignals: z.array(z.string()),
  retentionRecommendations: z.array(z.object({
    action: z.string(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    expectedImpact: z.string(),
    estimatedCost: z.string().optional(),
    timeframe: z.string(),
  })),
  predictedChurnWindow: z.string().optional(),
  lifetimeValueAtRisk: z.number(),
  renewalProbability: z.number().min(0).max(1),
  reasoning: z.string(),
});

export interface ChurnPredictorConfig {
  /** @deprecated Kept for backwards compatibility during migration. */
  openaiApiKey?: string;
  /** Preferred: Anthropic API key (ANTHROPIC_API_KEY). */
  anthropicApiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  anthropicClient?: AnthropicClient;
  /** Pluggable deterministic / ML model (defaults to weighted baseline). */
  churnModel?: IChurnModel;
}

export class ChurnPredictorService {
  private anthropic: AnthropicClient;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private churnModel: IChurnModel;

  constructor(config: ChurnPredictorConfig) {
    this.model = config.model ?? ModelTier.SONNET;
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 2048;
    this.churnModel = config.churnModel ?? new DeterministicChurnModel();

    if (config.anthropicClient) {
      this.anthropic = config.anthropicClient;
    } else {
      const apiKey =
        config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
      if (!apiKey) {
        throw new Error(
          'ChurnPredictorService: ANTHROPIC_API_KEY or anthropicClient is required',
        );
      }
      this.anthropic = createAnthropicClient({
        apiKey,
        defaultModel: this.model,
      });
    }
  }

  async predictChurnRisk(
    customerId: string,
    data?: Partial<CustomerData>,
    baselineInput?: ChurnBaselineInput,
  ): Promise<ChurnPredictionResult> {
    const customerContext = this.buildCustomerContext(customerId, data);

    // DETERMINISTIC FIRST — compute baseline, pass to LLM for narration.
    const deterministic = await this.churnModel.predict(
      baselineInput ?? this.deriveBaselineFromCustomerData(customerContext),
    );

    const userContent = `${CHURN_PREDICTION_PROMPT.user}

Customer Data:
${JSON.stringify(customerContext, null, 2)}

DETERMINISTIC CHURN BASELINE (authoritative — narrate, do not override):
${JSON.stringify(deterministic, null, 2)}`;

    const result = await generateStructured(this.anthropic, {
      systemPrompt: CHURN_PREDICTION_PROMPT.system,
      prompt: userContent,
      schema: ChurnPredictionResultSchema,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });

    const narrated = result.data as ChurnPredictionResult;
    // Preserve deterministic score & level
    return {
      ...narrated,
      score: deterministic.score,
      riskLevel:
        deterministic.level as unknown as ChurnPredictionResult['riskLevel'],
    };
  }

  private deriveBaselineFromCustomerData(
    ctx: CustomerData,
  ): ChurnBaselineInput {
    const daysUntilLeaseEnd = Math.ceil(
      (new Date(ctx.leaseEndDate).getTime() - Date.now()) /
        (1000 * 60 * 60 * 24),
    );
    return {
      lateness: {
        onTimePayments: ctx.paymentHistory.onTimePayments,
        latePayments: ctx.paymentHistory.latePayments,
        missedPayments: ctx.paymentHistory.missedPayments,
        averageDaysLate: ctx.paymentHistory.averageDaysLate,
      },
      complaints: {
        complaintsCount: ctx.communicationHistory.complaintsCount,
        inquiriesCount: ctx.communicationHistory.inquiriesCount,
        sentimentTrend: ctx.communicationHistory.sentimentTrend,
      },
      maintenance: {
        totalRequests: ctx.maintenanceRequests.total,
        openRequests: ctx.maintenanceRequests.openCount,
        averageResolutionDays: ctx.maintenanceRequests.averageResolutionDays,
        satisfactionRating: ctx.maintenanceRequests.satisfactionRating,
      },
      recency: {
        daysUntilLeaseEnd,
        previousRenewals: ctx.renewalHistory?.previousRenewals ?? 0,
        declinedOffers: ctx.renewalHistory?.declinedOffers ?? 0,
      },
      market: {
        areaRentTrend: ctx.marketContext?.areaRentTrend ?? 'stable',
        competitorAvailability:
          ctx.marketContext?.competitorAvailability ?? 'medium',
        marketRentComparison:
          ctx.marketContext?.marketRentComparison ?? 1,
      },
    };
  }

  private buildCustomerContext(customerId: string, data?: Partial<CustomerData>): CustomerData {
    return {
      customerId,
      tenantSince: data?.tenantSince ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      leaseEndDate: data?.leaseEndDate ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      rentAmount: data?.rentAmount ?? 0,
      paymentHistory: data?.paymentHistory ?? { onTimePayments: 0, latePayments: 0, missedPayments: 0 },
      maintenanceRequests: data?.maintenanceRequests ?? { total: 0, openCount: 0, averageResolutionDays: 0 },
      communicationHistory: data?.communicationHistory ?? { complaintsCount: 0, inquiriesCount: 0 },
      renewalHistory: data?.renewalHistory,
      marketContext: data?.marketContext,
    };
  }
}

export function createChurnPredictorService(config: ChurnPredictorConfig): ChurnPredictorService {
  return new ChurnPredictorService(config);
}

export async function predictChurnRisk(
  customerId: string,
  data?: Partial<CustomerData>,
  config?: Partial<ChurnPredictorConfig>,
): Promise<ChurnPredictionResult> {
  const anthropicApiKey =
    config?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey && !config?.anthropicClient) {
    throw new Error('Anthropic API key or client is required');
  }
  const service = createChurnPredictorService({
    anthropicApiKey,
    ...config,
  });
  return service.predictChurnRisk(customerId, data);
}
