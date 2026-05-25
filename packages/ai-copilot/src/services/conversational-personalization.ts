/**
 * Conversational Personalization Service
 * 
 * Generates empathetic, personalized communications that:
 * - Remember past issues and interactions
 * - Personalize tone and timing
 * - Generate context-aware empathetic responses
 * - Adapt to tenant preferences and history
 * 
 * @module conversational-personalization
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { CONVERSATIONAL_PERSONALIZATION_PROMPT } from '../prompts/copilot-prompts.js';

// ============================================================================
// Types and Enums
// ============================================================================

export const MessageIntent = {
  // Operational
  PAYMENT_REMINDER: 'payment_reminder',
  PAYMENT_CONFIRMATION: 'payment_confirmation',
  MAINTENANCE_UPDATE: 'maintenance_update',
  MAINTENANCE_COMPLETION: 'maintenance_completion',
  LEASE_REMINDER: 'lease_reminder',
  INSPECTION_NOTICE: 'inspection_notice',
  
  // Relationship
  WELCOME: 'welcome',
  CHECK_IN: 'check_in',
  THANK_YOU: 'thank_you',
  APOLOGY: 'apology',
  FOLLOW_UP: 'follow_up',
  
  // Retention
  RENEWAL_OFFER: 'renewal_offer',
  RETENTION_OUTREACH: 'retention_outreach',
  SATISFACTION_CHECK: 'satisfaction_check',
  
  // Issue Response
  COMPLAINT_ACKNOWLEDGMENT: 'complaint_acknowledgment',
  ISSUE_RESOLUTION: 'issue_resolution',
  ESCALATION_UPDATE: 'escalation_update',
  
  // Announcements
  PROPERTY_UPDATE: 'property_update',
  COMMUNITY_NEWS: 'community_news',
  EMERGENCY_ALERT: 'emergency_alert',
  
  // Custom
  CUSTOM: 'custom',
} as const;

export type MessageIntent = (typeof MessageIntent)[keyof typeof MessageIntent];

export const EmotionalTone = {
  WARM: 'warm',
  PROFESSIONAL: 'professional',
  EMPATHETIC: 'empathetic',
  APOLOGETIC: 'apologetic',
  CELEBRATORY: 'celebratory',
  URGENT: 'urgent',
  REASSURING: 'reassuring',
  FIRM: 'firm',
  FRIENDLY: 'friendly',
  NEUTRAL: 'neutral',
} as const;

export type EmotionalTone = (typeof EmotionalTone)[keyof typeof EmotionalTone];

// ============================================================================
// Input Interfaces
// ============================================================================

export interface TenantContext {
  tenantId: string;
  name: string;
  preferredName?: string;
  
  // Preferences
  preferences: {
    language: string;
    communicationStyle: 'formal' | 'casual' | 'brief' | 'detailed';
    formality: 'high' | 'medium' | 'low';
    detailLevel: 'minimal' | 'moderate' | 'comprehensive';
  };
  
  // Current State
  currentState: {
    satisfactionScore?: number;
    sentimentTrend: 'improving' | 'stable' | 'declining';
    tenureMonths: number;
    hasOpenIssues: boolean;
    openIssueCount: number;
    lastInteractionDate?: string;
    daysSinceLastContact?: number;
  };
  
  // Relationship Context
  relationship: {
    tier: 'premium' | 'standard' | 'at_risk';
    renewalHistory: number;
    positiveInteractions: number;
    negativeInteractions: number;
    escalationHistory: number;
  };
}

export interface InteractionHistory {
  // Recent Conversations
  recentMessages?: Array<{
    date: string;
    direction: 'inbound' | 'outbound';
    channel: string;
    summary: string;
    sentiment?: number;
    resolved?: boolean;
  }>;
  
  // Past Issues
  pastIssues?: Array<{
    category: string;
    description: string;
    date: string;
    resolution: string;
    daysToResolve: number;
    tenantSatisfied: boolean;
  }>;
  
  // Memorable Events
  memorableEvents?: Array<{
    type: 'positive' | 'negative' | 'neutral';
    description: string;
    date: string;
    relevantForFuture: boolean;
  }>;
  
  // Promises Made
  promisesMade?: Array<{
    promise: string;
    date: string;
    fulfilled: boolean;
    context: string;
  }>;
}

export interface MessageRequest {
  intent: MessageIntent;
  
  // Required Context
  context: {
    topic: string;
    details: Record<string, unknown>;
    urgency: 'low' | 'normal' | 'high' | 'critical';
  };
  
  // Emotional Context
  emotionalContext?: {
    tenantMood?: 'happy' | 'neutral' | 'frustrated' | 'angry' | 'anxious';
    situationSeverity?: 'minor' | 'moderate' | 'significant' | 'major';
    requiresEmpathy?: boolean;
    requiresApology?: boolean;
  };
  
  // Constraints
  constraints?: {
    maxLength?: number;
    mustInclude?: string[];
    mustAvoid?: string[];
    callToAction?: string;
    deadline?: string;
  };
  
  // Custom Content
  customContent?: string;
}

// ============================================================================
// Output Interfaces
// ============================================================================

export interface PersonalizedMessage {
  // Main Message
  message: string;
  
  // Variants
  variants: {
    formal: string;
    casual: string;
    brief: string;
  };
  
  // Metadata
  metadata: {
    intent: MessageIntent;
    tone: EmotionalTone;
    personalizations: string[];
    historyReferences: string[];
    empathyElements: string[];
  };
  
  // Channel Adaptations
  channelVersions: {
    whatsapp: string;
    sms: string;
    email: {
      subject: string;
      body: string;
    };
  };
  
  // Recommendations
  recommendations: {
    suggestedTone: EmotionalTone;
    suggestedTiming: string;
    followUpNeeded: boolean;
    followUpSuggestion?: string;
    escalationRisk: 'low' | 'medium' | 'high';
  };
  
  // Quality Metrics
  quality: {
    personalizationScore: number;
    empathyScore: number;
    clarityScore: number;
    appropriatenessScore: number;
  };
}

export interface ConversationResponse {
  tenantId: string;
  generatedAt: string;
  
  // Response
  response: PersonalizedMessage;
  
  // Context Used
  contextUsed: {
    historyReferencesUsed: string[];
    preferencesApplied: string[];
    sensitivityConsiderations: string[];
  };
  
  // Suggestions
  suggestions: {
    beforeSending: string[];
    afterSending: string[];
    potentialIssues: string[];
  };
  
  confidence: number;
  reasoning: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const PersonalizedMessageSchema = z.object({
  message: z.string(),
  variants: z.object({
    formal: z.string(),
    casual: z.string(),
    brief: z.string(),
  }),
  metadata: z.object({
    intent: z.string(),
    tone: z.enum(['warm', 'professional', 'empathetic', 'apologetic', 'celebratory',
      'urgent', 'reassuring', 'firm', 'friendly', 'neutral']),
    personalizations: z.array(z.string()),
    historyReferences: z.array(z.string()),
    empathyElements: z.array(z.string()),
  }),
  channelVersions: z.object({
    whatsapp: z.string(),
    sms: z.string(),
    email: z.object({
      subject: z.string(),
      body: z.string(),
    }),
  }),
  recommendations: z.object({
    suggestedTone: z.enum(['warm', 'professional', 'empathetic', 'apologetic', 
      'celebratory', 'urgent', 'reassuring', 'firm', 'friendly', 'neutral']),
    suggestedTiming: z.string(),
    followUpNeeded: z.boolean(),
    followUpSuggestion: z.string().optional(),
    escalationRisk: z.enum(['low', 'medium', 'high']),
  }),
  quality: z.object({
    personalizationScore: z.number().min(0).max(1),
    empathyScore: z.number().min(0).max(1),
    clarityScore: z.number().min(0).max(1),
    appropriatenessScore: z.number().min(0).max(1),
  }),
});

const ConversationResponseSchema = z.object({
  tenantId: z.string(),
  generatedAt: z.string(),
  response: PersonalizedMessageSchema,
  contextUsed: z.object({
    historyReferencesUsed: z.array(z.string()),
    preferencesApplied: z.array(z.string()),
    sensitivityConsiderations: z.array(z.string()),
  }),
  suggestions: z.object({
    beforeSending: z.array(z.string()),
    afterSending: z.array(z.string()),
    potentialIssues: z.array(z.string()),
  }),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

// ============================================================================
// Service Configuration
// ============================================================================

export interface ConversationalPersonalizationConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class ConversationalPersonalizationService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: ConversationalPersonalizationConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.5;
    this.maxTokens = config.maxTokens ?? 2500;
  }

  /**
   * Generate a personalized message for a tenant
   */
  async generateMessage(
    tenant: TenantContext,
    history: InteractionHistory,
    request: MessageRequest
  ): Promise<ConversationResponse> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: CONVERSATIONAL_PERSONALIZATION_PROMPT.system },
        {
          role: 'user',
          content: `${CONVERSATIONAL_PERSONALIZATION_PROMPT.user}

Tenant Context:
${JSON.stringify(tenant, null, 2)}

Interaction History:
${JSON.stringify(history, null, 2)}

Message Request:
${JSON.stringify(request, null, 2)}

Generate a personalized message that:
1. Uses the tenant's preferred name and communication style
2. References relevant past interactions if appropriate
3. Shows empathy based on their current state and history
4. Matches their formality and detail preferences
5. Adapts tone to the situation and their emotional context`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return ConversationResponseSchema.parse(JSON.parse(content)) as ConversationResponse;
  }

  /**
   * Generate an empathetic response to a complaint or issue
   */
  async generateEmpatheticResponse(
    tenant: TenantContext,
    history: InteractionHistory,
    complaint: {
      category: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tenantEmotion?: string;
      hasHappenedBefore?: boolean;
    }
  ): Promise<ConversationResponse> {
    const request: MessageRequest = {
      intent: 'complaint_acknowledgment',
      context: {
        topic: complaint.category,
        details: complaint as unknown as Record<string, unknown>,
        urgency: complaint.severity === 'critical' ? 'critical' : 
                 complaint.severity === 'high' ? 'high' : 'normal',
      },
      emotionalContext: {
        tenantMood: this.mapEmotionToMood(complaint.tenantEmotion),
        situationSeverity: complaint.severity === 'low' ? 'minor' :
                          complaint.severity === 'medium' ? 'moderate' :
                          complaint.severity === 'high' ? 'significant' : 'major',
        requiresEmpathy: true,
        requiresApology: complaint.hasHappenedBefore || complaint.severity !== 'low',
      },
    };

    return this.generateMessage(tenant, history, request);
  }

  /**
   * Generate a follow-up message referencing past issues
   */
  async generateFollowUp(
    tenant: TenantContext,
    history: InteractionHistory,
    followUpContext: {
      originalIssue: string;
      resolution: string;
      daysSinceResolution: number;
      checkingFor: 'satisfaction' | 'recurrence' | 'additional_needs';
    }
  ): Promise<ConversationResponse> {
    const request: MessageRequest = {
      intent: 'follow_up',
      context: {
        topic: followUpContext.originalIssue,
        details: followUpContext as unknown as Record<string, unknown>,
        urgency: 'low',
      },
      emotionalContext: {
        requiresEmpathy: true,
      },
    };

    return this.generateMessage(tenant, history, request);
  }

  /**
   * Generate a proactive check-in message
   */
  async generateProactiveCheckIn(
    tenant: TenantContext,
    history: InteractionHistory,
    checkInReason: 'scheduled' | 'sentiment_drop' | 'long_silence' | 'post_issue' | 'milestone'
  ): Promise<ConversationResponse> {
    const request: MessageRequest = {
      intent: 'check_in',
      context: {
        topic: 'wellness_check',
        details: { reason: checkInReason },
        urgency: 'low',
      },
      emotionalContext: {
        requiresEmpathy: checkInReason === 'sentiment_drop' || checkInReason === 'post_issue',
      },
    };

    return this.generateMessage(tenant, history, request);
  }

  /**
   * Adapt an existing message to a tenant's preferences
   */
  async adaptMessage(
    tenant: TenantContext,
    originalMessage: string,
    targetTone?: EmotionalTone
  ): Promise<{
    adaptedMessage: string;
    changes: string[];
    toneApplied: EmotionalTone;
  }> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a message adaptation AI. Adapt messages to match tenant preferences while preserving meaning.`,
        },
        {
          role: 'user',
          content: `Adapt this message for the tenant's preferences:

Original Message:
"${originalMessage}"

Tenant Preferences:
- Communication Style: ${tenant.preferences.communicationStyle}
- Formality: ${tenant.preferences.formality}
- Detail Level: ${tenant.preferences.detailLevel}
- Language: ${tenant.preferences.language}
${targetTone ? `- Target Tone: ${targetTone}` : ''}

Return JSON with: adaptedMessage, changes (array of what was changed), toneApplied`,
        },
      ],
      temperature: 0.4,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return JSON.parse(content) as {
      adaptedMessage: string;
      changes: string[];
      toneApplied: EmotionalTone;
    };
  }

  /**
   * Generate conversation starters based on history
   */
  async generateConversationStarters(
    tenant: TenantContext,
    history: InteractionHistory,
    purpose: 'relationship_building' | 'issue_prevention' | 'retention' | 'feedback'
  ): Promise<string[]> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a tenant relationship AI. Generate personalized conversation starters based on history and context.`,
        },
        {
          role: 'user',
          content: `Generate 3-5 conversation starters for this tenant.

Tenant: ${tenant.name}
Purpose: ${purpose}
Communication Style: ${tenant.preferences.communicationStyle}
Recent History Summary: ${JSON.stringify(history.recentMessages?.slice(0, 3))}
Past Issues: ${JSON.stringify(history.pastIssues?.slice(0, 3))}

Return JSON array of conversation starter strings.`,
        },
      ],
      temperature: 0.6,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const result = JSON.parse(content) as { starters: string[] };
    return result.starters;
  }

  /**
   * Map emotion string to mood category
   */
  private mapEmotionToMood(
    emotion?: string
  ): 'happy' | 'neutral' | 'frustrated' | 'angry' | 'anxious' {
    if (!emotion) return 'neutral';
    
    const emotionLower = emotion.toLowerCase();
    if (['angry', 'rage', 'furious'].some(e => emotionLower.includes(e))) return 'angry';
    if (['frustrated', 'annoyed', 'irritated'].some(e => emotionLower.includes(e))) return 'frustrated';
    if (['anxious', 'worried', 'concerned', 'nervous'].some(e => emotionLower.includes(e))) return 'anxious';
    if (['happy', 'satisfied', 'pleased', 'grateful'].some(e => emotionLower.includes(e))) return 'happy';
    return 'neutral';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createConversationalPersonalizationService(
  config: ConversationalPersonalizationConfig
): ConversationalPersonalizationService {
  return new ConversationalPersonalizationService(config);
}

export async function generatePersonalizedMessage(
  tenant: TenantContext,
  history: InteractionHistory,
  request: MessageRequest,
  config?: Partial<ConversationalPersonalizationConfig>
): Promise<ConversationResponse> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  
  const service = createConversationalPersonalizationService({ openaiApiKey: apiKey, ...config });
  return service.generateMessage(tenant, history, request);
}
