/**
 * Tenant Preference Profile Engine (Workflow C.1)
 * 
 * Builds and manages tenant preference graphs from onboarding data.
 * Captures language, channel, communication style, and quiet hours.
 * Auto-adapts all future communications based on learned preferences.
 * 
 * @module preference-profile-engine
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { PREFERENCE_PROFILE_PROMPT } from '../prompts/copilot-prompts.js';

// ============================================================================
// Types and Enums
// ============================================================================

export const ChannelPreference = {
  WHATSAPP: 'whatsapp',
  SMS: 'sms',
  EMAIL: 'email',
  VOICE: 'voice',
  APP: 'app',
} as const;

export type ChannelPreference = (typeof ChannelPreference)[keyof typeof ChannelPreference];

export const CommunicationStyle = {
  FORMAL: 'formal',
  CASUAL: 'casual',
  BRIEF: 'brief',
  DETAILED: 'detailed',
} as const;

export type CommunicationStyle = (typeof CommunicationStyle)[keyof typeof CommunicationStyle];

export const LanguagePreference = {
  ENGLISH: 'en',
  SWAHILI: 'sw',
  FRENCH: 'fr',
  ARABIC: 'ar',
} as const;

export type LanguagePreference = (typeof LanguagePreference)[keyof typeof LanguagePreference];

export const ResponseSpeed = {
  INSTANT: 'instant',
  QUICK: 'quick',
  STANDARD: 'standard',
  PATIENT: 'patient',
} as const;

export type ResponseSpeed = (typeof ResponseSpeed)[keyof typeof ResponseSpeed];

// ============================================================================
// Input Interfaces
// ============================================================================

export interface OnboardingData {
  tenantId: string;
  moveInDate: string;
  
  // Explicit preferences from onboarding form
  explicitPreferences?: {
    preferredLanguage?: string;
    preferredChannel?: ChannelPreference;
    quietHoursEnabled?: boolean;
    quietHoursStart?: string; // HH:MM format
    quietHoursEnd?: string;   // HH:MM format
    timezone?: string;
    preferredContactTime?: 'morning' | 'afternoon' | 'evening' | 'anytime';
  };

  // Communication samples from onboarding interactions
  communicationSamples?: Array<{
    channel: string;
    message: string;
    timestamp: string;
    responseTimeMinutes?: number;
  }>;

  // Household context
  householdContext?: {
    size: number;
    hasChildren: boolean;
    hasPets: boolean;
    workSchedule?: string;
    specialNeeds?: string[];
  };

  // Property context
  propertyContext?: {
    type: 'apartment' | 'house' | 'studio' | 'villa';
    location: string;
    amenities: string[];
  };
}

export interface CommunicationEvent {
  tenantId: string;
  channel: ChannelPreference;
  direction: 'inbound' | 'outbound';
  content: string;
  timestamp: string;
  responseTimeMinutes?: number;
  sentiment?: number; // -1 to 1
  successful?: boolean;
}

// ============================================================================
// Output Interfaces
// ============================================================================

export interface PreferenceNode {
  category: string;
  preference: string;
  confidence: number;
  source: 'explicit' | 'inferred' | 'behavioral';
  lastUpdated: string;
  evidence: string[];
}

export interface PreferenceGraph {
  tenantId: string;
  nodes: PreferenceNode[];
  edges: Array<{
    from: string;
    to: string;
    relationship: string;
    strength: number;
  }>;
  generatedAt: string;
}

export interface CommunicationAdaptation {
  channel: ChannelPreference;
  language: string;
  style: CommunicationStyle;
  formality: 'high' | 'medium' | 'low';
  detailLevel: 'minimal' | 'moderate' | 'comprehensive';
  timing: {
    preferredWindow: string;
    avoidTimes: string[];
    urgentOverride: boolean;
  };
  tone: {
    warmth: number; // 0-1
    directness: number; // 0-1
    formality: number; // 0-1
  };
}

export interface PreferenceProfileResult {
  tenantId: string;
  profile: {
    language: {
      primary: string;
      secondary: string | null;
      confidence: number;
    };
    channel: {
      primary: ChannelPreference;
      secondary: ChannelPreference | null;
      fallback: ChannelPreference;
      confidence: number;
    };
    communicationStyle: {
      style: CommunicationStyle;
      formality: 'high' | 'medium' | 'low';
      detailPreference: 'minimal' | 'moderate' | 'comprehensive';
      confidence: number;
    };
    timing: {
      quietHours: { start: string; end: string } | null;
      preferredWindow: string;
      timezone: string;
      responseExpectation: ResponseSpeed;
    };
    accessibility: {
      needs: string[];
      largeText: boolean;
      voiceAssistance: boolean;
    };
  };
  
  preferenceGraph: PreferenceGraph;
  communicationAdaptation: CommunicationAdaptation;
  
  insights: {
    keyObservations: string[];
    adaptationRecommendations: string[];
    potentialFriction: string[];
  };
  
  messageTemplates: {
    greeting: string;
    paymentReminder: string;
    maintenanceNotification: string;
    generalAnnouncement: string;
  };
  
  confidence: number;
  dataQuality: 'high' | 'medium' | 'low';
  reasoning: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const PreferenceNodeSchema = z.object({
  category: z.string(),
  preference: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['explicit', 'inferred', 'behavioral']),
  lastUpdated: z.string(),
  evidence: z.array(z.string()),
});

const PreferenceGraphSchema = z.object({
  tenantId: z.string(),
  nodes: z.array(PreferenceNodeSchema),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    relationship: z.string(),
    strength: z.number().min(0).max(1),
  })),
  generatedAt: z.string(),
});

const CommunicationAdaptationSchema = z.object({
  channel: z.enum(['whatsapp', 'sms', 'email', 'voice', 'app']),
  language: z.string(),
  style: z.enum(['formal', 'casual', 'brief', 'detailed']),
  formality: z.enum(['high', 'medium', 'low']),
  detailLevel: z.enum(['minimal', 'moderate', 'comprehensive']),
  timing: z.object({
    preferredWindow: z.string(),
    avoidTimes: z.array(z.string()),
    urgentOverride: z.boolean(),
  }),
  tone: z.object({
    warmth: z.number().min(0).max(1),
    directness: z.number().min(0).max(1),
    formality: z.number().min(0).max(1),
  }),
});

const PreferenceProfileResultSchema = z.object({
  tenantId: z.string(),
  profile: z.object({
    language: z.object({
      primary: z.string(),
      secondary: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
    channel: z.object({
      primary: z.enum(['whatsapp', 'sms', 'email', 'voice', 'app']),
      secondary: z.enum(['whatsapp', 'sms', 'email', 'voice', 'app']).nullable(),
      fallback: z.enum(['whatsapp', 'sms', 'email', 'voice', 'app']),
      confidence: z.number().min(0).max(1),
    }),
    communicationStyle: z.object({
      style: z.enum(['formal', 'casual', 'brief', 'detailed']),
      formality: z.enum(['high', 'medium', 'low']),
      detailPreference: z.enum(['minimal', 'moderate', 'comprehensive']),
      confidence: z.number().min(0).max(1),
    }),
    timing: z.object({
      quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
      preferredWindow: z.string(),
      timezone: z.string(),
      responseExpectation: z.enum(['instant', 'quick', 'standard', 'patient']),
    }),
    accessibility: z.object({
      needs: z.array(z.string()),
      largeText: z.boolean(),
      voiceAssistance: z.boolean(),
    }),
  }),
  preferenceGraph: PreferenceGraphSchema,
  communicationAdaptation: CommunicationAdaptationSchema,
  insights: z.object({
    keyObservations: z.array(z.string()),
    adaptationRecommendations: z.array(z.string()),
    potentialFriction: z.array(z.string()),
  }),
  messageTemplates: z.object({
    greeting: z.string(),
    paymentReminder: z.string(),
    maintenanceNotification: z.string(),
    generalAnnouncement: z.string(),
  }),
  confidence: z.number().min(0).max(1),
  dataQuality: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
});

// ============================================================================
// Service Configuration
// ============================================================================

export interface PreferenceProfileEngineConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class PreferenceProfileEngine {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: PreferenceProfileEngineConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 3000;
  }

  /**
   * Build initial preference profile from onboarding data
   */
  async buildPreferenceProfile(
    data: OnboardingData
  ): Promise<PreferenceProfileResult> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: PREFERENCE_PROFILE_PROMPT.system },
        {
          role: 'user',
          content: `${PREFERENCE_PROFILE_PROMPT.user}\n\nOnboarding Data:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return PreferenceProfileResultSchema.parse(JSON.parse(content)) as PreferenceProfileResult;
  }

  /**
   * Update preference profile based on new communication events
   */
  async updateProfileFromCommunication(
    currentProfile: PreferenceProfileResult,
    events: CommunicationEvent[]
  ): Promise<PreferenceProfileResult> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: PREFERENCE_PROFILE_PROMPT.system },
        {
          role: 'user',
          content: `Update the following preference profile based on new communication events.

Current Profile:
${JSON.stringify(currentProfile, null, 2)}

New Communication Events:
${JSON.stringify(events, null, 2)}

Analyze the new events and update the profile accordingly. Pay attention to:
1. Response times and their implications on urgency expectations
2. Channel usage patterns
3. Language and communication style in messages
4. Timing patterns (when they engage)
5. Any friction or preference signals

Return the updated complete profile in the same JSON format.`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return PreferenceProfileResultSchema.parse(JSON.parse(content)) as PreferenceProfileResult;
  }

  /**
   * Generate adapted communication for a specific message type
   */
  async generateAdaptedMessage(
    profile: PreferenceProfileResult,
    messageType: 'greeting' | 'payment_reminder' | 'maintenance' | 'announcement' | 'custom',
    context: {
      customContent?: string;
      urgency?: 'low' | 'normal' | 'high' | 'critical';
      specificDetails?: Record<string, string>;
    }
  ): Promise<{
    message: string;
    channel: ChannelPreference;
    timing: string;
    fallbackMessage?: string;
  }> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a communication personalization AI for a property management platform.
Generate messages adapted to the tenant's preferences and communication style.
Return a JSON object with:
- message: The adapted message text
- channel: The recommended channel to use
- timing: When to send (specific time or "now" for urgent)
- fallbackMessage: A shorter/alternative version if needed`,
        },
        {
          role: 'user',
          content: `Generate an adapted ${messageType} message for this tenant.

Tenant Preference Profile:
${JSON.stringify(profile.profile, null, 2)}

Communication Adaptation Guidelines:
${JSON.stringify(profile.communicationAdaptation, null, 2)}

Message Context:
${JSON.stringify(context, null, 2)}

Create a message that:
1. Uses their preferred language (${profile.profile.language.primary})
2. Matches their communication style (${profile.profile.communicationStyle.style})
3. Has appropriate formality level (${profile.profile.communicationStyle.formality})
4. Respects their timing preferences`,
        },
      ],
      temperature: 0.4,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const result = JSON.parse(content) as {
      message: string;
      channel: ChannelPreference;
      timing: string;
      fallbackMessage?: string;
    };

    return result;
  }

  /**
   * Check if current time is within tenant's quiet hours
   */
  isInQuietHours(profile: PreferenceProfileResult, currentTime?: Date): boolean {
    const quietHours = profile.profile.timing.quietHours;
    if (!quietHours) return false;

    const now = currentTime ?? new Date();
    const timezone = profile.profile.timing.timezone;

    // Convert to tenant's timezone
    const tenantTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const currentMinutes = tenantTime.getHours() * 60 + tenantTime.getMinutes();

    const [startHour, startMin] = quietHours.start.split(':').map(Number);
    const [endHour, endMin] = quietHours.end.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * Get optimal send time for a message based on tenant preferences
   */
  getOptimalSendTime(
    profile: PreferenceProfileResult,
    urgency: 'low' | 'normal' | 'high' | 'critical',
    currentTime?: Date
  ): {
    sendTime: Date;
    reason: string;
    canSendNow: boolean;
  } {
    const now = currentTime ?? new Date();
    
    // Critical messages can always be sent
    if (urgency === 'critical') {
      return {
        sendTime: now,
        reason: 'Critical message - immediate delivery required',
        canSendNow: true,
      };
    }

    // Check quiet hours
    if (this.isInQuietHours(profile, now)) {
      // Find end of quiet hours
      const quietHours = profile.profile.timing.quietHours!;
      const [endHour, endMin] = quietHours.end.split(':').map(Number);
      
      const sendTime = new Date(now);
      sendTime.setHours(endHour, endMin, 0, 0);
      
      // If end time is in the past, add a day
      if (sendTime <= now) {
        sendTime.setDate(sendTime.getDate() + 1);
      }

      return {
        sendTime,
        reason: `Respecting quiet hours (${quietHours.start} - ${quietHours.end})`,
        canSendNow: false,
      };
    }

    // High urgency can be sent now if not in quiet hours
    if (urgency === 'high') {
      return {
        sendTime: now,
        reason: 'High urgency message - sending now (outside quiet hours)',
        canSendNow: true,
      };
    }

    // For normal/low urgency, check preferred window
    const preferredWindow = profile.profile.timing.preferredWindow;
    // Default to sending now if within business hours
    return {
      sendTime: now,
      reason: `Sending during preferred window: ${preferredWindow}`,
      canSendNow: true,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createPreferenceProfileEngine(
  config: PreferenceProfileEngineConfig
): PreferenceProfileEngine {
  return new PreferenceProfileEngine(config);
}

export async function buildPreferenceProfile(
  data: OnboardingData,
  config?: Partial<PreferenceProfileEngineConfig>
): Promise<PreferenceProfileResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  
  const engine = createPreferenceProfileEngine({ openaiApiKey: apiKey, ...config });
  return engine.buildPreferenceProfile(data);
}
