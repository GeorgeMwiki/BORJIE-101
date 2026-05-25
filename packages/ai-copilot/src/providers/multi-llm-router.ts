/**
 * Multi-LLM router (Wave 11)
 *
 * Ported from LitFin's multi-provider substrate. Picks the right AI provider
 * per task given:
 *
 *   - task-type         (analysis | conversation | batch | reasoning …)
 *   - cost-budget       (cheap | balanced | premium)
 *   - latency-budget    (fast | normal | slow-ok)
 *   - tenant-tier       (free | growth | enterprise)
 *
 * Rules (most-specific-first):
 *
 *   analysis / reasoning / tool_use  → Anthropic (Sonnet/Opus)
 *   conversation / summarization     → OpenAI    (gpt-4o-mini)
 *   batch / bulk-extraction          → DeepSeek  (deepseek-chat)
 *
 * Fallback: if the preferred provider isn't registered (key missing or
 * previous call failed) the router walks a deterministic fallback chain
 * until one succeeds.
 *
 * Every successful call is logged to the Wave 10 `CostLedger` (per tenant,
 * per provider, per model). `assertWithinBudget()` is called up-front so
 * a runaway tenant can't rack up charges across multiple providers.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import type { CostLedger } from '../cost-ledger.js';
import type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
} from './ai-provider.js';
import type { AIResult } from '../types/core.types.js';
import { aiErr } from '../types/core.types.js';

export type TaskType =
  | 'analysis'
  | 'reasoning'
  | 'tool_use'
  | 'conversation'
  | 'summarization'
  | 'batch'
  | 'bulk_extraction';

export type CostBudget = 'cheap' | 'balanced' | 'premium';
export type LatencyBudget = 'fast' | 'normal' | 'slow_ok';
export type TenantTier = 'free' | 'growth' | 'enterprise';

export interface RouteHints {
  taskType: TaskType;
  costBudget?: CostBudget;
  latencyBudget?: LatencyBudget;
  tenantTier?: TenantTier;
  /**
   * Per-call USD ceiling. If the projected cost of the chosen provider/model
   * (using its registered pricing + expectedOutputTokens hint) exceeds this
   * value, the call is rejected BEFORE the provider is invoked.
   *
   * Pricing-less providers are treated as unbounded — the envelope is
   * bypassed because the estimator returns 0.
   */
  maxBudgetUsdPerCall?: number;
  /**
   * Expected output-token count for envelope estimation. Required when
   * maxBudgetUsdPerCall is set and pricing is configured.
   */
  expectedOutputTokens?: number;
  /**
   * Expected prompt-token count for envelope estimation. Optional; defaults
   * to 0 when omitted.
   */
  expectedPromptTokens?: number;
}

/**
 * Tier → preferred Anthropic model. Per Phase D D7 spec:
 *   enterprise → Opus 4.7
 *   growth/standard → Sonnet 4.6
 *   free → Haiku 4.5
 */
const TIER_PREFERRED_ANTHROPIC: Readonly<Record<TenantTier, string>> = {
  enterprise: getModelLatest('opus'),
  growth: getModelLatest('sonnet'),
  free: getModelLatest('haiku'),
};

/** How long to skip a provider after a 429 / RATE_LIMIT response. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export interface MultiLLMContext {
  readonly tenantId: string;
  readonly operation?: string;
  readonly correlationId?: string;
}

export interface ProviderRegistration {
  readonly provider: AIProvider;
  /** Which model IDs this provider should be invoked with (by task type). */
  readonly preferredModels: Partial<Record<TaskType, string>>;
  /**
   * Cost-per-1k pricing table keyed by model — used to estimate USD micro
   * cost for the ledger. If omitted, cost is logged as 0.
   */
  readonly pricing?: Record<
    string,
    { promptPer1k: number; completionPer1k: number }
  >;
}

export interface RouterLogger {
  warn?(meta: Record<string, unknown>): void;
  info?(meta: Record<string, unknown>): void;
}

export interface MultiLLMRouterDeps {
  /** Registered providers keyed by providerId (e.g. 'anthropic'). */
  readonly providers: Record<string, ProviderRegistration>;
  /** Cost ledger — every call recorded. */
  readonly ledger: CostLedger;
  /**
   * Fallback chain for each task type — ordered by preference. First entry
   * is the primary, remaining are fallbacks (same shape as BORJIE
   * Wave 10 "preferred/fallback" pattern).
   */
  readonly fallbackChains?: Partial<Record<TaskType, string[]>>;
  /**
   * Optional structured logger. The router emits one warn() per
   * rate-limited fallback so platform observability can correlate cool-off
   * decisions with downstream impact.
   */
  readonly logger?: RouterLogger;
  /**
   * Override the cooldown window (ms) after a 429 / RATE_LIMIT response.
   * Defaults to 60 000.
   */
  readonly rateLimitCooldownMs?: number;
}

export interface RouteDecision {
  readonly providerId: string;
  readonly modelId: string;
  readonly reason: string;
}

/** Default fallback chains if the caller doesn't override. */
export const DEFAULT_FALLBACK_CHAINS: Record<TaskType, string[]> = {
  analysis: ['anthropic', 'openai', 'deepseek'],
  reasoning: ['anthropic', 'openai', 'deepseek'],
  tool_use: ['anthropic', 'openai', 'deepseek'],
  conversation: ['openai', 'anthropic', 'deepseek'],
  summarization: ['openai', 'deepseek', 'anthropic'],
  batch: ['deepseek', 'openai', 'anthropic'],
  bulk_extraction: ['deepseek', 'openai', 'anthropic'],
};

export interface MultiLLMRouter {
  /** Deterministic decision — no side effects. */
  pick(hints: RouteHints): RouteDecision | null;
  /** Execute the completion, logging every call to the ledger. */
  complete(params: {
    context: MultiLLMContext;
    hints: RouteHints;
    request: AICompletionRequest;
  }): Promise<
    AIResult<AICompletionResponse & { providerId: string }, AIProviderError>
  >;
}

export function createMultiLLMRouter(
  deps: MultiLLMRouterDeps
): MultiLLMRouter {
  const providers = deps.providers;
  const chains = {
    ...DEFAULT_FALLBACK_CHAINS,
    ...(deps.fallbackChains ?? {}),
  };
  const cooldownMs = deps.rateLimitCooldownMs ?? RATE_LIMIT_COOLDOWN_MS;
  // Per-router-instance map of providerId → cooldown-expiry epoch ms.
  const cooldownUntil = new Map<string, number>();

  function isCooledOff(providerId: string): boolean {
    const until = cooldownUntil.get(providerId);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      cooldownUntil.delete(providerId);
      return false;
    }
    return true;
  }

  /**
   * Choose the model for a registration given the requested task + tenant
   * tier. Tier-aware override only applies to the Anthropic leg AND only
   * when the requested model is supported by the registered provider.
   */
  function chooseModel(
    providerId: string,
    reg: ProviderRegistration,
    hints: RouteHints,
  ): string | null {
    const base = reg.preferredModels[hints.taskType] ?? null;
    if (providerId !== 'anthropic') return base;
    const tier = hints.tenantTier;
    if (!tier) return base;
    const tierPick = TIER_PREFERRED_ANTHROPIC[tier];
    if (!tierPick) return base;
    if (reg.provider.supportsModel(tierPick)) return tierPick;
    return base;
  }

  function pick(hints: RouteHints): RouteDecision | null {
    const chain = chains[hints.taskType] ?? DEFAULT_FALLBACK_CHAINS[hints.taskType];
    if (!chain) return null;

    // Apply cost override — if cheap, bump deepseek / openai to the top.
    const ordered = applyBudgets(chain, hints);
    for (const providerId of ordered) {
      const reg = providers[providerId];
      if (!reg) continue;
      if (isCooledOff(providerId)) continue;
      const model = chooseModel(providerId, reg, hints);
      if (!model) continue;
      return {
        providerId,
        modelId: model,
        reason: `task=${hints.taskType} cost=${hints.costBudget ?? 'balanced'} tier=${hints.tenantTier ?? 'growth'}`,
      };
    }
    return null;
  }

  async function complete(params: {
    context: MultiLLMContext;
    hints: RouteHints;
    request: AICompletionRequest;
  }) {
    const { context, hints, request } = params;

    // Budget guard — short-circuits BEFORE any provider is touched.
    await deps.ledger.assertWithinBudget(context.tenantId);

    const chain = chains[hints.taskType] ?? DEFAULT_FALLBACK_CHAINS[hints.taskType];
    const baseOrdered = applyBudgets(chain, hints);
    // For execution, promote anthropic to the head when it's registered with
    // a model for this task and the caller hasn't explicitly asked for cheap
    // routing. This matches the Phase D D7 spec where Anthropic is the
    // primary inference leg and openai/deepseek are 429/cost fallbacks.
    const ordered =
      hints.costBudget === 'cheap'
        ? baseOrdered
        : promoteAnthropicFirst(baseOrdered, providers, hints.taskType);

    let lastError: AIProviderError | null = null;
    for (const providerId of ordered) {
      const reg = providers[providerId];
      if (!reg) continue;
      if (isCooledOff(providerId)) {
        deps.logger?.warn?.({
          event: 'provider-cooled-off',
          providerId,
          tenantId: context.tenantId,
        });
        continue;
      }
      const model = chooseModel(providerId, reg, hints);
      if (!model) continue;

      // Per-call USD envelope check (D7). Skip when pricing is absent
      // (estimator returns 0 → bypassed by design).
      if (
        hints.maxBudgetUsdPerCall !== undefined &&
        hints.maxBudgetUsdPerCall >= 0
      ) {
        const projected = estimateProjectedCostUsd(reg, model, hints);
        if (projected > hints.maxBudgetUsdPerCall) {
          const envelopeErr: AIProviderError = {
            code: 'PROVIDER_ERROR',
            message: `Projected cost ${projected.toFixed(6)} USD exceeds per-call envelope ${hints.maxBudgetUsdPerCall.toFixed(6)} USD for ${providerId}/${model}`,
            provider: providerId,
            retryable: false,
          };
          return aiErr(envelopeErr);
        }
      }

      const scoped: AICompletionRequest = {
        ...request,
        modelOverride: request.modelOverride ?? model,
      };

      const result = await reg.provider.complete(scoped);
      if (!result.success) {
        const err = (result as { success: false; error: AIProviderError }).error;
        lastError = err;
        // 429-aware fallback: park the provider for the cooldown window.
        if (err.code === 'RATE_LIMIT') {
          cooldownUntil.set(providerId, Date.now() + cooldownMs);
          deps.logger?.warn?.({
            event: 'rate-limited',
            providerId,
            tenantId: context.tenantId,
            cooldownMs,
          });
          continue;
        }
        // Only fail through for genuinely retryable-on-another-provider errors.
        if (!err.retryable) {
          await recordLedger(deps.ledger, context, providerId, model, 0, 0);
          return aiErr(err);
        }
        continue;
      }

      const usage = result.data.usage;
      const micro = estimateMicroCost(reg, model, usage);

      try {
        await deps.ledger.recordUsage({
          tenantId: context.tenantId,
          provider: providerId,
          model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          costUsdMicro: micro,
          operation: context.operation,
          correlationId: context.correlationId,
        });
      } catch {
        // Never fail the caller because accounting failed.
      }

      return {
        success: true as const,
        data: { ...result.data, providerId },
      };
    }

    const fallbackErr: AIProviderError = lastError ?? {
      code: 'PROVIDER_ERROR',
      message: 'No provider accepted the route',
      provider: 'multi-llm-router',
      retryable: false,
    };
    return aiErr(fallbackErr);
  }

  return { pick, complete };
}

/**
 * Estimate the USD cost of a single call using the registered pricing
 * table and the caller's expectedOutputTokens / expectedPromptTokens hints.
 * Returns 0 when pricing is absent (unbounded by design).
 */
function estimateProjectedCostUsd(
  reg: ProviderRegistration,
  model: string,
  hints: RouteHints,
): number {
  const price = reg.pricing?.[model];
  if (!price) return 0;
  const promptTokens = hints.expectedPromptTokens ?? 0;
  const outputTokens = hints.expectedOutputTokens ?? 0;
  return (
    (promptTokens / 1000) * price.promptPer1k +
    (outputTokens / 1000) * price.completionPer1k
  );
}

/**
 * Apply cost/latency overrides to the base chain. This is deterministic —
 * we only re-order, never add providers not already in the chain.
 */
function applyBudgets(base: string[], hints: RouteHints): string[] {
  if (hints.costBudget === 'cheap') {
    return dedupe([
      ...base.filter((p) => p === 'deepseek'),
      ...base.filter((p) => p === 'openai'),
      ...base.filter((p) => p !== 'deepseek' && p !== 'openai'),
    ]);
  }
  if (hints.costBudget === 'premium') {
    return dedupe([
      ...base.filter((p) => p === 'anthropic'),
      ...base.filter((p) => p !== 'anthropic'),
    ]);
  }
  if (hints.latencyBudget === 'fast') {
    // Prefer whichever chain-head is a fast provider (openai / anthropic haiku).
    return dedupe([
      ...base.filter((p) => p === 'openai' || p === 'anthropic'),
      ...base.filter((p) => p === 'deepseek'),
    ]);
  }
  return [...base];
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/**
 * If anthropic is registered with a preferred model for the requested task,
 * float it to the head of the chain. No-op when anthropic is absent or
 * unconfigured for the task.
 */
function promoteAnthropicFirst(
  chain: string[],
  providers: Record<string, ProviderRegistration>,
  taskType: TaskType,
): string[] {
  const ant = providers.anthropic;
  if (!ant || !ant.preferredModels[taskType]) return chain;
  if (chain[0] === 'anthropic') return chain;
  return dedupe(['anthropic', ...chain]);
}

function estimateMicroCost(
  reg: ProviderRegistration,
  model: string,
  usage: { promptTokens: number; completionTokens: number }
): number {
  const price = reg.pricing?.[model];
  if (!price) return 0;
  const promptUsd = (usage.promptTokens / 1000) * price.promptPer1k;
  const completionUsd =
    (usage.completionTokens / 1000) * price.completionPer1k;
  return Math.max(0, Math.round((promptUsd + completionUsd) * 1_000_000));
}

async function recordLedger(
  ledger: CostLedger,
  ctx: MultiLLMContext,
  providerId: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  try {
    await ledger.recordUsage({
      tenantId: ctx.tenantId,
      provider: providerId,
      model,
      inputTokens,
      outputTokens,
      costUsdMicro: 0,
      operation: ctx.operation,
      correlationId: ctx.correlationId,
    });
  } catch {
    // swallow; accounting failure must not bubble up
  }
}
