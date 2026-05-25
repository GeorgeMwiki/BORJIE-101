/**
 * Shared report types and interfaces
 */

export type TenantId = string;
export type PropertyId = string;
export type CustomerId = string;

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ReportFilters {
  propertyIds?: PropertyId[];
  unitIds?: string[];
  status?: string[];
}

export type ReportType =
  | 'financial'
  | 'occupancy'
  | 'maintenance'
  | 'tenant'
  | 'property';

export type ReportFormat = 'pdf' | 'excel' | 'csv';

export interface ReportParams {
  tenantId: TenantId;
  dateRange?: DateRange;
  propertyIds?: PropertyId[];
  unitIds?: string[];
  period?: string;
}
