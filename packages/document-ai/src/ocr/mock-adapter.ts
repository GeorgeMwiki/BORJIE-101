/**
 * createMockOCRAdapter — deterministic, test-only.
 *
 * Returns a ParsedDocument from a fixture passed at construction time.
 * Used by the chat-with-doc, form-extraction, and accessibility test
 * suites so they don't pull in tesseract.js or any external OCR engine.
 */

import type { OCRConfig, OCRPort, ParsedDocument, DocumentPage } from '../types.js';
import { buildParsedDocument } from './parsed-document-builder.js';

export interface MockOCRFixture {
  readonly id?: string;
  readonly pages: ReadonlyArray<DocumentPage>;
}

export interface MockOCRAdapterConfig {
  readonly fixture: MockOCRFixture;
  /** Override the source mime; defaults to whatever the caller passes. */
  readonly mime?: string;
}

export function createMockOCRAdapter(config: MockOCRAdapterConfig): OCRPort {
  return {
    id: 'mock-ocr',
    async recognize(input: OCRConfig): Promise<ParsedDocument> {
      const limited =
        typeof input.maxPages === 'number' && input.maxPages > 0
          ? config.fixture.pages.slice(0, input.maxPages)
          : config.fixture.pages;
      const built = await buildParsedDocument({
        ...(config.fixture.id !== undefined ? { id: config.fixture.id } : {}),
        sourceMime: config.mime ?? input.mime,
        sourceBytes: input.bytes,
        pages: limited,
        producedBy: 'mock-ocr',
      });
      return built;
    },
  };
}
