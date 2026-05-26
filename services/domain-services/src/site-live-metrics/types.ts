/**
 * Site live-metrics — types + Zod for the per-site operations snapshot.
 *
 * Aggregates real-time signals from `sites`, `assets`, `maintenance_
 * events`, `attendance`, and the safety/incident events for a single
 * site so the ops dashboards can pull a single shaped payload instead
 * of issuing 6+ queries from the BFF.
 */

import type { TenantId } from '@borjie/domain-models';

export interface SiteLiveMetrics {
  readonly tenantId: TenantId;
  readonly siteId: string;
  readonly siteName: string | null;
  /** active|paused|abandoned|under_rehab. */
  readonly status: string;
  /** Mining phase. */
  readonly phase: string;
  readonly assetCount: number;
  readonly operationalAssetCount: number;
  readonly underMaintenanceAssetCount: number;
  readonly brokenAssetCount: number;
  readonly openMaintenanceEvents: number;
  readonly recentBreakdowns7d: number;
  readonly attendanceTodayPresent: number;
  readonly attendanceTodayAbsent: number;
  readonly fetchedAt: string;
}

export interface SitePortfolioHints {
  /** Asset counts per site (used as a portfolio-weighting hint). */
  readonly assetCountBySiteId: Readonly<Record<string, number>>;
  /** Maintenance-event counts per site (last 30 days). */
  readonly maintenanceEvents30dBySiteId: Readonly<Record<string, number>>;
}

export interface SiteLiveMetricsSource {
  fetchMetrics(
    tenantId: TenantId,
    siteId: string,
  ): Promise<SiteLiveMetrics | null>;
  listSiteIds(tenantId: TenantId): Promise<readonly string[]>;
  fetchPortfolioHints(tenantId: TenantId): Promise<SitePortfolioHints>;
}
