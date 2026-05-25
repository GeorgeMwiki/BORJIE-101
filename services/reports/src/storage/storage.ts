/**
 * Report storage - Store generated reports
 */

import { v4 as uuidv4 } from 'uuid';
import type { ReportFormat, ReportType } from '../reports/report-types.js';

export interface StoredReport {
  id: string;
  tenantId: string;
  reportType: ReportType;
  format: ReportFormat;
  filename: string;
  size: number;
  generatedAt: Date;
  params: Record<string, unknown>;
}

export interface ReportStorageOptions {
  basePath?: string;
}

export interface IReportStorage {
  save(
    tenantId: string,
    reportType: ReportType,
    format: ReportFormat,
    content: Buffer | string,
    params?: Record<string, unknown>
  ): Promise<StoredReport>;

  get(reportId: string): Promise<{ report: StoredReport; content: Buffer } | null>;

  list(filters: ReportListFilters): Promise<StoredReport[]>;

  delete(reportId: string): Promise<boolean>;
}

export interface ReportListFilters {
  tenantId?: string;
  reportType?: ReportType;
  format?: ReportFormat;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * In-memory report storage (for development / testing)
 * In production, use S3, filesystem, or cloud storage
 */
export class InMemoryReportStorage implements IReportStorage {
  private reports: Map<string, StoredReport> = new Map();
  private content: Map<string, Buffer> = new Map();

  async save(
    tenantId: string,
    reportType: ReportType,
    format: ReportFormat,
    content: Buffer | string,
    params: Record<string, unknown> = {}
  ): Promise<StoredReport> {
    const id = uuidv4();
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const ext = format === 'csv' ? 'csv' : format === 'excel' ? 'xlsx' : 'pdf';
    const filename = `${reportType}-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}.${ext}`;

    const report: StoredReport = {
      id,
      tenantId,
      reportType,
      format,
      filename,
      size: buffer.length,
      generatedAt: new Date(),
      params,
    };

    this.reports.set(id, report);
    this.content.set(id, buffer);
    return report;
  }

  async get(
    reportId: string
  ): Promise<{ report: StoredReport; content: Buffer } | null> {
    const report = this.reports.get(reportId);
    const buffer = this.content.get(reportId);
    if (!report || !buffer) return null;
    return { report, content: buffer };
  }

  async list(filters: ReportListFilters): Promise<StoredReport[]> {
    let results = Array.from(this.reports.values());

    if (filters.tenantId) {
      results = results.filter((r) => r.tenantId === filters.tenantId);
    }
    if (filters.reportType) {
      results = results.filter((r) => r.reportType === filters.reportType);
    }
    if (filters.format) {
      results = results.filter((r) => r.format === filters.format);
    }
    if (filters.from) {
      results = results.filter((r) => r.generatedAt >= filters.from!);
    }
    if (filters.to) {
      results = results.filter((r) => r.generatedAt <= filters.to!);
    }

    results.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  async delete(reportId: string): Promise<boolean> {
    const existed = this.reports.has(reportId);
    this.reports.delete(reportId);
    this.content.delete(reportId);
    return existed;
  }
}
