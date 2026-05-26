/**
 * Core types for AI Copilot services
 * 
 * These types define the foundational structures for AI automation,
 * governance, and human-in-the-loop workflows.
 */

import { z } from 'zod';

/** Brand type for type-safe IDs */
export type Brand<T, B> = T & { __brand: B };

/** Branded ID types for AI entities */
export type PromptId = Brand<string, 'PromptId'>;
export type CopilotRequestId = Brand<string, 'CopilotRequestId'>;
export type PredictionId = Brand<string, 'PredictionId'>;
export type ReviewId = Brand<string, 'ReviewId'>;
export type ModelId = Brand<string, 'ModelId'>;

/** ID factory functions */
export function asPromptId(id: string): PromptId {
  return id as PromptId;
}

export function asCopilotRequestId(id: string): CopilotRequestId {
  return id as CopilotRequestId;
}

export function asPredictionId(id: string): PredictionId {
  return id as PredictionId;
}

export function asReviewId(id: string): ReviewId {
  return id as ReviewId;
}

export function asModelId(id: string): ModelId {
  return id as ModelId;
}

/**
 * AI copilot domains aligned with BORJIE business areas
 */
export const CopilotDomain = {
  MAINTENANCE_TRIAGE: 'MAINTENANCE_TRIAGE',
  OWNER_REPORTING: 'OWNER_REPORTING',
  COMMUNICATION_DRAFTING: 'COMMUNICATION_DRAFTING',
  RISK_ALERTING: 'RISK_ALERTING',
  LEASE_ANALYSIS: 'LEASE_ANALYSIS',
  TENANT_SCREENING: 'TENANT_SCREENING',
  GRAPH_INTELLIGENCE: 'GRAPH_INTELLIGENCE',
} as const;

export type CopilotDomain = typeof CopilotDomain[keyof typeof CopilotDomain];

/**
 * Status of a copilot request through its lifecycle
 */
export const CopilotRequestStatus = {
  /** Request received and queued */
  PENDING: 'PENDING',
  /** AI processing in progress */
  PROCESSING: 'PROCESSING',
  /** AI completed, awaiting human review */
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  /** Human approved the output */
  APPROVED: 'APPROVED',
  /** Human rejected, may include feedback */
  REJECTED: 'REJECTED',
  /** Request was cancelled */
  CANCELLED: 'CANCELLED',
  /** Processing failed */
  FAILED: 'FAILED',
  /** Auto-approved (low-risk, high-confidence) */
  AUTO_APPROVED: 'AUTO_APPROVED',
} as const;

export type CopilotRequestStatus = typeof CopilotRequestStatus[keyof typeof CopilotRequestStatus];

/**
 * Risk level for AI operations - determines review requirements
 */
export const RiskLevel = {
  /** No review needed, auto-approve */
  LOW: 'LOW',
  /** Optional review, can auto-approve with high confidence */
  MEDIUM: 'MEDIUM',
  /** Mandatory human review required */
  HIGH: 'HIGH',
  /** Executive/multi-party approval required */
  CRITICAL: 'CRITICAL',
} as const;

export type RiskLevel = typeof RiskLevel[keyof typeof RiskLevel];

/**
 * Confidence level of AI output
 */
export const ConfidenceLevel = {
  VERY_LOW: 'VERY_LOW',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  VERY_HIGH: 'VERY_HIGH',
} as const;

export type ConfidenceLevel = typeof ConfidenceLevel[keyof typeof ConfidenceLevel];

/** Confidence score (0-1) to level mapping */
export function scoreToConfidenceLevel(score: number): ConfidenceLevel {
  if (score < 0.3) return ConfidenceLevel.VERY_LOW;
  if (score < 0.5) return ConfidenceLevel.LOW;
  if (score < 0.7) return ConfidenceLevel.MEDIUM;
  if (score < 0.85) return ConfidenceLevel.HIGH;
  return ConfidenceLevel.VERY_HIGH;
}

/**
 * Tenant context for multi-tenant AI operations
 */
export interface AITenantContext {
  tenantId: string;
  tenantName: string;
  environment: 'production' | 'staging' | 'development';
  /** Tenant-specific AI configuration overrides */
  aiConfig?: {
    /** Enabled copilot domains */
    enabledDomains?: CopilotDomain[];
    /** Default risk level threshold for auto-approval */
    autoApprovalThreshold?: ConfidenceLevel;
    /** Custom prompt overrides by ID */
    promptOverrides?: Record<string, string>;
  };
}

/**
 * Actor performing or reviewing AI operations
 */
export interface AIActor {
  type: 'user' | 'service' | 'system';
  id: string;
  name?: string;
  email?: string;
  roles?: string[];
}

/**
 * Request context for tracing AI operations
 */
export interface AIRequestContext {
  traceId: string;
  spanId?: string;
  requestId: string;
  sourceService: string;
  timestamp: string;
}

/**
 * Base interface for all copilot outputs
 */
export interface CopilotOutputBase {
  /** Unique output identifier */
  id: CopilotRequestId;
  /** The domain this output belongs to */
  domain: CopilotDomain;
  /** Current status */
  status: CopilotRequestStatus;
  /** Confidence score (0-1) */
  confidenceScore: number;
  /** Confidence level derived from score */
  confidenceLevel: ConfidenceLevel;
  /** Risk level of this output */
  riskLevel: RiskLevel;
  /** Whether human review is required */
  requiresReview: boolean;
  /** Model that generated this output */
  modelId: ModelId;
  /** Prompt version used */
  promptVersion: string;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Token usage */
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Human review record for AI outputs
 */
export interface HumanReview {
  id: ReviewId;
  copilotRequestId: CopilotRequestId;
  reviewer: AIActor;
  decision: 'approved' | 'rejected' | 'modified';
  /** Reviewer's modifications to the output */
  modifications?: Record<string, unknown> | undefined;
  /** Feedback for model improvement */
  feedback?: string | undefined;
  /** Quality rating (1-5) */
  qualityRating?: number | undefined;
  /** Time spent reviewing in seconds */
  reviewTimeSeconds: number;
  reviewedAt: string;
}

/**
 * Result type for AI operations
 */
export type AIResult<T, E = AIError> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * AI operation error
 */
export interface AIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

/** Create a success result */
export function aiOk<T>(data: T): AIResult<T, never> {
  return { success: true, data };
}

/** Create a failure result */
export function aiErr<E extends AIError>(error: E): AIResult<never, E> {
  return { success: false, error };
}

/**
 * Zod schemas for runtime validation
 */
export const CopilotDomainSchema = z.enum([
  'MAINTENANCE_TRIAGE',
  'OWNER_REPORTING',
  'COMMUNICATION_DRAFTING',
  'RISK_ALERTING',
  'LEASE_ANALYSIS',
  'TENANT_SCREENING',
  'GRAPH_INTELLIGENCE',
]);

export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const ConfidenceLevelSchema = z.enum([
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
]);

export const AITenantContextSchema = z.object({
  tenantId: z.string().min(1),
  tenantName: z.string().min(1),
  environment: z.enum(['production', 'staging', 'development']),
  aiConfig: z.object({
    enabledDomains: z.array(CopilotDomainSchema).optional(),
    autoApprovalThreshold: ConfidenceLevelSchema.optional(),
    promptOverrides: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

export const AIActorSchema = z.object({
  type: z.enum(['user', 'service', 'system']),
  id: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  roles: z.array(z.string()).optional(),
});
