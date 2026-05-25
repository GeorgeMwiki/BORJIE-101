/**
 * Ollama adapter — self-hosted models behind the standard Ollama HTTP API.
 *
 * Endpoint: `POST /api/chat`. Same message shape as Anthropic (role + content)
 * but content is flat string per message — adapter joins text blocks; thinking
 * blocks dropped; tool_use blocks serialised as JSON for the model to "see".
 */

import type {
  BrainLLMClient,
  BrainLLMMessage,
  BrainLLMRequest,
  BrainLLMResponse,
  ContentBlock,
  ProviderName,
  TextBlock,
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

export interface OllamaAdapterConfig {
  /** Default to localhost. */
  readonly baseUrl?: string;
  readonly fetchFn?: FetchFn;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaAdapter implements BrainLLMClient {
  public readonly provider: ProviderName = 'ollama';

  constructor(private readonly config: OllamaAdapterConfig = {}) {}

  async invoke(req: BrainLLMRequest): Promise<BrainLLMResponse> {
    requireMessages(req, this.provider);
    const started = Date.now();
    const model = stripCloudSuffix(stripProviderPrefix(req.model));

    const payload = this.buildPayload(req, model);
    const fetchFn = this.config.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
    const { body } = await adapterFetchJson(this.provider, `${this.config.baseUrl ?? DEFAULT_BASE_URL}/api/chat`, {
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      fetchFn,
    });

    const latencyMs = Date.now() - started;
    return this.parseResponse(body, model, latencyMs);
  }

  private buildPayload(req: BrainLLMRequest, model: string): Record<string, unknown> {
    const messages = [
      ...(req.system !== undefined ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map((m) => this.flattenMessage(m)),
    ];
    const payload: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      options: {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { num_predict: req.maxTokens } : {}),
        ...(req.stopSequences !== undefined ? { stop: req.stopSequences } : {}),
      },
    };
    return payload;
  }

  private flattenMessage(msg: BrainLLMMessage): Record<string, unknown> {
    const text = msg.content
      .filter((c): c is TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const toolUses = msg.content.filter((c) => c.type === 'tool_use');
    const toolBlock = toolUses.length > 0 ? `\n\n[TOOL_USE]\n${JSON.stringify(toolUses)}` : '';
    return { role: msg.role, content: text + toolBlock };
  }

  private parseResponse(body: unknown, model: string, latencyMs: number): BrainLLMResponse {
    const baseResp = { ...blankResponse(this.provider, model, latencyMs), model };
    if (!isRecord(body)) return baseResp;

    const content: ContentBlock[] = [];
    if (isRecord(body.message) && typeof body.message.content === 'string' && body.message.content.length > 0) {
      content.push({ type: 'text', text: body.message.content });
    }

    const usage = safeUsage(
      typeof body.prompt_eval_count === 'number' ? body.prompt_eval_count : undefined,
      typeof body.eval_count === 'number' ? body.eval_count : undefined
    );

    return {
      id: baseResp.id,
      model,
      provider: this.provider,
      content,
      stopReason: body.done === true ? 'end_turn' : 'max_tokens',
      usage,
      latencyMs,
    };
  }
}
