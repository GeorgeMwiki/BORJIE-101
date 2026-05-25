/**
 * Governed Prompt Registry
 * 
 * Centralized registry for managing versioned, approved prompts.
 * Provides prompt retrieval, versioning, and governance enforcement.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  PromptId,
  asPromptId,
  CopilotDomain,
  RiskLevel,
  AIActor,
  AIResult,
  AIError,
  aiOk,
  aiErr,
} from '../types/core.types.js';
import {
  GovernedPrompt,
  PromptStatus,
  PromptCategory,
  CreatePromptRequest,
  UpdatePromptRequest,
  CompiledPrompt,
  PromptVariable,
  CreatePromptRequestSchema,
} from '../types/prompt.types.js';

/**
 * Prompt not found error
 */
export interface PromptNotFoundError extends AIError {
  code: 'PROMPT_NOT_FOUND';
  promptId: string;
}

/**
 * Prompt validation error
 */
export interface PromptValidationError extends AIError {
  code: 'PROMPT_VALIDATION_ERROR';
  validationErrors: string[];
}

/**
 * Prompt compilation error
 */
export interface PromptCompilationError extends AIError {
  code: 'PROMPT_COMPILATION_ERROR';
  missingVariables: string[];
}

export type PromptRegistryError = PromptNotFoundError | PromptValidationError | PromptCompilationError;

/**
 * Interface for prompt storage backend
 */
export interface PromptStorageBackend {
  save(prompt: GovernedPrompt): Promise<void>;
  get(id: PromptId): Promise<GovernedPrompt | null>;
  getByDomainAndName(domain: CopilotDomain, name: string): Promise<GovernedPrompt | null>;
  getActiveByDomain(domain: CopilotDomain): Promise<GovernedPrompt[]>;
  list(filters?: {
    domain?: CopilotDomain;
    status?: PromptStatus;
    category?: PromptCategory;
  }): Promise<GovernedPrompt[]>;
  getVersionHistory(name: string, domain: CopilotDomain): Promise<GovernedPrompt[]>;
}

/**
 * In-memory prompt storage for development/testing
 */
export class InMemoryPromptStorage implements PromptStorageBackend {
  private prompts: Map<string, GovernedPrompt> = new Map();

  async save(prompt: GovernedPrompt): Promise<void> {
    this.prompts.set(prompt.id, prompt);
  }

  async get(id: PromptId): Promise<GovernedPrompt | null> {
    return this.prompts.get(id) ?? null;
  }

  async getByDomainAndName(domain: CopilotDomain, name: string): Promise<GovernedPrompt | null> {
    for (const prompt of this.prompts.values()) {
      if (prompt.domain === domain && prompt.name === name && prompt.status === PromptStatus.APPROVED) {
        return prompt;
      }
    }
    return null;
  }

  async getActiveByDomain(domain: CopilotDomain): Promise<GovernedPrompt[]> {
    return Array.from(this.prompts.values()).filter(
      p => p.domain === domain && p.status === PromptStatus.APPROVED
    );
  }

  async list(filters?: {
    domain?: CopilotDomain;
    status?: PromptStatus;
    category?: PromptCategory;
  }): Promise<GovernedPrompt[]> {
    let results = Array.from(this.prompts.values());
    if (filters?.domain) {
      results = results.filter(p => p.domain === filters.domain);
    }
    if (filters?.status) {
      results = results.filter(p => p.status === filters.status);
    }
    if (filters?.category) {
      results = results.filter(p => p.category === filters.category);
    }
    return results;
  }

  async getVersionHistory(name: string, domain: CopilotDomain): Promise<GovernedPrompt[]> {
    return Array.from(this.prompts.values())
      .filter(p => p.name === name && p.domain === domain)
      .sort((a, b) => b.version.localeCompare(a.version));
  }
}

/**
 * Governed Prompt Registry
 * 
 * Manages the lifecycle of AI prompts with versioning,
 * approval workflows, and governance enforcement.
 */
export class PromptRegistry {
  constructor(
    private storage: PromptStorageBackend,
    private defaultModelId: string = 'gpt-4-turbo-preview'
  ) {}

  /**
   * Create a new prompt (starts as DRAFT)
   */
  async createPrompt(
    request: CreatePromptRequest,
    actor: AIActor
  ): Promise<AIResult<GovernedPrompt, PromptValidationError>> {
    // Validate request
    const validation = CreatePromptRequestSchema.safeParse(request);
    if (!validation.success) {
      return aiErr({
        code: 'PROMPT_VALIDATION_ERROR',
        message: 'Invalid prompt request',
        validationErrors: validation.error.issues.map((e) => `${String(e.path.join('.'))}: ${e.message}`),
        retryable: false,
      });
    }

    const now = new Date().toISOString();
    const prompt: GovernedPrompt = {
      id: asPromptId(uuidv4()),
      name: request.name,
      description: request.description,
      domain: request.domain,
      category: request.category,
      version: '1.0.0',
      status: PromptStatus.DRAFT,
      riskLevel: request.riskLevel,
      template: request.template,
      systemPrompt: request.systemPrompt,
      variables: request.variables,
      modelConstraints: request.modelConstraints ?? {},
      guardrails: request.guardrails ?? {},
      testCases: request.testCases ?? [],
      createdBy: actor,
      createdAt: now,
      updatedBy: actor,
      updatedAt: now,
      tags: request.tags ?? [],
    };

    await this.storage.save(prompt);
    return aiOk(prompt);
  }

  /**
   * Submit a prompt for approval
   */
  async submitForApproval(
    promptId: PromptId,
    actor: AIActor
  ): Promise<AIResult<GovernedPrompt, PromptNotFoundError>> {
    const prompt = await this.storage.get(promptId);
    if (!prompt) {
      return aiErr({
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt ${promptId} not found`,
        promptId,
        retryable: false,
      });
    }

    const updated: GovernedPrompt = {
      ...prompt,
      status: PromptStatus.PENDING_APPROVAL,
      approval: {
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
      },
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.save(updated);
    return aiOk(updated);
  }

  /**
   * Approve a prompt
   */
  async approvePrompt(
    promptId: PromptId,
    actor: AIActor,
    notes?: string
  ): Promise<AIResult<GovernedPrompt, PromptNotFoundError>> {
    const prompt = await this.storage.get(promptId);
    if (!prompt) {
      return aiErr({
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt ${promptId} not found`,
        promptId,
        retryable: false,
      });
    }

    const updated: GovernedPrompt = {
      ...prompt,
      status: PromptStatus.APPROVED,
      approval: {
        ...prompt.approval!,
        approvedBy: actor,
        approvedAt: new Date().toISOString(),
        reviewNotes: notes,
      },
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.save(updated);
    return aiOk(updated);
  }

  /**
   * Reject a prompt
   */
  async rejectPrompt(
    promptId: PromptId,
    actor: AIActor,
    reason: string
  ): Promise<AIResult<GovernedPrompt, PromptNotFoundError>> {
    const prompt = await this.storage.get(promptId);
    if (!prompt) {
      return aiErr({
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt ${promptId} not found`,
        promptId,
        retryable: false,
      });
    }

    const updated: GovernedPrompt = {
      ...prompt,
      status: PromptStatus.REJECTED,
      approval: {
        ...prompt.approval!,
        rejectedBy: actor,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason,
      },
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.save(updated);
    return aiOk(updated);
  }

  /**
   * Create a new version of an existing prompt
   */
  async createNewVersion(
    request: UpdatePromptRequest,
    actor: AIActor
  ): Promise<AIResult<GovernedPrompt, PromptNotFoundError | PromptValidationError>> {
    const existing = await this.storage.get(request.promptId);
    if (!existing) {
      return aiErr({
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt ${request.promptId} not found`,
        promptId: request.promptId,
        retryable: false,
      });
    }

    // Calculate new version
    const [major, minor, patch] = existing.version.split('.').map(Number);
    let newVersion: string;
    switch (request.bumpType) {
      case 'major':
        newVersion = `${major + 1}.0.0`;
        break;
      case 'minor':
        newVersion = `${major}.${minor + 1}.0`;
        break;
      case 'patch':
        newVersion = `${major}.${minor}.${patch + 1}`;
        break;
    }

    const now = new Date().toISOString();
    const newPrompt: GovernedPrompt = {
      ...existing,
      ...request.changes,
      id: asPromptId(uuidv4()),
      version: newVersion,
      previousVersionId: existing.id,
      status: PromptStatus.DRAFT,
      approval: undefined,
      createdBy: actor,
      createdAt: now,
      updatedBy: actor,
      updatedAt: now,
    };

    // Deprecate old version if it was approved
    if (existing.status === PromptStatus.APPROVED) {
      await this.storage.save({
        ...existing,
        status: PromptStatus.DEPRECATED,
        updatedBy: actor,
        updatedAt: now,
      });
    }

    await this.storage.save(newPrompt);
    return aiOk(newPrompt);
  }

  /**
   * Get an approved prompt by domain and name
   */
  async getActivePrompt(
    domain: CopilotDomain,
    name: string
  ): Promise<AIResult<GovernedPrompt, PromptNotFoundError>> {
    const prompt = await this.storage.getByDomainAndName(domain, name);
    if (!prompt) {
      return aiErr({
        code: 'PROMPT_NOT_FOUND',
        message: `No active prompt found for ${domain}/${name}`,
        promptId: `${domain}/${name}`,
        retryable: false,
      });
    }
    return aiOk(prompt);
  }

  /**
   * Compile a prompt with variable substitution
   */
  async compilePrompt(
    promptId: PromptId,
    variables: Record<string, unknown>,
    modelOverride?: string
  ): Promise<AIResult<CompiledPrompt, PromptNotFoundError | PromptCompilationError>> {
    const prompt = await this.storage.get(promptId);
    if (!prompt) {
      return aiErr({
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt ${promptId} not found`,
        promptId,
        retryable: false,
      });
    }

    // Check for missing required variables
    const missingVariables = prompt.variables
      .filter(v => v.required && !(v.name in variables) && v.defaultValue === undefined)
      .map(v => v.name);

    if (missingVariables.length > 0) {
      return aiErr({
        code: 'PROMPT_COMPILATION_ERROR',
        message: 'Missing required variables',
        missingVariables,
        retryable: false,
      });
    }

    // Build complete variables with defaults
    const completeVariables: Record<string, unknown> = {};
    for (const v of prompt.variables) {
      completeVariables[v.name] = variables[v.name] ?? v.defaultValue;
    }

    // Substitute variables in template
    let userPrompt = prompt.template;
    for (const [key, value] of Object.entries(completeVariables)) {
      const placeholder = `{{${key}}}`;
      userPrompt = userPrompt.replaceAll(placeholder, String(value));
    }

    // Determine model
    const modelId = modelOverride 
      ?? prompt.modelConstraints.allowedModels?.[0] 
      ?? this.defaultModelId;

    const compiled: CompiledPrompt = {
      promptId: prompt.id,
      version: prompt.version,
      systemPrompt: prompt.systemPrompt ?? '',
      userPrompt,
      modelConfig: {
        modelId,
        maxTokens: prompt.modelConstraints.maxResponseTokens ?? 4096,
        temperature: prompt.modelConstraints.temperature ?? 0.7,
        topP: prompt.modelConstraints.topP,
      },
      guardrails: prompt.guardrails,
    };

    return aiOk(compiled);
  }

  /**
   * List all prompts for a domain
   */
  async listByDomain(domain: CopilotDomain): Promise<GovernedPrompt[]> {
    return this.storage.list({ domain });
  }

  /**
   * Get prompt by ID
   */
  async getById(promptId: PromptId): Promise<AIResult<GovernedPrompt, PromptNotFoundError>> {
    const prompt = await this.storage.get(promptId);
    if (!prompt) {
      return aiErr({
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt ${promptId} not found`,
        promptId,
        retryable: false,
      });
    }
    return aiOk(prompt);
  }
}

/**
 * Factory function to create a prompt registry with default storage
 */
export function createPromptRegistry(
  storage?: PromptStorageBackend,
  defaultModelId?: string
): PromptRegistry {
  return new PromptRegistry(
    storage ?? new InMemoryPromptStorage(),
    defaultModelId
  );
}
