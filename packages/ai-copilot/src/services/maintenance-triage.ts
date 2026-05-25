/**
 * Maintenance Triage Service
 * AI-powered classification of maintenance requests
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { MAINTENANCE_TRIAGE_CLASSIFICATION_PROMPT } from '../prompts/index.js';

// Types
export const MaintenanceCategory = {
  PLUMBING: 'PLUMBING',
  ELECTRICAL: 'ELECTRICAL',
  HVAC: 'HVAC',
  APPLIANCE: 'APPLIANCE',
  STRUCTURAL: 'STRUCTURAL',
  PEST_CONTROL: 'PEST_CONTROL',
  SAFETY: 'SAFETY',
  EXTERIOR: 'EXTERIOR',
  COMMON_AREA: 'COMMON_AREA',
  COSMETIC: 'COSMETIC',
  ROOFING: 'ROOFING',
  FLOORING: 'FLOORING',
  LOCKS_SECURITY: 'LOCKS_SECURITY',
  OTHER: 'OTHER',
} as const;

export type MaintenanceCategory = (typeof MaintenanceCategory)[keyof typeof MaintenanceCategory];

export const MaintenanceSeverity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;

export type MaintenanceSeverity = (typeof MaintenanceSeverity)[keyof typeof MaintenanceSeverity];

export const MaintenanceUrgencyLevel = {
  EMERGENCY: 'EMERGENCY',
  URGENT: 'URGENT',
  HIGH: 'HIGH',
  STANDARD: 'STANDARD',
  LOW: 'LOW',
} as const;

export type MaintenanceUrgencyLevel = (typeof MaintenanceUrgencyLevel)[keyof typeof MaintenanceUrgencyLevel];

export interface MaintenanceImage {
  url: string;
  type?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  description?: string;
}

export interface ClassifyMaintenanceResult {
  category: MaintenanceCategory;
  subcategory?: string;
  severity: MaintenanceSeverity;
  urgency: MaintenanceUrgencyLevel;
  confidence: number;
  reasoning: string;
  safetyConcerns: string[];
  estimatedResponseTime: string;
  requiresSpecialist: boolean;
  specialistType?: string;
  suggestedActions: string[];
  potentialCauses: string[];
  imageAnalysis?: {
    issuesDetected: string[];
    damageAssessment?: string;
    additionalContext?: string;
  };
}

const ClassifyMaintenanceResultSchema = z.object({
  category: z.enum(['PLUMBING', 'ELECTRICAL', 'HVAC', 'APPLIANCE', 'STRUCTURAL',
    'PEST_CONTROL', 'SAFETY', 'EXTERIOR', 'COMMON_AREA', 'COSMETIC',
    'ROOFING', 'FLOORING', 'LOCKS_SECURITY', 'OTHER']),
  subcategory: z.string().optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  urgency: z.enum(['EMERGENCY', 'URGENT', 'HIGH', 'STANDARD', 'LOW']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  safetyConcerns: z.array(z.string()),
  estimatedResponseTime: z.string(),
  requiresSpecialist: z.boolean(),
  specialistType: z.string().optional(),
  suggestedActions: z.array(z.string()),
  potentialCauses: z.array(z.string()),
  imageAnalysis: z.object({
    issuesDetected: z.array(z.string()),
    damageAssessment: z.string().optional(),
    additionalContext: z.string().optional(),
  }).optional(),
});

export interface MaintenanceTriageConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enableVision?: boolean;
}

export class MaintenanceTriageService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private enableVision: boolean;

  constructor(config: MaintenanceTriageConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 1024;
    this.enableVision = config.enableVision ?? true;
  }

  async classifyMaintenanceRequest(
    description: string,
    images?: MaintenanceImage[]
  ): Promise<ClassifyMaintenanceResult> {
    const hasImages = images && images.length > 0 && this.enableVision;
    const modelToUse = hasImages ? 'gpt-4-turbo' : this.model;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: MAINTENANCE_TRIAGE_CLASSIFICATION_PROMPT.system },
    ];

    if (hasImages) {
      const content: OpenAI.ChatCompletionContentPart[] = [
        { type: 'text', text: `${MAINTENANCE_TRIAGE_CLASSIFICATION_PROMPT.user}\n\nMaintenance Request:\n${description}` },
      ];
      for (const image of images!) {
        content.push({ type: 'image_url', image_url: { url: image.url, detail: 'high' } });
      }
      messages.push({ role: 'user', content });
    } else {
      messages.push({
        role: 'user',
        content: `${MAINTENANCE_TRIAGE_CLASSIFICATION_PROMPT.user}\n\nMaintenance Request:\n${description}`,
      });
    }

    const response = await this.openai.chat.completions.create({
      model: modelToUse,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return ClassifyMaintenanceResultSchema.parse(parsed) as ClassifyMaintenanceResult;
  }
}

export function createMaintenanceTriageService(config: MaintenanceTriageConfig): MaintenanceTriageService {
  return new MaintenanceTriageService(config);
}

export async function classifyMaintenanceRequest(
  description: string,
  images?: MaintenanceImage[],
  config?: Partial<MaintenanceTriageConfig>
): Promise<ClassifyMaintenanceResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  const service = createMaintenanceTriageService({ openaiApiKey: apiKey, ...config });
  return service.classifyMaintenanceRequest(description, images);
}
