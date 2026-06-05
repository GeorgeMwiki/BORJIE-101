/**
 * Shared report types and interfaces
 */

// TenantId is the multi-tenancy (per-org) scope key, NOT a real-estate renter.
export type TenantId = string;
export type SiteId = string;
export type CustomerId = string;

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ReportFilters {
  siteIds?: SiteId[];
  unitIds?: string[];
  status?: string[];
}

export type ReportType =
  | 'financial'
  | 'asset_utilisation'
  | 'maintenance'
  | 'buyer'
  | 'site';

export type ReportFormat = 'pdf' | 'excel' | 'csv';

export interface ReportParams {
  tenantId: TenantId;
  dateRange?: DateRange;
  siteIds?: SiteId[];
  unitIds?: string[];
  period?: string;
}
