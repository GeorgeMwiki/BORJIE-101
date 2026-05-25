/**
 * Excel Report Generator using ExcelJS
 */

import ExcelJS from 'exceljs';
import type {
  IReportGenerator,
  ReportGeneratorOptions,
  ReportData,
} from './generator.interface.js';
import { ReportGeneratorError } from './generator.interface.js';

export class ExcelGenerator implements IReportGenerator {
  private workbook: ExcelJS.Workbook;

  constructor() {
    this.workbook = new ExcelJS.Workbook();
  }

  async generate(
    options: ReportGeneratorOptions,
    data: ReportData
  ): Promise<Buffer> {
    try {
      this.workbook = new ExcelJS.Workbook();
      this.workbook.creator = 'BORJIE Reports';
      this.workbook.created = options.generatedAt ?? new Date();

      const sheet = this.workbook.addWorksheet(
        this.sanitizeSheetName(options.title) || 'Report',
        { properties: { tabColor: { argb: '4472C4' } } }
      );

      let row = 1;
      sheet.getCell(row, 1).value = options.title;
      sheet.getCell(row, 1).font = { size: 16, bold: true };
      row += 1;

      if (options.subtitle) {
        sheet.getCell(row, 1).value = options.subtitle;
        sheet.getCell(row, 1).font = { size: 11, italic: true };
        row += 1;
      }

      sheet.getCell(row, 1).value = `Generated: ${(options.generatedAt ?? new Date()).toISOString().slice(0, 19)}`;
      sheet.getCell(row, 1).font = { size: 9 };
      row += 2;

      for (const section of data.sections) {
        sheet.getCell(row, 1).value = section.title;
        sheet.getCell(row, 1).font = { size: 12, bold: true };
        row += 1;

        if (section.content) {
          sheet.getCell(row, 1).value = section.content;
          row += 1;
        }

        if (section.table) {
          section.table.headers.forEach((header, col) => {
            const cell = sheet.getCell(row, col + 1);
            cell.value = header;
            cell.font = { bold: true };
          });
          row += 1;

          for (const dataRow of section.table.rows) {
            dataRow.forEach((cell, col) => {
              sheet.getCell(row, col + 1).value = cell;
            });
            row += 1;
          }
          row += 1;
        }
      }

      if (data.summary && Object.keys(data.summary).length > 0) {
        sheet.getCell(row, 1).value = 'Summary';
        sheet.getCell(row, 1).font = { size: 12, bold: true };
        row += 1;
        for (const [key, value] of Object.entries(data.summary)) {
          sheet.getCell(row, 1).value = key;
          sheet.getCell(row, 2).value = value;
          row += 1;
        }
      }

      ["A", "B", "C", "D", "E", "F", "G"].forEach((col) => {
        const colObj = sheet.getColumn(col);
        if (colObj) colObj.width = 18;
      });

      const buffer = await this.workbook.xlsx.writeBuffer();
      return Buffer.from(buffer as ArrayBuffer);
    } catch (err) {
      throw err instanceof ReportGeneratorError
        ? err
        : new ReportGeneratorError(
            err instanceof Error ? err.message : String(err),
            'excel',
            err
          );
    }
  }

  private sanitizeSheetName(name: string): string {
    return name.replace(/[\\/*?:\[\]]/g, '').slice(0, 31);
  }
}
