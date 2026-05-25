/**
 * OpenAI provider — production implementation.
 *
 * Implements `AIProvider` so it plugs into the existing registry and router
 * alongside the Anthropic provider. Uses `fetch` directly (same pattern as
 * `anthropic.ts`) to keep the package light on SDK dependencies and so the
 * unit tests can stub network deterministically.
 *
 * Ported from LitFin's multi-LLM substrate (2026). Adds:
 *  - Retry with exponential backoff on 429 / 5xx
 *  - Timeout handling
 *  - Model catalog covering the cheap conversation tier (`gpt-4o-mini`)
 *    used by `multi-llm-router.ts`
 *
 * The legacy `OpenAIProvider` class in `ai-provider.ts` predates this one;
 * this module exports a richer, production-oriented implementation named
 * `OpenAIChatProvider` so both can co-exist during migration.
 */

import { AIResult, aiOk, aiErr, asModelId } from '../types/core.types.js';
import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
  ModelInfo,
} from './ai-provider.js';

export interface OpenAIChatProviderConfig {
  apiKey: string;
  organization?: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultTimeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
}

/**
 * Canonical OpenAI chat model IDs used by the router.
 */
export const OPENAI_MODELS = {
  GPT_4O: 'gpt-4o',
  GPT_4O_MINI: 'gpt-4o-mini',
  GPT_4_TURBO: 'gpt-4-turbo',
} as const;

export type OpenAIModelId = (typeof OPENAI_MODELS)[keyof typeof OPENAI_MODELS];

export class OpenAIChatProvider implements AIProvider {
  readonly providerId = 'openai';
  readonly supportedModels: string[] = [
    OPENAI_MODELS.GPT_4O,
    OPENAI_MODELS.GPT_4O_MINI,
    OPENAI_MODELS.GPT_4_TURBO,
  ];

  private readonly config: OpenAIChatProviderConfig;
  private readonly modelInfoMap: Map<string, ModelInfo>;

  constructor(config: OpenAIChatProviderConfig) {
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      throw new Error(
        'OpenAIChatProvider: apiKey is required (set OPENAI_API_KEY).'
      );
    }
    this.config = config;
    this.modelInfoMap = new Map<string, ModelInfo>([
      [
        OPENAI_MODELS.GPT_4O,
        {
          id: OPENAI_MODELS.GPT_4O,
          displayName: 'GPT-4o',
          contextWindow: 128_000,
          maxOutputTokens: 16_000,
          supportsJson: true,
          supportsVision: true,
          costPer1kPromptTokens: 0.005,
          costPer1kCompletionTokens: 0.015,
          tier: 'advanced',
        },
      ],
      [
        OPENAI_MODELS.GPT_4O_MINI,
        {
          id: OPENAI_MODELS.GPT_4O_MINI,
          displayName: 'GPT-4o mini',
          contextWindow: 128_000,
          maxOutputTokens: 16_000,
          supportsJson: true,
          supportsVision: true,
          costPer1kPromptTokens: 0.00015,
          costPer1kCompletionTokens: 0.0006,
          tier: 'basic',
        },
      ],
      [
        OPENAI_MODELS.GPT_4_TURBO,
        {
          id: OPENAI_MODELS.GPT_4_TURBO,
          displayName: 'GPT-4 Turbo',
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          supportsJson: true,
          supportsVision: true,
          costPer1kPromptTokens: 0.01,
          costPer1kCompletionTokens: 0.03,
          tier: 'standard',
        },
      ],
    ]);
  }

  async complete(
    request: AICompletionRequest
  ): Promise<AIResult<AICompletionResponse, AIProviderError>> {
    const startTime = Date.now();
    const modelId =
      request.modelOverride ??
      request.prompt.modelConfig.modelId ??
      this.config.defaultModel ??
      OPENAI_MODELS.GPT_4O_MINI;
    const timeoutMs =
      request.timeoutMs ?? this.config.defaultTimeoutMs ?? 60_000;

    const messages: Array<{ role: string; content: string }> = [];
    if (request.prompt.systemPrompt) {
      messages.push({ role: 'system', content: request.prompt.systemPrompt });
    }
    const userContent = request.additionalContext
      ? `${request.prompt.userPrompt}\n\n${request.additionalContext}`
      : request.prompt.userPrompt;
    messages.push({ role: 'user', content: userContent });

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      max_tokens: request.prompt.modelConfig.maxTokens ?? 4096,
      temperature:
        request.temperatureOverride ??
        request.prompt.modelConfig.temperature ??
        0.7,
    };
    if (request.prompt.modelConfig.topP !== undefined) {
      body.top_p = request.prompt.modelConfig.topP;
    }
    if (request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const result = await this.requestWithRetry(body, timeoutMs);
    if (!result.success) {
      return aiErr((result as { success: false; error: AIProviderError }).error);
    }
    const data = result.data;

    const content = data.choices?.[0]?.message?.content ?? '';
    let parsedJson: unknown;
    if (request.jsonMode) parsedJson = safeJsonParse(content);

    const finishReason = mapStopReason(data.choices?.[0]?.finish_reason);
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;

    return aiOk({
      content,
      parsedJson,
      modelId: asModelId(modelId),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      processingTimeMs: Date.now() - startTime,
      finishReason,
    });
  }

  private async requestOnce(
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<AIResult<OpenAIChatResponse, AIProviderError>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `${this.config.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
            ...(this.config.organization
              ? { 'OpenAI-Organization': this.config.organization }
              : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        return this.handleApiError(response.status, err);
      }
      const data = (await response.json()) as OpenAIChatResponse;
      return aiOk(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return aiErr({
          code: 'TIMEOUT',
          message: `OpenAI request timed out after ${timeoutMs}ms`,
          provider: this.providerId,
          retryable: true,
        });
      }
      return aiErr({
        code: 'PROVIDER_ERROR',
        message: error instanceof Error ? error.message : String(error),
        provider: this.providerId,
        retryable: true,
      });
    }
  }

  private async requestWithRetry(
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<AIResult<OpenAIChatResponse, AIProviderError>> {
    const maxRetries = this.config.maxRetries ?? 3;
    const baseMs = this.config.retryBaseMs ?? 500;
    let last: AIProviderError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const r = await this.requestOnce(body, timeoutMs);
      if (r.success) return r;
      const err = (r as { success: false; error: AIProviderError }).error;
      last = err;
      if (!err.retryable || attempt === maxRetries) return aiErr(err);
      const wait = baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
      await new Promise((res) => setTimeout(res, wait));
    }
    return aiErr(
      last ?? {
        code: 'PROVIDER_ERROR',
        message: 'unknown openai failure',
        provider: this.providerId,
        retryable: false,
      }
    );
  }

  private handleApiError(
    statusCode: number,
    body: Record<string, unknown>
  ): AIResult<never, AIProviderError> {
    const msg = String(
      (body.error as Record<string, unknown>)?.message ?? 'API error'
    );
    if (statusCode === 429) {
      return aiErr({
        code: 'RATE_LIMIT',
        message: `OpenAI rate limited: ${msg}`,
        provider: this.providerId,
        statusCode,
        retryable: true,
      });
    }
    if (statusCode === 400 && /context|token|length/i.test(msg)) {
      return aiErr({
        code: 'CONTEXT_LENGTH',
        message: `OpenAI context length exceeded: ${msg}`,
        provider: this.providerId,
        statusCode,
        retryable: false,
      });
    }
    return aiErr({
      code: 'PROVIDER_ERROR',
      message: msg,
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
    if (!this.config.apiKey) return false;
    try {
      const response = await fetch(
        `${this.config.baseUrl ?? 'https://api.openai.com'}/v1/models`,
        {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function mapStopReason(
  raw: string | undefined
): 'stop' | 'length' | 'content_filter' | 'error' | 'tool_use' {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'stop';
  }
}

function safeJsonParse(content: string): unknown {
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : content;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return undefined;
  }
}
