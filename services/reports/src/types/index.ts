/**
 * Report and Analytics types
 */

export type TenantId = string;
export type PropertyId = string;
export type CustomerId = string;
export type UserId = string;

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ReportFilters {
  propertyIds?: PropertyId[];
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
