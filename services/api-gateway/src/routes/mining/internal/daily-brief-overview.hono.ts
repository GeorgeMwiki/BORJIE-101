/**
 * /api/v1/mining/internal/daily-brief-overview — admin fleet view.
 *
 * Read-only aggregate of today's daily-brief activity ACROSS every
 * tenant. Powers the `<AdminDailyBriefCard>` panel on the admin
 * cockpit dashboard.
 *
 * Returns:
 *   {
 *     date,                    // EAT calendar date
 *     totals: { sent, failed, skipped, queued, tenantsActive },
 *     topAlerts: [             // up to 3 high-signal lines per
 *       { tenantId, tenantName, severity, kind, summary }
 *     ],
 *     perTenant: [             // detail rows for the drill-into UI
 *       { tenantId, tenantName, plan, dispatched, failed, skipped,
 *         snapshotId, hasSnapshot }
 *     ]
 *   }
 *
 * SUPER_ADMIN-only — this is fleet metadata, not tenant-scoped data.
 * The handler bypasses the per-tenant RLS scope (mirrors
 * tenants.hono.ts) so the aggregate sees every row.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { createLogger } from '../../../utils/logger';

const moduleLogger = createLogger('admin-daily-brief-overview');

export interface AdminDailyBriefOverview {
  readonly date: string;
  readonly totals: {
    readonly sent: number;
    readonly failed: number;
    readonly skipped: number;
    readonly queued: number;
    readonly tenantsActive: number;
  };
  readonly topAlerts: ReadonlyArray<{
    readonly tenantId: string;
    readonly tenantName: string;
    readonly severity: string;
    readonly kind: string;
    readonly summary: string;
  }>;
  readonly perTenant: ReadonlyArray<{
    readonly tenantId: string;
    readonly tenantName: string;
    readonly plan: string | null;
    readonly dispatched: number;
    readonly failed: number;
    readonly skipped: number;
    readonly snapshotId: string | null;
    readonly hasSnapshot: boolean;
  }>;
}

export function createAdminDailyBriefOverviewRouter(): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  app.get('/', async (c: any) => {
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DAILY_BRIEF_OVERVIEW_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }
    try {
      const overview = await composeOverview(db);
      return c.json({ success: true, data: overview }, 200);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      moduleLogger.error('admin daily-brief overview failed', {
        evt: 'admin_daily_brief_overview_failed',
        reason,
      });
      return c.json(
        {
          success: false,
          error: { code: 'DAILY_BRIEF_OVERVIEW_FAILED', message: reason },
        },
        500,
      );
    }
  });

  return app;
}

async function composeOverview(db: {
  execute(q: unknown): Promise<unknown>;
}): Promise<AdminDailyBriefOverview> {
  const date = todayInTz('Africa/Dar_es_Salaam');

  // 1) Dispatch counters for today across every tenant.
  const dispatchRows = rowsOf(
    await db.execute(sql`
      SELECT status, count(*)::int AS c
        FROM daily_brief_dispatches
       WHERE snapshot_date = ${date}::date
       GROUP BY status
    `),
  );
  const totals = { sent: 0, failed: 0, skipped: 0, queued: 0, tenantsActive: 0 };
  for (const r of dispatchRows) {
    const s = String((r as Record<string, unknown>).status ?? '');
    const c = Number((r as Record<string, unknown>).c ?? 0);
    if (s === 'sent') totals.sent = c;
    else if (s === 'failed') totals.failed = c;
    else if (s === 'skipped') totals.skipped = c;
  }

  // 2) Active tenants — those with `daily_brief_cadence != 'off'` and at
  // least one recipient.
  const activeRow = rowsOf(
    await db.execute(sql`
      SELECT count(*)::int AS c
        FROM tenants
       WHERE status = 'active'
         AND daily_brief_cadence <> 'off'
         AND daily_brief_recipients IS NOT NULL
         AND jsonb_array_length(daily_brief_recipients) > 0
    `),
  );
  totals.tenantsActive = Number(
    (activeRow[0] as Record<string, unknown> | undefined)?.c ?? 0,
  );
  totals.queued = Math.max(0, totals.tenantsActive - countSentTenants(dispatchRows));

  // 3) Per-tenant detail — join dispatches × snapshots × tenants.
  const perTenantRows = rowsOf(
    await db.execute(sql`
      SELECT t.id::text                          AS tenant_id,
             t.name                              AS tenant_name,
             t.plan::text                        AS plan,
             COALESCE(s.snapshot_id::text, NULL) AS snapshot_id,
             COALESCE(s.has_snap, false)         AS has_snapshot,
             COALESCE(d.dispatched, 0)::int      AS dispatched,
             COALESCE(d.failed, 0)::int          AS failed,
             COALESCE(d.skipped, 0)::int         AS skipped
        FROM tenants t
        LEFT JOIN LATERAL (
          SELECT id AS snapshot_id, true AS has_snap
            FROM owner_brief_snapshots
           WHERE tenant_id = t.id::uuid
             AND snapshot_date = ${date}::date
           ORDER BY generated_at DESC
           LIMIT 1
        ) s ON true
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE status = 'sent')    AS dispatched,
                 count(*) FILTER (WHERE status = 'failed')  AS failed,
                 count(*) FILTER (WHERE status = 'skipped') AS skipped
            FROM daily_brief_dispatches
           WHERE tenant_id = t.id::uuid
             AND snapshot_date = ${date}::date
        ) d ON true
       WHERE t.status = 'active'
         AND t.daily_brief_cadence <> 'off'
       ORDER BY d.failed DESC NULLS LAST, t.name ASC
       LIMIT 100
    `),
  );
  const perTenant = perTenantRows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      tenantId: String(row.tenant_id ?? ''),
      tenantName: String(row.tenant_name ?? '—'),
      plan: row.plan == null ? null : String(row.plan),
      dispatched: Number(row.dispatched ?? 0),
      failed: Number(row.failed ?? 0),
      skipped: Number(row.skipped ?? 0),
      snapshotId: row.snapshot_id == null ? null : String(row.snapshot_id),
      hasSnapshot: Boolean(row.has_snapshot),
    };
  });

  // 4) Top alerts — pull the top 3 alert-level decisions across every
  // tenant snapshot for today. The brief.decisions.items array holds
  // alert-level lines; we cap at 3 for the admin overview card.
  const alertRows = rowsOf(
    await db.execute(sql`
      WITH today_snaps AS (
        SELECT s.tenant_id, s.brief, t.name AS tenant_name
          FROM owner_brief_snapshots s
          JOIN tenants t ON t.id::uuid = s.tenant_id
         WHERE s.snapshot_date = ${date}::date
         ORDER BY s.generated_at DESC
      )
      SELECT tenant_id::text AS tenant_id,
             tenant_name,
             item->>'severity' AS severity,
             item->>'kind'     AS kind,
             item->>'summary'  AS summary
        FROM today_snaps,
             jsonb_array_elements(COALESCE(brief->'decisions'->'items', '[]'::jsonb)) AS item
       WHERE COALESCE(item->>'severity', '') IN ('critical','high')
       ORDER BY CASE COALESCE(item->>'severity', '')
                  WHEN 'critical' THEN 0
                  WHEN 'high'     THEN 1
                  ELSE 2 END
       LIMIT 3
    `),
  );
  const topAlerts = alertRows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      tenantId: String(row.tenant_id ?? ''),
      tenantName: String(row.tenant_name ?? '—'),
      severity: String(row.severity ?? 'high'),
      kind: String(row.kind ?? 'incident'),
      summary: String(row.summary ?? ''),
    };
  });

  return { date, totals, topAlerts, perTenant };
}

function countSentTenants(
  dispatchRows: ReadonlyArray<Record<string, unknown>>,
): number {
  let n = 0;
  for (const r of dispatchRows) {
    if (String(r.status) === 'sent') n = Number(r.c ?? 0);
  }
  return n;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: unknown }).rows;
  return Array.isArray(wrapped)
    ? (wrapped as ReadonlyArray<Record<string, unknown>>)
    : [];
}

function todayInTz(timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export const adminDailyBriefOverviewRouter = createAdminDailyBriefOverviewRouter();
export default adminDailyBriefOverviewRouter;
