/**
 * AI Cost Ledger — Wave 9 enterprise polish.
 *
 * Append-only ledger of every LLM call + per-tenant monthly budget enforcement.
 *
 * Design:
 *   - recordUsage() writes a new ai_cost_entries row. It never updates or
 *     deletes prior rows; the repository port intentionally exposes no
 *     update/delete surface.
 *   - currentMonthSpend() sums usage for the tenant from the first of the
 *     current calendar month (UTC) through `now`.
 *   - isOverBudget() returns true when currentMonthSpend >= monthlyCap and
 *     the budget has `hardStop = true`. A `hardStop=false` budget is
 *     informational — currentMonthSpend is still tracked, but callers
 *     aren't blocked.
 *   - setBudget() upserts the per-tenant monthly cap.
 *
 * Costs are stored as microdollars (USD * 1_000_000) to avoid float drift.
 *
 * The Anthropic provider wrapper calls `isOverBudget(tenantId)` BEFORE each
 * API call and throws `AiBudgetExceededError` when true — this short-circuits
 * the network round-trip so a runaway tenant can't rack up charges.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AiCostEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsdMicro: number;
  readonly operation: string | null;
  readonly correlationId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly createdAt: string;
}

export interface TenantAiBudget {
  readonly tenantId: string;
  readonly monthlyCapUsdMicro: number;
  readonly hardStop: boolean;
  readonly updatedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecordUsageInput {
  readonly tenantId: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsdMicro: number;
  readonly operation?: string;
  readonly correlationId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface MonthSpendSummary {
  readonly tenantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalCostUsdMicro: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly callCount: number;
  readonly byModel: Readonly<Record<string, { cost: number; calls: number }>>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AiBudgetExceededError extends Error {
  readonly code = 'AI_BUDGET_EXCEEDED' as const;
  readonly tenantId: string;
  readonly monthlyCapUsdMicro: number;
  readonly currentSpendUsdMicro: number;

  constructor(params: {
    tenantId: string;
    monthlyCapUsdMicro: number;
    currentSpendUsdMicro: number;
  }) {
    super(
      `AI budget exceeded for tenant ${params.tenantId}: ` +
        `spent ${params.currentSpendUsdMicro} of ${params.monthlyCapUsdMicro} microdollars`,
    );
    this.name = 'AiBudgetExceededError';
    this.tenantId = params.tenantId;
    this.monthlyCapUsdMicro = params.monthlyCapUsdMicro;
    this.currentSpendUsdMicro = params.currentSpendUsdMicro;
  }
}

export class CostLedgerError extends Error {
  constructor(
    message: string,
    public readonly code: 'VALIDATION' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'CostLedgerError';
  }
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/**
 * Storage-agnostic port for the ledger. Append-only: note that the port
 * intentionally does NOT expose any `update` or `delete` method — callers
 * cannot mutate prior rows.
 */
export interface CostLedgerRepository {
  insertEntry(entry: AiCostEntry): Promise<AiCostEntry>;
  /** Sum usage for a tenant between `from` (inclusive) and `to` (exclusive). */
  sumUsage(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{
    totalCostUsdMicro: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    callCount: number;
    byModel: Record<string, { cost: number; calls: number }>;
  }>;
  listRecent(
    tenantId: string,
    limit: number,
  ): Promise<readonly AiCostEntry[]>;
  getBudget(tenantId: string): Promise<TenantAiBudget | null>;
  upsertBudget(budget: TenantAiBudget): Promise<TenantAiBudget>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Return the UTC start-of-month for a given date. Pure.
 */
export function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Return the UTC start-of-NEXT-month for a given date. Pure.
 */
export function startOfNextMonthUtc(d: Date): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
}

function validateNonEmpty(value: string, field: string): void {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new CostLedgerError(`${field} is required`, 'VALIDATION');
  }
}

function validateNonNegativeInt(value: number, field: string): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new CostLedgerError(
      `${field} must be a non-negative integer`,
      'VALIDATION',
    );
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CostLedgerDeps {
  readonly repo: CostLedgerRepository;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export interface CostLedger {
  recordUsage(input: RecordUsageInput): Promise<AiCostEntry>;
  currentMonthSpend(tenantId: string): Promise<MonthSpendSummary>;
  isOverBudget(tenantId: string): Promise<boolean>;
  getBudget(tenantId: string): Promise<TenantAiBudget | null>;
  setBudget(
    tenantId: string,
    monthlyCapUsdMicro: number,
    options?: { hardStop?: boolean; updatedBy?: string },
  ): Promise<TenantAiBudget>;
  listRecentEntries(
    tenantId: string,
    limit?: number,
  ): Promise<readonly AiCostEntry[]>;
  /**
   * Convenience guard — throws AiBudgetExceededError iff isOverBudget() is
   * true. Wrappers call this before every LLM round-trip.
   */
  assertWithinBudget(tenantId: string): Promise<void>;
}

export function createCostLedger(deps: CostLedgerDeps): CostLedger {
  const now = deps.now ?? (() => new Date());
  const genId =
    deps.idGenerator ?? (() => `aic_${Date.now()}_${randomSuffix()}`);

  return {
    async recordUsage(input) {
      validateNonEmpty(input.tenantId, 'tenantId');
      validateNonEmpty(input.provider, 'provider');
      validateNonEmpty(input.model, 'model');
      validateNonNegativeInt(input.inputTokens, 'inputTokens');
      validateNonNegativeInt(input.outputTokens, 'outputTokens');
      validateNonNegativeInt(input.costUsdMicro, 'costUsdMicro');

      const nowIso = now().toISOString();
      const entry: AiCostEntry = {
        id: genId(),
        tenantId: input.tenantId,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsdMicro: input.costUsdMicro,
        operation: input.operation ?? null,
        correlationId: input.correlationId ?? null,
        metadata: input.metadata ? { ...input.metadata } : {},
        occurredAt: nowIso,
        createdAt: nowIso,
      };
      return deps.repo.insertEntry(entry);
    },

    async currentMonthSpend(tenantId) {
      validateNonEmpty(tenantId, 'tenantId');
      const current = now();
      const from = startOfMonthUtc(current);
      const to = startOfNextMonthUtc(current);
      const sums = await deps.repo.sumUsage(tenantId, from, to);
      return {
        tenantId,
        periodStart: from.toISOString(),
        periodEnd: to.toISOString(),
        totalCostUsdMicro: sums.totalCostUsdMicro,
        totalInputTokens: sums.totalInputTokens,
        totalOutputTokens: sums.totalOutputTokens,
        callCount: sums.callCount,
        byModel: { ...sums.byModel },
      };
    },

    async isOverBudget(tenantId) {
      validateNonEmpty(tenantId, 'tenantId');
      const budget = await deps.repo.getBudget(tenantId);
      if (!budget) return false; // No budget configured → unlimited.
      if (!budget.hardStop) return false; // Informational only.
      if (budget.monthlyCapUsdMicro <= 0) return false;
      const summary = await this.currentMonthSpend(tenantId);
      return summary.totalCostUsdMicro >= budget.monthlyCapUsdMicro;
    },

    async assertWithinBudget(tenantId) {
      validateNonEmpty(tenantId, 'tenantId');
      const budget = await deps.repo.getBudget(tenantId);
      if (!budget || !budget.hardStop || budget.monthlyCapUsdMicro <= 0) {
        return;
      }
      const summary = await this.currentMonthSpend(tenantId);
      if (summary.totalCostUsdMicro >= budget.monthlyCapUsdMicro) {
        throw new AiBudgetExceededError({
          tenantId,
          monthlyCapUsdMicro: budget.monthlyCapUsdMicro,
          currentSpendUsdMicro: summary.totalCostUsdMicro,
        });
      }
    },

    async getBudget(tenantId) {
      validateNonEmpty(tenantId, 'tenantId');
      return deps.repo.getBudget(tenantId);
    },

    async setBudget(tenantId, monthlyCapUsdMicro, options) {
      validateNonEmpty(tenantId, 'tenantId');
      validateNonNegativeInt(monthlyCapUsdMicro, 'monthlyCapUsdMicro');
      const existing = await deps.repo.getBudget(tenantId);
      const nowIso = now().toISOString();
      const row: TenantAiBudget = {
        tenantId,
        monthlyCapUsdMicro,
        hardStop: options?.hardStop ?? existing?.hardStop ?? true,
        updatedBy: options?.updatedBy ?? existing?.updatedBy ?? null,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
      return deps.repo.upsertBudget(row);
    },

    async listRecentEntries(tenantId, limit = 50) {
      validateNonEmpty(tenantId, 'tenantId');
      const capped = Math.max(1, Math.min(limit, 500));
      return deps.repo.listRecent(tenantId, capped);
    },
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
