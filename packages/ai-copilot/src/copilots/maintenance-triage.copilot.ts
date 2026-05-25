/**
 * Maintenance Triage Copilot
 * 
 * AI-powered maintenance request triage, categorization,
 * and work order generation.
 */

import {
  CopilotDomain,
  CopilotRequestId,
  RiskLevel,
  AIResult,
  aiOk,
  aiErr,
} from '../types/core.types.js';
import {
  MaintenanceTriageInput,
  MaintenanceTriageOutput,
  MaintenanceUrgency,
  MaintenanceCategory,
} from '../types/copilot.types.js';
import { BaseCopilot, CopilotError } from '../services/base-copilot.js';
import { AICompletionResponse } from '../providers/ai-provider.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { AIProviderRegistry } from '../providers/ai-provider.js';
import { ReviewService } from '../services/review-service.js';

/**
 * Parsed triage response from AI
 */
interface TriageAIResponse {
  triage: {
    urgency: string;
    urgencyConfidence: number;
    category: string;
    subcategory?: string;
    categoryConfidence: number;
    issuesIdentified: string[];
    safetyConcerns: string[];
    requiresTenantAccess: boolean;
    estimatedComplexity: number;
  };
  routing: {
    vendorType: string;
    suggestedVendorIds?: string[];
    skillsRequired: string[];
    estimatedServiceHours: number;
    suggestedScheduling: {
      earliest: string;
      latest: string;
      preferredTimeOfDay?: string;
    };
  };
  workOrderDraft: {
    title: string;
    description: string;
    internalNotes: string;
    estimatedCost?: {
      min: number;
      max: number;
      currency: string;
    };
  };
  tenantCommunication: {
    acknowledgmentMessage: string;
    expectedResolutionMessage: string;
    instructionsForTenant?: string;
  };
  followUp: {
    inspectionRecommended: boolean;
    preventiveMaintenanceRecommended: boolean;
    relatedSystemsToCheck: string[];
  };
}

/**
 * Maintenance Triage Copilot Implementation
 */
export class MaintenanceTriageCopilot extends BaseCopilot<MaintenanceTriageInput, MaintenanceTriageOutput> {
  readonly domain = CopilotDomain.MAINTENANCE_TRIAGE;
  readonly promptName = 'maintenance-triage-standard';
  readonly defaultRiskLevel = RiskLevel.MEDIUM;

  constructor(
    promptRegistry: PromptRegistry,
    providerRegistry: AIProviderRegistry,
    reviewService: ReviewService
  ) {
    super(promptRegistry, providerRegistry, reviewService);
  }

  protected transformInputToVariables(input: MaintenanceTriageInput): Record<string, unknown> {
    return {
      propertyName: input.property.name,
      propertyType: input.property.type,
      propertyAge: input.property.age,
      unitNumber: input.unit.number,
      bedrooms: input.unit.bedrooms,
      bathrooms: input.unit.bathrooms,
      tenantName: input.tenant.name,
      preferredContact: input.tenant.preferredContactMethod ?? 'app',
      requestText: input.requestText,
      recentHistory: input.recentHistory,
    };
  }

  protected parseAIResponse(
    response: AICompletionResponse,
    input: MaintenanceTriageInput,
    requestId: CopilotRequestId
  ): AIResult<MaintenanceTriageOutput, CopilotError> {
    // Parse JSON response
    const parseResult = this.safeParseJson<TriageAIResponse>(response.content, requestId);
    if (!parseResult.success) {
      return parseResult as AIResult<MaintenanceTriageOutput, CopilotError>;
    }

    const aiResponse = parseResult.data;

    // Validate urgency value
    const urgency = this.validateUrgency(aiResponse.triage.urgency);
    if (!urgency) {
      return aiErr({
        code: 'VALIDATION_ERROR',
        message: `Invalid urgency value: ${aiResponse.triage.urgency}`,
        domain: this.domain,
        retryable: false,
      });
    }

    // Validate category value
    const category = this.validateCategory(aiResponse.triage.category);
    if (!category) {
      return aiErr({
        code: 'VALIDATION_ERROR',
        message: `Invalid category value: ${aiResponse.triage.category}`,
        domain: this.domain,
        retryable: false,
      });
    }

    // Determine risk level based on urgency
    const riskLevel = this.determineRiskLevel(urgency, aiResponse.triage.safetyConcerns);

    // Build output
    const output: MaintenanceTriageOutput = {
      ...this.createBaseOutput(requestId, riskLevel) as MaintenanceTriageOutput,
      domain: CopilotDomain.MAINTENANCE_TRIAGE,
      input,
      triage: {
        urgency,
        urgencyConfidence: aiResponse.triage.urgencyConfidence,
        category,
        subcategory: aiResponse.triage.subcategory,
        categoryConfidence: aiResponse.triage.categoryConfidence,
        issuesIdentified: aiResponse.triage.issuesIdentified,
        safetyConcerns: aiResponse.triage.safetyConcerns,
        requiresTenantAccess: aiResponse.triage.requiresTenantAccess,
        estimatedComplexity: aiResponse.triage.estimatedComplexity,
      },
      routing: {
        vendorType: aiResponse.routing.vendorType,
        suggestedVendorIds: aiResponse.routing.suggestedVendorIds,
        skillsRequired: aiResponse.routing.skillsRequired,
        estimatedServiceHours: aiResponse.routing.estimatedServiceHours,
        suggestedScheduling: {
          earliest: aiResponse.routing.suggestedScheduling.earliest,
          latest: aiResponse.routing.suggestedScheduling.latest,
          preferredTimeOfDay: aiResponse.routing.suggestedScheduling.preferredTimeOfDay as 'morning' | 'afternoon' | 'evening' | 'any' | undefined,
        },
      },
      workOrderDraft: aiResponse.workOrderDraft,
      tenantCommunication: aiResponse.tenantCommunication,
      followUp: aiResponse.followUp,
    };

    return aiOk(output);
  }

  protected calculateConfidence(output: MaintenanceTriageOutput): number {
    // Weighted average of urgency and category confidence
    const urgencyWeight = 0.6;
    const categoryWeight = 0.4;
    return (
      output.triage.urgencyConfidence * urgencyWeight +
      output.triage.categoryConfidence * categoryWeight
    );
  }

  protected validateOutput(output: MaintenanceTriageOutput): AIResult<MaintenanceTriageOutput, CopilotError> {
    // Validate required fields
    if (!output.triage.urgency) {
      return aiErr({
        code: 'VALIDATION_ERROR',
        message: 'Missing urgency in triage output',
        domain: this.domain,
        retryable: false,
      });
    }

    if (!output.triage.category) {
      return aiErr({
        code: 'VALIDATION_ERROR',
        message: 'Missing category in triage output',
        domain: this.domain,
        retryable: false,
      });
    }

    if (!output.workOrderDraft.title || !output.workOrderDraft.description) {
      return aiErr({
        code: 'VALIDATION_ERROR',
        message: 'Missing work order draft details',
        domain: this.domain,
        retryable: false,
      });
    }

    return aiOk(output);
  }

  /**
   * Validate and normalize urgency value
   */
  private validateUrgency(value: string): MaintenanceUrgency | null {
    const normalized = value.toUpperCase();
    if (Object.values(MaintenanceUrgency).includes(normalized as MaintenanceUrgency)) {
      return normalized as MaintenanceUrgency;
    }
    return null;
  }

  /**
   * Validate and normalize category value
   */
  private validateCategory(value: string): MaintenanceCategory | null {
    const normalized = value.toUpperCase();
    if (Object.values(MaintenanceCategory).includes(normalized as MaintenanceCategory)) {
      return normalized as MaintenanceCategory;
    }
    return null;
  }

  /**
   * Determine risk level based on urgency and safety concerns
   */
  private determineRiskLevel(urgency: MaintenanceUrgency, safetyConcerns: string[]): RiskLevel {
    // Emergency situations are critical risk
    if (urgency === MaintenanceUrgency.EMERGENCY) {
      return RiskLevel.CRITICAL;
    }

    // Safety concerns elevate risk
    if (safetyConcerns.length > 0) {
      return RiskLevel.HIGH;
    }

    // Urgent issues are high risk
    if (urgency === MaintenanceUrgency.URGENT) {
      return RiskLevel.HIGH;
    }

    // High priority is medium risk
    if (urgency === MaintenanceUrgency.HIGH) {
      return RiskLevel.MEDIUM;
    }

    // Everything else is low risk
    return RiskLevel.LOW;
  }
}

/**
 * Factory function
 */
export function createMaintenanceTriageCopilot(
  promptRegistry: PromptRegistry,
  providerRegistry: AIProviderRegistry,
  reviewService: ReviewService
): MaintenanceTriageCopilot {
  return new MaintenanceTriageCopilot(promptRegistry, providerRegistry, reviewService);
}
