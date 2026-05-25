/**
 * @borjie/executive-brief-engine — cost-budget.
 *
 * Per-tenant daily cap via the existing cost-ledger
 * (`packages/ai-copilot/src/cost-ledger.ts`). When the budget is
 * exhausted, the orchestrator returns a DEGRADED brief — rules-only
 * (no LLM calls) plus the last successful LLM-backed brief — instead
 * of failing the request outright.
 *
 * The port is intentionally narrow so we don't depend on the entire
 * cost-ledger module here.
 */

// ─────────────────────────────────────────────────────────────────────
// CostBudgetPort — wired from ai-copilot/cost-ledger in api-gateway.
// ─────────────────────────────────────────────────────────────────────

export interface CostBudgetPort {
  /**
   * True when the tenant has hit (>=) its monthly cap AND has hardStop=true.
   * Drops the engine to degraded mode.
   */
  isOverBudget(tenantId: string): Promise<boolean>;

  /**
   * Record an LLM cost against the brief operation. The cost-ledger
   * stores microdollars (USD * 1e6). Implementation should write through
   * `recordUsage` with `operation = 'executive_brief'`.
   */
  recordCost(args: {
    readonly tenantId: string;
    readonly costMicros: number;
    readonly model: string;
    readonly correlationId: string;
  }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory port — used by tests + the degraded-mode path. Allows callers
// to pre-set a tenant's over-budget state for deterministic test flow.
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryBudgetState {
  readonly overBudgetTenants: ReadonlyArray<string>;
}

export function createInMemoryCostBudget(initial?: InMemoryBudgetState): CostBudgetPort & {
  setOverBudget(tenantId: string, over: boolean): void;
  recordedCosts(): ReadonlyArray<{ tenantId: string; costMicros: number; model: string; correlationId: string }>;
} {
  const overSet = new Set<string>(initial?.overBudgetTenants ?? []);
  const recorded: Array<{ tenantId: string; costMicros: number; model: string; correlationId: string }> = [];
  return {
    async isOverBudget(tenantId: string) {
      return overSet.has(tenantId);
    },
    async recordCost({ tenantId, costMicros, model, correlationId }) {
      recorded.push({ tenantId, costMicros, model, correlationId });
    },
    setOverBudget(tenantId: string, over: boolean) {
      if (over) overSet.add(tenantId);
      else overSet.delete(tenantId);
    },
    recordedCosts() {
      return recorded;
    },
  };
}
