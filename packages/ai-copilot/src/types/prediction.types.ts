/**
 * Predictive Analytics Types
 *
 * Types for predictive signals including:
 * - Royalty arrears risk prediction
 * - Buyer churn risk prediction
 * - Equipment maintenance recurrence prediction
 * - Production health scoring
 */

import { z } from 'zod';
import {
  PredictionId,
  RiskLevel,
  ConfidenceLevel,
  AITenantContext,
  RiskLevelSchema,
  ConfidenceLevelSchema,
} from './core.types.js';

/**
 * Types of predictive models available
 */
export const PredictionModelType = {
  /** Predict likelihood of royalty/payment arrears */
  ROYALTY_ARREARS_RISK: 'ROYALTY_ARREARS_RISK',
  /** Predict buyer / off-taker churn likelihood */
  BUYER_CHURN_RISK: 'BUYER_CHURN_RISK',
  /** Predict equipment maintenance issue recurrence */
  MAINTENANCE_RECURRENCE: 'MAINTENANCE_RECURRENCE',
  /** Score overall production health */
  PRODUCTION_HEALTH: 'PRODUCTION_HEALTH',
  /** Predict mineral yield optimization */
  YIELD_OPTIMIZATION: 'YIELD_OPTIMIZATION',
  /** Predict market trends */
  MARKET_TREND: 'MARKET_TREND',
} as const;

export type PredictionModelType = typeof PredictionModelType[keyof typeof PredictionModelType];

/**
 * Time horizon for predictions
 */
export const PredictionHorizon = {
  /** 7 days */
  WEEK: 'WEEK',
  /** 30 days */
  MONTH: 'MONTH',
  /** 90 days */
  QUARTER: 'QUARTER',
  /** 180 days */
  HALF_YEAR: 'HALF_YEAR',
  /** 365 days */
  YEAR: 'YEAR',
} as const;

export type PredictionHorizon = typeof PredictionHorizon[keyof typeof PredictionHorizon];

/**
 * Base prediction result
 */
export interface PredictionBase {
  /** Unique prediction ID */
  id: PredictionId;
  /** Model type that generated this */
  modelType: PredictionModelType;
  /** Model version */
  modelVersion: string;
  /** Prediction horizon */
  horizon: PredictionHorizon;
  /** Probability score (0-1) */
  probability: number;
  /** Confidence in the prediction */
  confidence: ConfidenceLevel;
  /** Computed risk level */
  riskLevel: RiskLevel;
  /** Tenant context */
  tenant: AITenantContext;
  /** When prediction was generated */
  generatedAt: string;
  /** When prediction expires/should be refreshed */
  expiresAt: string;
  /** Features used in prediction */
  featureImportance: FeatureImportance[];
}

/**
 * Feature importance for explainability
 */
export interface FeatureImportance {
  feature: string;
  displayName: string;
  value: unknown;
  importance: number; // 0-1, contribution to prediction
  direction: 'positive' | 'negative' | 'neutral';
}

/**
 * Recommended action based on prediction
 */
export interface RecommendedAction {
  id: string;
  priority: 'immediate' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  /** Expected impact if action is taken */
  expectedImpact: {
    metric: string;
    currentValue?: number;
    projectedValue?: number;
    changePercent?: number;
  };
  /** Automation available for this action */
  automationAvailable: boolean;
  automationId?: string;
}

// ============================================
// ROYALTY ARREARS RISK PREDICTION
// ============================================

/**
 * Input features for royalty arrears risk prediction
 */
export interface RoyaltyArrearsRiskInput {
  /** Counterparty / supply-agreement identifier */
  counterpartyId: string;
  supplyAgreementId: string;
  siteId: string;
  pitId: string;

  /** Payment history */
  paymentHistory: {
    /** Total months with data */
    historyMonths: number;
    /** On-time payment rate */
    onTimeRate: number;
    /** Average days late when late */
    avgDaysLate: number;
    /** Longest arrears period in days */
    maxArrearsDays: number;
    /** Current outstanding-royalties amount */
    currentArrearsAmount: number;
    /** Times in arrears last 12 months */
    arrearsCount12m: number;
  };

  /** Counterparty profile */
  counterpartyProfile: {
    relationshipMonths: number;
    employmentStatus?: 'employed' | 'self-employed' | 'unemployed' | 'retired' | 'unknown';
    incomeVerified: boolean;
    paymentToRevenueRatio?: number;
  };

  /** Current context */
  currentContext: {
    paymentAmount: number;
    daysUntilNextDue: number;
    hasAutoPay: boolean;
    communicationResponseRate?: number;
    recentMaintenanceRequests?: number;
  };
}

/**
 * Royalty arrears risk prediction result
 */
export interface RoyaltyArrearsRiskPrediction extends PredictionBase {
  modelType: typeof PredictionModelType.ROYALTY_ARREARS_RISK;

  /** Input used for prediction */
  input: RoyaltyArrearsRiskInput;

  /** Predicted arrears outcome */
  prediction: {
    /** Probability of arrears in horizon */
    arrearsProbability: number;
    /** Expected outstanding-royalties amount if occurs */
    expectedArrearsAmount: number;
    /** Most likely arrears duration in days */
    expectedArrearsDays: number;
    /** Risk tier */
    riskTier: 'watch' | 'at-risk' | 'high-risk' | 'critical';
  };

  /** Recommended actions */
  recommendedActions: RecommendedAction[];

  /** Alert configuration */
  alertConfig: {
    shouldAlert: boolean;
    alertPriority: 'low' | 'medium' | 'high' | 'critical';
    alertRecipients: string[];
    alertMessage: string;
  };
}

// ============================================
// BUYER CHURN RISK PREDICTION
// ============================================

/**
 * Input features for buyer churn risk prediction
 */
export interface BuyerChurnRiskInput {
  counterpartyId: string;
  supplyAgreementId: string;
  siteId: string;
  pitId: string;

  /** Supply-agreement status */
  supplyAgreementStatus: {
    agreementStartDate: string;
    agreementEndDate: string;
    daysUntilExpiry: number;
    isSpotMarket: boolean;
    renewalsCompleted: number;
  };

  /** Counterparty engagement */
  counterpartyEngagement: {
    loginFrequency30d: number;
    maintenanceRequestCount12m: number;
    maintenanceResolutionSatisfaction?: number;
    communicationSentiment?: 'positive' | 'neutral' | 'negative';
    complaintCount12m: number;
  };

  /** Market factors */
  marketFactors: {
    currentPrice: number;
    marketRateEstimate: number;
    priceIncreasePercent?: number;
    localAvailableCapacityRate?: number;
  };

  /** Site factors */
  siteFactors: {
    siteAge: number;
    lastMajorUpgrade?: string;
    capabilityScore?: number;
    locationScore?: number;
  };
}

/**
 * Buyer churn risk prediction result
 */
export interface BuyerChurnRiskPrediction extends PredictionBase {
  modelType: typeof PredictionModelType.BUYER_CHURN_RISK;

  input: BuyerChurnRiskInput;

  prediction: {
    /** Probability of non-renewal */
    churnProbability: number;
    /** Most likely reason for churn */
    primaryChurnFactor: string;
    /** Whether buyer is likely to give notice */
    likelyToGiveNotice: boolean;
    /** Estimated notice timing */
    estimatedNoticeDays?: number;
    /** Churn risk tier */
    riskTier: 'stable' | 'watch' | 'at-risk' | 'likely-churning';
  };

  /** Retention recommendations */
  retentionRecommendations: RecommendedAction[];

  /** Financial impact */
  financialImpact: {
    /** Estimated available-capacity cost if churns */
    availableCapacityCost: number;
    /** Estimated turnover cost */
    turnoverCost: number;
    /** Potential payment loss during available-capacity */
    paymentLoss: number;
    /** Total financial impact */
    totalImpact: number;
  };
}

// ============================================
// MAINTENANCE RECURRENCE PREDICTION
// ============================================

/**
 * Input for maintenance recurrence prediction
 */
export interface MaintenanceRecurrenceInput {
  siteId: string;
  pitId: string;

  /** Work order details */
  workOrder: {
    id: string;
    category: string;
    subcategory?: string;
    description: string;
    createdAt: string;
    resolvedAt?: string;
    resolutionType?: string;
    resolutionNotes?: string;
    cost?: number;
  };

  /** Site context */
  siteContext: {
    siteAge: number;
    assetType: string;
    unitSize: number;
    lastInspectionDate?: string;
    hydraulicsAge?: number;
    pumpingAge?: number;
    electricalAge?: number;
  };

  /** Historical patterns */
  historicalPatterns: {
    /** Similar issues at this pit */
    similarIssuesThisPit: number;
    /** Similar issues at site */
    similarIssuesSite: number;
    /** Average recurrence interval days */
    avgRecurrenceIntervalDays?: number;
    /** Seasonal pattern detected */
    seasonalPattern?: boolean;
  };
}

/**
 * Maintenance recurrence prediction result
 */
export interface MaintenanceRecurrencePrediction extends PredictionBase {
  modelType: typeof PredictionModelType.MAINTENANCE_RECURRENCE;

  input: MaintenanceRecurrenceInput;

  prediction: {
    /** Probability of recurrence in horizon */
    recurrenceProbability: number;
    /** Estimated days until recurrence */
    estimatedRecurrenceDays?: number;
    /** Whether preventive action recommended */
    preventiveActionRecommended: boolean;
    /** Severity if recurs */
    recurrenceSeverity: 'minor' | 'moderate' | 'major' | 'critical';
    /** Related systems that may be affected */
    relatedSystems: string[];
  };

  /** Preventive recommendations */
  preventiveActions: RecommendedAction[];

  /** Cost projection */
  costProjection: {
    /** Cost if recurs without prevention */
    reactiveRepairCost: number;
    /** Cost of preventive action */
    preventiveCost: number;
    /** Net savings from prevention */
    potentialSavings: number;
  };
}

// ============================================
// PRODUCTION HEALTH SCORING
// ============================================

/**
 * Input for production health scoring
 */
export interface ProductionHealthInput {
  siteId: string;

  /** Portfolio view */
  portfolio: {
    totalPits: number;
    activePits: number;
    idlePits: number;
    pitsUnderUpgrade: number;
    avgDaysToCommission: number;
  };

  /** Financial performance */
  financialMetrics: {
    grossPotentialRevenue: number;
    effectiveGrossRevenue: number;
    collectionRate: number;
    avgRevenuePerPit: number;
    marketRateComparison: number; // % vs market
  };

  /** Counterparty composition */
  counterpartyComposition: {
    avgRelationshipMonths: number;
    counterpartyTurnoverRate12m: number;
    renewalRate: number;
    arrearsRate: number;
  };

  /** Market context */
  marketContext: {
    localAvailableCapacityRate: number;
    marketTrend: 'declining' | 'stable' | 'growing';
    seasonalFactor?: number;
  };
}

/**
 * Production health score result
 */
export interface ProductionHealthScore extends PredictionBase {
  modelType: typeof PredictionModelType.PRODUCTION_HEALTH;

  input: ProductionHealthInput;

  /** Overall health score */
  healthScore: {
    /** Overall score (0-100) */
    overall: number;
    /** Score grade */
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    /** Trend vs previous period */
    trend: 'improving' | 'stable' | 'declining';
    /** Change from previous score */
    changeFromPrevious?: number;
  };

  /** Component scores */
  componentScores: {
    production: number;
    collection: number;
    retention: number;
    marketPosition: number;
    operationalEfficiency: number;
  };

  /** Key insights */
  insights: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };

  /** Prioritized improvements */
  improvements: RecommendedAction[];

  /** Projected impact of improvements */
  projectedImpact: {
    revenueUplift: number;
    productionImprovement: number;
    collectionImprovement: number;
    timeToImpactDays: number;
  };
}

/**
 * Zod schemas for validation
 */
export const PredictionModelTypeSchema = z.enum([
  'ROYALTY_ARREARS_RISK',
  'BUYER_CHURN_RISK',
  'MAINTENANCE_RECURRENCE',
  'PRODUCTION_HEALTH',
  'YIELD_OPTIMIZATION',
  'MARKET_TREND',
]);

export const PredictionHorizonSchema = z.enum([
  'WEEK',
  'MONTH',
  'QUARTER',
  'HALF_YEAR',
  'YEAR',
]);

export const RecommendedActionSchema = z.object({
  id: z.string(),
  priority: z.enum(['immediate', 'high', 'medium', 'low']),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  expectedImpact: z.object({
    metric: z.string(),
    currentValue: z.number().optional(),
    projectedValue: z.number().optional(),
    changePercent: z.number().optional(),
  }),
  automationAvailable: z.boolean(),
  automationId: z.string().optional(),
});

export const RoyaltyArrearsRiskInputSchema = z.object({
  counterpartyId: z.string(),
  supplyAgreementId: z.string(),
  siteId: z.string(),
  pitId: z.string(),
  paymentHistory: z.object({
    historyMonths: z.number(),
    onTimeRate: z.number().min(0).max(1),
    avgDaysLate: z.number().min(0),
    maxArrearsDays: z.number().min(0),
    currentArrearsAmount: z.number().min(0),
    arrearsCount12m: z.number().min(0),
  }),
  counterpartyProfile: z.object({
    relationshipMonths: z.number().min(0),
    employmentStatus: z.enum(['employed', 'self-employed', 'unemployed', 'retired', 'unknown']).optional(),
    incomeVerified: z.boolean(),
    paymentToRevenueRatio: z.number().min(0).optional(),
  }),
  currentContext: z.object({
    paymentAmount: z.number().positive(),
    daysUntilNextDue: z.number(),
    hasAutoPay: z.boolean(),
    communicationResponseRate: z.number().min(0).max(1).optional(),
    recentMaintenanceRequests: z.number().min(0).optional(),
  }),
});

export const BuyerChurnRiskInputSchema = z.object({
  counterpartyId: z.string(),
  supplyAgreementId: z.string(),
  siteId: z.string(),
  pitId: z.string(),
  supplyAgreementStatus: z.object({
    agreementStartDate: z.string(),
    agreementEndDate: z.string(),
    daysUntilExpiry: z.number(),
    isSpotMarket: z.boolean(),
    renewalsCompleted: z.number().min(0),
  }),
  counterpartyEngagement: z.object({
    loginFrequency30d: z.number().min(0),
    maintenanceRequestCount12m: z.number().min(0),
    maintenanceResolutionSatisfaction: z.number().min(0).max(5).optional(),
    communicationSentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
    complaintCount12m: z.number().min(0),
  }),
  marketFactors: z.object({
    currentPrice: z.number().positive(),
    marketRateEstimate: z.number().positive(),
    priceIncreasePercent: z.number().optional(),
    localAvailableCapacityRate: z.number().min(0).max(1).optional(),
  }),
  siteFactors: z.object({
    siteAge: z.number().min(0),
    lastMajorUpgrade: z.string().optional(),
    capabilityScore: z.number().min(0).max(10).optional(),
    locationScore: z.number().min(0).max(10).optional(),
  }),
});
