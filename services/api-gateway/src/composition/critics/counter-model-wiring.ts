/**
 * Counter-model production wiring — Central Command Phase B (B5).
 *
 * Builds a `CounterModel` adapter bound to the api-gateway's wrapped
 * Anthropic client (circuit-breaker + budget-guard already applied at
 * the composition root). The kernel's executor consumes the resulting
 * port through its optional `counterModel` dep — when this factory
 * returns null (no Anthropic client configured) the executor simply
 * skips the second-LLM check and falls back to the legacy approval
 * flow.
 *
 * Coordination with B2 (composition/sovereign.ts owner):
 *   - sovereign.ts already constructs the wrapped Anthropic client
 *     into `anthropic` (after `wrapAnthropicWithCircuitBreaker`). The
 *     wire-in is ONE line inside `createExecutor({...})`:
 *
 *         counterModel: createProductionCounterModel(anthropic),
 *
 *   - Do that for BOTH executor instances (the early `agencyExecutor`
 *     stubbed branch + the `realAgencyExecutor` Drizzle-bound branch)
 *     so the counter-model fires regardless of which branch wins for
 *     the current request.
 */

import {
  counterModel as kernelCounterModel,
  type CounterModel,
  type CounterModelLlmClient,
} from '@borjie/central-intelligence';

export interface ProductionCounterModelConfig {
  readonly modelId?: string;
  readonly maxTokens?: number;
}

/**
 * Build a CounterModel bound to the supplied Anthropic-compatible
 * client. Returns null when `anthropicClient` is null — the executor
 * dep is optional, so missing config means "skip the check" rather
 * than "fail the request".
 */
export function createProductionCounterModel(
  anthropicClient: CounterModelLlmClient | null,
  config: ProductionCounterModelConfig = {},
): CounterModel | null {
  if (!anthropicClient) return null;
  return kernelCounterModel.createCounterModelReview({
    anthropicClient,
    modelId: config.modelId,
    maxTokens: config.maxTokens,
  });
}

/** Test-friendly named export so the wiring test can import the
 *  factory under its plain name without pulling the whole namespace. */
export const productionCounterModel = createProductionCounterModel;
