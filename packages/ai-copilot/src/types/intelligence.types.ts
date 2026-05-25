/**
 * Intelligence Layer Types
 * 
 * Comprehensive type definitions for Module C: AI Personalization Engine
 * These types provide unified interfaces for the intelligence layer services.
 * 
 * @module intelligence.types
 */

import { z } from 'zod';

// ============================================================================
// Common Base Types
// ============================================================================

/** Confidence score (0-1) */
export type ConfidenceScore = number;

/** Risk score (0-100) */
export type RiskScore = number;

/** Timestamp in ISO format */
export type ISOTimestamp = string;

/** Tenant identifier */
export type TenantId = string;

/** Property identifier */
export type PropertyId = string;

/** Unit identifier */
export type UnitId = string;

// ============================================================================
// Tenant Intelligence Types
// ============================================================================

/**
 * Comprehensive tenant intelligence profile combining all intelligence signals
 */
export interface TenantIntelligenceProfile {
  tenantId: TenantId;
  propertyId: PropertyId;
  unitId: UnitId;
  
  // Risk Scores
  riskScores: {
    payment: RiskScore;
    churn: RiskScore;
    dispute: RiskScore;
  };
  
  // Preference Profile
  preferences?: {
    language: string;
    channel: string;
    communicationStyle: string;
    formality: 'high' | 'medium' | 'low';
    quietHours?: { start: string; end: string };
  };
  
  // Friction Fingerprint
  frictionProfile?: {
    overallSensitivity: RiskScore;
    topSensitivities: string[];
    escalationSpeed: string;
    resolutionPreference: string;
  };
  
  // Current State
  currentState: {
    satisfactionScore?: number;
    sentimentTrend: 'improving' | 'stable' | 'declining';
    openIssueCount: number;
    daysSinceLastContact?: number;
    daysToLeaseEnd?: number;
  };
  
  // Engagement
  engagement: {
    level: 'high' | 'medium' | 'low' | 'disengaged';
    responseRate: number;
    positiveInteractions: number;
    negativeInteractions: number;
  };
  
  // Computed Values
  computed: {
    lifetimeValue: number;
    retentionPriority: 'high' | 'medium' | 'low';
    segment: 'premium' | 'standard' | 'at_risk' | 'underperforming';
  };
  
  lastUpdated: ISOTimestamp;
  confidence: ConfidenceScore;
}

/**
 * Tenant segment classification
 */
export const TenantSegment = {
  PREMIUM: 'premium',
  STANDARD: 'standard',
  AT_RISK: 'at_risk',
  UNDERPERFORMING: 'underperforming',
  NEW: 'new',
} as const;

export type TenantSegment = (typeof TenantSegment)[keyof typeof TenantSegment];

/**
 * Tenant lifecycle stage
 */
export const LifecycleStage = {
  ONBOARDING: 'onboarding',
  SETTLING: 'settling',
  ACTIVE: 'active',
  RENEWAL_APPROACHING: 'renewal_approaching',
  AT_RISK: 'at_risk',
  LEAVING: 'leaving',
} as const;

export type LifecycleStage = (typeof LifecycleStage)[keyof typeof LifecycleStage];

// ============================================================================
// Action & Decision Types
// ============================================================================

/**
 * Recommended action for tenant engagement
 */
export interface RecommendedTenantAction {
  id: string;
  tenantId: TenantId;
  actionType: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  
  // Execution
  executionMode: 'auto' | 'approval' | 'manual';
  canAutoExecute: boolean;
  
  // Impact
  expectedImpact: {
    churnReduction?: number;
    revenueImpact?: number;
    satisfactionImpact?: number;
  };
  
  // Details
  title: string;
  description: string;
  suggestedContent?: string;
  
  // Timing
  deadline?: ISOTimestamp;
  optimalTiming?: ISOTimestamp;
  
  confidence: ConfidenceScore;
  reasoning: string;
}

/**
 * Decision record for audit trail
 */
export interface IntelligenceDecision {
  id: string;
  tenantId: TenantId;
  decisionType: string;
  
  // Input signals used
  inputSignals: {
    riskScores?: Record<string, number>;
    sentimentData?: Record<string, unknown>;
    behavioralData?: Record<string, unknown>;
  };
  
  // Output
  recommendation: string;
  confidence: ConfidenceScore;
  alternatives?: string[];
  
  // Execution
  executed: boolean;
  executedAt?: ISOTimestamp;
  executedBy?: string;
  outcome?: string;
  
  // Audit
  createdAt: ISOTimestamp;
  reasoning: string;
}

// ============================================================================
// Communication Types
// ============================================================================

/**
 * Personalized communication request
 */
export interface PersonalizedCommunicationRequest {
  tenantId: TenantId;
  intent: string;
  
  context: {
    topic: string;
    urgency: 'low' | 'normal' | 'high' | 'critical';
    details?: Record<string, unknown>;
  };
  
  emotional?: {
    tenantMood?: string;
    requiresEmpathy?: boolean;
    requiresApology?: boolean;
  };
  
  constraints?: {
    maxLength?: number;
    mustInclude?: string[];
    mustAvoid?: string[];
    callToAction?: string;
  };
}

/**
 * Personalized communication response
 */
export interface PersonalizedCommunicationResponse {
  tenantId: TenantId;
  
  message: string;
  variants: {
    formal: string;
    casual: string;
    brief: string;
  };
  
  channelVersions: {
    whatsapp: string;
    sms: string;
    email: { subject: string; body: string };
  };
  
  metadata: {
    tone: string;
    personalizations: string[];
    empathyElements: string[];
    historyReferences: string[];
  };
  
  recommendations: {
    suggestedTiming: string;
    followUpNeeded: boolean;
    escalationRisk: 'low' | 'medium' | 'high';
  };
  
  confidence: ConfidenceScore;
}

// ============================================================================
// Renewal Intelligence Types
// ============================================================================

/**
 * Renewal recommendation
 */
export interface RenewalRecommendation {
  tenantId: TenantId;
  leaseId: string;
  
  // Current State
  currentRent: number;
  marketRent: number;
  daysToLeaseEnd: number;
  
  // Recommendation
  recommendedStrategy: string;
  recommendedRent: number;
  recommendedTerm: number;
  
  // Options
  options: Array<{
    id: string;
    strategy: string;
    rent: number;
    term: number;
    incentives: string[];
    noiImpact: number;
    acceptanceProbability: number;
    churnRiskChange: number;
  }>;
  
  // Analysis
  tenantValue: 'premium' | 'standard' | 'at_risk';
  retentionPriority: 'high' | 'medium' | 'low';
  priceElasticity: 'elastic' | 'moderate' | 'inelastic';
  
  // Timing
  optimalApproachDate: ISOTimestamp;
  deadline: ISOTimestamp;
  
  confidence: ConfidenceScore;
  reasoning: string;
}

// ============================================================================
// Vendor Intelligence Types
// ============================================================================

/**
 * Vendor performance summary
 */
export interface VendorPerformanceSummary {
  vendorId: string;
  vendorName: string;
  
  // Scores
  compositeScore: RiskScore;
  tier: 'preferred' | 'standard' | 'probation' | 'suspended';
  
  components: {
    quality: RiskScore;
    speed: RiskScore;
    cost: RiskScore;
    reliability: RiskScore;
    communication: RiskScore;
    compliance: RiskScore;
  };
  
  // Trends
  trend: 'improving' | 'stable' | 'declining';
  
  // Recommendations
  tierRecommendation?: string;
  improvementAreas: string[];
  strengths: string[];
  
  lastUpdated: ISOTimestamp;
}

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

export const TenantSegmentSchema = z.enum([
  'premium',
  'standard',
  'at_risk',
  'underperforming',
  'new',
]);

export const LifecycleStageSchema = z.enum([
  'onboarding',
  'settling',
  'active',
  'renewal_approaching',
  'at_risk',
  'leaving',
]);

export const RiskScoreSchema = z.number().min(0).max(100);

export const ConfidenceScoreSchema = z.number().min(0).max(1);

export const TenantIntelligenceProfileSchema = z.object({
  tenantId: z.string(),
  propertyId: z.string(),
  unitId: z.string(),
  riskScores: z.object({
    payment: RiskScoreSchema,
    churn: RiskScoreSchema,
    dispute: RiskScoreSchema,
  }),
  preferences: z.object({
    language: z.string(),
    channel: z.string(),
    communicationStyle: z.string(),
    formality: z.enum(['high', 'medium', 'low']),
    quietHours: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
  }).optional(),
  frictionProfile: z.object({
    overallSensitivity: RiskScoreSchema,
    topSensitivities: z.array(z.string()),
    escalationSpeed: z.string(),
    resolutionPreference: z.string(),
  }).optional(),
  currentState: z.object({
    satisfactionScore: z.number().min(1).max(5).optional(),
    sentimentTrend: z.enum(['improving', 'stable', 'declining']),
    openIssueCount: z.number(),
    daysSinceLastContact: z.number().optional(),
    daysToLeaseEnd: z.number().optional(),
  }),
  engagement: z.object({
    level: z.enum(['high', 'medium', 'low', 'disengaged']),
    responseRate: z.number().min(0).max(1),
    positiveInteractions: z.number(),
    negativeInteractions: z.number(),
  }),
  computed: z.object({
    lifetimeValue: z.number(),
    retentionPriority: z.enum(['high', 'medium', 'low']),
    segment: TenantSegmentSchema,
  }),
  lastUpdated: z.string().datetime(),
  confidence: ConfidenceScoreSchema,
});

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Intelligence operation result
 */
export type IntelligenceResult<T> =
  | { success: true; data: T; confidence: ConfidenceScore }
  | { success: false; error: IntelligenceError };

/**
 * Intelligence operation error
 */
export interface IntelligenceError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

/**
 * Create a successful intelligence result
 */
export function intelligenceOk<T>(data: T, confidence: ConfidenceScore): IntelligenceResult<T> {
  return { success: true, data, confidence };
}

/**
 * Create a failed intelligence result
 */
export function intelligenceErr(error: IntelligenceError): IntelligenceResult<never> {
  return { success: false, error };
}

// ============================================================================
// Event Types for Observability
// ============================================================================

/**
 * Intelligence event for audit/observability
 */
export interface IntelligenceEvent {
  eventId: string;
  eventType: string;
  timestamp: ISOTimestamp;
  
  // Subject
  tenantId?: TenantId;
  propertyId?: PropertyId;
  vendorId?: string;
  
  // Operation
  operation: string;
  inputSummary: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  
  // Metrics
  latencyMs: number;
  tokensUsed?: number;
  confidence: ConfidenceScore;
  
  // Model
  modelId: string;
  promptVersion: string;
}
