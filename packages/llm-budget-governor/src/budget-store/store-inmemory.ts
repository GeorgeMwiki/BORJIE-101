/**
 * In-memory budget store. Production wires a Drizzle-port adapter that
 * upserts rows in `llm_budget_usage` keyed by (tenant, period, periodKey).
 *
 * The shape is intentionally tiny so a Drizzle adapter can be a thin wrapper
 * that translates rows ↔ the BudgetUsage record shape.
 */

import type {
  BudgetStore,
  BudgetUsage,
  ModelTier,
  PeriodKey,
  TenantBudget,
  TenantId,
} from '../types.js';

export function createInMemoryBudgetStore(): BudgetStore {
  const budgets = new Map<TenantId, TenantBudget>();
  const usage = new Map<string, BudgetUsage>();

  function key(tenantId: TenantId, periodKey: PeriodKey): string {
    return `${tenantId}|${periodKey}`;
  }

  return {
    async getBudget(tenantId) {
      return budgets.get(tenantId) ?? null;
    },

    async setBudget(b) {
      budgets.set(b.tenantId, b);
    },

    async getUsage(tenantId, periodKey) {
      const stored = usage.get(key(tenantId, periodKey));
      if (stored) return stored;
      return {
        tenantId,
        period: periodKey.length === 10 ? 'daily' : 'monthly',
        periodKey,
        usedCents: 0,
        usedTokens: 0,
        highestTierUsed: null,
      };
    },

    async recordSpend(tenantId, periodKey, cents, tokens, tier) {
      const existing = usage.get(key(tenantId, periodKey));
      const next: BudgetUsage = {
        tenantId,
        period: periodKey.length === 10 ? 'daily' : 'monthly',
        periodKey,
        usedCents: (existing?.usedCents ?? 0) + cents,
        usedTokens: (existing?.usedTokens ?? 0) + tokens,
        highestTierUsed: pickHighestTier(existing?.highestTierUsed ?? null, tier),
      };
      usage.set(key(tenantId, periodKey), next);
      return next;
    },
  };
}

const TIER_RANK: Record<ModelTier, number> = {
  haiku: 1,
  sonnet: 2,
  opus: 3,
};

function pickHighestTier(
  a: ModelTier | null,
  b: ModelTier,
): ModelTier {
  if (a === null) return b;
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}
