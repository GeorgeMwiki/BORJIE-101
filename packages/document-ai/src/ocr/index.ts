/**
 * @borjie/document-ai/ocr — OCR adapter barrel.
 *
 * All adapters return a normalized ParsedDocument so downstream
 * chat-with-doc, form-extraction, and accessibility code is engine-
 * agnostic.
 */

export { createMockOCRAdapter } from './mock-adapter.js';
export type { MockOCRAdapterConfig, MockOCRFixture } from './mock-adapter.js';

export { createTesseractAdapter } from './tesseract-adapter.js';
export type { TesseractAdapterConfig, TesseractLike } from './tesseract-adapter.js';

export { createAnthropicVisionAdapter } from './anthropic-vision-adapter.js';
export type { AnthropicVisionAdapterConfig } from './anthropic-vision-adapter.js';

export { createDoclingAdapter } from './docling-adapter.js';
export type { DoclingAdapterConfig } from './docling-adapter.js';

export { createMarkerAdapter } from './marker-adapter.js';
export type { MarkerAdapterConfig } from './marker-adapter.js';

export { buildPage, buildParsedDocument } from './parsed-document-builder.js';
export { sha256Hex } from './sha256.js';
