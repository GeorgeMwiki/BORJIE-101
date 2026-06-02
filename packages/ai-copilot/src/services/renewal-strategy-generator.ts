/**
 * Renewal Strategy Generator (Enhanced - Module K Integration)
 * 
 * Generates multi-option renewal proposals with:
 * - Expected NOI impact analysis
 * - Churn risk impact assessment
 * - Market comps integration for pricing
 * - Personalized offer strategies
 * 
 * @module renewal-strategy-generator
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { RENEWAL_STRATEGY_PROMPT } from '../prompts/copilot-prompts.js';
import {
  type AnthropicClient,
  createAnthropicClient,
  generateStructured,
  ModelTier,
} from '../providers/anthropic-client.js';

// ============================================================================
// Types and Enums
// ============================================================================

export const RenewalStrategy = {
  RETENTION_PRIORITY: 'retention_priority',     // Minimize churn at cost of revenue
  BALANCED: 'balanced',                         // Balance retention and revenue
  REVENUE_OPTIMIZATION: 'revenue_optimization', // Maximize NOI
  MARKET_ALIGNMENT: 'market_alignment',         // Align with market rates
  RELATIONSHIP_BUILDING: 'relationship_building', // Long-term relationship focus
  VALUE_ADD: 'value_add',                       // Include perks/upgrades
} as const;

export type RenewalStrategy = (typeof RenewalStrategy)[keyof typeof RenewalStrategy];

export const IncentiveType = {
  PRICE_DISCOUNT: 'price_discount',
  PRICE_FREEZE: 'price_freeze',
  FREE_MONTH: 'free_month',
  UPGRADE_INCLUDED: 'upgrade_included',
  CAPABILITY_ACCESS: 'capability_access',
  MAINTENANCE_PRIORITY: 'maintenance_priority',
  LOGISTICS_INCLUDED: 'logistics_included',
  STORAGE_INCLUDED: 'storage_included',
  GIFT_CARD: 'gift_card',
  EARLY_RENEWAL_BONUS: 'early_renewal_bonus',
} as const;

export type IncentiveType = (typeof IncentiveType)[keyof typeof IncentiveType];

// ============================================================================
// Input Interfaces
// ============================================================================

export interface CounterpartyRenewalData {
  counterpartyId: string;
  counterpartyName: string;

  // Current Offtake / supply-agreement
  currentOfftake: {
    monthlyPayment: number;
    currency: string;
    startDate: string;
    endDate: string;
    termMonths: number;
    originalPrice: number; // Price at agreement start
    lastPriceIncrease?: {
      date: string;
      percentChange: number;
    };
  };

  // Counterparty Quality Metrics
  counterpartyMetrics: {
    paymentScore: number;          // 0-100
    onTimePaymentRate: number;     // 0-1
    maintenanceCostBurden: number; // Annual cost caused
    communicationScore: number;    // 0-100
    complaintFrequency: 'low' | 'medium' | 'high';
    ruleCompliance: number;        // 0-100
  };
  
  // Risk Scores
  riskScores: {
    churnRisk: number;     // 0-100
    paymentRisk: number;   // 0-100
    disputeRisk: number;   // 0-100
  };
  
  // Engagement & Satisfaction
  engagement: {
    satisfactionScore?: number;  // 1-5
    sentimentTrend: 'improving' | 'stable' | 'declining';
    renewalHistory: number;      // Previous renewals
    referralsMade: number;
  };
  
  // Known Preferences
  preferences?: {
    priceSensitivity: 'low' | 'medium' | 'high';
    preferredTermLength?: number;
    valuesPriority?: ('price' | 'location' | 'capabilities' | 'service')[];
  };
}

export interface MarketCompData {
  siteId: string;
  pitId: string;
  pitType: string;

  // Current Market Data
  marketData: {
    avgMarketPrice: number;
    priceRange: { min: number; max: number };
    medianPrice: number;
    priceTrend: 'increasing' | 'stable' | 'decreasing';
    trendPercent?: number;
    availableCapacityRate: number;
    daysOnMarket: number;  // Avg for similar pits
  };

  // Comparables
  comparables?: Array<{
    source: 'internal' | 'external';
    pitType: string;
    location: string;
    price: number;
    capabilities: string[];
    daysListed?: number;
  }>;

  // Demand Signals
  demandSignals?: {
    inquiriesLast30Days: number;
    viewingsLast30Days: number;
    waitlistCount: number;
    seasonalFactor: number; // 0.8-1.2
  };
}

export interface SitePolicies {
  // Price Policies
  maxPriceIncreasePercent: number;
  minPriceIncreasePercent?: number;
  regulatoryPriceCap?: number;

  // Discount Policies
  maxDiscountPercent: number;
  maxIncentiveValue: number;

  // Approval Requirements
  requiresApprovalAbove: number; // Percent change requiring approval

  // Term Policies
  preferredTermMonths: number[];
  shortTermPremium?: number;    // Extra percent for short terms
  longTermDiscount?: number;    // Discount for long terms
}

// ============================================================================
// Output Interfaces
// ============================================================================

export interface RenewalOption {
  id: string;
  strategy: RenewalStrategy;
  label: string;
  description: string;
  recommended: boolean;
  
  // Pricing
  pricing: {
    proposedPrice: number;
    changeFromCurrent: number;
    changePercent: number;
    effectivePrice: number;  // After incentives
    effectiveChangePercent: number;
  };

  // Term Options
  termOptions: Array<{
    months: number;
    price: number;
    effectivePrice: number;
    discount?: number;
    totalContractValue: number;
  }>;
  
  // Incentives
  incentives: Array<{
    type: IncentiveType;
    description: string;
    value: number;
    conditions?: string;
    monthsApplicable?: number;
  }>;
  
  // Impact Analysis
  impactAnalysis: {
    // NOI Impact
    noiImpact: {
      year1: number;
      year2Projected: number;
      vsAvailableCapacityScenario: number;
      explanation: string;
    };
    
    // Churn Impact
    churnImpact: {
      acceptanceProbability: number;
      renewalProbability: number;
      churnRiskChange: number; // Positive = reduced risk
      explanation: string;
    };
    
    // Market Position
    marketPosition: {
      vsMarket: 'below' | 'at' | 'above';
      percentile: number;
      competitiveness: 'weak' | 'competitive' | 'strong';
    };
  };
  
  // Risk Assessment
  risks: string[];
  benefits: string[];
  
  // Execution
  requiresApproval: boolean;
  approvalReason?: string;
  suggestedPresentation: string;
  talkingPoints: string[];
}

export interface AvailableCapacityScenario {
  probability: number;
  expectedAvailableCapacityDays: number;
  turnoverCost: number;
  recontractPrice: number;
  totalCostVsRenewal: number;
}

export interface RenewalStrategyResult {
  counterpartyId: string;
  siteId: string;
  pitId: string;
  generatedAt: string;

  // Summary
  summary: {
    currentPrice: number;
    marketPrice: number;
    currentVsMarket: number; // Percentage difference
    recommendedOption: string;
    recommendedStrategy: RenewalStrategy;
    urgency: 'low' | 'medium' | 'high' | 'critical';
    daysToOfftakeEnd: number;
  };

  // Options
  options: RenewalOption[];

  // Counterparty Analysis
  counterpartyAnalysis: {
    valueAssessment: 'premium' | 'standard' | 'at_risk' | 'underperforming';
    lifetimeValue: number;
    retentionPriority: 'high' | 'medium' | 'low';
    priceElasticity: 'elastic' | 'moderate' | 'inelastic';
    relationshipStrength: 'strong' | 'moderate' | 'weak';
    keyRetentionFactors: string[];
    keyChurnRisks: string[];
  };

  // Financial Projections
  financialProjections: {
    scenarios: Array<{
      scenario: string;
      probability: number;
      year1Revenue: number;
      year1Costs: number;
      year1NOI: number;
      year2ProjectedNOI: number;
    }>;
    availableCapacityScenario: AvailableCapacityScenario;
    breakEvenIncrease: number;
    maxIncreaseBeforeChurn: number;
  };
  
  // Negotiation Guidance
  negotiationGuidance: {
    openingPosition: string;
    targetOutcome: string;
    walkAwayPoint?: string;
    concessionStrategy: string[];
    objectionHandling: Array<{
      objection: string;
      response: string;
    }>;
  };
  
  // Timing
  timing: {
    optimalApproachDate: string;
    deadlineForOffer: string;
    followUpSchedule: string[];
    urgencyFactors: string[];
  };
  
  // Comps Summary
  compsSummary: {
    internalComps: number;
    externalComps: number;
    avgCompPrice: number;
    compRange: { min: number; max: number };
    dataConfidence: 'high' | 'medium' | 'low';
  };

  confidence: number;
  reasoning: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const RenewalOptionSchema = z.object({
  id: z.string(),
  strategy: z.enum(['retention_priority', 'balanced', 'revenue_optimization', 
    'market_alignment', 'relationship_building', 'value_add']),
  label: z.string(),
  description: z.string(),
  recommended: z.boolean(),
  pricing: z.object({
    proposedPrice: z.number(),
    changeFromCurrent: z.number(),
    changePercent: z.number(),
    effectivePrice: z.number(),
    effectiveChangePercent: z.number(),
  }),
  termOptions: z.array(z.object({
    months: z.number(),
    price: z.number(),
    effectivePrice: z.number(),
    discount: z.number().optional(),
    totalContractValue: z.number(),
  })),
  incentives: z.array(z.object({
    type: z.enum(['price_discount', 'price_freeze', 'free_month', 'upgrade_included',
      'capability_access', 'maintenance_priority', 'logistics_included', 'storage_included',
      'gift_card', 'early_renewal_bonus']),
    description: z.string(),
    value: z.number(),
    conditions: z.string().optional(),
    monthsApplicable: z.number().optional(),
  })),
  impactAnalysis: z.object({
    noiImpact: z.object({
      year1: z.number(),
      year2Projected: z.number(),
      vsAvailableCapacityScenario: z.number(),
      explanation: z.string(),
    }),
    churnImpact: z.object({
      acceptanceProbability: z.number().min(0).max(1),
      renewalProbability: z.number().min(0).max(1),
      churnRiskChange: z.number(),
      explanation: z.string(),
    }),
    marketPosition: z.object({
      vsMarket: z.enum(['below', 'at', 'above']),
      percentile: z.number().min(0).max(100),
      competitiveness: z.enum(['weak', 'competitive', 'strong']),
    }),
  }),
  risks: z.array(z.string()),
  benefits: z.array(z.string()),
  requiresApproval: z.boolean(),
  approvalReason: z.string().optional(),
  suggestedPresentation: z.string(),
  talkingPoints: z.array(z.string()),
});

const RenewalStrategyResultSchema = z.object({
  counterpartyId: z.string(),
  siteId: z.string(),
  pitId: z.string(),
  generatedAt: z.string(),
  summary: z.object({
    currentPrice: z.number(),
    marketPrice: z.number(),
    currentVsMarket: z.number(),
    recommendedOption: z.string(),
    recommendedStrategy: z.enum(['retention_priority', 'balanced', 'revenue_optimization',
      'market_alignment', 'relationship_building', 'value_add']),
    urgency: z.enum(['low', 'medium', 'high', 'critical']),
    daysToOfftakeEnd: z.number(),
  }),
  options: z.array(RenewalOptionSchema),
  counterpartyAnalysis: z.object({
    valueAssessment: z.enum(['premium', 'standard', 'at_risk', 'underperforming']),
    lifetimeValue: z.number(),
    retentionPriority: z.enum(['high', 'medium', 'low']),
    priceElasticity: z.enum(['elastic', 'moderate', 'inelastic']),
    relationshipStrength: z.enum(['strong', 'moderate', 'weak']),
    keyRetentionFactors: z.array(z.string()),
    keyChurnRisks: z.array(z.string()),
  }),
  financialProjections: z.object({
    scenarios: z.array(z.object({
      scenario: z.string(),
      probability: z.number(),
      year1Revenue: z.number(),
      year1Costs: z.number(),
      year1NOI: z.number(),
      year2ProjectedNOI: z.number(),
    })),
    availableCapacityScenario: z.object({
      probability: z.number(),
      expectedAvailableCapacityDays: z.number(),
      turnoverCost: z.number(),
      recontractPrice: z.number(),
      totalCostVsRenewal: z.number(),
    }),
    breakEvenIncrease: z.number(),
    maxIncreaseBeforeChurn: z.number(),
  }),
  negotiationGuidance: z.object({
    openingPosition: z.string(),
    targetOutcome: z.string(),
    walkAwayPoint: z.string().optional(),
    concessionStrategy: z.array(z.string()),
    objectionHandling: z.array(z.object({
      objection: z.string(),
      response: z.string(),
    })),
  }),
  timing: z.object({
    optimalApproachDate: z.string(),
    deadlineForOffer: z.string(),
    followUpSchedule: z.array(z.string()),
    urgencyFactors: z.array(z.string()),
  }),
  compsSummary: z.object({
    internalComps: z.number(),
    externalComps: z.number(),
    avgCompPrice: z.number(),
    compRange: z.object({ min: z.number(), max: z.number() }),
    dataConfidence: z.enum(['high', 'medium', 'low']),
  }),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

// ============================================================================
// Service Configuration
// ============================================================================

export interface RenewalStrategyConfig {
  /** @deprecated Kept for backwards compatibility during migration. */
  openaiApiKey?: string | undefined;
  /** Preferred: Anthropic API key (ANTHROPIC_API_KEY). */
  anthropicApiKey?: string | undefined;
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  /**
   * Optional: inject a preconfigured Anthropic client. When omitted, a client
   * is built from `anthropicApiKey` at construction time.
   */
  anthropicClient?: AnthropicClient | undefined;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class RenewalStrategyGenerator {
  private anthropic: AnthropicClient;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: RenewalStrategyConfig) {
    this.model = config.model ?? ModelTier.SONNET;
    this.temperature = config.temperature ?? 0.4;
    this.maxTokens = config.maxTokens ?? 4000;

    if (config.anthropicClient) {
      this.anthropic = config.anthropicClient;
    } else {
      const apiKey =
        config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
      if (!apiKey) {
        throw new Error(
          'RenewalStrategyGenerator: ANTHROPIC_API_KEY or anthropicClient is required',
        );
      }
      this.anthropic = createAnthropicClient({
        apiKey,
        defaultModel: this.model,
      });
    }
  }

  /**
   * Generate comprehensive renewal strategy with multiple options.
   * Migrated from OpenAI to Anthropic via the shared client. Zod schema is
   * unchanged so callers need no updates.
   */
  async generateStrategy(
    counterparty: CounterpartyRenewalData,
    market: MarketCompData,
    policies: SitePolicies
  ): Promise<RenewalStrategyResult> {
    const userPrompt = `${RENEWAL_STRATEGY_PROMPT.user}

Counterparty Data:
${JSON.stringify(counterparty, null, 2)}

Market & Comparables Data:
${JSON.stringify(market, null, 2)}

Site Policies:
${JSON.stringify(policies, null, 2)}

Generate at least 3-4 distinct renewal options covering different strategies.
Include detailed NOI impact and churn risk analysis for each option.`;

    const result = await generateStructured(this.anthropic, {
      prompt: userPrompt,
      systemPrompt: RENEWAL_STRATEGY_PROMPT.system,
      schema: RenewalStrategyResultSchema,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });

    return result.data as RenewalStrategyResult;
  }

  /**
   * Get recommended option from strategy result
   */
  getRecommendedOption(result: RenewalStrategyResult): RenewalOption | undefined {
    return result.options.find(o => o.recommended);
  }

  /**
   * Filter options by strategy type
   */
  getOptionsByStrategy(
    result: RenewalStrategyResult,
    strategy: RenewalStrategy
  ): RenewalOption[] {
    return result.options.filter(o => o.strategy === strategy);
  }

  /**
   * Calculate ROI of renewal vs available-capacity
   */
  calculateRenewalROI(result: RenewalStrategyResult): {
    bestOption: RenewalOption;
    roiVsAvailableCapacity: number;
    breakEvenDays: number;
    recommendation: string;
  } {
    const availableCapacity = result.financialProjections.availableCapacityScenario;
    const recommended = this.getRecommendedOption(result);

    if (!recommended) {
      throw new Error('No recommended option found');
    }

    const renewalNOI = recommended.impactAnalysis.noiImpact.year1;
    const availableCapacityCost = availableCapacity.totalCostVsRenewal;
    const roiVsAvailableCapacity = ((renewalNOI - availableCapacityCost) / Math.abs(availableCapacityCost)) * 100;

    // Calculate break-even days
    const dailyPrice = recommended.pricing.proposedPrice / 30;
    const breakEvenDays = Math.ceil(availableCapacity.turnoverCost / dailyPrice);

    return {
      bestOption: recommended,
      roiVsAvailableCapacity,
      breakEvenDays,
      recommendation: roiVsAvailableCapacity > 0
        ? `Renewal recommended. ${breakEvenDays} days to break even on turnover costs.`
        : `Consider available-capacity scenario. Market conditions may favor a new counterparty.`,
    };
  }

  /**
   * Adjust strategy based on counterparty response
   */
  async adjustForCounteroffer(
    originalResult: RenewalStrategyResult,
    counteroffer: {
      requestedPrice?: number;
      requestedTerm?: number;
      requestedIncentives?: string[];
      concerns?: string[];
    }
  ): Promise<{
    adjustedOptions: RenewalOption[];
    recommendation: string;
    maxConcession: number;
    walkAwayAdvice: string;
  }> {
    const counterofferSchema = z.object({
      adjustedOptions: z.array(z.any()),
      recommendation: z.string(),
      maxConcession: z.number(),
      walkAwayAdvice: z.string(),
    });

    const result = await generateStructured(this.anthropic, {
      systemPrompt:
        'You are a renewal negotiation AI. Analyze counteroffers and recommend adjusted strategies.',
      prompt: `Original Strategy:
${JSON.stringify(originalResult, null, 2)}

Counterparty Counteroffer:
${JSON.stringify(counteroffer, null, 2)}

Provide adjusted options that balance counterparty requests with site objectives.
Return JSON with: adjustedOptions (array), recommendation (string), maxConcession (number), walkAwayAdvice (string)`,
      schema: counterofferSchema,
      model: this.model,
      temperature: 0.4,
      maxTokens: 2500,
    });

    return result.data as {
      adjustedOptions: RenewalOption[];
      recommendation: string;
      maxConcession: number;
      walkAwayAdvice: string;
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createRenewalStrategyGenerator(
  config: RenewalStrategyConfig
): RenewalStrategyGenerator {
  return new RenewalStrategyGenerator(config);
}

export async function generateRenewalStrategy(
  counterparty: CounterpartyRenewalData,
  market: MarketCompData,
  policies: SitePolicies,
  config?: Partial<RenewalStrategyConfig>
): Promise<RenewalStrategyResult> {
  const anthropicApiKey =
    config?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey && !config?.anthropicClient) {
    throw new Error('Anthropic API key or client is required');
  }

  const generator = createRenewalStrategyGenerator({
    anthropicApiKey,
    ...config,
  });
  return generator.generateStrategy(counterparty, market, policies);
}

// ============================================================================
// Default Policies
// ============================================================================

export const DEFAULT_SITE_POLICIES: SitePolicies = {
  maxPriceIncreasePercent: 10,
  minPriceIncreasePercent: 0,
  maxDiscountPercent: 5,
  maxIncentiveValue: 500,
  requiresApprovalAbove: 8,
  preferredTermMonths: [6, 12, 18, 24],
  shortTermPremium: 5,
  longTermDiscount: 3,
};
