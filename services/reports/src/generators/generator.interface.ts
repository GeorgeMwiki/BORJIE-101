/**
 * Common interface for report generators
 */

export interface ReportGeneratorOptions {
  title: string;
  subtitle?: string;
  generatedAt?: Date;
  metadata?: Record<string, unknown>;
  margin?: number;
}

export interface TableData {
  headers: string[];
  rows: (string | number)[][];
}

export interface ReportData {
  sections: Array<{
    title: string;
    content?: string;
    table?: TableData;
  }>;
  summary?: Record<string, string | number>;
}

export interface IReportGenerator {
  /**
   * Generate report content from structured data
   * @param options - Report options (title, subtitle, etc.)
   * @param data - Structured report data
   * @returns Buffer for binary formats (PDF, Excel) or string for text formats (CSV)
   */
  generate(
    options: ReportGeneratorOptions,
    data: ReportData
  ): Promise<Buffer | string>;
}

export type ReportFormat = 'pdf' | 'excel' | 'csv';

/** Thrown when report generation fails */
export class ReportGeneratorError extends Error {
  constructor(
    message: string,
    public readonly generator: string,
    public override readonly cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'ReportGeneratorError';
  }
}
