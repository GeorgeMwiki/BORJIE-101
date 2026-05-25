/**
 * DeepSeek provider — production implementation.
 *
 * DeepSeek exposes an OpenAI-compatible `/chat/completions` endpoint so this
 * provider reuses the OpenAI request shape, only swapping the base URL +
 * auth. It's the cheapest tier in the multi-LLM router; intended for batch
 * extraction and bulk non-latency-critical jobs.
 *
 * Ported from LitFin's multi-LLM substrate (2026).
 */

import { AIResult, aiOk, aiErr, asModelId } from '../types/core.types.js';
import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
  ModelInfo,
} from './ai-provider.js';

export interface DeepSeekProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultTimeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
}

/**
 * Canonical DeepSeek chat model IDs.
 */
export const DEEPSEEK_MODELS = {
  CHAT: 'deepseek-chat',
  REASONER: 'deepseek-reasoner',
} as const;

export type DeepSeekModelId =
  (typeof DEEPSEEK_MODELS)[keyof typeof DEEPSEEK_MODELS];

export class DeepSeekProvider implements AIProvider {
  readonly providerId = 'deepseek';
  readonly supportedModels: string[] = [
    DEEPSEEK_MODELS.CHAT,
    DEEPSEEK_MODELS.REASONER,
  ];

  private readonly config: DeepSeekProviderConfig;
  private readonly modelInfoMap: Map<string, ModelInfo>;

  constructor(config: DeepSeekProviderConfig) {
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      throw new Error(
        'DeepSeekProvider: apiKey is required (set DEEPSEEK_API_KEY).'
      );
    }
    this.config = config;
    this.modelInfoMap = new Map<string, ModelInfo>([
      [
        DEEPSEEK_MODELS.CHAT,
        {
          id: DEEPSEEK_MODELS.CHAT,
          displayName: 'DeepSeek Chat',
          contextWindow: 64_000,
          maxOutputTokens: 8_000,
          supportsJson: true,
          supportsVision: false,
          costPer1kPromptTokens: 0.00014,
          costPer1kCompletionTokens: 0.00028,
          tier: 'basic',
        },
      ],
      [
        DEEPSEEK_MODELS.REASONER,
        {
          id: DEEPSEEK_MODELS.REASONER,
          displayName: 'DeepSeek Reasoner',
          contextWindow: 64_000,
          maxOutputTokens: 8_000,
          supportsJson: true,
          supportsVision: false,
          costPer1kPromptTokens: 0.00055,
          costPer1kCompletionTokens: 0.0022,
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
      DEEPSEEK_MODELS.CHAT;
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
  ): Promise<AIResult<DeepSeekChatResponse, AIProviderError>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `${this.config.baseUrl ?? 'https://api.deepseek.com'}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
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
      const data = (await response.json()) as DeepSeekChatResponse;
      return aiOk(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return aiErr({
          code: 'TIMEOUT',
          message: `DeepSeek request timed out after ${timeoutMs}ms`,
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
  ): Promise<AIResult<DeepSeekChatResponse, AIProviderError>> {
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
        message: 'unknown deepseek failure',
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
        message: `DeepSeek rate limited: ${msg}`,
        provider: this.providerId,
        statusCode,
        retryable: true,
      });
    }
    if (statusCode === 400 && /context|token|length/i.test(msg)) {
      return aiErr({
        code: 'CONTEXT_LENGTH',
        message: `DeepSeek context length exceeded: ${msg}`,
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
    return true; // DeepSeek has no cheap /models endpoint; trust config.
  }
}

interface DeepSeekChatResponse {
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
