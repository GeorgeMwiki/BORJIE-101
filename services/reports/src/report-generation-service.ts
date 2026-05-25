/**
 * Main Report Generation Service
 * Orchestrates report generation, scheduling, storage, and delivery
 */

import {
  PdfGenerator,
  ExcelGenerator,
  CsvGenerator,
  type ReportData,
  type ReportGeneratorOptions,
} from './generators/index.js';
import type { ReportType, ReportFormat } from './reports/report-types.js';
import { financialReportToReportData } from './reports/financial-report.js';
import { occupancyReportToReportData } from './reports/occupancy-report.js';
import { maintenanceReportToReportData } from './reports/maintenance-report.js';
import { tenantReportToReportData } from './reports/tenant-report.js';
import { propertyReportToReportData } from './reports/property-report.js';
import type { IReportDataProvider } from './data-provider.interface.js';
import type { IReportStorage } from './storage/storage.js';
import type { ReportListFilters } from './storage/storage.js';
import { ReportScheduler } from './scheduler/scheduler.js';
import type { ScheduleConfig } from './scheduler/scheduler.js';
import type { StoredReport } from './storage/storage.js';

/** Error codes for report generation failures */
export type ReportGenerationErrorCode =
  | 'INVALID_PARAMS'
  | 'INVALID_FORMAT'
  | 'INVALID_REPORT_TYPE'
  | 'SCHEDULER_NOT_CONFIGURED'
  | 'STORAGE_ERROR'
  | 'DATA_PROVIDER_ERROR'
  | 'GENERATION_FAILED';

export class ReportGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: ReportGenerationErrorCode,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ReportGenerationError';
  }
}

const REPORT_TITLES: Record<ReportType, string> = {
  financial: 'Financial Report',
  occupancy: 'Occupancy Report',
  maintenance: 'Maintenance Report',
  tenant: 'Tenant Report',
  property: 'Property Report',
};

export interface ReportGenerationServiceOptions {
  dataProvider: IReportDataProvider;
  storage: IReportStorage;
  scheduler?: ReportScheduler;
  persistReports?: boolean;
}

export class ReportGenerationService {
  private readonly pdfGenerator = new PdfGenerator();
  private readonly excelGenerator = new ExcelGenerator();
  private readonly csvGenerator = new CsvGenerator();

  constructor(private readonly options: ReportGenerationServiceOptions) {}

  /**
   * Generate a report
   * @param reportType - Type of report (financial, occupancy, maintenance, tenant, property)
   * @param params - Report parameters (tenantId required, optional dateRange, propertyIds, period)
   * @param format - Output format (pdf, excel, csv)
   * @returns Report content and optional reportId if persisted
   */
  async generateReport(
    reportType: ReportType,
    params: Record<string, unknown>,
    format: ReportFormat
  ): Promise<{ reportId?: string; content: Buffer | string }> {
    this.validateReportType(reportType);
    this.validateFormat(format);

    const tenantId = params.tenantId as string;
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ReportGenerationError(
        'tenantId is required in params and must be a string',
        'INVALID_PARAMS'
      );
    }

    try {
      const reportParams = this.normalizeParams(params);
      const reportData = await this.fetchReportData(
        reportType,
        tenantId,
        reportParams
      );
      const structuredData = this.toReportData(reportType, reportData);
      const options: ReportGeneratorOptions = {
        title: REPORT_TITLES[reportType],
        subtitle: this.getSubtitle(reportType, params),
        generatedAt: new Date(),
      };

      let content: Buffer | string;

      switch (format) {
        case 'pdf':
          content = await this.pdfGenerator.generate(options, structuredData);
          break;
        case 'excel':
          content = await this.excelGenerator.generate(options, structuredData);
          break;
        case 'csv':
          content = await this.csvGenerator.generate(options, structuredData);
          break;
        default:
          throw new ReportGenerationError(
            `Unsupported format: ${format}`,
            'INVALID_FORMAT'
          );
      }

      if (this.options.persistReports !== false && this.options.storage) {
        const stored = await this.options.storage.save(
          tenantId,
          reportType,
          format,
          content,
          params
        );
        return { reportId: stored.id, content };
      }

      return { content };
    } catch (err) {
      if (err instanceof ReportGenerationError) throw err;
      throw new ReportGenerationError(
        err instanceof Error ? err.message : String(err),
        'GENERATION_FAILED',
        err
      );
    }
  }

  private validateReportType(reportType: string): asserts reportType is ReportType {
    const valid: ReportType[] = ['financial', 'occupancy', 'maintenance', 'tenant', 'property'];
    if (!valid.includes(reportType as ReportType)) {
      throw new ReportGenerationError(
        `Unknown report type: ${reportType}. Valid types: ${valid.join(', ')}`,
        'INVALID_REPORT_TYPE'
      );
    }
  }

  private validateFormat(format: string): asserts format is ReportFormat {
    const valid: ReportFormat[] = ['pdf', 'excel', 'csv'];
    if (!valid.includes(format as ReportFormat)) {
      throw new ReportGenerationError(
        `Unsupported format: ${format}. Valid formats: ${valid.join(', ')}`,
        'INVALID_FORMAT'
      );
    }
  }

  /**
   * Schedule a recurring report
   */
  async scheduleReport(
    reportType: ReportType,
    params: Record<string, unknown>,
    schedule: ScheduleConfig
  ): Promise<{ scheduleId: string }> {
    const scheduler = this.options.scheduler;
    if (!scheduler) {
      throw new ReportGenerationError(
        'Scheduler not configured',
        'SCHEDULER_NOT_CONFIGURED'
      );
    }

    const tenantId = params.tenantId as string;
    if (!tenantId) {
      throw new ReportGenerationError(
        'tenantId is required in params',
        'INVALID_PARAMS'
      );
    }

    const scheduled = await scheduler.scheduleReport(
      tenantId,
      reportType,
      params,
      schedule
    );
    return { scheduleId: scheduled.id };
  }

  /**
   * Get a stored report by ID
   */
  async getReport(
    reportId: string
  ): Promise<{ report: StoredReport; content: Buffer } | null> {
    return this.options.storage.get(reportId);
  }

  /**
   * List stored reports with filters
   */
  async listReports(filters: ReportListFilters): Promise<StoredReport[]> {
    return this.options.storage.list(filters);
  }

  /**
   * Cancel a scheduled report
   */
  async cancelSchedule(scheduleId: string): Promise<boolean> {
    const scheduler = this.options.scheduler;
    if (!scheduler) {
      throw new ReportGenerationError(
        'Scheduler not configured',
        'SCHEDULER_NOT_CONFIGURED'
      );
    }
    return scheduler.cancelSchedule(scheduleId);
  }

  private normalizeParams(params: Record<string, unknown>): {
    tenantId: string;
    dateRange?: { start: Date; end: Date };
    propertyIds?: string[];
    period?: string;
  } {
    const tenantId = params.tenantId as string;
    const result: ReturnType<
      ReportGenerationService['normalizeParams']
    > = {
      tenantId,
    };

    if (params.dateRange) {
      const dr = params.dateRange as { start: string; end: string };
      result.dateRange = {
        start: new Date(dr.start),
        end: new Date(dr.end),
      };
    } else {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now);
      result.dateRange = { start, end };
    }

    if (params.propertyIds) {
      result.propertyIds = params.propertyIds as string[];
    }
    if (params.period) {
      result.period = params.period as string;
    }

    return result;
  }

  private async fetchReportData(
    reportType: ReportType,
    tenantId: string,
    params: ReturnType<ReportGenerationService['normalizeParams']>
  ): Promise<unknown> {
    const reportParams = {
      tenantId: params.tenantId,
      dateRange: params.dateRange,
      propertyIds: params.propertyIds,
      period: params.period,
    };

    switch (reportType) {
      case 'financial':
        return this.options.dataProvider.getFinancialData(
          tenantId,
          reportParams
        );
      case 'occupancy':
        return this.options.dataProvider.getOccupancyData(
          tenantId,
          reportParams
        );
      case 'maintenance':
        return this.options.dataProvider.getMaintenanceData(
          tenantId,
          reportParams
        );
      case 'tenant':
        return this.options.dataProvider.getTenantData(
          tenantId,
          reportParams
        );
      case 'property':
        return this.options.dataProvider.getPropertyData(
          tenantId,
          reportParams
        );
      default:
        throw new ReportGenerationError(
          `Unknown report type: ${reportType}`,
          'INVALID_REPORT_TYPE'
        );
    }
  }

  private toReportData(reportType: ReportType, data: unknown): ReportData {
    switch (reportType) {
      case 'financial':
        return financialReportToReportData(
          data as import('./reports/financial-report.js').FinancialReportData
        );
      case 'occupancy':
        return occupancyReportToReportData(
          data as import('./reports/occupancy-report.js').OccupancyReportData
        );
      case 'maintenance':
        return maintenanceReportToReportData(
          data as import('./reports/maintenance-report.js').MaintenanceReportData
        );
      case 'tenant':
        return tenantReportToReportData(
          data as import('./reports/tenant-report.js').TenantReportData
        );
      case 'property':
        return propertyReportToReportData(
          data as import('./reports/property-report.js').PropertyReportData
        );
      default:
        throw new ReportGenerationError(
          `Unknown report type: ${reportType}`,
          'INVALID_REPORT_TYPE'
        );
    }
  }

  private getSubtitle(
    reportType: ReportType,
    params: Record<string, unknown>
  ): string {
    const dateRange = params.dateRange as
      | { start: string; end: string }
      | undefined;
    if (dateRange) {
      return `Period: ${dateRange.start} to ${dateRange.end}`;
    }
    const period = params.period as string;
    return period ? `Period: ${period}` : '';
  }
}
