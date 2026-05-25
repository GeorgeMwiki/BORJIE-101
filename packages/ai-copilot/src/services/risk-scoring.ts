/**
 * Risk Scoring Models
 * 
 * Comprehensive risk scoring for property management including:
 * - Dispute Risk Score
 * - Vendor Performance Score
 * - Composite Risk Assessment
 * 
 * @module risk-scoring
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { DISPUTE_RISK_PROMPT, VENDOR_SCORE_PROMPT } from '../prompts/copilot-prompts.js';

// ============================================================================
// Dispute Risk Types
// ============================================================================

export const DisputeCategory = {
  DEPOSIT: 'deposit',
  MAINTENANCE: 'maintenance',
  BILLING: 'billing',
  NOISE: 'noise',
  PROPERTY_DAMAGE: 'property_damage',
  LEASE_TERMS: 'lease_terms',
  HARASSMENT: 'harassment',
  DISCRIMINATION: 'discrimination',
  SAFETY: 'safety',
  PRIVACY: 'privacy',
} as const;

export type DisputeCategory = (typeof DisputeCategory)[keyof typeof DisputeCategory];

export const DisputeRiskLevel = {
  CRITICAL: 'critical',
  HIGH: 'high',
  ELEVATED: 'elevated',
  MODERATE: 'moderate',
  LOW: 'low',
} as const;

export type DisputeRiskLevel = (typeof DisputeRiskLevel)[keyof typeof DisputeRiskLevel];

export interface DisputeHistoryData {
  tenantId: string;
  
  // Past Disputes
  pastDisputes?: Array<{
    category: DisputeCategory;
    description: string;
    date: string;
    resolution: 'tenant_favor' | 'landlord_favor' | 'compromise' | 'escalated' | 'withdrawn';
    daysToResolve: number;
    escalatedToLegal: boolean;
  }>;
  
  // Communication Signals
  communicationHistory?: {
    totalComplaints: number;
    unresolvedComplaints: number;
    escalatedComplaints: number;
    legalMentions: number;
    threateningLanguage: boolean;
    harassmentAllegations: boolean;
    discriminationAllegations: boolean;
  };
  
  // Current Issues
  currentOpenIssues?: Array<{
    category: string;
    severity: 'low' | 'medium' | 'high';
    daysOpen: number;
    escalationCount: number;
  }>;
  
  // Payment Disputes
  paymentDisputes?: {
    chargebackCount: number;
    billingDisputes: number;
    depositDisagreements: boolean;
  };
  
  // Tenant Profile
  tenantProfile?: {
    tenureMonths: number;
    sentimentTrend: 'improving' | 'stable' | 'declining';
    satisfactionScore: number;
    communicationStyle: 'cooperative' | 'neutral' | 'adversarial';
  };
}

export interface DisputeRiskFactor {
  factor: string;
  category: DisputeCategory;
  weight: number; // 0-1
  impact: 'high' | 'medium' | 'low';
  evidence: string[];
  mitigation?: string;
}

export interface DisputeRiskResult {
  tenantId: string;
  
  // Overall Score
  score: number; // 0-100
  riskLevel: DisputeRiskLevel;
  confidence: number;
  
  // Category Breakdown
  categoryScores: Partial<Record<DisputeCategory, {
    score: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    activeIssues: number;
  }>>;
  
  // Risk Factors
  factors: DisputeRiskFactor[];
  topRiskCategories: DisputeCategory[];
  
  // Predictions
  predictions: {
    likelihood30Days: number;
    likelihood90Days: number;
    mostLikelyDisputeType: DisputeCategory;
    potentialSeverity: 'minor' | 'moderate' | 'significant' | 'major';
    legalEscalationRisk: number;
  };
  
  // Mitigation
  mitigation: {
    immediateActions: string[];
    preventiveActions: string[];
    communicationRecommendations: string[];
    documentationNeeds: string[];
  };
  
  // Warning Signs
  warningSignals: string[];
  positiveFactors: string[];
  
  reasoning: string;
  calculatedAt: string;
}

// ============================================================================
// Vendor Performance Types
// ============================================================================

export const VendorSpecialization = {
  PLUMBING: 'plumbing',
  ELECTRICAL: 'electrical',
  HVAC: 'hvac',
  APPLIANCE: 'appliance',
  GENERAL: 'general',
  ROOFING: 'roofing',
  PAINTING: 'painting',
  FLOORING: 'flooring',
  LANDSCAPING: 'landscaping',
  PEST_CONTROL: 'pest_control',
  LOCKSMITH: 'locksmith',
  CLEANING: 'cleaning',
} as const;

export type VendorSpecialization = (typeof VendorSpecialization)[keyof typeof VendorSpecialization];

export const VendorTier = {
  PREFERRED: 'preferred',
  STANDARD: 'standard',
  PROBATION: 'probation',
  SUSPENDED: 'suspended',
} as const;

export type VendorTier = (typeof VendorTier)[keyof typeof VendorTier];

export interface VendorPerformanceData {
  vendorId: string;
  name: string;
  specializations: VendorSpecialization[];
  
  // Work Order Metrics
  workOrderMetrics: {
    totalCompleted: number;
    totalAssigned: number;
    completionRate: number;
    
    // Timing
    avgAcceptanceTimeMinutes: number;
    avgCompletionTimeDays: number;
    slaComplianceRate: number;
    
    // Quality
    firstTimeFixRate: number;
    reopenRate: number;
    callbackRate: number;
  };
  
  // Cost Metrics
  costMetrics?: {
    avgCostPerJob: number;
    costVarianceVsBenchmark: number; // percentage
    invoiceAccuracyRate: number;
    disputedInvoiceCount: number;
  };
  
  // Tenant Feedback
  tenantFeedback?: {
    avgRating: number; // 1-5
    totalRatings: number;
    positiveReviews: number;
    negativeReviews: number;
    complaintCount: number;
    professionalismScore: number;
    communicationScore: number;
  };
  
  // Reliability
  reliability?: {
    noShowCount: number;
    lateArrivalRate: number;
    emergencyAvailability: boolean;
    weekendAvailability: boolean;
    responseRateToRequests: number;
  };
  
  // Compliance
  compliance?: {
    licenseCurrent: boolean;
    insuranceCurrent: boolean;
    backgroundCheckCurrent: boolean;
    safetyIncidents: number;
    warrantyClaimsHonored: number;
    warrantyClaimsDenied: number;
  };
}

export interface VendorScoreComponent {
  category: string;
  score: number; // 0-100
  weight: number; // 0-1
  weightedScore: number;
  trend: 'improving' | 'stable' | 'declining';
  details: string;
}

export interface VendorScoreResult {
  vendorId: string;
  vendorName: string;
  
  // Overall Score
  compositeScore: number; // 0-100
  tier: VendorTier;
  confidence: number;
  
  // Component Scores
  components: {
    quality: VendorScoreComponent;
    speed: VendorScoreComponent;
    cost: VendorScoreComponent;
    reliability: VendorScoreComponent;
    communication: VendorScoreComponent;
    compliance: VendorScoreComponent;
  };
  
  // Specialization Scores
  specializationScores: Partial<Record<VendorSpecialization, {
    score: number;
    jobCount: number;
    trend: 'improving' | 'stable' | 'declining';
  }>>;
  
  // Ranking
  ranking: {
    overallRank: number;
    totalVendors: number;
    percentile: number;
    rankBySpecialization: Partial<Record<VendorSpecialization, number>>;
  };
  
  // Recommendations
  recommendations: {
    tierRecommendation: VendorTier;
    tierChangeReason?: string;
    improvementAreas: string[];
    strengths: string[];
    trainingNeeds: string[];
    contractRecommendations: string[];
  };
  
  // Risk Assessment
  riskAssessment: {
    reliabilityRisk: 'low' | 'medium' | 'high';
    qualityRisk: 'low' | 'medium' | 'high';
    complianceRisk: 'low' | 'medium' | 'high';
    costRisk: 'low' | 'medium' | 'high';
    overallRisk: 'low' | 'medium' | 'high';
    riskFactors: string[];
  };
  
  reasoning: string;
  calculatedAt: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const DisputeRiskFactorSchema = z.object({
  factor: z.string(),
  category: z.enum(['deposit', 'maintenance', 'billing', 'noise', 'property_damage',
    'lease_terms', 'harassment', 'discrimination', 'safety', 'privacy']),
  weight: z.number().min(0).max(1),
  impact: z.enum(['high', 'medium', 'low']),
  evidence: z.array(z.string()),
  mitigation: z.string().optional(),
});

const DisputeRiskResultSchema = z.object({
  tenantId: z.string(),
  score: z.number().min(0).max(100),
  riskLevel: z.enum(['critical', 'high', 'elevated', 'moderate', 'low']),
  confidence: z.number().min(0).max(1),
  categoryScores: z.record(z.string(), z.object({
    score: z.number().min(0).max(100),
    trend: z.enum(['increasing', 'stable', 'decreasing']),
    activeIssues: z.number(),
  })),
  factors: z.array(DisputeRiskFactorSchema),
  topRiskCategories: z.array(z.enum(['deposit', 'maintenance', 'billing', 'noise',
    'property_damage', 'lease_terms', 'harassment', 'discrimination', 'safety', 'privacy'])),
  predictions: z.object({
    likelihood30Days: z.number().min(0).max(1),
    likelihood90Days: z.number().min(0).max(1),
    mostLikelyDisputeType: z.enum(['deposit', 'maintenance', 'billing', 'noise',
      'property_damage', 'lease_terms', 'harassment', 'discrimination', 'safety', 'privacy']),
    potentialSeverity: z.enum(['minor', 'moderate', 'significant', 'major']),
    legalEscalationRisk: z.number().min(0).max(1),
  }),
  mitigation: z.object({
    immediateActions: z.array(z.string()),
    preventiveActions: z.array(z.string()),
    communicationRecommendations: z.array(z.string()),
    documentationNeeds: z.array(z.string()),
  }),
  warningSignals: z.array(z.string()),
  positiveFactors: z.array(z.string()),
  reasoning: z.string(),
  calculatedAt: z.string(),
});

const VendorScoreComponentSchema = z.object({
  category: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  weightedScore: z.number(),
  trend: z.enum(['improving', 'stable', 'declining']),
  details: z.string(),
});

const VendorScoreResultSchema = z.object({
  vendorId: z.string(),
  vendorName: z.string(),
  compositeScore: z.number().min(0).max(100),
  tier: z.enum(['preferred', 'standard', 'probation', 'suspended']),
  confidence: z.number().min(0).max(1),
  components: z.object({
    quality: VendorScoreComponentSchema,
    speed: VendorScoreComponentSchema,
    cost: VendorScoreComponentSchema,
    reliability: VendorScoreComponentSchema,
    communication: VendorScoreComponentSchema,
    compliance: VendorScoreComponentSchema,
  }),
  specializationScores: z.record(z.string(), z.object({
    score: z.number().min(0).max(100),
    jobCount: z.number(),
    trend: z.enum(['improving', 'stable', 'declining']),
  })),
  ranking: z.object({
    overallRank: z.number(),
    totalVendors: z.number(),
    percentile: z.number(),
    rankBySpecialization: z.record(z.string(), z.number()),
  }),
  recommendations: z.object({
    tierRecommendation: z.enum(['preferred', 'standard', 'probation', 'suspended']),
    tierChangeReason: z.string().optional(),
    improvementAreas: z.array(z.string()),
    strengths: z.array(z.string()),
    trainingNeeds: z.array(z.string()),
    contractRecommendations: z.array(z.string()),
  }),
  riskAssessment: z.object({
    reliabilityRisk: z.enum(['low', 'medium', 'high']),
    qualityRisk: z.enum(['low', 'medium', 'high']),
    complianceRisk: z.enum(['low', 'medium', 'high']),
    costRisk: z.enum(['low', 'medium', 'high']),
    overallRisk: z.enum(['low', 'medium', 'high']),
    riskFactors: z.array(z.string()),
  }),
  reasoning: z.string(),
  calculatedAt: z.string(),
});

// ============================================================================
// Service Configuration
// ============================================================================

export interface RiskScoringConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class RiskScoringService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: RiskScoringConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 3000;
  }

  /**
   * Calculate dispute risk score for a tenant
   */
  async calculateDisputeRisk(
    data: DisputeHistoryData
  ): Promise<DisputeRiskResult> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: DISPUTE_RISK_PROMPT.system },
        {
          role: 'user',
          content: `${DISPUTE_RISK_PROMPT.user}

Tenant Dispute Data:
${JSON.stringify(data, null, 2)}

Calculate the dispute risk score and provide comprehensive analysis.`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return DisputeRiskResultSchema.parse(JSON.parse(content)) as DisputeRiskResult;
  }

  /**
   * Calculate vendor performance score
   */
  async calculateVendorScore(
    data: VendorPerformanceData,
    benchmarks?: {
      avgCompletionTimeDays: number;
      avgCostPerJob: number;
      avgRating: number;
      avgFirstTimeFixRate: number;
    }
  ): Promise<VendorScoreResult> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: VENDOR_SCORE_PROMPT.system },
        {
          role: 'user',
          content: `${VENDOR_SCORE_PROMPT.user}

Vendor Performance Data:
${JSON.stringify(data, null, 2)}

${benchmarks ? `Industry Benchmarks:\n${JSON.stringify(benchmarks, null, 2)}` : ''}

Calculate the vendor performance score and provide comprehensive analysis.`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return VendorScoreResultSchema.parse(JSON.parse(content)) as VendorScoreResult;
  }

  /**
   * Batch calculate dispute risk for multiple tenants
   */
  async batchCalculateDisputeRisk(
    tenants: DisputeHistoryData[]
  ): Promise<DisputeRiskResult[]> {
    const results = await Promise.all(
      tenants.map(tenant => this.calculateDisputeRisk(tenant))
    );
    return results;
  }

  /**
   * Batch calculate vendor scores
   */
  async batchCalculateVendorScores(
    vendors: VendorPerformanceData[]
  ): Promise<VendorScoreResult[]> {
    const results = await Promise.all(
      vendors.map(vendor => this.calculateVendorScore(vendor))
    );
    
    // Update rankings based on all scores
    const sorted = [...results].sort((a, b) => b.compositeScore - a.compositeScore);
    return results.map(result => ({
      ...result,
      ranking: {
        ...result.ranking,
        overallRank: sorted.findIndex(r => r.vendorId === result.vendorId) + 1,
        totalVendors: results.length,
        percentile: Math.round(
          ((results.length - sorted.findIndex(r => r.vendorId === result.vendorId)) / results.length) * 100
        ),
      },
    }));
  }

  /**
   * Get high-risk tenants from dispute scores
   */
  getHighRiskTenants(
    scores: DisputeRiskResult[],
    threshold: number = 60
  ): DisputeRiskResult[] {
    return scores
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get vendors needing attention
   */
  getVendorsNeedingAttention(
    scores: VendorScoreResult[]
  ): VendorScoreResult[] {
    return scores.filter(
      s => s.tier === 'probation' || 
           s.riskAssessment.overallRisk === 'high' ||
           s.compositeScore < 60
    );
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createRiskScoringService(
  config: RiskScoringConfig
): RiskScoringService {
  return new RiskScoringService(config);
}

export async function calculateDisputeRisk(
  data: DisputeHistoryData,
  config?: Partial<RiskScoringConfig>
): Promise<DisputeRiskResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  
  const service = createRiskScoringService({ openaiApiKey: apiKey, ...config });
  return service.calculateDisputeRisk(data);
}

export async function calculateVendorScore(
  data: VendorPerformanceData,
  config?: Partial<RiskScoringConfig>
): Promise<VendorScoreResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  
  const service = createRiskScoringService({ openaiApiKey: apiKey, ...config });
  return service.calculateVendorScore(data);
}
