/**
 * Next Best Action Service
 * AI-powered recommendation engine for customer engagement
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { NEXT_BEST_ACTION_PROMPT } from '../prompts/index.js';

export const ActionCategory = {
  RETENTION: 'RETENTION',
  COMMUNICATION: 'COMMUNICATION',
  PAYMENT: 'PAYMENT',
  MAINTENANCE: 'MAINTENANCE',
  LEASE: 'LEASE',
  UPSELL: 'UPSELL',
  SERVICE: 'SERVICE',
  RELATIONSHIP: 'RELATIONSHIP',
} as const;

export type ActionCategory = (typeof ActionCategory)[keyof typeof ActionCategory];

export const ActionUrgency = {
  IMMEDIATE: 'IMMEDIATE',
  TODAY: 'TODAY',
  THIS_WEEK: 'THIS_WEEK',
  THIS_MONTH: 'THIS_MONTH',
  SCHEDULED: 'SCHEDULED',
} as const;

export type ActionUrgency = (typeof ActionUrgency)[keyof typeof ActionUrgency];

export interface NBACustomerContext {
  customerId: string;
  segment: 'premium' | 'standard' | 'at_risk' | 'new';
  lifecycle: {
    stage: 'onboarding' | 'active' | 'renewal_approaching' | 'at_risk' | 'churned';
    tenureDays: number;
    daysToLeaseEnd?: number;
  };
  recentActivity: {
    lastPaymentDate?: string;
    lastMaintenanceRequest?: string;
    lastCommunication?: string;
    recentComplaints: number;
  };
  riskIndicators: { churnRisk?: number; paymentRisk?: number; satisfactionScore?: number };
  opportunities: {
    renewalEligible: boolean;
    upgradeEligible: boolean;
    referralCandidate: boolean;
    amenityUpsell: string[];
  };
  preferences?: {
    communicationChannel: 'email' | 'sms' | 'phone' | 'app';
    contactTime?: 'morning' | 'afternoon' | 'evening';
  };
}

export interface RecommendedAction {
  id: string;
  title: string;
  description: string;
  category: ActionCategory;
  urgency: ActionUrgency;
  priority: number;
  confidence: number;
  reasoning: string;
  expectedOutcome: {
    primaryBenefit: string;
    successProbability: number;
    revenueImpact?: number;
    retentionImpact?: number;
  };
  execution: {
    channel: 'email' | 'sms' | 'phone' | 'in_app' | 'in_person';
    suggestedScript?: string;
    suggestedTiming: string;
    automatable: boolean;
  };
}

export interface NextBestActionResult {
  customerId: string;
  recommendation: RecommendedAction;
  alternativeActions: RecommendedAction[];
  customerInsights: { keyObservations: string[]; riskFactors: string[]; opportunities: string[] };
  timing: { optimalContactWindow: string; avoidTimes?: string[] };
  personalization: { messageFraming: string; toneSuggestion: string; keyTalkingPoints: string[] };
  successMetrics: { trackingEvents: string[]; successCriteria: string; followUpTriggers: string[] };
}

const RecommendedActionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(['RETENTION', 'COMMUNICATION', 'PAYMENT', 'MAINTENANCE', 'LEASE', 'UPSELL', 'SERVICE', 'RELATIONSHIP']),
  urgency: z.enum(['IMMEDIATE', 'TODAY', 'THIS_WEEK', 'THIS_MONTH', 'SCHEDULED']),
  priority: z.number().min(1).max(10),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  expectedOutcome: z.object({
    primaryBenefit: z.string(),
    successProbability: z.number().min(0).max(1),
    revenueImpact: z.number().optional(),
    retentionImpact: z.number().optional(),
  }),
  execution: z.object({
    channel: z.enum(['email', 'sms', 'phone', 'in_app', 'in_person']),
    suggestedScript: z.string().optional(),
    suggestedTiming: z.string(),
    automatable: z.boolean(),
  }),
});

const NextBestActionResultSchema = z.object({
  customerId: z.string(),
  recommendation: RecommendedActionSchema,
  alternativeActions: z.array(RecommendedActionSchema),
  customerInsights: z.object({
    keyObservations: z.array(z.string()),
    riskFactors: z.array(z.string()),
    opportunities: z.array(z.string()),
  }),
  timing: z.object({
    optimalContactWindow: z.string(),
    avoidTimes: z.array(z.string()).optional(),
  }),
  personalization: z.object({
    messageFraming: z.string(),
    toneSuggestion: z.string(),
    keyTalkingPoints: z.array(z.string()),
  }),
  successMetrics: z.object({
    trackingEvents: z.array(z.string()),
    successCriteria: z.string(),
    followUpTriggers: z.array(z.string()),
  }),
});

export interface NextBestActionConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class NextBestActionService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: NextBestActionConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.4;
    this.maxTokens = config.maxTokens ?? 2048;
  }

  async getNextBestAction(customerId: string, context?: Partial<NBACustomerContext>): Promise<NextBestActionResult> {
    const customerContext = this.buildCustomerContext(customerId, context);

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: NEXT_BEST_ACTION_PROMPT.system },
        { role: 'user', content: `${NEXT_BEST_ACTION_PROMPT.user}\n\nCustomer Context:\n${JSON.stringify(customerContext, null, 2)}` },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return NextBestActionResultSchema.parse(JSON.parse(content)) as NextBestActionResult;
  }

  private buildCustomerContext(customerId: string, context?: Partial<NBACustomerContext>): NBACustomerContext {
    return {
      customerId,
      segment: context?.segment ?? 'standard',
      lifecycle: context?.lifecycle ?? { stage: 'active', tenureDays: 0 },
      recentActivity: context?.recentActivity ?? { recentComplaints: 0 },
      riskIndicators: context?.riskIndicators ?? {},
      opportunities: context?.opportunities ?? { renewalEligible: false, upgradeEligible: false, referralCandidate: false, amenityUpsell: [] },
      preferences: context?.preferences,
    };
  }
}

export function createNextBestActionService(config: NextBestActionConfig): NextBestActionService {
  return new NextBestActionService(config);
}

export async function getNextBestAction(
  customerId: string,
  context?: Partial<NBACustomerContext>,
  config?: Partial<NextBestActionConfig>
): Promise<NextBestActionResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  const service = createNextBestActionService({ openaiApiKey: apiKey, ...config });
  return service.getNextBestAction(customerId, context);
}
