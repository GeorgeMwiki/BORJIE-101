/**
 * OpenAI Chat Completions adapter.
 *
 * Translates Anthropic-style content blocks IN -> OpenAI messages OUT.
 * Translates OpenAI choices OUT -> Anthropic-style content blocks IN.
 *
 * Thinking blocks: OpenAI exposes reasoning via `reasoning` field on the
 * response (o1/o3 family). For models without reasoning, the adapter stubs
 * a `thinking` block with empty payload to preserve continuity.
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

export interface OpenAIAdapterConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchFn?: FetchFn;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIAdapter implements BrainLLMClient {
  public readonly provider: ProviderName = 'openai';

  constructor(private readonly config: OpenAIAdapterConfig) {}

  async invoke(req: BrainLLMRequest): Promise<BrainLLMResponse> {
    requireMessages(req, this.provider);
    const started = Date.now();
    const model = stripCloudSuffix(stripProviderPrefix(req.model));

    const payload = this.buildPayload(req, model);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    } as const;
    const fetchFn = this.config.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
    const { body } = await adapterFetchJson(this.provider, `${this.config.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`, {
      headers,
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
      ...req.messages.map((m) => this.translateMessageOut(m)),
    ];
    // GPT-5 family + o1/o3 reasoning models require `max_completion_tokens`
    // instead of `max_tokens` (the latter is rejected with HTTP 400
    // "Unsupported parameter"). Detect by model-name prefix.
    const needsCompletionTokens =
      model.startsWith('gpt-5') ||
      model.startsWith('o1') ||
      model.startsWith('o3') ||
      model.startsWith('o4');
    const tokensKey = needsCompletionTokens ? 'max_completion_tokens' : 'max_tokens';
    // GPT-5 reasoning models also reject `temperature` (they sample
    // their own reasoning budget). Filter it out of the request shape.
    const supportsTemperature = !needsCompletionTokens;
    const base: Record<string, unknown> = {
      model,
      messages,
      [tokensKey]: req.maxTokens ?? 4096,
    };
    if (req.temperature !== undefined && supportsTemperature) base.temperature = req.temperature;
    if (req.stopSequences !== undefined) base.stop = req.stopSequences;
    if (req.tools !== undefined) {
      base.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }
    return base;
  }

  /** Anthropic-style message -> OpenAI-style message. */
  private translateMessageOut(msg: BrainLLMMessage): Record<string, unknown> {
    // Pull text + tool_use into OpenAI's flatter shape.
    const textParts = msg.content
      .filter((c): c is TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const toolCalls = msg.content
      .filter((c): c is ToolUseBlock => c.type === 'tool_use')
      .map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.input) },
      }));

    const out: Record<string, unknown> = { role: msg.role, content: textParts };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return out;
  }

  private parseResponse(body: unknown, model: string, latencyMs: number): BrainLLMResponse {
    const baseResp = { ...blankResponse(this.provider, model, latencyMs), model };
    if (!isRecord(body)) return baseResp;

    const choices = Array.isArray(body.choices) ? body.choices : [];
    const firstChoice = choices[0];
    const content: ContentBlock[] = [];

    if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
      const msg = firstChoice.message;
      // Reasoning -> thinking block (preserves cross-provider continuity).
      if (typeof msg.reasoning === 'string' && msg.reasoning.length > 0) {
        content.push({ type: 'thinking', thinking: msg.reasoning });
      }
      if (typeof msg.content === 'string' && msg.content.length > 0) {
        content.push({ type: 'text', text: msg.content });
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (!isRecord(tc) || !isRecord(tc.function)) continue;
          let parsedInput: Record<string, unknown> = {};
          if (typeof tc.function.arguments === 'string') {
            try {
              const parsed = JSON.parse(tc.function.arguments);
              if (isRecord(parsed)) parsedInput = parsed;
            } catch {
              // leave as empty record
            }
          }
          content.push({
            type: 'tool_use',
            id: typeof tc.id === 'string' ? tc.id : 'tool_call_unknown',
            name: typeof tc.function.name === 'string' ? tc.function.name : 'unknown',
            input: parsedInput,
          });
        }
      }
    }

    const usageRaw = isRecord(body.usage) ? body.usage : {};
    const usage = safeUsage(
      typeof usageRaw.prompt_tokens === 'number' ? usageRaw.prompt_tokens : undefined,
      typeof usageRaw.completion_tokens === 'number' ? usageRaw.completion_tokens : undefined
    );

    const finishReason =
      isRecord(firstChoice) && typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : 'stop';
    const stopReason: BrainLLMResponse['stopReason'] =
      finishReason === 'tool_calls'
        ? 'tool_use'
        : finishReason === 'length'
          ? 'max_tokens'
          : finishReason === 'stop'
            ? 'end_turn'
            : 'end_turn';

    return {
      id: typeof body.id === 'string' ? body.id : baseResp.id,
      model,
      provider: this.provider,
      content,
      stopReason,
      usage,
      latencyMs,
    };
  }
}
