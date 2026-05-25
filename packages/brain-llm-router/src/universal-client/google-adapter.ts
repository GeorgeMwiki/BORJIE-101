/**
 * Google Gemini API adapter — `generateContent` endpoint.
 *
 * Translates Anthropic-style messages -> Gemini `contents` (role + parts).
 * Translates Gemini candidates -> Anthropic-style content blocks.
 *
 * Gemini does not emit thinking blocks (no equivalent of Claude's extended-
 * thinking). The adapter stubs an empty thinking block if `req.thinking` was
 * requested, so cross-provider continuity is preserved.
 */

import type {
  BrainLLMClient,
  BrainLLMMessage,
  BrainLLMRequest,
  BrainLLMResponse,
  ContentBlock,
  ProviderName,
  TextBlock,
  ToolUseBlock,
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

export interface GoogleAdapterConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchFn?: FetchFn;
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleAdapter implements BrainLLMClient {
  public readonly provider: ProviderName = 'google';

  constructor(private readonly config: GoogleAdapterConfig) {}

  async invoke(req: BrainLLMRequest): Promise<BrainLLMResponse> {
    requireMessages(req, this.provider);
    const started = Date.now();
    const model = stripCloudSuffix(stripProviderPrefix(req.model));

    const payload = this.buildPayload(req);
    const url = `${this.config.baseUrl ?? DEFAULT_BASE_URL}/models/${model}:generateContent?key=${this.config.apiKey}`;
    const fetchFn = this.config.fetchFn ?? (globalThis.fetch as unknown as FetchFn);

    const { body } = await adapterFetchJson(this.provider, url, {
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      fetchFn,
    });

    const latencyMs = Date.now() - started;
    return this.parseResponse(body, model, latencyMs, req.thinking !== undefined);
  }

  private buildPayload(req: BrainLLMRequest): Record<string, unknown> {
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => this.translateMessageOut(m));

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxTokens ?? 4096,
    };
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.stopSequences !== undefined) generationConfig.stopSequences = req.stopSequences;

    const payload: Record<string, unknown> = { contents, generationConfig };
    if (req.system !== undefined) {
      payload.systemInstruction = { parts: [{ text: req.system }] };
    }
    if (req.tools !== undefined) {
      payload.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
    }
    return payload;
  }

  /** Anthropic-style message -> Gemini `Content` (role + parts). */
  private translateMessageOut(msg: BrainLLMMessage): Record<string, unknown> {
    const parts: Array<Record<string, unknown>> = [];
    for (const c of msg.content) {
      if (c.type === 'text') {
        parts.push({ text: c.text });
      } else if (c.type === 'tool_use') {
        parts.push({ functionCall: { name: c.name, args: c.input } });
      } else if (c.type === 'tool_result') {
        parts.push({
          functionResponse: {
            name: c.tool_use_id,
            response: { content: c.content, isError: c.is_error ?? false },
          },
        });
      }
      // thinking blocks dropped (Gemini does not consume them).
    }
    // Gemini uses 'model' instead of 'assistant'.
    const role = msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role;
    return { role, parts };
  }

  private parseResponse(body: unknown, model: string, latencyMs: number, thinkingRequested: boolean): BrainLLMResponse {
    const baseResp = { ...blankResponse(this.provider, model, latencyMs), model };
    if (!isRecord(body)) return baseResp;

    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const first = candidates[0];
    const content: ContentBlock[] = [];

    if (thinkingRequested) {
      content.push({ type: 'thinking', thinking: '' });
    }

    if (isRecord(first) && isRecord(first.content) && Array.isArray(first.content.parts)) {
      for (const p of first.content.parts) {
        if (!isRecord(p)) continue;
        if (typeof p.text === 'string') {
          const block: TextBlock = { type: 'text', text: p.text };
          content.push(block);
        } else if (isRecord(p.functionCall)) {
          const fc = p.functionCall;
          const input = isRecord(fc.args) ? fc.args : {};
          const block: ToolUseBlock = {
            type: 'tool_use',
            id: `gemini_tool_${content.length}`,
            name: typeof fc.name === 'string' ? fc.name : 'unknown',
            input,
          };
          content.push(block);
        }
      }
    }

    const meta = isRecord(body.usageMetadata) ? body.usageMetadata : {};
    const usage = safeUsage(
      typeof meta.promptTokenCount === 'number' ? meta.promptTokenCount : undefined,
      typeof meta.candidatesTokenCount === 'number' ? meta.candidatesTokenCount : undefined
    );

    const finishReason =
      isRecord(first) && typeof first.finishReason === 'string' ? first.finishReason : 'STOP';
    const stopReason: BrainLLMResponse['stopReason'] =
      finishReason === 'MAX_TOKENS'
        ? 'max_tokens'
        : content.some((c) => c.type === 'tool_use')
          ? 'tool_use'
          : 'end_turn';

    return {
      id: baseResp.id,
      model,
      provider: this.provider,
      content,
      stopReason,
      usage,
      latencyMs,
    };
  }
}
