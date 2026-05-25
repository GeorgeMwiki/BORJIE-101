/**
 * PDF-to-text via the OCR factory.
 *
 * For the migration wizard we want raw-text extraction so the LLM can
 * look for ledger patterns in handwritten or scanned documents.
 */

import type { SheetRow } from './csv-parser.js';

export interface PdfTextParseResult {
  readonly plainText: string;
  /** Optional sheet-ish extraction if tables were detected. */
  readonly sheets?: Record<string, SheetRow[]>;
}

export interface PdfOcrCaller {
  extractText(
    buffer: Buffer,
    mimeType: string,
    options?: { language?: string; documentType?: string }
  ): Promise<{ rawText: string | null }>;
}

export async function parsePdfText(
  buffer: Buffer,
  ocr: PdfOcrCaller,
  opts?: { language?: string }
): Promise<PdfTextParseResult> {
  const result = await ocr.extractText(buffer, 'application/pdf', {
    language: opts?.language ?? 'en',
    documentType: 'other',
  });
  return { plainText: result.rawText ?? '' };
}
