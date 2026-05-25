/**
 * PDF Report Generator using PDFKit
 */

import PDFDocument from 'pdfkit';
import type {
  IReportGenerator,
  ReportGeneratorOptions,
  ReportData,
} from './generator.interface.js';
import { ReportGeneratorError } from './generator.interface.js';

export class PdfGenerator implements IReportGenerator {
  private doc: InstanceType<typeof PDFDocument> | null = null;
  private chunks: Buffer[] = [];

  async generate(
    options: ReportGeneratorOptions,
    data: ReportData
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const handleError = (err: unknown) => {
        reject(
          err instanceof ReportGeneratorError
            ? err
            : new ReportGeneratorError(
                err instanceof Error ? err.message : String(err),
                'pdf',
                err
              )
        );
      };

      try {
        this.chunks = [];
        this.doc = new PDFDocument({ margin: options.margin ?? 50 });
        this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
        this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
        this.doc.on('error', handleError);

        this.doc.fontSize(20).text(options.title);
        if (options.subtitle) {
          this.doc.fontSize(12).text(options.subtitle, { continued: false });
        }
        const generatedAt =
          options.generatedAt ?? new Date();
        this.doc
          .fontSize(10)
          .fillColor('#666666')
          .text(
            `Generated: ${generatedAt.toISOString().slice(0, 19).replace('T', ' ')}`,
            { continued: false }
          )
          .fillColor('#000000');
        this.doc.moveDown(1.5);

        for (const section of data.sections) {
          this.doc.fontSize(14).text(section.title).moveDown(0.5);
          if (section.content) {
            this.doc.fontSize(10).text(section.content).moveDown(0.5);
          }
          if (section.table) {
            this.addTable(section.table.headers, section.table.rows);
          }
          this.doc.moveDown(1);
        }

        if (data.summary && Object.keys(data.summary).length > 0) {
          this.doc.fontSize(12).text('Summary').moveDown(0.5);
          this.doc.fontSize(10);
          for (const [key, value] of Object.entries(data.summary)) {
            this.doc.text(`${key}: ${value}`);
          }
        }

        this.doc.end();
      } catch (err) {
        handleError(err);
      }
    });
  }

  private addTable(headers: string[], rows: (string | number)[][]): void {
    if (!this.doc) return;
    const colWidth = 120;
    const startX = 50;
    let y = this.doc.y;

    this.doc.fontSize(10);
    headers.forEach((header, i) => {
      this.doc!.font('Helvetica-Bold').text(String(header), startX + i * colWidth, y, {
        width: colWidth - 5,
      });
    });
    y += 20;

    rows.forEach((row) => {
      row.forEach((cell, i) => {
        this.doc!.font('Helvetica').text(String(cell), startX + i * colWidth, y, {
          width: colWidth - 5,
        });
      });
      y += 15;
    });
    this.doc!.y = y + 10;
  }
}
