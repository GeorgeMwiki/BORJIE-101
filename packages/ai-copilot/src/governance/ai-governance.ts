/**
 * AI Governance Service
 * 
 * Central governance for AI operations including:
 * - Audit logging
 * - Usage tracking and metrics
 * - Cost monitoring
 * - Quality tracking
 * - Compliance enforcement
 */

import { v4 as uuidv4 } from 'uuid';
import {
  CopilotRequestId,
  CopilotDomain,
  RiskLevel,
  ConfidenceLevel,
  AITenantContext,
  AIActor,
  CopilotOutputBase,
} from '../types/core.types.js';
import { PredictionBase, PredictionModelType } from '../types/prediction.types.js';
import { HumanReview } from '../types/core.types.js';

/**
 * AI operation type for audit
 */
export const AIOperationType = {
  COPILOT_INVOCATION: 'COPILOT_INVOCATION',
  PREDICTION_GENERATED: 'PREDICTION_GENERATED',
  REVIEW_SUBMITTED: 'REVIEW_SUBMITTED',
  PROMPT_CREATED: 'PROMPT_CREATED',
  PROMPT_APPROVED: 'PROMPT_APPROVED',
  AUTO_APPROVAL: 'AUTO_APPROVAL',
  HIGH_RISK_ALERT: 'HIGH_RISK_ALERT',
  ERROR: 'ERROR',
} as const;

export type AIOperationType = typeof AIOperationType[keyof typeof AIOperationType];

/**
 * AI audit event
 */
export interface AIAuditEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  operationType: AIOperationType;
  tenant: AITenantContext;
  actor: AIActor;
  domain?: CopilotDomain;
  modelType?: PredictionModelType;
  requestId?: CopilotRequestId;
  riskLevel?: RiskLevel;
  confidenceLevel?: ConfidenceLevel;
  outcome: 'success' | 'failure' | 'pending';
  details: Record<string, unknown>;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost?: {
    amount: number;
    currency: string;
  };
  processingTimeMs?: number;
}

/**
 * Usage metrics aggregation
 */
export interface UsageMetrics {
  period: {
    start: string;
    end: string;
  };
  tenant: AITenantContext;
  
  /** Copilot usage */
  copilotUsage: {
    byDomain: Record<CopilotDomain, {
      invocations: number;
      successRate: number;
      avgProcessingTimeMs: number;
      avgConfidence: number;
      reviewRate: number;
      approvalRate: number;
    }>;
    totalInvocations: number;
    totalTokens: number;
    totalCost: number;
  };
  
  /** Prediction usage */
  predictionUsage: {
    byModel: Record<PredictionModelType, {
      predictions: number;
      avgConfidence: number;
      highRiskCount: number;
      actionsTaken: number;
    }>;
    totalPredictions: number;
  };
  
  /** Review metrics */
  reviewMetrics: {
    totalReviews: number;
    avgReviewTimeSeconds: number;
    approvalRate: number;
    modificationRate: number;
    avgQualityRating: number;
  };
  
  /** Quality metrics */
  qualityMetrics: {
    overallAccuracy: number;
    userSatisfaction: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
  };
}

/**
 * Cost tracking
 */
export interface CostTracking {
  period: {
    start: string;
    end: string;
  };
  tenantId: string;
  
  byModel: Record<string, {
    tokenUsage: { prompt: number; completion: number; total: number };
    cost: number;
    invocations: number;
  }>;
  
  byDomain: Record<CopilotDomain, {
    cost: number;
    invocations: number;
    avgCostPerInvocation: number;
  }>;
  
  totalCost: number;
  budgetLimit?: number;
  budgetUsedPercent?: number;
}

/**
 * AI governance storage backend
 */
export interface AIGovernanceStorageBackend {
  saveAuditEvent(event: AIAuditEvent): Promise<void>;
  getAuditEvents(options: AuditQueryOptions): Promise<AIAuditEvent[]>;
  getUsageMetrics(tenantId: string, start: Date, end: Date): Promise<UsageMetrics>;
  getCostTracking(tenantId: string, start: Date, end: Date): Promise<CostTracking>;
  recordFeedback(requestId: CopilotRequestId, feedback: QualityFeedback): Promise<void>;
}

/**
 * Audit query options
 */
export interface AuditQueryOptions {
  tenantId?: string;
  operationType?: AIOperationType;
  domain?: CopilotDomain;
  startTime?: Date;
  endTime?: Date;
  riskLevel?: RiskLevel;
  outcome?: 'success' | 'failure' | 'pending';
  limit?: number;
  offset?: number;
}

/**
 * Quality feedback from users
 */
export interface QualityFeedback {
  requestId: CopilotRequestId;
  feedbackType: 'helpful' | 'not-helpful' | 'incorrect' | 'inappropriate';
  rating?: number;
  comment?: string;
  submittedBy: AIActor;
  submittedAt: string;
}

/**
 * In-memory governance storage for development
 */
export class InMemoryGovernanceStorage implements AIGovernanceStorageBackend {
  private auditEvents: AIAuditEvent[] = [];
  private feedback: Map<string, QualityFeedback[]> = new Map();

  async saveAuditEvent(event: AIAuditEvent): Promise<void> {
    this.auditEvents.push(event);
  }

  async getAuditEvents(options: AuditQueryOptions): Promise<AIAuditEvent[]> {
    let results = this.auditEvents;
    
    if (options.tenantId) {
      results = results.filter(e => e.tenant.tenantId === options.tenantId);
    }
    if (options.operationType) {
      results = results.filter(e => e.operationType === options.operationType);
    }
    if (options.domain) {
      results = results.filter(e => e.domain === options.domain);
    }
    if (options.startTime) {
      results = results.filter(e => new Date(e.timestamp) >= options.startTime!);
    }
    if (options.endTime) {
      results = results.filter(e => new Date(e.timestamp) <= options.endTime!);
    }
    if (options.riskLevel) {
      results = results.filter(e => e.riskLevel === options.riskLevel);
    }
    if (options.outcome) {
      results = results.filter(e => e.outcome === options.outcome);
    }

    results = results.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100));
    return results;
  }

  async getUsageMetrics(tenantId: string, start: Date, end: Date): Promise<UsageMetrics> {
    const events = this.auditEvents.filter(
      e => e.tenant.tenantId === tenantId &&
           new Date(e.timestamp) >= start &&
           new Date(e.timestamp) <= end
    );

    // Aggregate metrics (simplified)
    const copilotEvents = events.filter(e => e.operationType === AIOperationType.COPILOT_INVOCATION);
    const predictionEvents = events.filter(e => e.operationType === AIOperationType.PREDICTION_GENERATED);
    const reviewEvents = events.filter(e => e.operationType === AIOperationType.REVIEW_SUBMITTED);

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      tenant: events[0]?.tenant ?? { tenantId, tenantName: '', environment: 'production' },
      copilotUsage: {
        byDomain: {} as UsageMetrics['copilotUsage']['byDomain'],
        totalInvocations: copilotEvents.length,
        totalTokens: copilotEvents.reduce((sum, e) => sum + (e.tokenUsage?.totalTokens ?? 0), 0),
        totalCost: copilotEvents.reduce((sum, e) => sum + (e.cost?.amount ?? 0), 0),
      },
      predictionUsage: {
        byModel: {} as UsageMetrics['predictionUsage']['byModel'],
        totalPredictions: predictionEvents.length,
      },
      reviewMetrics: {
        totalReviews: reviewEvents.length,
        avgReviewTimeSeconds: 0,
        approvalRate: 0,
        modificationRate: 0,
        avgQualityRating: 0,
      },
      qualityMetrics: {
        overallAccuracy: 0.85,
        userSatisfaction: 0.9,
        falsePositiveRate: 0.05,
        falseNegativeRate: 0.03,
      },
    };
  }

  async getCostTracking(tenantId: string, start: Date, end: Date): Promise<CostTracking> {
    const events = this.auditEvents.filter(
      e => e.tenant.tenantId === tenantId &&
           new Date(e.timestamp) >= start &&
           new Date(e.timestamp) <= end &&
           e.cost
    );

    const totalCost = events.reduce((sum, e) => sum + (e.cost?.amount ?? 0), 0);

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      tenantId,
      byModel: {},
      byDomain: {} as CostTracking['byDomain'],
      totalCost,
    };
  }

  async recordFeedback(requestId: CopilotRequestId, feedback: QualityFeedback): Promise<void> {
    const existing = this.feedback.get(requestId) ?? [];
    existing.push(feedback);
    this.feedback.set(requestId, existing);
  }
}

/**
 * AI Governance Service
 */
export class AIGovernanceService {
  private storage: AIGovernanceStorageBackend;
  private costPerToken: Record<string, { prompt: number; completion: number }>;

  constructor(storage?: AIGovernanceStorageBackend) {
    this.storage = storage ?? new InMemoryGovernanceStorage();

    // Default cost per 1K tokens (USD).
    // Anthropic Claude rates are first-class — they are the Brain's primary
    // executor. OpenAI rates remain for any legacy copilot still routed via
    // the OpenAIProvider. The 'default' entry mirrors Sonnet 4.6 since most
    // Brain turns run through that tier.
    this.costPerToken = {
      // Anthropic
      'claude-opus-4-6': { prompt: 0.015, completion: 0.075 },
      'claude-sonnet-4-6': { prompt: 0.003, completion: 0.015 },
      'claude-haiku-4-5-20251001': { prompt: 0.0008, completion: 0.004 },
      'claude-haiku-4-5': { prompt: 0.0008, completion: 0.004 },
      // OpenAI (legacy copilot path)
      'gpt-4-turbo-preview': { prompt: 0.01, completion: 0.03 },
      'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
      'gpt-4': { prompt: 0.03, completion: 0.06 },
      'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
      // Fallback — Sonnet rates so unknown models don't silently overcharge
      'default': { prompt: 0.003, completion: 0.015 },
    };
  }

  /**
   * Log a copilot invocation
   */
  async logCopilotInvocation(
    output: CopilotOutputBase,
    tenant: AITenantContext,
    actor: AIActor,
    outcome: 'success' | 'failure'
  ): Promise<void> {
    const cost = this.calculateCost(output.modelId, output.tokenUsage);
    
    const event: AIAuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      operationType: AIOperationType.COPILOT_INVOCATION,
      tenant,
      actor,
      domain: output.domain,
      requestId: output.id,
      riskLevel: output.riskLevel,
      confidenceLevel: output.confidenceLevel,
      outcome,
      details: {
        promptVersion: output.promptVersion,
        requiresReview: output.requiresReview,
        status: output.status,
      },
      tokenUsage: output.tokenUsage,
      cost,
      processingTimeMs: output.processingTimeMs,
    };

    await this.storage.saveAuditEvent(event);
  }

  /**
   * Log a prediction generation
   */
  async logPrediction(
    prediction: PredictionBase,
    tenant: AITenantContext,
    actor: AIActor
  ): Promise<void> {
    const event: AIAuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      operationType: AIOperationType.PREDICTION_GENERATED,
      tenant,
      actor,
      modelType: prediction.modelType,
      riskLevel: prediction.riskLevel,
      confidenceLevel: prediction.confidence,
      outcome: 'success',
      details: {
        predictionId: prediction.id,
        modelVersion: prediction.modelVersion,
        horizon: prediction.horizon,
        probability: prediction.probability,
        topFeatures: prediction.featureImportance.slice(0, 3).map(f => f.feature),
      },
    };

    await this.storage.saveAuditEvent(event);

    // Log high-risk alert separately
    if (prediction.riskLevel === RiskLevel.HIGH || prediction.riskLevel === RiskLevel.CRITICAL) {
      await this.logHighRiskAlert(prediction, tenant, actor);
    }
  }

  /**
   * Log a human review
   */
  async logReview(
    review: HumanReview,
    output: CopilotOutputBase,
    tenant: AITenantContext
  ): Promise<void> {
    const event: AIAuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      operationType: AIOperationType.REVIEW_SUBMITTED,
      tenant,
      actor: review.reviewer,
      domain: output.domain,
      requestId: review.copilotRequestId,
      riskLevel: output.riskLevel,
      outcome: 'success',
      details: {
        reviewId: review.id,
        decision: review.decision,
        qualityRating: review.qualityRating,
        reviewTimeSeconds: review.reviewTimeSeconds,
        hadModifications: !!review.modifications,
        hadFeedback: !!review.feedback,
      },
    };

    await this.storage.saveAuditEvent(event);
  }

  /**
   * Log an auto-approval
   */
  async logAutoApproval(
    output: CopilotOutputBase,
    tenant: AITenantContext,
    actor: AIActor,
    reason: string
  ): Promise<void> {
    const event: AIAuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      operationType: AIOperationType.AUTO_APPROVAL,
      tenant,
      actor,
      domain: output.domain,
      requestId: output.id,
      riskLevel: output.riskLevel,
      confidenceLevel: output.confidenceLevel,
      outcome: 'success',
      details: {
        reason,
        confidenceScore: output.confidenceScore,
      },
    };

    await this.storage.saveAuditEvent(event);
  }

  /**
   * Log a high-risk alert
   */
  async logHighRiskAlert(
    prediction: PredictionBase,
    tenant: AITenantContext,
    actor: AIActor
  ): Promise<void> {
    const event: AIAuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      operationType: AIOperationType.HIGH_RISK_ALERT,
      tenant,
      actor,
      modelType: prediction.modelType,
      riskLevel: prediction.riskLevel,
      outcome: 'success',
      details: {
        predictionId: prediction.id,
        probability: prediction.probability,
        modelType: prediction.modelType,
        horizon: prediction.horizon,
      },
    };

    await this.storage.saveAuditEvent(event);
  }

  /**
   * Log an error
   */
  async logError(
    error: Error,
    context: {
      tenant: AITenantContext;
      actor: AIActor;
      domain?: CopilotDomain;
      modelType?: PredictionModelType;
      requestId?: CopilotRequestId;
    }
  ): Promise<void> {
    const event: AIAuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      operationType: AIOperationType.ERROR,
      tenant: context.tenant,
      actor: context.actor,
      domain: context.domain,
      modelType: context.modelType,
      requestId: context.requestId,
      outcome: 'failure',
      details: {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
      },
    };

    await this.storage.saveAuditEvent(event);
  }

  /**
   * Log a Brain (persona/orchestrator) turn.
   *
   * Captures what the existing `logCopilotInvocation` cannot: persona id,
   * advisor consultation, handoff depth, and thread id. Emits as a
   * `COPILOT_INVOCATION` event so existing usage-metric aggregations include
   * Brain traffic automatically.
   */
  async logBrainTurn(params: {
    tenant: AITenantContext;
    actor: AIActor;
    personaId: string;
    threadId: string;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    advisorConsulted: boolean;
    depth: number;
    outcome?: 'success' | 'failure';
    domain?: CopilotDomain;
    riskLevel?: RiskLevel;
    processingTimeMs?: number;
  }): Promise<void> {
    const totalTokens = params.promptTokens + params.completionTokens;
    const cost = this.calculateCost(params.modelId, {
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
    });
    const event: AIAuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      operationType: AIOperationType.COPILOT_INVOCATION,
      tenant: params.tenant,
      actor: params.actor,
      domain: params.domain,
      riskLevel: params.riskLevel,
      outcome: params.outcome ?? 'success',
      details: {
        kind: 'brain_turn',
        personaId: params.personaId,
        threadId: params.threadId,
        advisorConsulted: params.advisorConsulted,
        depth: params.depth,
      },
      tokenUsage: {
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens,
      },
      cost,
      processingTimeMs: params.processingTimeMs,
    };
    await this.storage.saveAuditEvent(event);
  }

  /**
   * Get usage metrics for a tenant
   */
  async getUsageMetrics(tenantId: string, start: Date, end: Date): Promise<UsageMetrics> {
    return this.storage.getUsageMetrics(tenantId, start, end);
  }

  /**
   * Get cost tracking for a tenant
   */
  async getCostTracking(tenantId: string, start: Date, end: Date): Promise<CostTracking> {
    return this.storage.getCostTracking(tenantId, start, end);
  }

  /**
   * Query audit events
   */
  async queryAuditEvents(options: AuditQueryOptions): Promise<AIAuditEvent[]> {
    return this.storage.getAuditEvents(options);
  }

  /**
   * Record quality feedback
   */
  async recordFeedback(feedback: QualityFeedback): Promise<void> {
    await this.storage.recordFeedback(feedback.requestId, feedback);
  }

  /**
   * Calculate cost for token usage
   */
  private calculateCost(
    modelId: string,
    tokenUsage: { promptTokens: number; completionTokens: number }
  ): { amount: number; currency: string } {
    const rates = this.costPerToken[modelId] ?? this.costPerToken['default'];
    const promptCost = (tokenUsage.promptTokens / 1000) * rates.prompt;
    const completionCost = (tokenUsage.completionTokens / 1000) * rates.completion;
    
    return {
      amount: Math.round((promptCost + completionCost) * 10000) / 10000,
      currency: 'USD',
    };
  }

  /**
   * Check if tenant is within budget
   */
  async checkBudget(tenantId: string, budgetLimit: number): Promise<{
    withinBudget: boolean;
    currentUsage: number;
    remaining: number;
    percentUsed: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const costTracking = await this.getCostTracking(tenantId, startOfMonth, now);
    
    return {
      withinBudget: costTracking.totalCost <= budgetLimit,
      currentUsage: costTracking.totalCost,
      remaining: budgetLimit - costTracking.totalCost,
      percentUsed: (costTracking.totalCost / budgetLimit) * 100,
    };
  }
}

/**
 * Factory function
 */
export function createAIGovernanceService(
  storage?: AIGovernanceStorageBackend
): AIGovernanceService {
  return new AIGovernanceService(storage);
}
