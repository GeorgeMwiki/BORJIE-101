/**
 * CSV Report Generator
 */

import type {
  IReportGenerator,
  ReportGeneratorOptions,
  ReportData,
} from './generator.interface.js';

export class CsvGenerator implements IReportGenerator {
  private static escape(value: unknown): string {
    const s = String(value ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  async generate(
    options: ReportGeneratorOptions,
    data: ReportData
  ): Promise<string> {
    const lines: string[] = [];
    lines.push(`# ${options.title}`);
    if (options.subtitle) {
      lines.push(`# ${options.subtitle}`);
    }
    lines.push(
      `# Generated: ${(options.generatedAt ?? new Date()).toISOString().slice(0, 19)}`
    );
    lines.push('');

    for (const section of data.sections) {
      lines.push(`## ${section.title}`);
      if (section.content) {
        lines.push(section.content);
      }
      if (section.table) {
        const headerRow = section.table.headers
          .map(CsvGenerator.escape)
          .join(',');
        lines.push(headerRow);
        for (const row of section.table.rows) {
          lines.push(row.map(CsvGenerator.escape).join(','));
        }
      }
      lines.push('');
    }

    if (data.summary && Object.keys(data.summary).length > 0) {
      lines.push('## Summary');
      for (const [key, value] of Object.entries(data.summary)) {
        lines.push(`${CsvGenerator.escape(key)},${CsvGenerator.escape(value)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate flat CSV from a single table (headers + rows)
   */
  static generateFlat(headers: string[], rows: (string | number)[][]): string {
    const headerRow = headers.map(CsvGenerator.escape).join(',');
    const dataRows = rows.map((row) =>
      row.map(CsvGenerator.escape).join(',')
    );
    return [headerRow, ...dataRows].join('\n');
  }

  static generateFromObjects<T extends Record<string, unknown>>(
    headers: string[],
    rows: T[],
    keyMap: (keyof T)[]
  ): string {
    const dataRows = rows.map((row) =>
      keyMap.map((k) => CsvGenerator.escape(row[k])).join(',')
    );
    return [headers.join(','), ...dataRows].join('\n');
  }
}
