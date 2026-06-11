/**
 * Renewal Optimizer Service
 * AI-powered offtake / supply-agreement renewal pricing optimization
 */

import OpenAI from 'openai';
import { resolveLegacyOpenAiModelId } from '../model-resolution.js';
import { z } from 'zod';
import { RENEWAL_OPTIMIZATION_PROMPT } from '../prompts/index.js';

export const PricingStrategy = {
  RETENTION_FOCUSED: 'RETENTION_FOCUSED',
  MARKET_RATE: 'MARKET_RATE',
  VALUE_MAXIMIZATION: 'VALUE_MAXIMIZATION',
  RELATIONSHIP_BALANCE: 'RELATIONSHIP_BALANCE',
  INCENTIVE_BASED: 'INCENTIVE_BASED',
} as const;

export type PricingStrategy = (typeof PricingStrategy)[keyof typeof PricingStrategy];

export interface OfftakeData {
  offtakeId: string;
  currentPrice: number;
  currency: string;
  offtakeStartDate: string;
  offtakeEndDate: string;
  termMonths: number;
  counterparty: {
    id: string;
    name: string;
    segment: 'premium' | 'standard' | 'at_risk';
    paymentScore: number;
    tenureDays: number;
    renewalHistory: number;
  };
  site: { id: string; name: string; type: string; location: string; capabilities: string[] };
  pit: { id: string; type: string; benches: number; faces: number; areaHa?: number | undefined };
  marketData?: {
    averagePrice: number;
    priceRange: { min: number; max: number };
    availableCapacityRate: number;
    demandLevel: 'high' | 'moderate' | 'low';
  } | undefined;
  constraints?: { maxIncreasePercent?: number | undefined; regulatoryLimit?: number | undefined; ownerMinimum?: number | undefined } | undefined;
}

export interface PricingOption {
  id: string;
  strategy: PricingStrategy;
  label: string;
  description: string;
  proposedPrice: number;
  changeAmount: number;
  changePercent: number;
  termOptions: Array<{ months: number; price: number; monthlyDiscount?: number; totalValue: number }>;
  incentives?: Array<{ type: string; description: string; value?: number; conditions?: string }>;
  projectedOutcome: {
    acceptanceProbability: number;
    renewalLikelihood: number;
    revenueImpact: number;
  };
  competitivePosition: { vsMarket: 'below' | 'at' | 'above'; percentile: number };
  risks: string[];
  benefits: string[];
}

export interface RenewalOptimizationResult {
  offtakeId: string;
  currentPrice: number;
  recommendedOption: PricingOption;
  allOptions: PricingOption[];
  marketAnalysis: {
    currentVsMarket: number;
    marketTrend: 'increasing' | 'stable' | 'decreasing';
    competitivePosition: string;
    supplyDemandBalance: string;
  };
  counterpartyAnalysis: {
    retentionValue: number;
    churnRisk: number;
    priceElasticity: 'high' | 'medium' | 'low';
    relationshipStrength: 'strong' | 'moderate' | 'weak';
  };
  financialProjections: {
    scenarioComparison: Array<{ scenario: string; probability: number; year1Revenue: number; year1Costs: number; netIncome: number }>;
    turnoverCostEstimate: number;
    breakEvenIncrease: number;
  };
  negotiationGuidance: {
    openingPosition: string;
    flexibilityRange: { min: number; max: number };
    keyTalkingPoints: string[];
    objectionHandling: Array<{ objection: string; response: string }>;
  };
  timing: { optimalSendDate: string; followUpSchedule: string[]; expirationRecommendation: string };
  reasoning: string;
}

const PricingOptionSchema = z.object({
  id: z.string(),
  strategy: z.enum(['RETENTION_FOCUSED', 'MARKET_RATE', 'VALUE_MAXIMIZATION', 'RELATIONSHIP_BALANCE', 'INCENTIVE_BASED']),
  label: z.string(),
  description: z.string(),
  proposedPrice: z.number(),
  changeAmount: z.number(),
  changePercent: z.number(),
  termOptions: z.array(z.object({ months: z.number(), price: z.number(), monthlyDiscount: z.number().optional(), totalValue: z.number() })),
  incentives: z.array(z.object({ type: z.string(), description: z.string(), value: z.number().optional(), conditions: z.string().optional() })).optional(),
  projectedOutcome: z.object({ acceptanceProbability: z.number().min(0).max(1), renewalLikelihood: z.number().min(0).max(1), revenueImpact: z.number() }),
  competitivePosition: z.object({ vsMarket: z.enum(['below', 'at', 'above']), percentile: z.number().min(0).max(100) }),
  risks: z.array(z.string()),
  benefits: z.array(z.string()),
});

const RenewalOptimizationResultSchema = z.object({
  offtakeId: z.string(),
  currentPrice: z.number(),
  recommendedOption: PricingOptionSchema,
  allOptions: z.array(PricingOptionSchema),
  marketAnalysis: z.object({
    currentVsMarket: z.number(),
    marketTrend: z.enum(['increasing', 'stable', 'decreasing']),
    competitivePosition: z.string(),
    supplyDemandBalance: z.string(),
  }),
  counterpartyAnalysis: z.object({
    retentionValue: z.number(),
    churnRisk: z.number().min(0).max(1),
    priceElasticity: z.enum(['high', 'medium', 'low']),
    relationshipStrength: z.enum(['strong', 'moderate', 'weak']),
  }),
  financialProjections: z.object({
    scenarioComparison: z.array(z.object({ scenario: z.string(), probability: z.number(), year1Revenue: z.number(), year1Costs: z.number(), netIncome: z.number() })),
    turnoverCostEstimate: z.number(),
    breakEvenIncrease: z.number(),
  }),
  negotiationGuidance: z.object({
    openingPosition: z.string(),
    flexibilityRange: z.object({ min: z.number(), max: z.number() }),
    keyTalkingPoints: z.array(z.string()),
    objectionHandling: z.array(z.object({ objection: z.string(), response: z.string() })),
  }),
  timing: z.object({ optimalSendDate: z.string(), followUpSchedule: z.array(z.string()), expirationRecommendation: z.string() }),
  reasoning: z.string(),
});

export interface RenewalOptimizerConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class RenewalOptimizerService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: RenewalOptimizerConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? resolveLegacyOpenAiModelId();
    this.temperature = config.temperature ?? 0.4;
    this.maxTokens = config.maxTokens ?? 3072;
  }

  async generateRenewalOptions(offtakeId: string, offtakeData?: Partial<OfftakeData>): Promise<RenewalOptimizationResult> {
    const fullOfftakeData = this.buildOfftakeData(offtakeId, offtakeData);

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: RENEWAL_OPTIMIZATION_PROMPT.system },
        { role: 'user', content: `${RENEWAL_OPTIMIZATION_PROMPT.user}\n\nOfftake Data:\n${JSON.stringify(fullOfftakeData, null, 2)}` },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return RenewalOptimizationResultSchema.parse(JSON.parse(content)) as RenewalOptimizationResult;
  }

  private buildOfftakeData(offtakeId: string, data?: Partial<OfftakeData>): OfftakeData {
    // Renewal optimization is a governance-critical decision. Fabricating
    // counterparty/site/pit IDs from constants would cause the AI to emit
    // reasoning grounded in fake data — which would then surface in the
    // manager's UI as a recommendation. Require the caller to supply these.
    if (!data?.counterparty) throw new Error('renewal-optimizer: counterparty data is required');
    if (!data?.site) throw new Error('renewal-optimizer: site data is required');
    if (!data?.pit) throw new Error('renewal-optimizer: pit data is required');
    if (data.currentPrice == null) throw new Error('renewal-optimizer: currentPrice is required');
    if (!data.offtakeStartDate) throw new Error('renewal-optimizer: offtakeStartDate is required');
    if (!data.offtakeEndDate) throw new Error('renewal-optimizer: offtakeEndDate is required');
    if (data.termMonths == null) throw new Error('renewal-optimizer: termMonths is required');
    if (!data.currency) throw new Error(
      'renewal-optimizer: currency is required — resolve from tenant region-config before calling'
    );

    return {
      offtakeId,
      currentPrice: data.currentPrice,
      currency: data.currency,
      offtakeStartDate: data.offtakeStartDate,
      offtakeEndDate: data.offtakeEndDate,
      termMonths: data.termMonths,
      counterparty: data.counterparty,
      site: data.site,
      pit: data.pit,
      marketData: data.marketData,
      constraints: data.constraints,
    };
  }
}

export function createRenewalOptimizerService(config: RenewalOptimizerConfig): RenewalOptimizerService {
  return new RenewalOptimizerService(config);
}

export async function generateRenewalOptions(
  offtakeId: string,
  offtakeData?: Partial<OfftakeData>,
  config?: Partial<RenewalOptimizerConfig>
): Promise<RenewalOptimizationResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  const service = createRenewalOptimizerService({ openaiApiKey: apiKey, ...config });
  return service.generateRenewalOptions(offtakeId, offtakeData);
}
