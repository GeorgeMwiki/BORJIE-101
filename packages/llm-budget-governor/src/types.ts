/**
 * `@borjie/llm-budget-governor` — public types.
 *
 * Per-tenant LLM budget cap with auto-downgrade (opus -> sonnet -> haiku)
 * when approaching the cap. Resets when the period rolls over.
 *
 * Period kinds:
 *   - 'daily'  : keyed by ISO yyyy-mm-dd
 *   - 'monthly': keyed by ISO yyyy-mm
 *
 * Money is tracked in **cents** so we never deal in float dollars.
 * Token counts are integers.
 *
 * Ported from LITFIN PROJECT/src/core/mcp/budget/per-tenant-meter.ts +
 * src/core/litfin-ai/llm/prompt-budget.ts.
 */

export type TenantId = string;
export type Period = 'daily' | 'monthly';
export type PeriodKey = string;

/**
 * Model tiers in priority order (cheapest first → most-expensive last).
 * Order matters for the downgrade ladder.
 */
export const MODEL_TIERS = [
  'haiku',
  'sonnet',
  'opus',
] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

/** Per-tenant cap configuration. */
export interface TenantBudget {
  readonly tenantId: TenantId;
  readonly period: Period;
  /** Cap in CENTS. Must be > 0. */
  readonly capCents: number;
  /** Cap in tokens. Must be > 0. */
  readonly capTokens: number;
  /** Tiers permitted for this tenant. */
  readonly allowedTiers: ReadonlyArray<ModelTier>;
  /**
   * When usage / cap crosses this fraction (0..1), downgrade kicks in.
   * Default 0.85.
   */
  readonly downgradeAtFraction: number;
}

/** Snapshot of per-tenant usage for the current period. */
export interface BudgetUsage {
  readonly tenantId: TenantId;
  readonly period: Period;
  readonly periodKey: PeriodKey;
  readonly usedCents: number;
  readonly usedTokens: number;
  /** Highest tier called this period (informational). */
  readonly highestTierUsed: ModelTier | null;
}

/** Outcome of an evaluation call. */
export type GovernanceDecision =
  | { kind: 'proceed'; model: ModelTier; remainingCents: number; remainingTokens: number }
  | {
      kind: 'downgrade';
      requested: ModelTier;
      downgradedTo: ModelTier;
      reason: 'approaching-cap' | 'tier-not-allowed';
      remainingCents: number;
      remainingTokens: number;
    }
  | {
      kind: 'block';
      reason: 'over-cap-cents' | 'over-cap-tokens' | 'no-tier-fits';
      usedCents: number;
      usedTokens: number;
      capCents: number;
      capTokens: number;
      resetsAt: PeriodKey;
    };

/** Pluggable store port. */
export interface BudgetStore {
  getBudget(tenantId: TenantId): Promise<TenantBudget | null>;
  setBudget(budget: TenantBudget): Promise<void>;
  getUsage(tenantId: TenantId, periodKey: PeriodKey): Promise<BudgetUsage>;
  recordSpend(
    tenantId: TenantId,
    periodKey: PeriodKey,
    cents: number,
    tokens: number,
    tier: ModelTier,
  ): Promise<BudgetUsage>;
}

/** Estimated cost-per-1k-tokens by tier in CENTS (input + output averaged). */
export interface CostTable {
  readonly haiku: number;
  readonly sonnet: number;
  readonly opus: number;
}

/** Default cost table — calibrated to 2026 Anthropic pricing. */
export const DEFAULT_COST_PER_1K_CENTS: CostTable = {
  haiku: 25,
  sonnet: 300,
  opus: 1500,
};

/** Optional alert sink — governor calls this when a downgrade fires. */
export interface AlertSink {
  emitDowngrade(args: {
    tenantId: TenantId;
    periodKey: PeriodKey;
    requested: ModelTier;
    downgradedTo: ModelTier;
    reason: string;
  }): Promise<void>;
  emitBlock(args: {
    tenantId: TenantId;
    periodKey: PeriodKey;
    reason: string;
  }): Promise<void>;
}

/** Composition options. */
export interface BudgetGovernorOptions {
  readonly store: BudgetStore;
  readonly alertSink?: AlertSink;
  readonly costTable?: CostTable;
  readonly now?: () => Date;
}
