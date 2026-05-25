/**
 * Budget guard for LLM providers — Wave 9 enterprise polish.
 *
 * Wraps an Anthropic-style client so every outgoing `messages.create`:
 *   1. Calls `ledger.assertWithinBudget(tenantId)` FIRST. If the tenant is
 *      over their monthly cap, an `AiBudgetExceededError` is thrown before
 *      the HTTP round-trip.
 *   2. After a successful response, records usage via `ledger.recordUsage`
 *      so the very next call sees the updated spend.
 *
 * The wrapper is a pure factory — it does not mutate the underlying client.
 *
 * Price estimation: callers who know the per-1k-token USD price for a model
 * can supply a `priceEstimator`. When omitted, cost is stored as 0 (tokens
 * are still tracked) so operators can reconcile later.
 */

import type {
  AnthropicClient,
  AnthropicSdkLike,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
} from './anthropic-client.js';
import type { CostLedger } from '../cost-ledger.js';
import { logger } from '../logger.js';

export interface BudgetGuardContext {
  readonly tenantId: string;
  readonly operation?: string;
  readonly correlationId?: string;
}

export interface BudgetGuardedAnthropicClient {
  readonly defaultModel: string;
  readonly sdk: AnthropicSdkLike;
}

export interface PriceEstimator {
  /**
   * Estimate cost in microdollars for an Anthropic call. Returning 0 is
   * valid — tokens are still tracked, the cost column stays zero.
   */
  (input: {
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): number;
}

export interface BudgetGuardOptions {
  readonly ledger: CostLedger;
  /**
   * Resolver that returns the tenant context for a given call. Required —
   * the wrapper cannot know which tenant owns the call otherwise.
   * Usage sites either bind this at construction time (per-tenant client
   * factory) or pass the context via a thread-local-like async accessor.
   */
  readonly context: () => BudgetGuardContext;
  readonly priceEstimator?: PriceEstimator;
  /** Provider label written to the ledger. Default: 'anthropic'. */
  readonly provider?: string;
}

/**
 * Wrap an Anthropic client so every call is guarded by the budget ledger.
 * The returned client is structurally identical to the input — downstream
 * code can't tell the difference.
 */
export function withBudgetGuard(
  inner: AnthropicClient,
  options: BudgetGuardOptions,
): BudgetGuardedAnthropicClient {
  const provider = options.provider ?? 'anthropic';

  const guardedSdk: AnthropicSdkLike = {
    messages: {
      async create(
        request: AnthropicMessageRequest,
      ): Promise<AnthropicMessageResponse> {
        const ctx = options.context();
        if (!ctx || !ctx.tenantId) {
          throw new Error(
            'withBudgetGuard: context() returned no tenantId; cannot guard the call',
          );
        }

        // 1. Pre-flight: throw AiBudgetExceededError if over cap.
        await options.ledger.assertWithinBudget(ctx.tenantId);

        // 2. Execute the underlying call.
        const response = await inner.sdk.messages.create(request);

        // 3. Record usage. Failure to record MUST NOT bubble up to the
        //    caller — the actual call succeeded. We log and swallow.
        const inputTokens = response.usage?.input_tokens ?? 0;
        const outputTokens = response.usage?.output_tokens ?? 0;
        const costUsdMicro =
          options.priceEstimator
            ? Math.max(
                0,
                Math.round(
                  options.priceEstimator({
                    model: request.model,
                    inputTokens,
                    outputTokens,
                  }),
                ),
              )
            : 0;

        try {
          await options.ledger.recordUsage({
            tenantId: ctx.tenantId,
            provider,
            model: request.model,
            inputTokens,
            outputTokens,
            costUsdMicro,
            operation: ctx.operation,
            correlationId: ctx.correlationId,
          });
        } catch (err) {
           
          logger.error('withBudgetGuard: failed to record usage', { error: err instanceof Error ? err.message : err });
        }

        return response;
      },
    },
  };

  return Object.freeze({
    defaultModel: inner.defaultModel,
    sdk: guardedSdk,
  });
}
