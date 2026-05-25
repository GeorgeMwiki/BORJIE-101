/**
 * XLSX parser for migration uploads.
 *
 * Uses `exceljs` when installed; throws `XlsxParserUnavailableError`
 * otherwise so callers can downgrade to CSV or prompt the admin to
 * re-upload. exceljs is an optional peer dep — see KI-015 for the
 * contingency plan if we want to take a hard dep.
 */

import type { SheetRow } from './csv-parser.js';

export interface ParsedXlsx {
  readonly sheets: Record<string, SheetRow[]>;
}

export class XlsxParserUnavailableError extends Error {
  readonly code = 'XLSX_PARSER_UNAVAILABLE';
  constructor(message = 'exceljs is not installed; XLSX parsing disabled.') {
    super(message);
    this.name = 'XlsxParserUnavailableError';
  }
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedXlsx> {
  // Runtime probe — keep this defensive so builds never break if
  // `exceljs` is absent in a given deployment image.
  try {
    const mod = (await import('exceljs').catch(() => null)) as
      | {
          Workbook: new () => {
            xlsx: { load: (b: Buffer) => Promise<void> };
            eachSheet: (
              cb: (ws: {
                name: string;
                rowCount: number;
                getRow: (n: number) => {
                  eachCell: (fn: (c: { value: unknown }, col: number) => void) => void;
                };
              }) => void
            ) => void;
          };
        }
      | null;

    if (!mod) throw new XlsxParserUnavailableError();

    const wb = new mod.Workbook();
    await wb.xlsx.load(buffer);
    const sheets: Record<string, SheetRow[]> = {};
    wb.eachSheet((ws) => {
      const headers: string[] = [];
      ws.getRow(1).eachCell((c, col) => {
        headers[col - 1] = String((c.value as string | number) ?? '');
      });
      const rows: SheetRow[] = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row: SheetRow = {};
        ws.getRow(r).eachCell((c, col) => {
          const key = headers[col - 1] ?? `col${col}`;
          const v = c.value;
          row[key] =
            v == null
              ? null
              : typeof v === 'number'
              ? v
              : String(v);
        });
        rows.push(row);
      }
      sheets[ws.name] = rows;
    });
    return { sheets };
  } catch (err) {
    if (err instanceof XlsxParserUnavailableError) throw err;
    throw new XlsxParserUnavailableError(
      `XLSX parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
