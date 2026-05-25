/**
 * Governed Prompt Library Types
 * 
 * Prompts are versioned, reviewed, and audited artifacts.
 * Changes require approval workflow and maintain full history.
 */

import { z } from 'zod';
import {
  PromptId,
  CopilotDomain,
  RiskLevel,
  AIActor,
  CopilotDomainSchema,
  RiskLevelSchema,
  AIActorSchema,
} from './core.types.js';

/**
 * Status of a prompt in its lifecycle
 */
export const PromptStatus = {
  /** Initial draft, not yet submitted for review */
  DRAFT: 'DRAFT',
  /** Submitted for approval */
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /** Approved and available for use */
  APPROVED: 'APPROVED',
  /** Previously approved but now superseded */
  DEPRECATED: 'DEPRECATED',
  /** Rejected during approval process */
  REJECTED: 'REJECTED',
  /** Archived, no longer available */
  ARCHIVED: 'ARCHIVED',
} as const;

export type PromptStatus = typeof PromptStatus[keyof typeof PromptStatus];

/**
 * Categories of prompts by function
 */
export const PromptCategory = {
  /** System prompts that set context and behavior */
  SYSTEM: 'SYSTEM',
  /** Task-specific prompts for user requests */
  TASK: 'TASK',
  /** Prompts for formatting/structuring output */
  OUTPUT_FORMAT: 'OUTPUT_FORMAT',
  /** Prompts for safety guardrails */
  GUARDRAIL: 'GUARDRAIL',
  /** Prompts for evaluation/scoring */
  EVALUATION: 'EVALUATION',
} as const;

export type PromptCategory = typeof PromptCategory[keyof typeof PromptCategory];

/**
 * Input variable definition for prompts
 */
export interface PromptVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  defaultValue?: unknown;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    min?: number;
    max?: number;
  };
}

/**
 * Test case for prompt validation
 */
export interface PromptTestCase {
  name: string;
  description: string;
  inputs: Record<string, unknown>;
  expectedOutputContains?: string[];
  expectedOutputNotContains?: string[];
  expectedConfidenceMin?: number;
  tags?: string[];
}

/**
 * Prompt performance metrics
 */
export interface PromptMetrics {
  /** Total invocations */
  totalInvocations: number;
  /** Average confidence score */
  avgConfidenceScore: number;
  /** Approval rate when reviewed */
  approvalRate: number;
  /** Average processing time in ms */
  avgProcessingTimeMs: number;
  /** Average token usage */
  avgTokenUsage: number;
  /** Error rate */
  errorRate: number;
  /** Last calculated timestamp */
  calculatedAt: string;
}

/**
 * Governed prompt definition
 */
export interface GovernedPrompt {
  /** Unique prompt identifier */
  id: PromptId;
  /** Human-readable name */
  name: string;
  /** Detailed description of purpose */
  description: string;
  /** Domain this prompt serves */
  domain: CopilotDomain;
  /** Category of prompt */
  category: PromptCategory;
  /** Semantic version (major.minor.patch) */
  version: string;
  /** Previous version ID if this is an update */
  previousVersionId?: PromptId;
  /** Current lifecycle status */
  status: PromptStatus;
  /** Risk level when using this prompt */
  riskLevel: RiskLevel;
  
  /** The actual prompt template with {{variable}} placeholders */
  template: string;
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Variables this prompt accepts */
  variables: PromptVariable[];
  
  /** Model constraints */
  modelConstraints: {
    /** Allowed model IDs */
    allowedModels?: string[];
    /** Minimum model capability tier */
    minCapabilityTier?: 'basic' | 'standard' | 'advanced';
    /** Maximum tokens for response */
    maxResponseTokens?: number;
    /** Temperature setting */
    temperature?: number;
    /** Top-p setting */
    topP?: number;
  };
  
  /** Guardrails and safety */
  guardrails: {
    /** Maximum input length */
    maxInputLength?: number;
    /** Required input sanitization */
    sanitizeInput?: boolean;
    /** Blocked content patterns */
    blockedPatterns?: string[];
    /** Required output validation schema */
    outputSchema?: Record<string, unknown>;
    /** PII handling requirements */
    piiHandling?: 'allow' | 'redact' | 'reject';
  };
  
  /** Test cases for validation */
  testCases: PromptTestCase[];
  
  /** Performance metrics */
  metrics?: PromptMetrics;
  
  /** Approval tracking */
  approval?: {
    requestedBy: AIActor;
    requestedAt: string;
    approvedBy?: AIActor;
    approvedAt?: string;
    rejectedBy?: AIActor;
    rejectedAt?: string;
    rejectionReason?: string;
    reviewNotes?: string;
  };
  
  /** Audit trail */
  createdBy: AIActor;
  createdAt: string;
  updatedBy: AIActor;
  updatedAt: string;
  
  /** Tags for organization */
  tags: string[];
}

/**
 * Request to create a new prompt
 */
export interface CreatePromptRequest {
  name: string;
  description: string;
  domain: CopilotDomain;
  category: PromptCategory;
  riskLevel: RiskLevel;
  template: string;
  systemPrompt?: string;
  variables: PromptVariable[];
  modelConstraints?: GovernedPrompt['modelConstraints'];
  guardrails?: GovernedPrompt['guardrails'];
  testCases?: PromptTestCase[];
  tags?: string[];
}

/**
 * Request to update an existing prompt (creates new version)
 */
export interface UpdatePromptRequest {
  promptId: PromptId;
  changes: Partial<Omit<CreatePromptRequest, 'domain'>>;
  changeReason: string;
  bumpType: 'major' | 'minor' | 'patch';
}

/**
 * Compiled prompt ready for execution
 */
export interface CompiledPrompt {
  promptId: PromptId;
  version: string;
  systemPrompt: string;
  userPrompt: string;
  modelConfig: {
    modelId: string;
    maxTokens: number;
    temperature: number;
    topP?: number;
  };
  guardrails: GovernedPrompt['guardrails'];
}

/**
 * Zod schemas for validation
 */
export const PromptStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'DEPRECATED',
  'REJECTED',
  'ARCHIVED',
]);

export const PromptCategorySchema = z.enum([
  'SYSTEM',
  'TASK',
  'OUTPUT_FORMAT',
  'GUARDRAIL',
  'EVALUATION',
]);

export const PromptVariableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string(),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  validation: z.object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
});

export const PromptTestCaseSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  expectedOutputContains: z.array(z.string()).optional(),
  expectedOutputNotContains: z.array(z.string()).optional(),
  expectedConfidenceMin: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
});

export const CreatePromptRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(1000),
  domain: CopilotDomainSchema,
  category: PromptCategorySchema,
  riskLevel: RiskLevelSchema,
  template: z.string().min(10),
  systemPrompt: z.string().optional(),
  variables: z.array(PromptVariableSchema),
  modelConstraints: z.object({
    allowedModels: z.array(z.string()).optional(),
    minCapabilityTier: z.enum(['basic', 'standard', 'advanced']).optional(),
    maxResponseTokens: z.number().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
  }).optional(),
  guardrails: z.object({
    maxInputLength: z.number().positive().optional(),
    sanitizeInput: z.boolean().optional(),
    blockedPatterns: z.array(z.string()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    piiHandling: z.enum(['allow', 'redact', 'reject']).optional(),
  }).optional(),
  testCases: z.array(PromptTestCaseSchema).optional(),
  tags: z.array(z.string()).optional(),
});
