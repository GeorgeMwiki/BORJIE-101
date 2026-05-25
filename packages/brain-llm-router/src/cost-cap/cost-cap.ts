/**
 * cost-cap/ — per-tenant per-conversation budget enforcement.
 *
 * Reads from three duck-typed ports (so tests + production both wire
 * without coupling):
 *   - TenantBudgetReader: monthly + conversation budget USD.
 *   - K-F BudgetMonitor port (already-spent USD).
 *   - M-E CircuitBreaker port (kill-switch for runaway tenants).
 *
 * Pre-flight cost projection: based on input token estimate × output token
 * cap × model rate, decide whether to allow the call. Hard-stops above
 * remaining budget; emits a `cost-cap-exceeded` event for K-B receipt UX.
 */

import type { BrainLLMRequest, BrainLLMResponse, ModelTier } from '../types.js';
import { BrainLLMError } from '../types.js';
import { computeCost, getPricing } from '../cost-cascade/pricing.js';

export interface TenantBudget {
  readonly tenantId: string;
  readonly monthlyBudgetUsd: number;
  readonly conversationBudgetUsd: number;
}

export interface TenantBudgetReader {
  read(tenantId: string): Promise<TenantBudget>;
}

export interface SpendLedger {
  /** Total USD spent this month for tenant. */
  monthToDateSpend(tenantId: string): Promise<number>;
  /** USD spent for this specific conversation. */
  conversationSpend(tenantId: string, conversationId: string): Promise<number>;
  /** Record a new charge. */
  record(charge: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly usd: number;
    readonly model: ModelTier;
    readonly at: string;
  }): Promise<void>;
}

export interface TenantKillSwitch {
  /** True if tenant is currently blocked (M-E circuit broken). */
  isBlocked(tenantId: string): Promise<boolean>;
}

export interface CostCapEvent {
  readonly type: 'cost-cap-exceeded' | 'cost-cap-warning';
  readonly tenantId: string;
  readonly conversationId: string;
  readonly attemptedUsd: number;
  readonly monthlyRemainingUsd: number;
  readonly conversationRemainingUsd: number;
  readonly at: string;
}

export interface CostCapConfig {
  readonly budgetReader: TenantBudgetReader;
  readonly ledger: SpendLedger;
  readonly killSwitch?: TenantKillSwitch;
  readonly onEvent?: (event: CostCapEvent) => void;
  /** Warning threshold as fraction of remaining (default 0.85). */
  readonly warnThreshold?: number;
}

/**
 * Pre-flight check before invoking the model. Throws COST_CAP_EXCEEDED
 * (non-retryable) if the projected cost exceeds remaining budget.
 *
 * Returns the projected USD so the caller can pass it to the on-step
 * budget tracker in the orchestrator.
 */
export async function preflightCostCheck(
  req: BrainLLMRequest,
  ctx: { readonly tenantId: string; readonly conversationId: string; readonly model: ModelTier },
  config: CostCapConfig
): Promise<{ readonly projectedUsd: number; readonly monthlyRemainingUsd: number; readonly conversationRemainingUsd: number }> {
  if (config.killSwitch !== undefined && (await config.killSwitch.isBlocked(ctx.tenantId))) {
    throw new BrainLLMError({
      code: 'TENANT_BLOCKED',
      message: `tenant ${ctx.tenantId} is currently blocked by killSwitch`,
      retryable: false,
    });
  }

  const budget = await config.budgetReader.read(ctx.tenantId);
  const monthlySpent = await config.ledger.monthToDateSpend(ctx.tenantId);
  const conversationSpent = await config.ledger.conversationSpend(ctx.tenantId, ctx.conversationId);

  const monthlyRemaining = budget.monthlyBudgetUsd - monthlySpent;
  const conversationRemaining = budget.conversationBudgetUsd - conversationSpent;

  const pricing = getPricing(ctx.model);
  const inputTokens = estimateInputTokens(req);
  const outputTokens = req.maxTokens ?? 4096;
  const { usd: projected } = computeCost({ inputTokens, outputTokens }, pricing);

  // Emit a warning event when nearing thresholds.
  const warnThreshold = config.warnThreshold ?? 0.85;
  if (config.onEvent !== undefined) {
    const warnConv = projected > conversationRemaining * warnThreshold && projected <= conversationRemaining;
    const warnMonth = projected > monthlyRemaining * warnThreshold && projected <= monthlyRemaining;
    if (warnConv || warnMonth) {
      config.onEvent({
        type: 'cost-cap-warning',
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        attemptedUsd: projected,
        monthlyRemainingUsd: monthlyRemaining,
        conversationRemainingUsd: conversationRemaining,
        at: new Date().toISOString(),
      });
    }
  }

  if (projected > conversationRemaining || projected > monthlyRemaining) {
    if (config.onEvent !== undefined) {
      config.onEvent({
        type: 'cost-cap-exceeded',
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        attemptedUsd: projected,
        monthlyRemainingUsd: monthlyRemaining,
        conversationRemainingUsd: conversationRemaining,
        at: new Date().toISOString(),
      });
    }
    throw new BrainLLMError({
      code: 'COST_CAP_EXCEEDED',
      message:
        `cost cap exceeded for tenant=${ctx.tenantId} conversation=${ctx.conversationId}: ` +
        `projected $${projected.toFixed(4)} > min(monthlyRemaining=$${monthlyRemaining.toFixed(4)}, ` +
        `conversationRemaining=$${conversationRemaining.toFixed(4)})`,
      retryable: false,
    });
  }

  return {
    projectedUsd: projected,
    monthlyRemainingUsd: monthlyRemaining,
    conversationRemainingUsd: conversationRemaining,
  };
}

/**
 * Post-flight charge — record the actual USD spent. Caller invokes after
 * the model returns. Uses real `response.usage`.
 */
export async function postflightCharge(
  response: BrainLLMResponse,
  ctx: { readonly tenantId: string; readonly conversationId: string },
  ledger: SpendLedger
): Promise<{ readonly chargedUsd: number }> {
  const pricing = getPricing(response.model);
  const { usd } = computeCost(response.usage, pricing);
  await ledger.record({
    tenantId: ctx.tenantId,
    conversationId: ctx.conversationId,
    usd,
    model: response.model,
    at: new Date().toISOString(),
  });
  return { chargedUsd: usd };
}

function estimateInputTokens(req: BrainLLMRequest): number {
  let chars = req.system?.length ?? 0;
  for (const m of req.messages) {
    for (const c of m.content) {
      if (c.type === 'text') chars += c.text.length;
    }
  }
  return Math.ceil(chars / 4);
}

/** In-memory ledger for tests + bootstrap. */
export class InMemorySpendLedger implements SpendLedger {
  private readonly charges: Array<{
    tenantId: string;
    conversationId: string;
    usd: number;
    model: ModelTier;
    at: string;
  }> = [];

  async monthToDateSpend(tenantId: string): Promise<number> {
    return this.charges.filter((c) => c.tenantId === tenantId).reduce((sum, c) => sum + c.usd, 0);
  }

  async conversationSpend(tenantId: string, conversationId: string): Promise<number> {
    return this.charges
      .filter((c) => c.tenantId === tenantId && c.conversationId === conversationId)
      .reduce((sum, c) => sum + c.usd, 0);
  }

  async record(charge: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly usd: number;
    readonly model: ModelTier;
    readonly at: string;
  }): Promise<void> {
    this.charges.push({ ...charge });
  }

  // test helper
  count(): number {
    return this.charges.length;
  }
}
