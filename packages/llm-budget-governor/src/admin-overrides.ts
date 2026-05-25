/**
 * Admin emergency overrides + per-tenant ceiling adjustments.
 *
 * Use sparingly — every override should leave a trail in an audit log
 * (the alertSink is the natural place to also record overrides; not
 * coupled here so callers can route differently).
 */

import type {
  BudgetStore,
  ModelTier,
  Period,
  TenantBudget,
  TenantId,
} from './types.js';

export interface AdjustCeilingArgs {
  readonly tenantId: TenantId;
  readonly capCents?: number;
  readonly capTokens?: number;
  readonly allowedTiers?: ReadonlyArray<ModelTier>;
  readonly downgradeAtFraction?: number;
}

/**
 * Adjust an existing budget. If no budget exists yet, throws — callers
 * must use `seedBudget()` for that path.
 */
export async function adjustCeiling(
  store: BudgetStore,
  args: AdjustCeilingArgs,
): Promise<TenantBudget> {
  const existing = await store.getBudget(args.tenantId);
  if (!existing) {
    throw new Error(
      `[budget-governor] no budget exists for tenant ${args.tenantId}; seed it first`,
    );
  }
  const next: TenantBudget = {
    ...existing,
    capCents: args.capCents ?? existing.capCents,
    capTokens: args.capTokens ?? existing.capTokens,
    allowedTiers: args.allowedTiers ?? existing.allowedTiers,
    downgradeAtFraction:
      args.downgradeAtFraction ?? existing.downgradeAtFraction,
  };
  await store.setBudget(next);
  return next;
}

export interface SeedBudgetArgs {
  readonly tenantId: TenantId;
  readonly period: Period;
  readonly capCents: number;
  readonly capTokens: number;
  readonly allowedTiers: ReadonlyArray<ModelTier>;
  readonly downgradeAtFraction?: number;
}

/** Seed a brand-new tenant budget (idempotent — overwrites). */
export async function seedBudget(
  store: BudgetStore,
  args: SeedBudgetArgs,
): Promise<TenantBudget> {
  const budget: TenantBudget = {
    tenantId: args.tenantId,
    period: args.period,
    capCents: args.capCents,
    capTokens: args.capTokens,
    allowedTiers: args.allowedTiers,
    downgradeAtFraction: args.downgradeAtFraction ?? 0.85,
  };
  await store.setBudget(budget);
  return budget;
}

/**
 * Emergency unlock — bump the cap by a multiplier so a tenant currently
 * blocked can resume immediately. Use for incident response only. Note
 * this returns the new budget; the alertSink does NOT fire here — the
 * caller is expected to log this through a dedicated audit channel.
 */
export async function emergencyUnlock(
  store: BudgetStore,
  tenantId: TenantId,
  multiplier = 2,
): Promise<TenantBudget> {
  const existing = await store.getBudget(tenantId);
  if (!existing) {
    throw new Error(
      `[budget-governor] no budget exists for tenant ${tenantId}; cannot unlock`,
    );
  }
  if (multiplier <= 1) {
    throw new Error('[budget-governor] multiplier must be > 1 for unlock');
  }
  const next: TenantBudget = {
    ...existing,
    capCents: Math.round(existing.capCents * multiplier),
    capTokens: Math.round(existing.capTokens * multiplier),
  };
  await store.setBudget(next);
  return next;
}
