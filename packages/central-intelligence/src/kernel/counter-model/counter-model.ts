/**
 * Counter-model — second-LLM sanity check for destroy-tier actions.
 *
 * Central Command Phase B (B5). The HIL pattern from R1:
 *
 *   "Every destroy-tier or billing-tier action gets a second LLM
 *    review BEFORE the approval gate fires. Cheap model (Haiku);
 *    single API call."
 *
 * The reviewer is provider-agnostic — we duck-type a minimal Anthropic
 * Messages client surface so the kernel package keeps zero runtime
 * Anthropic SDK imports. The composition root passes in a real client.
 *
 * Verdicts (see `prompt-template.ts`):
 *   - safe   → executor proceeds with the normal approval flow
 *   - risky  → executor proceeds, but the reason is attached to the
 *              approval payload so the human sees the second opinion
 *   - refuse → executor aborts the step with the counter-model's reason
 *
 * Fallbacks:
 *   - API error / timeout → default to `risky` (safer than failing-open)
 *   - Empty / malformed response → default to `risky`
 *   - Model not configured (no client) → executor SHOULD skip the
 *     counter-model entirely; this module never returns `safe` on
 *     missing config because that would silently re-create the bug we
 *     are trying to close.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import type {
  CounterModelVerdict,
} from './prompt-template.js';
import {
  COUNTER_MODEL_VERDICTS,
  buildCounterModelPrompt,
  parseCounterModelResponse,
} from './prompt-template.js';

export type { CounterModelVerdict };
export { COUNTER_MODEL_VERDICTS };

/**
 * Minimal client surface — mirrors `AnthropicMessagesClient` in the
 * sensors module so the gateway can re-use the same wrapped client
 * (circuit-breaker, budget guard).
 */
export interface CounterModelLlmClient {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: ReadonlyArray<{ role: 'user'; content: string }>;
    }): Promise<{
      readonly content: ReadonlyArray<{ type: string; text?: string }>;
    }>;
  };
}

export interface CounterModelReviewArgs {
  readonly toolName: string;
  readonly payload: Record<string, unknown> | null;
  readonly riskTier?: 'destroy' | 'billing' | 'external-comm' | 'mutate';
  readonly tenantId?: string;
  readonly userId?: string;
  readonly context?: Record<string, unknown>;
}

export interface CounterModelReviewOutcome {
  readonly verdict: CounterModelVerdict;
  readonly reason: string;
  readonly confidence: number;
  readonly modelId: string;
  /** True when the verdict came from the fallback path rather than the
   *  model. The executor uses this for audit metadata so a future
   *  regression check can grep counter-model coverage. */
  readonly fallback: boolean;
}

export interface CounterModel {
  review(
    args: CounterModelReviewArgs,
  ): Promise<CounterModelReviewOutcome>;
}

export interface CounterModelConfig {
  readonly anthropicClient: CounterModelLlmClient;
  readonly modelId?: string;
  readonly maxTokens?: number;
}

export const DEFAULT_COUNTER_MODEL_ID = getModelLatest('haiku');

export function createCounterModelReview(
  config: CounterModelConfig,
): CounterModel {
  const modelId = config.modelId ?? DEFAULT_COUNTER_MODEL_ID;
  const maxTokens = config.maxTokens ?? 256;
  return {
    async review(args) {
      const prompt = buildCounterModelPrompt(args);
      try {
        const response = await config.anthropicClient.messages.create({
          model: modelId,
          max_tokens: maxTokens,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        });
        let body = '';
        for (const block of response.content ?? []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            body += block.text;
          }
        }
        const parsed = parseCounterModelResponse(body);
        return {
          verdict: parsed.verdict,
          reason: parsed.reason,
          confidence: parsed.confidence,
          modelId,
          fallback: false,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          verdict: 'risky',
          reason: `counter-model unavailable (${message}); defaulting to risky`,
          confidence: 0,
          modelId,
          fallback: true,
        };
      }
    },
  };
}
