/**
 * Report and Analytics types
 */

// TenantId is the multi-tenancy (per-org) scope key, NOT a real-estate renter.
export type TenantId = string;
export type SiteId = string;
export type CustomerId = string;
export type UserId = string;

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ReportFilters {
  siteIds?: SiteId[];
  unitIds?: string[];
  status?: string[];
}

export type ReportFormat = 'pdf' | 'excel' | 'csv';

export type ReportPeriod = 'monthly' | 'quarterly' | 'annual';

export interface ScheduledReportConfig {
  reportType: string;
  schedule: string; // cron expression
  recipients: string[];
  format: ReportFormat;
  filters?: ReportFilters;
}
