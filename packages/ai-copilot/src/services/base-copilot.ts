/**
 * Base Copilot Service
 * 
 * Abstract base class for all domain-specific copilots.
 * Handles common functionality like prompt compilation, AI invocation,
 * review determination, and audit logging.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  CopilotRequestId,
  CopilotDomain,
  CopilotRequestStatus,
  CopilotOutputBase,
  RiskLevel,
  ConfidenceLevel,
  AITenantContext,
  AIActor,
  AIRequestContext,
  AIResult,
  AIError,
  asCopilotRequestId,
  asModelId,
  scoreToConfidenceLevel,
  aiOk,
  aiErr,
} from '../types/core.types.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { AIProvider, AIProviderRegistry, AICompletionResponse } from '../providers/ai-provider.js';
import { ReviewService, ReviewRequirement } from './review-service.js';
import { analyzeMessage as analyzePromptShield } from '../security/prompt-shield.js';
import { scanOutput } from '../security/output-guard.js';

/**
 * Copilot invocation error
 */
export interface CopilotError extends AIError {
  code: 'COPILOT_ERROR' | 'PROMPT_ERROR' | 'AI_ERROR' | 'PARSING_ERROR' | 'VALIDATION_ERROR';
  domain: CopilotDomain;
}

/**
 * Copilot invocation options
 */
export interface CopilotInvocationOptions {
  /** Force review regardless of risk/confidence */
  forceReview?: boolean;
  /** Skip auto-approval even if eligible */
  skipAutoApproval?: boolean;
  /** Custom timeout in ms */
  timeoutMs?: number;
  /** Override model */
  modelOverride?: string;
  /** Additional context */
  additionalContext?: string;
}

/**
 * Copilot invocation result
 */
export interface CopilotInvocationResult<T extends CopilotOutputBase> {
  output: T;
  reviewRequirement: ReviewRequirement;
  rawAIResponse: AICompletionResponse;
}

/**
 * Event listener for copilot events
 */
export interface CopilotEventListener {
  onRequestStarted?(requestId: CopilotRequestId, domain: CopilotDomain, tenant: AITenantContext): void;
  onRequestCompleted?(requestId: CopilotRequestId, output: CopilotOutputBase, processingTimeMs: number): void;
  onRequestFailed?(requestId: CopilotRequestId, error: CopilotError): void;
  onReviewRequired?(requestId: CopilotRequestId, requirement: ReviewRequirement): void;
  onAutoApproved?(requestId: CopilotRequestId, reason: string): void;
}

/**
 * Abstract base copilot class
 */
export abstract class BaseCopilot<TInput, TOutput extends CopilotOutputBase> {
  protected promptRegistry: PromptRegistry;
  protected providerRegistry: AIProviderRegistry;
  protected reviewService: ReviewService;
  protected eventListeners: CopilotEventListener[] = [];

  /** The domain this copilot serves */
  abstract readonly domain: CopilotDomain;
  /** The prompt name to use */
  abstract readonly promptName: string;
  /** Default risk level for this copilot */
  abstract readonly defaultRiskLevel: RiskLevel;

  constructor(
    promptRegistry: PromptRegistry,
    providerRegistry: AIProviderRegistry,
    reviewService: ReviewService
  ) {
    this.promptRegistry = promptRegistry;
    this.providerRegistry = providerRegistry;
    this.reviewService = reviewService;
  }

  /**
   * Add an event listener
   */
  addEventListener(listener: CopilotEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: CopilotEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index >= 0) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Transform input into prompt variables
   */
  protected abstract transformInputToVariables(input: TInput): Record<string, unknown>;

  /**
   * Parse AI response into typed output
   */
  protected abstract parseAIResponse(
    response: AICompletionResponse,
    input: TInput,
    requestId: CopilotRequestId
  ): AIResult<TOutput, CopilotError>;

  /**
   * Calculate confidence score from the output
   */
  protected abstract calculateConfidence(output: TOutput): number;

  /**
   * Validate the parsed output
   */
  protected abstract validateOutput(output: TOutput): AIResult<TOutput, CopilotError>;

  /**
   * Main invocation method
   */
  async invoke(
    input: TInput,
    tenant: AITenantContext,
    actor: AIActor,
    requestContext: AIRequestContext,
    options: CopilotInvocationOptions = {}
  ): Promise<AIResult<CopilotInvocationResult<TOutput>, CopilotError>> {
    const requestId = asCopilotRequestId(uuidv4());
    const startTime = Date.now();

    // Notify listeners
    this.eventListeners.forEach(l => l.onRequestStarted?.(requestId, this.domain, tenant));

    try {
      // Get the prompt
      const promptResult = await this.promptRegistry.getActivePrompt(this.domain, this.promptName);
      if (!promptResult.success) {
        const error: CopilotError = {
          code: 'PROMPT_ERROR',
          message: `Prompt not found: ${this.promptName}`,
          domain: this.domain,
          retryable: false,
        };
        this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, error));
        return aiErr(error);
      }

      // Transform input to variables
      const variables = this.transformInputToVariables(input);

      // Round-3 audit H9 fix — run the prompt-shield over every
      // string variable that originated from tenant input BEFORE the
      // LLM call. The shield catches role-override attempts, DAN
      // jailbreaks, base64-decode probes, etc. If the shield blocks
      // the input, we surface a typed error instead of forwarding the
      // crafted prompt to the model.
      for (const [k, v] of Object.entries(variables)) {
        if (typeof v !== 'string' || v.length === 0) continue;
        const shieldResult = analyzePromptShield(v);
        if (shieldResult.blocked) {
          const error: CopilotError = {
            code: 'VALIDATION_ERROR',
            message: `Prompt-shield blocked input variable "${k}" — threat=${shieldResult.threat}.`,
            domain: this.domain,
            retryable: false,
            details: {
              variable: k,
              threat: shieldResult.threat,
              patterns: shieldResult.patterns,
            },
          };
          this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, error));
          return aiErr(error);
        }
        // Substitute the sanitised value when the shield produced
        // one (medium / high threats are NOT blocked but ARE
        // sanitised — strip delimiters / control chars).
        if (shieldResult.sanitized !== v && shieldResult.sanitized.length > 0) {
          variables[k] = shieldResult.sanitized;
        }
      }

      // Compile prompt
      const compileResult = await this.promptRegistry.compilePrompt(
        promptResult.data.id,
        variables,
        options.modelOverride
      );
      if (!compileResult.success) {
        const compileErr = (compileResult as { success: false; error: { message: string } }).error;
        const error: CopilotError = {
          code: 'PROMPT_ERROR',
          message: `Failed to compile prompt: ${compileErr.message}`,
          domain: this.domain,
          retryable: false,
          details: { ...compileErr },
        };
        this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, error));
        return aiErr(error);
      }

      // Get AI provider
      const provider = this.providerRegistry.getForModel(compileResult.data.modelConfig.modelId);
      if (!provider) {
        const error: CopilotError = {
          code: 'AI_ERROR',
          message: `No provider found for model: ${compileResult.data.modelConfig.modelId}`,
          domain: this.domain,
          retryable: false,
        };
        this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, error));
        return aiErr(error);
      }

      // Call AI
      const aiResult = await provider.complete({
        prompt: compileResult.data,
        additionalContext: options.additionalContext,
        jsonMode: true,
        timeoutMs: options.timeoutMs,
      });

      if (!aiResult.success) {
        const aiErrBranch = (aiResult as { success: false; error: { message: string; retryable: boolean } }).error;
        const error: CopilotError = {
          code: 'AI_ERROR',
          message: aiErrBranch.message,
          domain: this.domain,
          retryable: aiErrBranch.retryable,
          details: { ...aiErrBranch },
        };
        this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, error));
        return aiErr(error);
      }

      // Parse response
      const parseResult = this.parseAIResponse(aiResult.data, input, requestId);
      if (!parseResult.success) {
        const parseErr = (parseResult as { success: false; error: CopilotError }).error;
        this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, parseErr));
        return aiErr(parseErr);
      }

      // Validate output
      const validateResult = this.validateOutput(parseResult.data);
      if (!validateResult.success) {
        const validateErr = (validateResult as { success: false; error: CopilotError }).error;
        this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, validateErr));
        return aiErr(validateErr);
      }

      // Calculate confidence
      const confidenceScore = this.calculateConfidence(validateResult.data);
      const confidenceLevel = scoreToConfidenceLevel(confidenceScore);

      // Determine review requirement
      const reviewRequirement = this.reviewService.determineReviewRequirement(
        validateResult.data.riskLevel,
        confidenceLevel,
        this.domain
      );

      // Determine final status
      let status: CopilotRequestStatus;
      if (options.forceReview || (reviewRequirement.required && !options.skipAutoApproval)) {
        status = CopilotRequestStatus.AWAITING_REVIEW;
        this.eventListeners.forEach(l => l.onReviewRequired?.(requestId, reviewRequirement));
      } else if (!reviewRequirement.required) {
        status = CopilotRequestStatus.AUTO_APPROVED;
        this.eventListeners.forEach(l => l.onAutoApproved?.(requestId, reviewRequirement.reason));
      } else {
        status = CopilotRequestStatus.AWAITING_REVIEW;
      }

      // Build final output
      const processingTimeMs = Date.now() - startTime;
      const output: TOutput = {
        ...validateResult.data,
        id: requestId,
        status,
        confidenceScore,
        confidenceLevel,
        requiresReview: reviewRequirement.required,
        modelId: aiResult.data.modelId,
        promptVersion: promptResult.data.version,
        processingTimeMs,
        tokenUsage: aiResult.data.usage,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Notify completion
      this.eventListeners.forEach(l => l.onRequestCompleted?.(requestId, output, processingTimeMs));

      return aiOk({
        output,
        reviewRequirement,
        rawAIResponse: aiResult.data,
      });

    } catch (error) {
      // Round-3 audit H10 fix — run the raw error message through
      // the output-guard so DB schema names, file paths, API keys,
      // and other accidental secret material in stack traces don't
      // leak verbatim into the caller's error surface.
      const rawMessage = error instanceof Error ? error.message : 'Unknown error';
      const scanned = scanOutput(rawMessage);
      const copilotError: CopilotError = {
        code: 'COPILOT_ERROR',
        message: scanned.sanitized || 'Copilot failed with an unexpected error.',
        domain: this.domain,
        retryable: true,
      };
      this.eventListeners.forEach(l => l.onRequestFailed?.(requestId, copilotError));
      return aiErr(copilotError);
    }
  }

  /**
   * Helper to create base output with common fields
   */
  protected createBaseOutput(
    requestId: CopilotRequestId,
    riskLevel: RiskLevel = this.defaultRiskLevel
  ): Partial<CopilotOutputBase> {
    return {
      id: requestId,
      domain: this.domain,
      status: CopilotRequestStatus.PROCESSING,
      riskLevel,
      confidenceScore: 0,
      confidenceLevel: ConfidenceLevel.MEDIUM,
      requiresReview: true,
      modelId: asModelId('unknown'),
      promptVersion: '0.0.0',
      processingTimeMs: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to safely parse JSON from AI response
   */
  protected safeParseJson<T>(
    content: string,
    requestId: CopilotRequestId
  ): AIResult<T, CopilotError> {
    try {
      // Try to extract JSON from the response (handles markdown code blocks)
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1] !== undefined) {
        jsonStr = jsonMatch[1];
      }
      
      const parsed = JSON.parse(jsonStr) as T;
      return aiOk(parsed);
    } catch (error) {
      return aiErr({
        code: 'PARSING_ERROR',
        message: `Failed to parse AI response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
        domain: this.domain,
        retryable: false,
        details: { content: content.substring(0, 500) },
      });
    }
  }
}

/**
 * Copilot factory for creating domain-specific copilots
 */
export interface CopilotFactory {
  createMaintenanceTriageCopilot(): BaseCopilot<unknown, CopilotOutputBase>;
  createOwnerReportingCopilot(): BaseCopilot<unknown, CopilotOutputBase>;
  createCommunicationDraftingCopilot(): BaseCopilot<unknown, CopilotOutputBase>;
  createRiskAlertingCopilot(): BaseCopilot<unknown, CopilotOutputBase>;
}
