/**
 * Friction Fingerprint Analyzer (Workflow C.2)
 * 
 * Learns tenant sensitivities from check-ins and interactions.
 * Tracks escalation speed, preference for fixes vs explanations.
 * Adjusts AI proactiveness based on fingerprint.
 * 
 * @module friction-fingerprint-analyzer
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { FRICTION_FINGERPRINT_PROMPT } from '../prompts/copilot-prompts.js';

// ============================================================================
// Types and Enums
// ============================================================================

export const SensitivityCategory = {
  NOISE: 'noise',
  MAINTENANCE: 'maintenance',
  COMMUNICATION: 'communication',
  PRICE: 'price',
  CLEANLINESS: 'cleanliness',
  PRIVACY: 'privacy',
  SECURITY: 'security',
  NEIGHBORS: 'neighbors',
  AMENITIES: 'amenities',
  TIMING: 'timing',
} as const;

export type SensitivityCategory = (typeof SensitivityCategory)[keyof typeof SensitivityCategory];

export const EscalationSpeed = {
  IMMEDIATE: 'immediate',   // Escalates within minutes
  QUICK: 'quick',           // Escalates within hours
  MODERATE: 'moderate',     // Escalates within a day
  PATIENT: 'patient',       // Waits for standard resolution
  VERY_PATIENT: 'very_patient', // Rarely escalates
} as const;

export type EscalationSpeed = (typeof EscalationSpeed)[keyof typeof EscalationSpeed];

export const ResolutionPreference = {
  IMMEDIATE_FIX: 'immediate_fix',
  THOROUGH_FIX: 'thorough_fix',
  EXPLANATION_FIRST: 'explanation_first',
  COMPENSATION: 'compensation',
  PREVENTION_FOCUS: 'prevention_focus',
} as const;

export type ResolutionPreference = (typeof ResolutionPreference)[keyof typeof ResolutionPreference];

export const ProactivenessLevel = {
  HIGH: 'high',       // Frequent check-ins, proactive updates
  MEDIUM: 'medium',   // Standard engagement
  LOW: 'low',         // Minimal engagement, only when necessary
  REACTIVE: 'reactive', // Only respond when contacted
} as const;

export type ProactivenessLevel = (typeof ProactivenessLevel)[keyof typeof ProactivenessLevel];

// ============================================================================
// Input Interfaces
// ============================================================================

export interface CheckInData {
  tenantId: string;
  checkInType: 'day_3' | 'day_10' | 'monthly' | 'quarterly' | 'post_maintenance' | 'post_issue';
  date: string;
  
  // Check-in responses
  responses: Array<{
    question: string;
    answer: string;
    sentiment?: number; // -1 to 1
  }>;
  
  // Issues mentioned
  issuesMentioned?: Array<{
    category: SensitivityCategory;
    description: string;
    severity: 'low' | 'medium' | 'high';
    resolved?: boolean;
  }>;
  
  // Overall sentiment
  overallSentiment?: number;
  overallSatisfaction?: number; // 1-5 scale
}

export interface InteractionHistory {
  tenantId: string;
  interactions: Array<{
    type: 'complaint' | 'request' | 'question' | 'feedback' | 'escalation';
    category: SensitivityCategory;
    description: string;
    timestamp: string;
    responseTime: number; // minutes
    resolutionTime?: number; // minutes
    outcome: 'resolved' | 'pending' | 'escalated' | 'withdrawn';
    satisfactionRating?: number; // 1-5
    emotionDetected?: string;
  }>;
}

export interface TenantContext {
  tenantId: string;
  tenureMonths: number;
  unitType: string;
  propertyType: string;
  demographicHints?: {
    likelyAge?: 'young_adult' | 'adult' | 'middle_aged' | 'senior';
    likelyLifestyle?: 'professional' | 'family' | 'student' | 'retired';
    likelyIncome?: 'budget' | 'mid_range' | 'premium';
  };
}

// ============================================================================
// Output Interfaces
// ============================================================================

export interface SensitivityScore {
  category: SensitivityCategory;
  score: number; // 0-100
  trend: 'increasing' | 'stable' | 'decreasing';
  triggers: string[];
  lastIncident?: string;
  evidence: string[];
}

export interface EscalationProfile {
  overallSpeed: EscalationSpeed;
  byCategory: Partial<Record<SensitivityCategory, EscalationSpeed>>;
  escalationTriggers: string[];
  calmingFactors: string[];
  avgTimeToEscalation: number; // minutes
}

export interface ResolutionProfile {
  primaryPreference: ResolutionPreference;
  secondaryPreference: ResolutionPreference | null;
  expectations: {
    responseTime: 'immediate' | 'within_hour' | 'same_day' | 'within_24h' | 'flexible';
    updateFrequency: 'constant' | 'regular' | 'milestones_only' | 'on_completion';
    communicationStyle: 'detailed_updates' | 'brief_updates' | 'final_only';
  };
  satisfactionDrivers: string[];
  dissatisfactionDrivers: string[];
}

export interface AIProactivenessGuideline {
  level: ProactivenessLevel;
  checkInFrequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'minimal';
  updateStyle: {
    maintenance: 'every_step' | 'milestones' | 'completion_only';
    payments: 'frequent_reminders' | 'standard_reminders' | 'minimal_reminders';
    announcements: 'all' | 'relevant_only' | 'critical_only';
  };
  engagementTips: string[];
  avoidActions: string[];
}

export interface FrictionFingerprintResult {
  tenantId: string;
  
  // Sensitivity Profile
  sensitivityProfile: {
    overallSensitivity: number; // 0-100
    scores: SensitivityScore[];
    topSensitivities: SensitivityCategory[];
    lowSensitivities: SensitivityCategory[];
  };
  
  // Escalation Behavior
  escalationProfile: EscalationProfile;
  
  // Resolution Preferences
  resolutionProfile: ResolutionProfile;
  
  // AI Engagement Guidelines
  proactivenessGuideline: AIProactivenessGuideline;
  
  // Communication Adjustments
  communicationAdjustments: {
    toneAdjustment: {
      warmth: number; // -1 to 1 (cooler to warmer)
      urgency: number; // -1 to 1 (calmer to more urgent)
      empathy: number; // 0 to 1
      technicality: number; // 0 to 1
    };
    messagingTips: string[];
    phrasesToUse: string[];
    phrasesToAvoid: string[];
  };
  
  // Risk Assessment
  riskAssessment: {
    churnRisk: 'low' | 'medium' | 'high';
    escalationRisk: 'low' | 'medium' | 'high';
    satisfactionTrend: 'improving' | 'stable' | 'declining';
    keyRiskFactors: string[];
    mitigationActions: string[];
  };
  
  // Personalized Playbooks
  playbooks: {
    forMaintenance: string[];
    forPaymentIssues: string[];
    forComplaints: string[];
    forCheckIns: string[];
  };
  
  confidence: number;
  dataQuality: 'high' | 'medium' | 'low';
  lastUpdated: string;
  reasoning: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const SensitivityScoreSchema = z.object({
  category: z.enum(['noise', 'maintenance', 'communication', 'price', 'cleanliness', 
    'privacy', 'security', 'neighbors', 'amenities', 'timing']),
  score: z.number().min(0).max(100),
  trend: z.enum(['increasing', 'stable', 'decreasing']),
  triggers: z.array(z.string()),
  lastIncident: z.string().optional(),
  evidence: z.array(z.string()),
});

const EscalationProfileSchema = z.object({
  overallSpeed: z.enum(['immediate', 'quick', 'moderate', 'patient', 'very_patient']),
  byCategory: z.record(z.string(), z.enum(['immediate', 'quick', 'moderate', 'patient', 'very_patient'])),
  escalationTriggers: z.array(z.string()),
  calmingFactors: z.array(z.string()),
  avgTimeToEscalation: z.number(),
});

const ResolutionProfileSchema = z.object({
  primaryPreference: z.enum(['immediate_fix', 'thorough_fix', 'explanation_first', 'compensation', 'prevention_focus']),
  secondaryPreference: z.enum(['immediate_fix', 'thorough_fix', 'explanation_first', 'compensation', 'prevention_focus']).nullable(),
  expectations: z.object({
    responseTime: z.enum(['immediate', 'within_hour', 'same_day', 'within_24h', 'flexible']),
    updateFrequency: z.enum(['constant', 'regular', 'milestones_only', 'on_completion']),
    communicationStyle: z.enum(['detailed_updates', 'brief_updates', 'final_only']),
  }),
  satisfactionDrivers: z.array(z.string()),
  dissatisfactionDrivers: z.array(z.string()),
});

const AIProactivenessGuidelineSchema = z.object({
  level: z.enum(['high', 'medium', 'low', 'reactive']),
  checkInFrequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'minimal']),
  updateStyle: z.object({
    maintenance: z.enum(['every_step', 'milestones', 'completion_only']),
    payments: z.enum(['frequent_reminders', 'standard_reminders', 'minimal_reminders']),
    announcements: z.enum(['all', 'relevant_only', 'critical_only']),
  }),
  engagementTips: z.array(z.string()),
  avoidActions: z.array(z.string()),
});

const FrictionFingerprintResultSchema = z.object({
  tenantId: z.string(),
  sensitivityProfile: z.object({
    overallSensitivity: z.number().min(0).max(100),
    scores: z.array(SensitivityScoreSchema),
    topSensitivities: z.array(z.enum(['noise', 'maintenance', 'communication', 'price', 
      'cleanliness', 'privacy', 'security', 'neighbors', 'amenities', 'timing'])),
    lowSensitivities: z.array(z.enum(['noise', 'maintenance', 'communication', 'price', 
      'cleanliness', 'privacy', 'security', 'neighbors', 'amenities', 'timing'])),
  }),
  escalationProfile: EscalationProfileSchema,
  resolutionProfile: ResolutionProfileSchema,
  proactivenessGuideline: AIProactivenessGuidelineSchema,
  communicationAdjustments: z.object({
    toneAdjustment: z.object({
      warmth: z.number().min(-1).max(1),
      urgency: z.number().min(-1).max(1),
      empathy: z.number().min(0).max(1),
      technicality: z.number().min(0).max(1),
    }),
    messagingTips: z.array(z.string()),
    phrasesToUse: z.array(z.string()),
    phrasesToAvoid: z.array(z.string()),
  }),
  riskAssessment: z.object({
    churnRisk: z.enum(['low', 'medium', 'high']),
    escalationRisk: z.enum(['low', 'medium', 'high']),
    satisfactionTrend: z.enum(['improving', 'stable', 'declining']),
    keyRiskFactors: z.array(z.string()),
    mitigationActions: z.array(z.string()),
  }),
  playbooks: z.object({
    forMaintenance: z.array(z.string()),
    forPaymentIssues: z.array(z.string()),
    forComplaints: z.array(z.string()),
    forCheckIns: z.array(z.string()),
  }),
  confidence: z.number().min(0).max(1),
  dataQuality: z.enum(['high', 'medium', 'low']),
  lastUpdated: z.string(),
  reasoning: z.string(),
});

// ============================================================================
// Service Configuration
// ============================================================================

export interface FrictionFingerprintAnalyzerConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class FrictionFingerprintAnalyzer {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: FrictionFingerprintAnalyzerConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 3500;
  }

  /**
   * Analyze friction fingerprint from check-in data and interaction history
   */
  async analyzeFingerprint(
    checkIns: CheckInData[],
    interactionHistory: InteractionHistory,
    context?: TenantContext
  ): Promise<FrictionFingerprintResult> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: FRICTION_FINGERPRINT_PROMPT.system },
        {
          role: 'user',
          content: `${FRICTION_FINGERPRINT_PROMPT.user}

Check-In Data:
${JSON.stringify(checkIns, null, 2)}

Interaction History:
${JSON.stringify(interactionHistory, null, 2)}

${context ? `Tenant Context:\n${JSON.stringify(context, null, 2)}` : ''}`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return FrictionFingerprintResultSchema.parse(JSON.parse(content)) as FrictionFingerprintResult;
  }

  /**
   * Update fingerprint with new check-in data
   */
  async updateWithCheckIn(
    currentFingerprint: FrictionFingerprintResult,
    newCheckIn: CheckInData
  ): Promise<FrictionFingerprintResult> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: FRICTION_FINGERPRINT_PROMPT.system },
        {
          role: 'user',
          content: `Update the friction fingerprint based on new check-in data.

Current Fingerprint:
${JSON.stringify(currentFingerprint, null, 2)}

New Check-In Data:
${JSON.stringify(newCheckIn, null, 2)}

Analyze the new check-in and update the fingerprint. Pay special attention to:
1. Any new sensitivity signals
2. Changes in satisfaction or sentiment
3. New issues or concerns mentioned
4. Communication style preferences
5. Escalation behavior patterns

Return the updated complete fingerprint.`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return FrictionFingerprintResultSchema.parse(JSON.parse(content)) as FrictionFingerprintResult;
  }

  /**
   * Get recommended AI behavior adjustments for a specific situation
   */
  async getAdjustedBehavior(
    fingerprint: FrictionFingerprintResult,
    situation: {
      type: 'maintenance_issue' | 'payment_late' | 'complaint' | 'routine_checkin' | 'renewal';
      severity: 'low' | 'medium' | 'high' | 'critical';
      specificContext?: string;
    }
  ): Promise<{
    recommendedTone: string;
    messageTemplate: string;
    followUpSchedule: string[];
    escalationThreshold: string;
    doList: string[];
    dontList: string[];
  }> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are an AI behavior adjustment system for property management.
Based on the tenant's friction fingerprint, recommend how to handle the current situation.
Return a JSON object with recommendations.`,
        },
        {
          role: 'user',
          content: `Based on this tenant's friction fingerprint, how should we handle this situation?

Friction Fingerprint:
${JSON.stringify(fingerprint, null, 2)}

Current Situation:
${JSON.stringify(situation, null, 2)}

Provide specific, actionable recommendations.`,
        },
      ],
      temperature: 0.4,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return JSON.parse(content) as {
      recommendedTone: string;
      messageTemplate: string;
      followUpSchedule: string[];
      escalationThreshold: string;
      doList: string[];
      dontList: string[];
    };
  }

  /**
   * Detect potential friction in a message before sending
   */
  async detectPotentialFriction(
    fingerprint: FrictionFingerprintResult,
    proposedMessage: string
  ): Promise<{
    frictionRisk: 'low' | 'medium' | 'high';
    concerns: string[];
    suggestions: string[];
    revisedMessage?: string;
  }> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a friction detection system for property management communications.
Analyze messages before they are sent to detect potential friction based on tenant sensitivities.`,
        },
        {
          role: 'user',
          content: `Analyze this proposed message for potential friction with this tenant.

Tenant Friction Fingerprint (key sensitivities):
- Top sensitivities: ${fingerprint.sensitivityProfile.topSensitivities.join(', ')}
- Escalation speed: ${fingerprint.escalationProfile.overallSpeed}
- Communication adjustments: ${JSON.stringify(fingerprint.communicationAdjustments)}
- Phrases to avoid: ${fingerprint.communicationAdjustments.phrasesToAvoid.join(', ')}

Proposed Message:
"${proposedMessage}"

Detect any potential friction and suggest improvements.`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return JSON.parse(content) as {
      frictionRisk: 'low' | 'medium' | 'high';
      concerns: string[];
      suggestions: string[];
      revisedMessage?: string;
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createFrictionFingerprintAnalyzer(
  config: FrictionFingerprintAnalyzerConfig
): FrictionFingerprintAnalyzer {
  return new FrictionFingerprintAnalyzer(config);
}

export async function analyzeFingerprint(
  checkIns: CheckInData[],
  interactionHistory: InteractionHistory,
  context?: TenantContext,
  config?: Partial<FrictionFingerprintAnalyzerConfig>
): Promise<FrictionFingerprintResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  
  const analyzer = createFrictionFingerprintAnalyzer({ openaiApiKey: apiKey, ...config });
  return analyzer.analyzeFingerprint(checkIns, interactionHistory, context);
}
