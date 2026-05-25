/**
 * Predictive Analytics Types
 * 
 * Types for predictive signals including:
 * - Arrears risk prediction
 * - Churn risk prediction
 * - Maintenance recurrence prediction
 * - Occupancy health scoring
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
  /** Predict likelihood of payment arrears */
  ARREARS_RISK: 'ARREARS_RISK',
  /** Predict tenant churn likelihood */
  CHURN_RISK: 'CHURN_RISK',
  /** Predict maintenance issue recurrence */
  MAINTENANCE_RECURRENCE: 'MAINTENANCE_RECURRENCE',
  /** Score overall occupancy health */
  OCCUPANCY_HEALTH: 'OCCUPANCY_HEALTH',
  /** Predict rental yield optimization */
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
// ARREARS RISK PREDICTION
// ============================================

/**
 * Input features for arrears risk prediction
 */
export interface ArrearsRiskInput {
  /** Tenant/lease identifier */
  tenantId: string;
  leaseId: string;
  propertyId: string;
  unitId: string;
  
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
    /** Current arrears amount */
    currentArrearsAmount: number;
    /** Times in arrears last 12 months */
    arrearsCount12m: number;
  };
  
  /** Tenant profile */
  tenantProfile: {
    tenancyMonths: number;
    employmentStatus?: 'employed' | 'self-employed' | 'unemployed' | 'retired' | 'unknown';
    incomeVerified: boolean;
    rentToIncomeRatio?: number;
  };
  
  /** Current context */
  currentContext: {
    rentAmount: number;
    daysUntilNextDue: number;
    hasAutoPay: boolean;
    communicationResponseRate?: number;
    recentMaintenanceRequests?: number;
  };
}

/**
 * Arrears risk prediction result
 */
export interface ArrearsRiskPrediction extends PredictionBase {
  modelType: typeof PredictionModelType.ARREARS_RISK;
  
  /** Input used for prediction */
  input: ArrearsRiskInput;
  
  /** Predicted arrears outcome */
  prediction: {
    /** Probability of arrears in horizon */
    arrearsProbability: number;
    /** Expected arrears amount if occurs */
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
// CHURN RISK PREDICTION
// ============================================

/**
 * Input features for churn risk prediction
 */
export interface ChurnRiskInput {
  tenantId: string;
  leaseId: string;
  propertyId: string;
  unitId: string;
  
  /** Lease status */
  leaseStatus: {
    leaseStartDate: string;
    leaseEndDate: string;
    daysUntilExpiry: number;
    isMonthToMonth: boolean;
    renewalsCompleted: number;
  };
  
  /** Tenant engagement */
  tenantEngagement: {
    loginFrequency30d: number;
    maintenanceRequestCount12m: number;
    maintenanceResolutionSatisfaction?: number;
    communicationSentiment?: 'positive' | 'neutral' | 'negative';
    complaintCount12m: number;
  };
  
  /** Market factors */
  marketFactors: {
    currentRent: number;
    marketRateEstimate: number;
    rentIncreasePercent?: number;
    localVacancyRate?: number;
  };
  
  /** Property factors */
  propertyFactors: {
    propertyAge: number;
    lastMajorRenovation?: string;
    amenityScore?: number;
    neighborhoodScore?: number;
  };
}

/**
 * Churn risk prediction result
 */
export interface ChurnRiskPrediction extends PredictionBase {
  modelType: typeof PredictionModelType.CHURN_RISK;
  
  input: ChurnRiskInput;
  
  prediction: {
    /** Probability of non-renewal */
    churnProbability: number;
    /** Most likely reason for churn */
    primaryChurnFactor: string;
    /** Whether tenant is likely to give notice */
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
    /** Estimated vacancy cost if churns */
    vacancyCost: number;
    /** Estimated turnover cost */
    turnoverCost: number;
    /** Potential rent loss during vacancy */
    rentLoss: number;
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
  propertyId: string;
  unitId: string;
  
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
  
  /** Property context */
  propertyContext: {
    propertyAge: number;
    buildingType: string;
    unitSize: number;
    lastInspectionDate?: string;
    hvacAge?: number;
    plumbingAge?: number;
    electricalAge?: number;
  };
  
  /** Historical patterns */
  historicalPatterns: {
    /** Similar issues in this unit */
    similarIssuesThisUnit: number;
    /** Similar issues in property */
    similarIssuesProperty: number;
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
// OCCUPANCY HEALTH SCORING
// ============================================

/**
 * Input for occupancy health scoring
 */
export interface OccupancyHealthInput {
  propertyId: string;
  
  /** Portfolio view */
  portfolio: {
    totalUnits: number;
    occupiedUnits: number;
    vacantUnits: number;
    unitsUnderRenovation: number;
    avgDaysOnMarket: number;
  };
  
  /** Financial performance */
  financialMetrics: {
    grossPotentialRent: number;
    effectiveGrossRent: number;
    collectionRate: number;
    avgRentPerUnit: number;
    marketRateComparison: number; // % vs market
  };
  
  /** Tenant composition */
  tenantComposition: {
    avgTenancyMonths: number;
    tenantTurnoverRate12m: number;
    renewalRate: number;
    arrearsRate: number;
  };
  
  /** Market context */
  marketContext: {
    localVacancyRate: number;
    marketTrend: 'declining' | 'stable' | 'growing';
    seasonalFactor?: number;
  };
}

/**
 * Occupancy health score result
 */
export interface OccupancyHealthScore extends PredictionBase {
  modelType: typeof PredictionModelType.OCCUPANCY_HEALTH;
  
  input: OccupancyHealthInput;
  
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
    occupancy: number;
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
    occupancyImprovement: number;
    collectionImprovement: number;
    timeToImpactDays: number;
  };
}

/**
 * Zod schemas for validation
 */
export const PredictionModelTypeSchema = z.enum([
  'ARREARS_RISK',
  'CHURN_RISK',
  'MAINTENANCE_RECURRENCE',
  'OCCUPANCY_HEALTH',
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

export const ArrearsRiskInputSchema = z.object({
  tenantId: z.string(),
  leaseId: z.string(),
  propertyId: z.string(),
  unitId: z.string(),
  paymentHistory: z.object({
    historyMonths: z.number(),
    onTimeRate: z.number().min(0).max(1),
    avgDaysLate: z.number().min(0),
    maxArrearsDays: z.number().min(0),
    currentArrearsAmount: z.number().min(0),
    arrearsCount12m: z.number().min(0),
  }),
  tenantProfile: z.object({
    tenancyMonths: z.number().min(0),
    employmentStatus: z.enum(['employed', 'self-employed', 'unemployed', 'retired', 'unknown']).optional(),
    incomeVerified: z.boolean(),
    rentToIncomeRatio: z.number().min(0).optional(),
  }),
  currentContext: z.object({
    rentAmount: z.number().positive(),
    daysUntilNextDue: z.number(),
    hasAutoPay: z.boolean(),
    communicationResponseRate: z.number().min(0).max(1).optional(),
    recentMaintenanceRequests: z.number().min(0).optional(),
  }),
});

export const ChurnRiskInputSchema = z.object({
  tenantId: z.string(),
  leaseId: z.string(),
  propertyId: z.string(),
  unitId: z.string(),
  leaseStatus: z.object({
    leaseStartDate: z.string(),
    leaseEndDate: z.string(),
    daysUntilExpiry: z.number(),
    isMonthToMonth: z.boolean(),
    renewalsCompleted: z.number().min(0),
  }),
  tenantEngagement: z.object({
    loginFrequency30d: z.number().min(0),
    maintenanceRequestCount12m: z.number().min(0),
    maintenanceResolutionSatisfaction: z.number().min(0).max(5).optional(),
    communicationSentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
    complaintCount12m: z.number().min(0),
  }),
  marketFactors: z.object({
    currentRent: z.number().positive(),
    marketRateEstimate: z.number().positive(),
    rentIncreasePercent: z.number().optional(),
    localVacancyRate: z.number().min(0).max(1).optional(),
  }),
  propertyFactors: z.object({
    propertyAge: z.number().min(0),
    lastMajorRenovation: z.string().optional(),
    amenityScore: z.number().min(0).max(10).optional(),
    neighborhoodScore: z.number().min(0).max(10).optional(),
  }),
});
