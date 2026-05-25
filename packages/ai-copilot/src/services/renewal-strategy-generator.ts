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
  RENT_DISCOUNT: 'rent_discount',
  RENT_FREEZE: 'rent_freeze',
  FREE_MONTH: 'free_month',
  UPGRADE_INCLUDED: 'upgrade_included',
  AMENITY_ACCESS: 'amenity_access',
  MAINTENANCE_PRIORITY: 'maintenance_priority',
  PARKING_INCLUDED: 'parking_included',
  STORAGE_INCLUDED: 'storage_included',
  GIFT_CARD: 'gift_card',
  EARLY_RENEWAL_BONUS: 'early_renewal_bonus',
} as const;

export type IncentiveType = (typeof IncentiveType)[keyof typeof IncentiveType];

// ============================================================================
// Input Interfaces
// ============================================================================

export interface TenantRenewalData {
  tenantId: string;
  tenantName: string;
  
  // Current Lease
  currentLease: {
    monthlyRent: number;
    currency: string;
    startDate: string;
    endDate: string;
    termMonths: number;
    originalRent: number; // Rent at move-in
    lastRentIncrease?: {
      date: string;
      percentChange: number;
    };
  };
  
  // Tenant Quality Metrics
  tenantMetrics: {
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
    valuesPriority?: ('price' | 'location' | 'amenities' | 'service')[];
  };
}

export interface MarketCompData {
  propertyId: string;
  unitId: string;
  unitType: string;
  
  // Current Market Data
  marketData: {
    avgMarketRent: number;
    rentRange: { min: number; max: number };
    medianRent: number;
    rentTrend: 'increasing' | 'stable' | 'decreasing';
    trendPercent?: number;
    vacancyRate: number;
    daysOnMarket: number;  // Avg for similar units
  };
  
  // Comparables
  comparables?: Array<{
    source: 'internal' | 'external';
    unitType: string;
    location: string;
    rent: number;
    amenities: string[];
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

export interface PropertyPolicies {
  // Rent Policies
  maxRentIncreasePercent: number;
  minRentIncreasePercent?: number;
  regulatoryRentCap?: number;
  
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
    proposedRent: number;
    changeFromCurrent: number;
    changePercent: number;
    effectiveRent: number;  // After incentives
    effectiveChangePercent: number;
  };
  
  // Term Options
  termOptions: Array<{
    months: number;
    rent: number;
    effectiveRent: number;
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
      vsVacancyScenario: number;
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

export interface VacancyScenario {
  probability: number;
  expectedVacancyDays: number;
  turnoverCost: number;
  releaseRent: number;
  totalCostVsRenewal: number;
}

export interface RenewalStrategyResult {
  tenantId: string;
  propertyId: string;
  unitId: string;
  generatedAt: string;
  
  // Summary
  summary: {
    currentRent: number;
    marketRent: number;
    currentVsMarket: number; // Percentage difference
    recommendedOption: string;
    recommendedStrategy: RenewalStrategy;
    urgency: 'low' | 'medium' | 'high' | 'critical';
    daysToLeaseEnd: number;
  };
  
  // Options
  options: RenewalOption[];
  
  // Tenant Analysis
  tenantAnalysis: {
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
    vacancyScenario: VacancyScenario;
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
    avgCompRent: number;
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
    proposedRent: z.number(),
    changeFromCurrent: z.number(),
    changePercent: z.number(),
    effectiveRent: z.number(),
    effectiveChangePercent: z.number(),
  }),
  termOptions: z.array(z.object({
    months: z.number(),
    rent: z.number(),
    effectiveRent: z.number(),
    discount: z.number().optional(),
    totalContractValue: z.number(),
  })),
  incentives: z.array(z.object({
    type: z.enum(['rent_discount', 'rent_freeze', 'free_month', 'upgrade_included',
      'amenity_access', 'maintenance_priority', 'parking_included', 'storage_included',
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
      vsVacancyScenario: z.number(),
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
  tenantId: z.string(),
  propertyId: z.string(),
  unitId: z.string(),
  generatedAt: z.string(),
  summary: z.object({
    currentRent: z.number(),
    marketRent: z.number(),
    currentVsMarket: z.number(),
    recommendedOption: z.string(),
    recommendedStrategy: z.enum(['retention_priority', 'balanced', 'revenue_optimization',
      'market_alignment', 'relationship_building', 'value_add']),
    urgency: z.enum(['low', 'medium', 'high', 'critical']),
    daysToLeaseEnd: z.number(),
  }),
  options: z.array(RenewalOptionSchema),
  tenantAnalysis: z.object({
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
    vacancyScenario: z.object({
      probability: z.number(),
      expectedVacancyDays: z.number(),
      turnoverCost: z.number(),
      releaseRent: z.number(),
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
    avgCompRent: z.number(),
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
  openaiApiKey?: string;
  /** Preferred: Anthropic API key (ANTHROPIC_API_KEY). */
  anthropicApiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Optional: inject a preconfigured Anthropic client. When omitted, a client
   * is built from `anthropicApiKey` at construction time.
   */
  anthropicClient?: AnthropicClient;
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
    tenant: TenantRenewalData,
    market: MarketCompData,
    policies: PropertyPolicies
  ): Promise<RenewalStrategyResult> {
    const userPrompt = `${RENEWAL_STRATEGY_PROMPT.user}

Tenant Data:
${JSON.stringify(tenant, null, 2)}

Market & Comparables Data:
${JSON.stringify(market, null, 2)}

Property Policies:
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
   * Calculate ROI of renewal vs vacancy
   */
  calculateRenewalROI(result: RenewalStrategyResult): {
    bestOption: RenewalOption;
    roiVsVacancy: number;
    breakEvenDays: number;
    recommendation: string;
  } {
    const vacancy = result.financialProjections.vacancyScenario;
    const recommended = this.getRecommendedOption(result);
    
    if (!recommended) {
      throw new Error('No recommended option found');
    }

    const renewalNOI = recommended.impactAnalysis.noiImpact.year1;
    const vacancyCost = vacancy.totalCostVsRenewal;
    const roiVsVacancy = ((renewalNOI - vacancyCost) / Math.abs(vacancyCost)) * 100;
    
    // Calculate break-even days
    const dailyRent = recommended.pricing.proposedRent / 30;
    const breakEvenDays = Math.ceil(vacancy.turnoverCost / dailyRent);

    return {
      bestOption: recommended,
      roiVsVacancy,
      breakEvenDays,
      recommendation: roiVsVacancy > 0 
        ? `Renewal recommended. ${breakEvenDays} days to break even on turnover costs.`
        : `Consider vacancy scenario. Market conditions may favor new tenant.`,
    };
  }

  /**
   * Adjust strategy based on tenant response
   */
  async adjustForCounteroffer(
    originalResult: RenewalStrategyResult,
    counteroffer: {
      requestedRent?: number;
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

Tenant Counteroffer:
${JSON.stringify(counteroffer, null, 2)}

Provide adjusted options that balance tenant requests with property objectives.
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
  tenant: TenantRenewalData,
  market: MarketCompData,
  policies: PropertyPolicies,
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
  return generator.generateStrategy(tenant, market, policies);
}

// ============================================================================
// Default Policies
// ============================================================================

export const DEFAULT_PROPERTY_POLICIES: PropertyPolicies = {
  maxRentIncreasePercent: 10,
  minRentIncreasePercent: 0,
  maxDiscountPercent: 5,
  maxIncentiveValue: 500,
  requiresApprovalAbove: 8,
  preferredTermMonths: [6, 12, 18, 24],
  shortTermPremium: 5,
  longTermDiscount: 3,
};
