/**
 * Drizzle-backed AI cost ledger repository. Bridges the pure ledger
 * contract in `@borjie/ai-copilot` with the Postgres tables defined
 * in `@borjie/database`.
 */
import { eq, and, gte, lt, desc } from 'drizzle-orm';
import { aiCostEntries, tenantAiBudgets } from '@borjie/database';
import type {
  AiCostEntry,
  TenantAiBudget,
  CostLedgerRepository,
} from '@borjie/ai-copilot';

/**
 * Drizzle client shape — kept as `any` at the constructor seam on
 * purpose. The underlying drizzle fluent builders (`db.select().from
 * (...).where(...).orderBy(...).limit(...)`) have deeply-nested generic
 * types that the composition-root cannot reproduce faithfully, and
 * widening through the `@borjie/database` package barrel trips
 * `TS2709 Cannot use namespace 'DatabaseClient' as a type`. `any` at
 * this single seam keeps the rest of the file typed (every row cast
 * to `Record<string, unknown>` before it's touched).
 *
 * Upstream callers should pass the real `DatabaseClient` (derived via
 * `ReturnType<typeof createDatabaseClient>` in service-registry.ts);
 * nothing about this repository does mock-mode fallback.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleLike = any;

export class DrizzleCostLedgerRepository implements CostLedgerRepository {
  constructor(private readonly db: DrizzleLike) {}

  async insertEntry(entry: AiCostEntry): Promise<AiCostEntry> {
    await this.db.insert(aiCostEntries).values({
      id: entry.id,
      tenantId: entry.tenantId,
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsdMicro: entry.costUsdMicro,
      operation: entry.operation,
      correlationId: entry.correlationId,
      metadata: entry.metadata,
      occurredAt: new Date(entry.occurredAt),
      createdAt: new Date(entry.createdAt),
    });
    return entry;
  }

  async sumUsage(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{
    totalCostUsdMicro: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    callCount: number;
    byModel: Record<string, { cost: number; calls: number }>;
  }> {
    const rows = await this.db
      .select()
      .from(aiCostEntries)
      .where(
        and(
          eq(aiCostEntries.tenantId, tenantId),
          gte(aiCostEntries.occurredAt, from),
          lt(aiCostEntries.occurredAt, to),
        ),
      );
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    const byModel: Record<string, { cost: number; calls: number }> = {};
    for (const r of rows as Record<string, unknown>[]) {
      const cost = Number(r.costUsdMicro) || 0;
      const inTok = Number(r.inputTokens) || 0;
      const outTok = Number(r.outputTokens) || 0;
      const model = (r.model as string) ?? 'unknown';
      totalCost += cost;
      totalIn += inTok;
      totalOut += outTok;
      if (!byModel[model]) byModel[model] = { cost: 0, calls: 0 };
      byModel[model].cost += cost;
      byModel[model].calls += 1;
    }
    return {
      totalCostUsdMicro: totalCost,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      callCount: rows.length,
      byModel,
    };
  }

  async listRecent(
    tenantId: string,
    limit: number,
  ): Promise<readonly AiCostEntry[]> {
    const rows = await this.db
      .select()
      .from(aiCostEntries)
      .where(eq(aiCostEntries.tenantId, tenantId))
      .orderBy(desc(aiCostEntries.occurredAt))
      .limit(limit);
    return (rows as Record<string, unknown>[]).map(fromEntryRow);
  }

  async getBudget(tenantId: string): Promise<TenantAiBudget | null> {
    const rows = await this.db
      .select()
      .from(tenantAiBudgets)
      .where(eq(tenantAiBudgets.tenantId, tenantId))
      .limit(1);
    const r = (rows as Record<string, unknown>[])[0];
    return r ? fromBudgetRow(r) : null;
  }

  async upsertBudget(budget: TenantAiBudget): Promise<TenantAiBudget> {
    await this.db
      .insert(tenantAiBudgets)
      .values({
        tenantId: budget.tenantId,
        monthlyCapUsdMicro: budget.monthlyCapUsdMicro,
        hardStop: budget.hardStop,
        updatedBy: budget.updatedBy,
        createdAt: new Date(budget.createdAt),
        updatedAt: new Date(budget.updatedAt),
      })
      .onConflictDoUpdate({
        target: [tenantAiBudgets.tenantId],
        set: {
          monthlyCapUsdMicro: budget.monthlyCapUsdMicro,
          hardStop: budget.hardStop,
          updatedBy: budget.updatedBy,
          updatedAt: new Date(budget.updatedAt),
        },
      });
    return budget;
  }
}

function fromEntryRow(row: Record<string, unknown>): AiCostEntry {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    provider: row.provider as string,
    model: row.model as string,
    inputTokens: Number(row.inputTokens) || 0,
    outputTokens: Number(row.outputTokens) || 0,
    costUsdMicro: Number(row.costUsdMicro) || 0,
    operation: (row.operation as string | null) ?? null,
    correlationId: (row.correlationId as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    occurredAt: toIso(row.occurredAt as Date | string),
    createdAt: toIso(row.createdAt as Date | string),
  };
}

function fromBudgetRow(row: Record<string, unknown>): TenantAiBudget {
  return {
    tenantId: row.tenantId as string,
    monthlyCapUsdMicro: Number(row.monthlyCapUsdMicro) || 0,
    hardStop: Boolean(row.hardStop),
    updatedBy: (row.updatedBy as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string),
    updatedAt: toIso(row.updatedAt as Date | string),
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}
