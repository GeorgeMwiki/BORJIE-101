/**
 * privacy-budget-ledger.ts — per-tenant privacy-budget bookkeeping.
 *
 * Every DP release consumes some ε from the asking tenant's budget. Once
 * the tenant has spent its total budget for the window, further
 * queries must be refused until the window resets (month-boundary by
 * default).
 *
 * Failure mode: the ledger is the SINGLE point of refusal for
 * over-spend. Any other layer that answers a DP query MUST first call
 * `check` + `consume` — the cross-tenant-query router uses exactly this
 * gate.
 *
 * Repository port: keeps the ledger swappable to a Postgres-backed
 * impl later. An in-memory default ships with the package so the
 * api-gateway can wire it in degraded mode.
 */

import type {
  PrivacyBudget,
  PrivacyBudgetRepository,
  PlanTierBudgets,
} from './types.js';

/** Hard default budget: 1.0 ε / month. */
export const DEFAULT_MONTHLY_EPSILON = 1.0;

/** Plan-tier budgets. Values picked conservatively — callers can override. */
export const DEFAULT_PLAN_TIER_BUDGETS: PlanTierBudgets = {
  default: 1.0,
  free: 0.25,
  starter: 0.5,
  pro: 1.0,
  enterprise: 4.0,
};

export interface PrivacyBudgetLedgerConfig {
  readonly now?: () => Date;
  readonly planTierBudgets?: PlanTierBudgets;
  /**
   * Resolves a tenant id to its plan tier. Callers inject so the ledger
   * does not grow a dependency on the billing layer. Returns 'default'
   * when unknown.
   */
  readonly getPlanTier?: (tenantId: string) => string | Promise<string>;
  readonly repository?: PrivacyBudgetRepository;
}

/**
 * In-memory implementation of PrivacyBudgetRepository. Reset on process
 * restart — intended for development + tests only.
 */
export class InMemoryPrivacyBudgetRepository implements PrivacyBudgetRepository {
  private readonly store = new Map<string, PrivacyBudget>();

  async readAll(): Promise<readonly PrivacyBudget[]> {
    return Array.from(this.store.values()).map((r) => ({ ...r }));
  }

  async read(tenantId: string): Promise<PrivacyBudget | null> {
    const found = this.store.get(tenantId);
    return found ? { ...found } : null;
  }

  async write(record: PrivacyBudget): Promise<void> {
    this.store.set(record.tenantId, { ...record });
  }
}

export class BudgetExceededError extends Error {
  constructor(tenantId: string, requested: number, remaining: number) {
    super(
      `Privacy budget exceeded for tenant ${tenantId}: requested ε=${requested}, remaining ε=${remaining}`,
    );
    this.name = 'BudgetExceededError';
  }
}

export class PrivacyBudgetLedger {
  private readonly repository: PrivacyBudgetRepository;
  private readonly now: () => Date;
  private readonly planTierBudgets: PlanTierBudgets;
  private readonly getPlanTier: (tenantId: string) => string | Promise<string>;

  constructor(config: PrivacyBudgetLedgerConfig = {}) {
    this.repository = config.repository ?? new InMemoryPrivacyBudgetRepository();
    this.now = config.now ?? (() => new Date());
    this.planTierBudgets = config.planTierBudgets ?? DEFAULT_PLAN_TIER_BUDGETS;
    this.getPlanTier = config.getPlanTier ?? (() => 'default');
  }

  /** Peek at a tenant's current budget state (fresh copy). */
  async snapshot(tenantId: string): Promise<PrivacyBudget> {
    return this.loadOrInit(tenantId);
  }

  /**
   * Non-mutating test: would `requestedEpsilon` fit under the tenant's
   * remaining budget in the current window? Also auto-rolls the window
   * forward so a stale `resetsAt` does not force a false negative.
   */
  async check(tenantId: string, requestedEpsilon: number): Promise<boolean> {
    if (!Number.isFinite(requestedEpsilon) || requestedEpsilon <= 0) {
      throw new Error(`requestedEpsilon must be > 0, got ${requestedEpsilon}`);
    }
    const current = await this.loadOrInit(tenantId);
    const remaining = current.totalEpsilon - current.usedEpsilon;
    return requestedEpsilon <= remaining + 1e-9;
  }

  /**
   * Attempt to consume ε. Throws `BudgetExceededError` if the request
   * would overshoot. Success returns the new snapshot.
   */
  async consume(tenantId: string, epsilon: number): Promise<PrivacyBudget> {
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
      throw new Error(`epsilon must be > 0, got ${epsilon}`);
    }
    const current = await this.loadOrInit(tenantId);
    const remaining = current.totalEpsilon - current.usedEpsilon;
    if (epsilon > remaining + 1e-9) {
      throw new BudgetExceededError(tenantId, epsilon, remaining);
    }
    const updated: PrivacyBudget = {
      ...current,
      usedEpsilon: current.usedEpsilon + epsilon,
    };
    await this.repository.write(updated);
    return updated;
  }

  /**
   * Sweep all known tenants, rolling any whose window has expired into
   * a fresh window. Intended to be invoked from a cron / heartbeat tick.
   */
  async resetMonthly(): Promise<number> {
    const all = await this.repository.readAll();
    const now = this.now();
    let rolled = 0;
    for (const rec of all) {
      if (new Date(rec.resetsAt).getTime() <= now.getTime()) {
        const next: PrivacyBudget = {
          ...rec,
          usedEpsilon: 0,
          resetsAt: nextMonthBoundary(now).toISOString(),
        };
        await this.repository.write(next);
        rolled += 1;
      }
    }
    return rolled;
  }

  /** Force a fresh window for a single tenant — admin override. */
  async forceReset(tenantId: string): Promise<PrivacyBudget> {
    const current = await this.loadOrInit(tenantId);
    const next: PrivacyBudget = {
      ...current,
      usedEpsilon: 0,
      resetsAt: nextMonthBoundary(this.now()).toISOString(),
    };
    await this.repository.write(next);
    return next;
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async loadOrInit(tenantId: string): Promise<PrivacyBudget> {
    if (!tenantId) throw new Error('tenantId is required');
    const existing = await this.repository.read(tenantId);
    if (existing && new Date(existing.resetsAt).getTime() > this.now().getTime()) {
      return existing;
    }
    // Either no record or window has expired — initialise fresh.
    const planTier = await Promise.resolve(this.getPlanTier(tenantId));
    const total =
      this.planTierBudgets[planTier] ?? this.planTierBudgets.default ?? DEFAULT_MONTHLY_EPSILON;
    const fresh: PrivacyBudget = {
      tenantId,
      totalEpsilon: total,
      usedEpsilon: 0,
      resetsAt: nextMonthBoundary(this.now()).toISOString(),
    };
    await this.repository.write(fresh);
    return fresh;
  }
}

/** First day of next calendar month, UTC, at 00:00:00. */
function nextMonthBoundary(from: Date): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
}
