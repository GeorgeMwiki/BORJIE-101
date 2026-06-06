/**
 * /api/v1/owner/group-rollup — per-tenant estate group financial rollup (OW-10).
 *
 * Backs the owner-web O-W-19 group sidebar
 * (`apps/owner-web/src/app/(routes)/group/page.tsx`), which renders the
 * estate groups + entities but notes that a per-tenant financial ROLLUP
 * across the group is a not-yet-built, owner-callable endpoint (the
 * `internal/tenants?group=me` path is SUPER_ADMIN-only). This is that
 * endpoint, reading REAL, RLS-scoped estate rows.
 *
 * Routes:
 *   GET /                 rollup for every estate group in the tenant
 *
 * REAL data sources (all FORCE-RLS, tenant-scoped):
 *   - `estate_groups`            — the holding shells (family office, etc.)
 *   - `estate_entities`          — businesses under each group: counts by
 *                                  status + kind + summed ownership.
 *   - `estate_capital_movements` — the intercompany money log (dividends,
 *                                  capital injections, loans, royalty
 *                                  settlements, …). Net flow PER ENTITY is
 *                                  aggregated and rolled up to the group.
 *
 * CURRENCY (CLAUDE.md hard rule — never hard-code / never cross-sum):
 *   capital movements are multi-currency. We aggregate net flow GROUPED
 *   BY currency and return an array of `{ currency, inflow, outflow, net }`
 *   per group. We NEVER sum across currencies and NEVER assume TZS.
 *
 * LEDGER NOTE / FLAG: `estate_capital_movements` is the estate-level
 * intercompany view (the money path still flows through
 * `LedgerService.post()`). There is no direct `estate_entity_id` column
 * on `ledger_entries`, so a true per-entity GENERAL-LEDGER balance is not
 * derivable without an entity↔ledger-account mapping. We surface the real
 * intercompany capital flow and FLAG that a full GL-per-entity rollup
 * needs that mapping.
 *
 * RLS: databaseMiddleware binds app.current_tenant_id.
 */

import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';

import {
  estateGroups,
  estateEntities,
  estateCapitalMovements,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-group-rollup');

interface CurrencyFlow {
  readonly currency: string;
  readonly inflow: number;
  readonly outflow: number;
  readonly net: number;
}

export const ownerGroupRollupRouter = new Hono();
ownerGroupRollupRouter.use('*', authMiddleware);
ownerGroupRollupRouter.use('*', databaseMiddleware);

ownerGroupRollupRouter.get('/', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) {
    return c.json(
      { success: false, error: { code: 'GROUP_ROLLUP_DB_UNAVAILABLE' } },
      503,
    );
  }
  const tenantId = auth.tenantId;

  try {
    // ---- groups -------------------------------------------------------
    const groups = await db
      .select({
        id: estateGroups.id,
        name: estateGroups.name,
        holdingType: estateGroups.holdingType,
        country: estateGroups.country,
        principalOwnerName: estateGroups.principalOwnerName,
      })
      .from(estateGroups)
      .where(eq(estateGroups.tenantId, tenantId))
      .limit(200);

    if (groups.length === 0) {
      // Honest empty — the tenant has no estate group yet.
      return c.json(
        {
          success: true as const,
          data: {
            groups: [] as const,
            count: 0,
            flags: [
              'No estate_groups rows for this tenant — create a group at ' +
                'POST /api/v1/estate/groups first.',
            ],
          },
        },
        200,
      );
    }

    // ---- per-group entity counts (status + kind + ownership) ----------
    const entityAgg = await db
      .select({
        estateGroupId: estateEntities.estateGroupId,
        status: estateEntities.status,
        total: sql<number>`COUNT(*)`,
        ownershipSum: sql<number>`COALESCE(SUM(${estateEntities.ownershipPct}), 0)`,
      })
      .from(estateEntities)
      .where(eq(estateEntities.tenantId, tenantId))
      .groupBy(estateEntities.estateGroupId, estateEntities.status);

    const entityByGroup = new Map<
      string,
      { total: number; byStatus: Record<string, number>; ownershipSum: number }
    >();
    for (const row of entityAgg) {
      const key = String(row.estateGroupId);
      const entry =
        entityByGroup.get(key) ??
        { total: 0, byStatus: {}, ownershipSum: 0 };
      const n = Number(row.total ?? 0);
      entry.total += n;
      entry.byStatus[String(row.status ?? 'unknown')] = n;
      entry.ownershipSum += Number(row.ownershipSum ?? 0);
      entityByGroup.set(key, entry);
    }

    // ---- per-group capital flow, grouped BY currency ------------------
    // estate_capital_movements has no estate_group_id; it links via
    // from/to entity. We join each side back to its entity's group and
    // aggregate inflow (money INTO an entity in the group) and outflow
    // (money OUT of an entity in the group) per currency. A flow whose
    // BOTH ends are inside the same group nets to zero at the group level
    // (intra-group), which is correct for a group rollup.
    const flowRows = await db.execute(sql`
      WITH grp_entity AS (
        SELECT id, estate_group_id
          FROM estate_entities
         WHERE tenant_id = ${tenantId}
      )
      SELECT
        g.estate_group_id::text AS estate_group_id,
        m.currency               AS currency,
        COALESCE(SUM(
          CASE WHEN m.to_entity_id = g.id THEN m.amount ELSE 0 END
        ), 0)                    AS inflow,
        COALESCE(SUM(
          CASE WHEN m.from_entity_id = g.id THEN m.amount ELSE 0 END
        ), 0)                    AS outflow
        FROM estate_capital_movements m
        JOIN grp_entity g
          ON g.id = m.from_entity_id OR g.id = m.to_entity_id
       WHERE m.tenant_id = ${tenantId}
       GROUP BY g.estate_group_id, m.currency
    `);
    const flowRaw = Array.isArray(flowRows)
      ? flowRows
      : ((flowRows as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
        []);

    const flowByGroup = new Map<string, CurrencyFlow[]>();
    for (const row of flowRaw as ReadonlyArray<Record<string, unknown>>) {
      const key = String(row.estate_group_id);
      const inflow = Number(row.inflow ?? 0);
      const outflow = Number(row.outflow ?? 0);
      const flows = flowByGroup.get(key) ?? [];
      flows.push({
        currency: String(row.currency ?? 'UNKNOWN'),
        inflow,
        outflow,
        net: inflow - outflow,
      });
      flowByGroup.set(key, flows);
    }

    // ---- assemble -----------------------------------------------------
    const rollup = groups.map((g) => {
      const gid = String(g.id);
      const ent = entityByGroup.get(gid) ?? {
        total: 0,
        byStatus: {},
        ownershipSum: 0,
      };
      return {
        groupId: gid,
        name: String(g.name ?? ''),
        holdingType: String(g.holdingType ?? ''),
        country: String(g.country ?? ''),
        principalOwnerName: String(g.principalOwnerName ?? ''),
        entities: {
          total: ent.total,
          byStatus: ent.byStatus,
          weightedOwnershipPctSum:
            Math.round(ent.ownershipSum * 100) / 100,
        },
        // Multi-currency: an array, one entry per currency present.
        capitalFlowByCurrency: flowByGroup.get(gid) ?? [],
      };
    });

    return c.json(
      {
        success: true as const,
        data: {
          groups: rollup,
          count: rollup.length,
          flags: [
            'FLAG: capitalFlowByCurrency is the estate intercompany flow ' +
              '(estate_capital_movements), NOT a full per-entity general ' +
              'ledger balance — ledger_entries has no estate_entity_id, so a ' +
              'GL-per-entity rollup needs an entity↔ledger-account mapping.',
          ],
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId }, 'group_rollup_failed');
    return c.json(
      { success: false, error: { code: 'GROUP_ROLLUP_FAILED' } },
      500,
    );
  }
});

export default ownerGroupRollupRouter;
