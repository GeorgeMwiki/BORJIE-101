/**
 * OCR shim.
 *
 * We deliberately do NOT bundle Tesseract.js (60+ MB of WASM artifacts).
 * Instead, the schema-sniff API exposes an OcrProvider interface; production
 * callers wire either:
 *
 *   - Tesseract.js (in-process)
 *   - A cloud-OCR connector (Google Cloud Vision, AWS Textract, etc.)
 *
 * For tests and offline development we ship `noopOcrProvider`, which throws,
 * and `staticOcrProvider`, which returns a canned response. CL-B2-or-later
 * will swap in the real provider.
 */

import { parsePdfText } from './pdf-adapter.js';
import type { ParsedTable } from './types.js';

export interface OcrProvider {
  /**
   * Extract text from raw image bytes. Implementations SHOULD return the
   * best-effort plain-text reconstruction; tabular layout is recovered
   * downstream by parsePdfText (the same line/column heuristic applies).
   */
  extractText(bytes: Uint8Array | Buffer): Promise<string>;
  /** Human-readable provider name, for telemetry. */
  readonly name: string;
}

export const noopOcrProvider: OcrProvider = Object.freeze({
  name: 'noop',
  async extractText(): Promise<string> {
    throw new Error(
      'No OCR provider configured. Wire Tesseract.js or a cloud-OCR connector via OcrProvider before ingesting image files.'
    );
  },
});

/**
 * Test/dev helper: returns the supplied text regardless of input bytes.
 * Useful for fixtures where the "OCR" output is known.
 */
export function staticOcrProvider(text: string): OcrProvider {
  return Object.freeze({
    name: 'static',
    async extractText(): Promise<string> {
      return text;
    },
  });
}

/**
 * Convenience: run OCR on the supplied bytes, then feed the recovered text
 * through the PDF text→table heuristic. The result is tagged as
 * source_format: 'image_ocr' so downstream layers can choose a different
 * LLM prompt (OCR text is noisier than native PDF text).
 */
export async function ocrToTable(
  bytes: Uint8Array | Buffer,
  provider: OcrProvider
): Promise<ParsedTable> {
  const text = await provider.extractText(bytes);
  const tab = parsePdfText(text);
  return Object.freeze({
    headers: tab.headers,
    rows: tab.rows,
    source_format: 'image_ocr',
    ingest_warnings: tab.ingest_warnings,
  });
}
