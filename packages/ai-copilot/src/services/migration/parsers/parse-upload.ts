/**
 * Dispatcher: turn an uploaded file buffer into the `sheets` + `plainText`
 * shape consumed by `skill.migration.extract`.
 */

import { parseCsv, type SheetRow } from './csv-parser.js';
import { parseXlsx, XlsxParserUnavailableError } from './xlsx-parser.js';
import { parsePdfText, type PdfOcrCaller } from './pdf-text-parser.js';

export interface ParseUploadResult {
  readonly sheets: Record<string, SheetRow[]>;
  readonly plainText?: string;
  readonly warnings: string[];
  readonly detectedMimeType: string;
}

export interface ParseUploadOptions {
  readonly filename?: string;
  /** Required when uploading PDFs. */
  readonly ocr?: PdfOcrCaller;
  readonly language?: string;
}

export async function parseUpload(
  buffer: Buffer,
  mimeType: string,
  options: ParseUploadOptions = {}
): Promise<ParseUploadResult> {
  const warnings: string[] = [];
  const normalized = normalizeMime(mimeType, options.filename);

  if (normalized === 'text/csv') {
    const sheetName = options.filename ?? 'sheet1';
    const { rows } = await parseCsv(buffer, sheetName);
    return {
      sheets: { [sheetName]: rows },
      warnings,
      detectedMimeType: normalized,
    };
  }

  if (normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    try {
      const { sheets } = await parseXlsx(buffer);
      return { sheets, warnings, detectedMimeType: normalized };
    } catch (err) {
      if (err instanceof XlsxParserUnavailableError) {
        warnings.push(err.message);
        return { sheets: {}, warnings, detectedMimeType: normalized };
      }
      throw err;
    }
  }

  if (normalized === 'application/pdf') {
    if (!options.ocr) {
      warnings.push('PDF uploaded but no OCR provider available; extraction skipped.');
      return { sheets: {}, warnings, detectedMimeType: normalized };
    }
    const { plainText } = await parsePdfText(buffer, options.ocr, {
      language: options.language,
    });
    return { sheets: {}, plainText, warnings, detectedMimeType: normalized };
  }

  if (normalized.startsWith('text/')) {
    return {
      sheets: {},
      plainText: buffer.toString('utf8'),
      warnings,
      detectedMimeType: normalized,
    };
  }

  warnings.push(`Unsupported mime type: ${normalized}`);
  return { sheets: {}, warnings, detectedMimeType: normalized };
}

function normalizeMime(mime: string, filename?: string): string {
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = filename?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'csv':
      return 'text/csv';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    default:
      return mime || 'application/octet-stream';
  }
}
