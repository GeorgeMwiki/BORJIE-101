/**
 * Anthropic API adapter — the "native" shape; no translation required.
 *
 * Speaks the official Messages API: <https://docs.anthropic.com/en/api/messages>
 * Preserves thinking blocks (with signatures), tool_use blocks, citations.
 */

import type {
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
  ContentBlock,
  ProviderName,
} from '../types.js';
import {
  adapterFetchJson,
  blankResponse,
  isRecord,
  requireMessages,
  safeUsage,
  stripCloudSuffix,
  stripProviderPrefix,
  type FetchFn,
} from './base-adapter.js';

export interface AnthropicAdapterConfig {
  readonly apiKey: string;
  /** Override base URL for Bedrock/Vertex variants. */
  readonly baseUrl?: string;
  /** Injected for tests; defaults to global fetch. */
  readonly fetchFn?: FetchFn;
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

export class AnthropicAdapter implements BrainLLMClient {
  public readonly provider: ProviderName = 'anthropic';

  constructor(private readonly config: AnthropicAdapterConfig) {}

  async invoke(req: BrainLLMRequest): Promise<BrainLLMResponse> {
    requireMessages(req, this.provider);
    const started = Date.now();
    const model = stripCloudSuffix(stripProviderPrefix(req.model));

    const payload = this.buildPayload(req, model);
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    } as const;

    const fetchFn = this.config.fetchFn ?? (globalThis.fetch as unknown as FetchFn);

    const { body } = await adapterFetchJson(this.provider, `${this.config.baseUrl ?? DEFAULT_BASE_URL}/messages`, {
      headers,
      body: payload,
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      fetchFn,
    });

    const latencyMs = Date.now() - started;
    return this.parseResponse(body, model, latencyMs);
  }

  private buildPayload(req: BrainLLMRequest, model: string): Record<string, unknown> {
    const base: Record<string, unknown> = {
      model,
      messages: req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.system !== undefined) base.system = req.system;
    if (req.temperature !== undefined) base.temperature = req.temperature;
    if (req.stopSequences !== undefined) base.stop_sequences = req.stopSequences;
    if (req.tools !== undefined) {
      base.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }
    if (req.thinking !== undefined) {
      base.thinking = { type: 'enabled', budget_tokens: req.thinking.budgetTokens };
    }
    return base;
  }

  private parseResponse(body: unknown, model: string, latencyMs: number): BrainLLMResponse {
    const baseResp = { ...blankResponse(this.provider, model, latencyMs), model };
    if (!isRecord(body)) return baseResp;

    const content: ContentBlock[] = Array.isArray(body.content)
      ? (body.content.filter((c) => isRecord(c)) as unknown as ContentBlock[])
      : [];

    const usageRaw = isRecord(body.usage) ? body.usage : {};
    const usage = safeUsage(
      typeof usageRaw.input_tokens === 'number' ? usageRaw.input_tokens : undefined,
      typeof usageRaw.output_tokens === 'number' ? usageRaw.output_tokens : undefined
    );
    const cacheRead =
      typeof usageRaw.cache_read_input_tokens === 'number' ? usageRaw.cache_read_input_tokens : undefined;
    const cacheWrite =
      typeof usageRaw.cache_creation_input_tokens === 'number'
        ? usageRaw.cache_creation_input_tokens
        : undefined;

    const stopReasonRaw = typeof body.stop_reason === 'string' ? body.stop_reason : 'end_turn';
    const stopReason =
      stopReasonRaw === 'tool_use' || stopReasonRaw === 'max_tokens' || stopReasonRaw === 'stop_sequence'
        ? stopReasonRaw
        : 'end_turn';

    return {
      id: typeof body.id === 'string' ? body.id : baseResp.id,
      model,
      provider: this.provider,
      content,
      stopReason,
      usage: {
        ...usage,
        ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
        ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
      },
      latencyMs,
    };
  }
}
