/**
 * Drizzle-backed Site Live Metrics source (Borjie mining).
 *
 * Aggregates real-time per-site operations signals from `sites`,
 * `assets`, `maintenance_events`, and `attendance`. Conservative
 * by design: any optional dimension that throws (missing column,
 * empty table) degrades to zero instead of failing the whole
 * snapshot.
 *
 * Every query enforces row-level tenant isolation via
 * `WHERE tenant_id = :ctx`.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { assets, attendance, sites } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import type {
  SiteLiveMetrics,
  SiteLiveMetricsSource,
  SitePortfolioHints,
} from './types.js';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => unknown;
  execute: (q: unknown) => Promise<unknown>;
  [k: string]: unknown;
}

export interface DrizzleSiteLiveMetricsSourceConfig {
  readonly db: DrizzleLike;
  /** Override for tests. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export class DrizzleSiteLiveMetricsSource implements SiteLiveMetricsSource {
  private readonly db: DrizzleLike;
  private readonly now: () => Date;

  constructor(config: DrizzleSiteLiveMetricsSourceConfig) {
    this.db = config.db;
    this.now = config.now ?? (() => new Date());
  }

  async fetchMetrics(
    tenantId: TenantId,
    siteId: string,
  ): Promise<SiteLiveMetrics | null> {
    const siteRows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof sites) => {
            where: (cond: unknown) => {
              limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(sites)
      .where(
        and(
          eq(sites.tenantId, tenantId as unknown as string),
          eq(sites.id, siteId),
        ),
      )
      .limit(1)) as readonly Record<string, unknown>[];
    if (siteRows.length === 0) return null;
    const siteRow = siteRows[0]!;

    const assetCounts = await this.fetchAssetCounts(tenantId, siteId);
    const maintenanceCounts = await this.fetchMaintenanceCounts(
      tenantId,
      siteId,
    );
    const attendanceCounts = await this.fetchAttendanceCounts(
      tenantId,
      siteId,
    );

    return {
      tenantId,
      siteId,
      siteName: (siteRow.name as string | null) ?? null,
      status: String(siteRow.status ?? 'active'),
      phase: String(siteRow.phase ?? 'pre_licence'),
      assetCount: assetCounts.total,
      operationalAssetCount: assetCounts.operational,
      underMaintenanceAssetCount: assetCounts.underMaintenance,
      brokenAssetCount: assetCounts.broken,
      openMaintenanceEvents: maintenanceCounts.open,
      recentBreakdowns7d: maintenanceCounts.recentBreakdowns,
      attendanceTodayPresent: attendanceCounts.present,
      attendanceTodayAbsent: attendanceCounts.absent,
      fetchedAt: this.now().toISOString(),
    };
  }

  async listSiteIds(tenantId: TenantId): Promise<readonly string[]> {
    const rows = (await (
      this.db as unknown as {
        select: (cols: Record<string, unknown>) => {
          from: (t: typeof sites) => {
            where: (cond: unknown) => Promise<readonly Record<string, unknown>[]>;
          };
        };
      }
    )
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId as unknown as string))) as readonly Record<
      string,
      unknown
    >[];
    return rows.map((r) => String(r.id));
  }

  async fetchPortfolioHints(
    tenantId: TenantId,
  ): Promise<SitePortfolioHints> {
    const assetCountBySiteId: Record<string, number> = {};
    const maintenanceEvents30dBySiteId: Record<string, number> = {};
    try {
      const rows = (await this.db.execute(sql`
        SELECT current_site_id AS site_id, COUNT(*)::int AS cnt
        FROM assets
        WHERE tenant_id = ${tenantId as unknown as string}
          AND current_site_id IS NOT NULL
        GROUP BY current_site_id
      `)) as unknown;
      const list = unwrapRows(rows);
      for (const r of list) {
        const sid = (r as Record<string, unknown>).site_id;
        const cnt = Number((r as Record<string, unknown>).cnt ?? 0);
        if (sid) assetCountBySiteId[String(sid)] = cnt;
      }
    } catch {
      // degrade silently
    }
    try {
      const rows = (await this.db.execute(sql`
        SELECT a.current_site_id AS site_id, COUNT(*)::int AS cnt
        FROM maintenance_events m
        JOIN assets a ON a.id = m.asset_id
        WHERE m.tenant_id = ${tenantId as unknown as string}
          AND a.current_site_id IS NOT NULL
          AND m.created_at > NOW() - INTERVAL '30 days'
        GROUP BY a.current_site_id
      `)) as unknown;
      const list = unwrapRows(rows);
      for (const r of list) {
        const sid = (r as Record<string, unknown>).site_id;
        const cnt = Number((r as Record<string, unknown>).cnt ?? 0);
        if (sid) maintenanceEvents30dBySiteId[String(sid)] = cnt;
      }
    } catch {
      // degrade silently
    }
    return { assetCountBySiteId, maintenanceEvents30dBySiteId };
  }

  private async fetchAssetCounts(
    tenantId: TenantId,
    siteId: string,
  ): Promise<{
    readonly total: number;
    readonly operational: number;
    readonly underMaintenance: number;
    readonly broken: number;
  }> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof assets) => {
            where: (cond: unknown) => Promise<readonly Record<string, unknown>[]>;
          };
        };
      }
    )
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.tenantId, tenantId as unknown as string),
          eq(assets.currentSiteId, siteId),
        ),
      )) as readonly Record<string, unknown>[];
    let total = 0;
    let operational = 0;
    let underMaintenance = 0;
    let broken = 0;
    for (const r of rows) {
      total += 1;
      const status = String(r.status ?? 'operational');
      if (status === 'operational') operational += 1;
      else if (status === 'under_maintenance') underMaintenance += 1;
      else if (status === 'broken') broken += 1;
    }
    return { total, operational, underMaintenance, broken };
  }

  private async fetchMaintenanceCounts(
    tenantId: TenantId,
    siteId: string,
  ): Promise<{
    readonly open: number;
    readonly recentBreakdowns: number;
  }> {
    try {
      const rows = (await this.db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE m.status = 'open')::int AS open,
          COUNT(*) FILTER (
            WHERE m.kind = 'breakdown'
              AND m.created_at > NOW() - INTERVAL '7 days'
          )::int AS recent_breakdowns
        FROM maintenance_events m
        JOIN assets a ON a.id = m.asset_id
        WHERE m.tenant_id = ${tenantId as unknown as string}
          AND a.current_site_id = ${siteId}
      `)) as unknown;
      const list = unwrapRows(rows);
      const r = list[0] as Record<string, unknown> | undefined;
      return {
        open: Number(r?.open ?? 0),
        recentBreakdowns: Number(r?.recent_breakdowns ?? 0),
      };
    } catch {
      // Raw SQL failed (schema drift / migration not applied). Degrade
      // silently to zeros rather than throw — the dashboard treats the
      // counts as "no signal" and surfaces a fresh-tenant placeholder.
      return { open: 0, recentBreakdowns: 0 };
    }
  }

  private async fetchAttendanceCounts(
    tenantId: TenantId,
    siteId: string,
  ): Promise<{ readonly present: number; readonly absent: number }> {
    try {
      const today = this.now().toISOString().slice(0, 10);
      const rows = (await (
        this.db as unknown as {
          select: () => {
            from: (t: typeof attendance) => {
              where: (cond: unknown) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        }
      )
        .select()
        .from(attendance)
        .where(
          and(
            eq(attendance.tenantId, tenantId as unknown as string),
            eq(attendance.siteId, siteId),
            gte(attendance.workDate, today),
          ),
        )) as readonly Record<string, unknown>[];
      let present = 0;
      let absent = 0;
      for (const r of rows) {
        const status = String(r.status ?? '');
        if (status === 'present') present += 1;
        else if (status === 'absent') absent += 1;
      }
      return { present, absent };
    } catch {
      return { present: 0, absent: 0 };
    }
  }
}

function unwrapRows(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const rows = (raw as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}
