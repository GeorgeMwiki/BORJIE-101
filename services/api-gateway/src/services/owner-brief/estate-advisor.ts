/**
 * Estate advisor slice — read-only summary computed daily for the
 * daily-brief cron.
 *
 * Wave ESTATE-OS. Surfaces three signals into the daily brief:
 *
 *   1. activeEntityCount   — count of estate_entities with status='active'
 *   2. overdueReviews      — count of succession_plans whose
 *                            next_review_due_at < now and status != 'archived'
 *   3. last30dFlowsTzs     — sum of estate_capital_movements.amount where
 *                            currency='TZS' and happened_at > now - 30d
 *
 * All reads are scoped by tenant via the GUC + RLS. The function never
 * throws — failure paths return zero counters so the cron's per-tenant
 * loop stays robust.
 */

import { sql } from 'drizzle-orm';

export interface EstateAdvisorSlice {
  readonly activeEntityCount: number;
  readonly overdueReviews: number;
  readonly last30dFlowsTzs: number;
  readonly computedAtIso: string;
}

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecResultRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecResultRow> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<ExecResultRow>;
  }
  const wrapped = result as { rows?: ReadonlyArray<ExecResultRow> };
  return wrapped?.rows ?? [];
}

export async function composeEstateAdvisorSlice(
  db: DbLike,
  tenantId: string,
): Promise<EstateAdvisorSlice> {
  const computedAtIso = new Date().toISOString();
  const baseline: EstateAdvisorSlice = {
    activeEntityCount: 0,
    overdueReviews: 0,
    last30dFlowsTzs: 0,
    computedAtIso,
  };

  try {
    const entityResult = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM estate_entities
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
    `);
    const overdueResult = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM succession_plans
       WHERE tenant_id = ${tenantId}
         AND status <> 'archived'
         AND next_review_due_at < NOW()
    `);
    const flowResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::numeric AS total
        FROM estate_capital_movements
       WHERE tenant_id = ${tenantId}
         AND currency = 'TZS'
         AND happened_at > NOW() - INTERVAL '30 days'
    `);

    const entityRows = rowsOf(entityResult);
    const overdueRows = rowsOf(overdueResult);
    const flowRows = rowsOf(flowResult);

    const activeEntityCount = Number(entityRows[0]?.n ?? 0);
    const overdueReviews = Number(overdueRows[0]?.n ?? 0);
    const last30dFlowsTzs = Number(flowRows[0]?.total ?? 0);

    return {
      activeEntityCount,
      overdueReviews,
      last30dFlowsTzs,
      computedAtIso,
    };
  } catch {
    return baseline;
  }
}
