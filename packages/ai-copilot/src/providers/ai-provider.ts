/**
 * AI Provider Abstraction
 * 
 * Abstraction layer for different AI model providers.
 * Supports OpenAI, Azure OpenAI, and can be extended for others.
 */

import { AIResult, AIError, aiOk, aiErr, ModelId, asModelId } from '../types/core.types.js';
import { CompiledPrompt } from '../types/prompt.types.js';

/**
 * AI completion request
 */
export interface AICompletionRequest {
  prompt: CompiledPrompt;
  /** Additional context to include */
  additionalContext?: string;
  /** Override model ID */
  modelOverride?: string;
  /** Override temperature */
  temperatureOverride?: number;
  /** JSON mode for structured output */
  jsonMode?: boolean;
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Tool definitions the model may call (Anthropic tool-use). */
  tools?: AIToolDefinition[];
  /**
   * Optional prior turn history. When provided, the provider sends the
   * full conversation including tool_use / tool_result blocks rather than
   * the single-shot user prompt. Required for the orchestrator's
   * tool-call loop to feed results back to the model.
   */
  priorMessages?: AIMessage[];
}

/**
 * Definition of a tool the model may invoke.
 */
export interface AIToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  inputSchema: Record<string, unknown>;
}

/**
 * Conversation message — used to feed history back to the model when
 * iterating a tool-call loop.
 */
export type AIMessage =
  | { role: 'user'; content: string | AIContentBlock[] }
  | { role: 'assistant'; content: string | AIContentBlock[] };

export type AIContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/**
 * AI completion response
 */
export interface AICompletionResponse {
  /** Generated content (text concatenation across text blocks). */
  content: string;
  /** Parsed JSON if jsonMode was true */
  parsedJson?: unknown;
  /** Model used */
  modelId: ModelId;
  /** Token usage */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /**
     * Prompt-cache telemetry (Anthropic prompt caching, A2b-2 wire #10a).
     * Populated when the provider supports prompt-cache breakpoints AND the
     * upstream API returns the counters. `cacheReadInputTokens` are billed at
     * ~10% of `promptTokens`, so this is the truth-source for the 40-90%
     * input-token cost reduction the prefix cache delivers.
     *
     * Optional + nullable-safe: providers that don't support caching omit
     * this field, keeping the existing shape backward-compatible.
     */
    cacheStats?: {
      /** Tokens written to the cache on this turn (one-time creation cost). */
      cacheCreationInputTokens: number;
      /** Tokens that hit the cache and were billed at the reduced rate. */
      cacheReadInputTokens: number;
    };
  };
  /** Processing time in ms */
  processingTimeMs: number;
  /** Finish reason — `tool_use` is added for Anthropic tool-use turns. */
  finishReason: 'stop' | 'length' | 'content_filter' | 'error' | 'tool_use';
  /** Tool calls the model wants executed (Anthropic tool-use). */
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  /**
   * Raw content blocks (text + tool_use). Required when feeding the model's
   * own turn back into a multi-turn conversation alongside tool_result blocks.
   */
  rawContent?: AIContentBlock[];
}

/**
 * Provider error types
 */
export interface AIProviderError extends AIError {
  code: 'PROVIDER_ERROR' | 'RATE_LIMIT' | 'CONTEXT_LENGTH' | 'CONTENT_FILTER' | 'TIMEOUT';
  provider: string;
  statusCode?: number;
}

/**
 * AI Provider interface
 */
export interface AIProvider {
  /** Provider identifier */
  readonly providerId: string;
  /** Supported model IDs */
  readonly supportedModels: string[];
  
  /**
   * Generate a completion
   */
  complete(request: AICompletionRequest): Promise<AIResult<AICompletionResponse, AIProviderError>>;
  
  /**
   * Check if a model is supported
   */
  supportsModel(modelId: string): boolean;
  
  /**
   * Get model information
   */
  getModelInfo(modelId: string): ModelInfo | null;
  
  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsJson: boolean;
  supportsVision: boolean;
  costPer1kPromptTokens: number;
  costPer1kCompletionTokens: number;
  tier: 'basic' | 'standard' | 'advanced';
}

/**
 * OpenAI Provider Configuration
 */
export interface OpenAIProviderConfig {
  apiKey: string;
  organization?: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultTimeoutMs?: number;
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements AIProvider {
  readonly providerId = 'openai';
  readonly supportedModels = [
    'gpt-4-turbo-preview',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-4-32k',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
  ];

  private config: OpenAIProviderConfig;
  private modelInfoMap: Map<string, ModelInfo>;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
    this.modelInfoMap = new Map([
      ['gpt-4-turbo-preview', {
        id: 'gpt-4-turbo-preview',
        displayName: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsJson: true,
        supportsVision: true,
        costPer1kPromptTokens: 0.01,
        costPer1kCompletionTokens: 0.03,
        tier: 'advanced',
      }],
      ['gpt-4-turbo', {
        id: 'gpt-4-turbo',
        displayName: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsJson: true,
        supportsVision: true,
        costPer1kPromptTokens: 0.01,
        costPer1kCompletionTokens: 0.03,
        tier: 'advanced',
      }],
      ['gpt-4', {
        id: 'gpt-4',
        displayName: 'GPT-4',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        supportsJson: true,
        supportsVision: false,
        costPer1kPromptTokens: 0.03,
        costPer1kCompletionTokens: 0.06,
        tier: 'advanced',
      }],
      ['gpt-3.5-turbo', {
        id: 'gpt-3.5-turbo',
        displayName: 'GPT-3.5 Turbo',
        contextWindow: 16385,
        maxOutputTokens: 4096,
        supportsJson: true,
        supportsVision: false,
        costPer1kPromptTokens: 0.0005,
        costPer1kCompletionTokens: 0.0015,
        tier: 'standard',
      }],
    ]);
  }

  async complete(request: AICompletionRequest): Promise<AIResult<AICompletionResponse, AIProviderError>> {
    const startTime = Date.now();
    const modelId = request.modelOverride ?? request.prompt.modelConfig.modelId ?? this.config.defaultModel ?? 'gpt-4-turbo-preview';
    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs ?? 60000;

    try {
      const messages: { role: string; content: string }[] = [];

      // System message
      if (request.prompt.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.prompt.systemPrompt,
        });
      }

      // User message
      let userContent = request.prompt.userPrompt;
      if (request.additionalContext) {
        userContent += `\n\n${request.additionalContext}`;
      }
      messages.push({
        role: 'user',
        content: userContent,
      });

      const requestBody: Record<string, unknown> = {
        model: modelId,
        messages,
        max_tokens: request.prompt.modelConfig.maxTokens,
        temperature: request.temperatureOverride ?? request.prompt.modelConfig.temperature,
      };

      if (request.prompt.modelConfig.topP !== undefined) {
        requestBody.top_p = request.prompt.modelConfig.topP;
      }

      if (request.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.config.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...(this.config.organization && { 'OpenAI-Organization': this.config.organization }),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as Record<string, unknown>;
        return this.handleApiError(response.status, errorBody);
      }

      const data = await response.json() as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      const processingTimeMs = Date.now() - startTime;

      let parsedJson: unknown = undefined;
      if (request.jsonMode) {
        try {
          parsedJson = JSON.parse(content);
        } catch {
          // JSON parsing failed, leave as undefined
        }
      }

      return aiOk({
        content,
        parsedJson,
        modelId: asModelId(modelId),
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        processingTimeMs,
        finishReason: (data.choices?.[0]?.finish_reason ?? 'stop') as 'stop' | 'length' | 'content_filter' | 'error',
      });

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      
      if (error instanceof Error && error.name === 'AbortError') {
        return aiErr({
          code: 'TIMEOUT',
          message: `Request timed out after ${timeoutMs}ms`,
          provider: this.providerId,
          retryable: true,
        });
      }

      return aiErr({
        code: 'PROVIDER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        provider: this.providerId,
        retryable: true,
        details: { processingTimeMs },
      });
    }
  }

  private handleApiError(statusCode: number, errorBody: Record<string, unknown>): AIResult<never, AIProviderError> {
    const errorMessage = (errorBody.error as Record<string, unknown>)?.message ?? 'API error';
    
    if (statusCode === 429) {
      return aiErr({
        code: 'RATE_LIMIT',
        message: `Rate limited: ${errorMessage}`,
        provider: this.providerId,
        statusCode,
        retryable: true,
      });
    }

    if (statusCode === 400 && String(errorMessage).includes('context_length')) {
      return aiErr({
        code: 'CONTEXT_LENGTH',
        message: `Context length exceeded: ${errorMessage}`,
        provider: this.providerId,
        statusCode,
        retryable: false,
      });
    }

    return aiErr({
      code: 'PROVIDER_ERROR',
      message: String(errorMessage),
      provider: this.providerId,
      statusCode,
      retryable: statusCode >= 500,
    });
  }

  supportsModel(modelId: string): boolean {
    return this.supportedModels.includes(modelId);
  }

  getModelInfo(modelId: string): ModelInfo | null {
    return this.modelInfoMap.get(modelId) ?? null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl ?? 'https://api.openai.com'}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Mock AI Provider for testing
 */
export class MockAIProvider implements AIProvider {
  readonly providerId = 'mock';
  readonly supportedModels = ['mock-model'];

  private responses: Map<string, string> = new Map();

  setResponse(promptContains: string, response: string): void {
    this.responses.set(promptContains, response);
  }

  async complete(request: AICompletionRequest): Promise<AIResult<AICompletionResponse, AIProviderError>> {
    const startTime = Date.now();
    
    // Find matching response
    let content = '{"result": "mock response"}';
    for (const [key, value] of this.responses) {
      if (request.prompt.userPrompt.includes(key)) {
        content = value;
        break;
      }
    }

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    let parsedJson: unknown = undefined;
    if (request.jsonMode) {
      try {
        parsedJson = JSON.parse(content);
      } catch {
        // Ignore
      }
    }

    return aiOk({
      content,
      parsedJson,
      modelId: asModelId('mock-model'),
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      processingTimeMs: Date.now() - startTime,
      finishReason: 'stop',
    });
  }

  supportsModel(modelId: string): boolean {
    return modelId === 'mock-model';
  }

  getModelInfo(): ModelInfo | null {
    return {
      id: 'mock-model',
      displayName: 'Mock Model',
      contextWindow: 4096,
      maxOutputTokens: 1024,
      supportsJson: true,
      supportsVision: false,
      costPer1kPromptTokens: 0,
      costPer1kCompletionTokens: 0,
      tier: 'basic',
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * Provider registry for managing multiple providers
 */
export class AIProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderId: string | null = null;

  register(provider: AIProvider, isDefault = false): void {
    this.providers.set(provider.providerId, provider);
    if (isDefault || this.defaultProviderId === null) {
      this.defaultProviderId = provider.providerId;
    }
  }

  get(providerId?: string): AIProvider | null {
    if (providerId) {
      return this.providers.get(providerId) ?? null;
    }
    if (this.defaultProviderId) {
      return this.providers.get(this.defaultProviderId) ?? null;
    }
    return null;
  }

  getForModel(modelId: string): AIProvider | null {
    for (const provider of this.providers.values()) {
      if (provider.supportsModel(modelId)) {
        return provider;
      }
    }
    return null;
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }
}
