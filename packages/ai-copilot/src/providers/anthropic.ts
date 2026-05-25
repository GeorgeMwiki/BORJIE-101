/**
 * Anthropic Provider — production implementation.
 *
 * Provides access to Claude Opus, Sonnet, and Haiku models — the reasoning
 * substrate for the Borjie Brain.
 *
 * Production capabilities:
 *  - Tool-use (Anthropic Messages API `tools` + `tool_use` content blocks)
 *  - Multi-turn (caller passes `priorMessages` so we can iterate the
 *    tool-call loop with `tool_result` blocks)
 *  - Retry with exponential backoff on 429 / 5xx
 *  - Honest error surfacing (no silent fallbacks)
 *
 * Pairs with `advisor.ts` to implement the Anthropic Advisor Pattern (2026).
 */

import { AIResult, aiOk, aiErr, asModelId } from '../types/core.types.js';
import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
  ModelInfo,
  AIContentBlock,
  AIMessage,
} from './ai-provider.js';
import { applyPrefixCache } from './anthropic-prefix-cache.js';

/**
 * Anthropic provider configuration
 */
export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultTimeoutMs?: number;
  /** Anthropic API version (anthropic-version header) */
  apiVersion?: string;
  /** Max retry attempts on 429 / 5xx. Default 4. */
  maxRetries?: number;
  /** Base backoff (ms). Each retry: base * 2^attempt + jitter. Default 500. */
  retryBaseMs?: number;
}

/**
 * Anthropic model identifiers (2026 Messages API).
 */
export const ANTHROPIC_MODELS = {
  OPUS_4_6: 'claude-opus-4-6',
  SONNET_4_6: 'claude-sonnet-4-6',
  HAIKU_4_5: 'claude-haiku-4-5-20251001',
} as const;

export type AnthropicModelId =
  (typeof ANTHROPIC_MODELS)[keyof typeof ANTHROPIC_MODELS];

const DEFAULT_API_VERSION = '2023-06-01';

export class AnthropicProvider implements AIProvider {
  readonly providerId = 'anthropic';
  readonly supportedModels: string[] = [
    ANTHROPIC_MODELS.OPUS_4_6,
    ANTHROPIC_MODELS.SONNET_4_6,
    ANTHROPIC_MODELS.HAIKU_4_5,
  ];

  private config: Required<
    Pick<AnthropicProviderConfig, 'apiKey'>
  > &
    Omit<AnthropicProviderConfig, 'apiKey'>;
  private modelInfoMap: Map<string, ModelInfo>;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      throw new Error(
        'AnthropicProvider: apiKey is required (set ANTHROPIC_API_KEY).'
      );
    }
    this.config = config;
    this.modelInfoMap = new Map([
      [
        ANTHROPIC_MODELS.OPUS_4_6,
        {
          id: ANTHROPIC_MODELS.OPUS_4_6,
          displayName: 'Claude Opus 4.6',
          contextWindow: 1_000_000,
          maxOutputTokens: 64_000,
          supportsJson: true,
          supportsVision: true,
          costPer1kPromptTokens: 0.015,
          costPer1kCompletionTokens: 0.075,
          tier: 'advanced',
        },
      ],
      [
        ANTHROPIC_MODELS.SONNET_4_6,
        {
          id: ANTHROPIC_MODELS.SONNET_4_6,
          displayName: 'Claude Sonnet 4.6',
          contextWindow: 1_000_000,
          maxOutputTokens: 64_000,
          supportsJson: true,
          supportsVision: true,
          costPer1kPromptTokens: 0.003,
          costPer1kCompletionTokens: 0.015,
          tier: 'standard',
        },
      ],
      [
        ANTHROPIC_MODELS.HAIKU_4_5,
        {
          id: ANTHROPIC_MODELS.HAIKU_4_5,
          displayName: 'Claude Haiku 4.5',
          contextWindow: 200_000,
          maxOutputTokens: 32_000,
          supportsJson: true,
          supportsVision: true,
          costPer1kPromptTokens: 0.0008,
          costPer1kCompletionTokens: 0.004,
          tier: 'basic',
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
      ANTHROPIC_MODELS.SONNET_4_6;
    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs ?? 60_000;

    // Build messages — either use priorMessages (multi-turn / tool loop) or
    // construct a single-shot user message from the prompt.
    const messages: Array<{
      role: 'user' | 'assistant';
      content: string | AIContentBlock[];
    }> = request.priorMessages
      ? request.priorMessages.map((m) => ({ role: m.role, content: m.content }))
      : [
          {
            role: 'user',
            content: request.additionalContext
              ? `${request.prompt.userPrompt}\n\n${request.additionalContext}`
              : request.prompt.userPrompt,
          },
        ];

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: request.prompt.modelConfig.maxTokens ?? 4096,
      temperature:
        request.temperatureOverride ??
        request.prompt.modelConfig.temperature ??
        0.7,
      messages,
    };
    if (request.prompt.systemPrompt) body.system = request.prompt.systemPrompt;
    if (request.prompt.modelConfig.topP !== undefined)
      body.top_p = request.prompt.modelConfig.topP;

    // Anthropic enforces `^[a-zA-Z0-9_-]{1,128}$` on every tool name. Our
    // internal skill names use dotted segments (e.g. `skill.maintenance.triage`)
    // so we sanitize on the way out and reverse the mapping when a `tool_use`
    // block references the sanitized name. The mapping is deterministic
    // (dot → `__`, colon → `___`) so it round-trips 1:1.
    const sanitizeToolName = (name: string): string =>
      name.replace(/\./g, '__').replace(/:/g, '___');
    const restoreToolName = (name: string): string =>
      name.replace(/___/g, ':').replace(/__/g, '.');

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: sanitizeToolName(t.name),
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    // A2b-2 wire #10a — Anthropic prompt-cache breakpoints. Marks the
    // system prompt + tools array as `cache_control: ephemeral` so
    // repeat turns reuse the same prefix at ~80% cost reduction. The
    // policy honours the 1-2 breakpoint recommendation (max 4) and
    // never mutates the input — `applyPrefixCache` returns a fresh
    // body that we re-assign before the retry loop.
    const prefixCacheResult = applyPrefixCache(
      body as Parameters<typeof applyPrefixCache>[0],
      {},
    );
    const cachedBody = prefixCacheResult.body as Record<string, unknown>;
    const result = await this.requestWithRetry(cachedBody, timeoutMs);
    if (!result.success) {
      const e = (result as { success: false; error: AIProviderError }).error;
      return aiErr(e);
    }
    const data = result.data;

    const rawContent: AIContentBlock[] = Array.isArray(data.content)
      ? data.content.map((b) => normalizeContentBlock(b))
      : [];

    const content = rawContent
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolCalls = rawContent.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use'
    );

    let parsedJson: unknown = undefined;
    if (request.jsonMode) parsedJson = safeJsonParse(content);

    const finishReason = mapStopReason(data.stop_reason);
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    // A2b-2 wire #10a — surface prompt-cache telemetry. Anthropic returns
    // `cache_creation_input_tokens` (one-time write cost) and
    // `cache_read_input_tokens` (cache hits billed at ~10% rate) on every
    // response when at least one `cache_control` marker was sent. The fields
    // are absent for non-cached turns — only populate `cacheStats` when at
    // least one counter is present so callers can distinguish "no cache"
    // from "cache miss".
    const cacheCreation = data.usage?.cache_creation_input_tokens;
    const cacheRead = data.usage?.cache_read_input_tokens;
    const cacheStats =
      cacheCreation !== undefined || cacheRead !== undefined
        ? {
            cacheCreationInputTokens: cacheCreation ?? 0,
            cacheReadInputTokens: cacheRead ?? 0,
          }
        : undefined;

    return aiOk({
      content,
      parsedJson,
      modelId: asModelId(modelId),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        ...(cacheStats ? { cacheStats } : {}),
      },
      processingTimeMs: Date.now() - startTime,
      finishReason,
      toolCalls: toolCalls.length
        ? toolCalls.map((c) => ({
            id: c.id,
            name: restoreToolName(c.name),
            input: c.input,
          }))
        : undefined,
      rawContent,
    });
  }

  /**
   * Single fetch with timeout. Caller wraps in retry loop.
   */
  private async requestOnce(
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<
    AIResult<
      {
        content?: Array<Record<string, unknown>>;
        stop_reason?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      },
      AIProviderError
    >
  > {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': this.config.apiVersion ?? DEFAULT_API_VERSION,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errorBody = (await response
          .json()
          .catch(() => ({}))) as Record<string, unknown>;
        return this.handleApiError(response.status, errorBody);
      }
      const data = (await response.json()) as {
        content?: Array<Record<string, unknown>>;
        stop_reason?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
      return aiOk(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return aiErr({
          code: 'TIMEOUT',
          message: `Anthropic request timed out after ${timeoutMs}ms`,
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

  /**
   * Retry wrapper. Exponential backoff on retryable errors only.
   */
  private async requestWithRetry(
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<
    AIResult<
      {
        content?: Array<Record<string, unknown>>;
        stop_reason?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      },
      AIProviderError
    >
  > {
    const maxRetries = this.config.maxRetries ?? 4;
    const baseMs = this.config.retryBaseMs ?? 500;
    let lastErr: AIProviderError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.requestOnce(body, timeoutMs);
      if (result.success) return result;
      const err = (result as { success: false; error: AIProviderError }).error;
      lastErr = err;
      if (!err.retryable || attempt === maxRetries) return aiErr(err);
      // Exponential backoff with jitter
      const wait = baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
      await new Promise((r) => setTimeout(r, wait));
    }
    return aiErr(
      lastErr ?? {
        code: 'PROVIDER_ERROR',
        message: 'unknown anthropic failure',
        provider: this.providerId,
        retryable: false,
      }
    );
  }

  private handleApiError(
    statusCode: number,
    errorBody: Record<string, unknown>
  ): AIResult<never, AIProviderError> {
    const errorObj = (errorBody.error as Record<string, unknown>) ?? {};
    const errorMessage = String(errorObj.message ?? 'API error');

    if (statusCode === 429) {
      return aiErr({
        code: 'RATE_LIMIT',
        message: `Anthropic rate limited: ${errorMessage}`,
        provider: this.providerId,
        statusCode,
        retryable: true,
      });
    }
    if (statusCode === 400 && /context|token|length/i.test(errorMessage)) {
      return aiErr({
        code: 'CONTEXT_LENGTH',
        message: `Anthropic context length exceeded: ${errorMessage}`,
        provider: this.providerId,
        statusCode,
        retryable: false,
      });
    }
    return aiErr({
      code: 'PROVIDER_ERROR',
      message: errorMessage,
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

  /**
   * Honest health check — issues a tiny `messages` call. Returns false on
   * any non-2xx so callers can route around an outage. Costs ~5 tokens.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    const probe = await this.requestOnce(
      {
        model:
          this.config.defaultModel ?? ANTHROPIC_MODELS.HAIKU_4_5,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
      this.config.defaultTimeoutMs ?? 5_000
    );
    return probe.success;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeContentBlock(b: Record<string, unknown>): AIContentBlock {
  const type = String(b.type ?? '');
  if (type === 'text') {
    return { type: 'text', text: String(b.text ?? '') };
  }
  if (type === 'tool_use') {
    return {
      type: 'tool_use',
      id: String(b.id ?? ''),
      name: String(b.name ?? ''),
      input: (b.input as Record<string, unknown>) ?? {},
    };
  }
  if (type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: String(b.tool_use_id ?? ''),
      content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
      is_error: Boolean(b.is_error),
    };
  }
  return { type: 'text', text: '' };
}

function mapStopReason(
  raw: string | undefined
): 'stop' | 'length' | 'content_filter' | 'error' | 'tool_use' {
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
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

/**
 * Helper: build a `tool_result` user-message turn to feed back into the model
 * after dispatching tool calls. Used by the orchestrator's tool-call loop.
 */
export function buildToolResultMessage(
  results: Array<{ toolUseId: string; content: string; isError?: boolean }>
): AIMessage {
  return {
    role: 'user',
    content: results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.toolUseId,
      content: r.content,
      is_error: r.isError,
    })),
  };
}
