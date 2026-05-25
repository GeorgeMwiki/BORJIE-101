/**
 * @borjie/document-ai — public entrypoint.
 *
 * Composition surface for callers. Re-exports every subsystem and the
 * `createDocumentAI` factory that wires them together with sensible
 * defaults (mock OCR + mock e-sig) so the package is safe to import
 * from any service without runtime dependencies on Anthropic, DocuSign,
 * tesseract, or pdf-lib.
 *
 * Subsystems are also reachable directly via subpath exports declared
 * in `package.json` (e.g. `@borjie/document-ai/ocr`).
 */

import type {
  BrainPort,
  ESignaturePort,
  EmbedderPort,
  OCRPort,
} from './types.js';
import { createMockOCRAdapter } from './ocr/mock-adapter.js';
import { createMockESignAdapter } from './e-signature/mock-adapter.js';

export * from './types.js';
export * from './ocr/index.js';
export * from './chat-with-doc/index.js';
export * from './form-extraction/index.js';
export * from './multilingual/index.js';
export * from './e-signature/index.js';
export * from './accessibility/index.js';

export interface CreateDocumentAIConfig {
  readonly ocr?: OCRPort;
  readonly brain?: BrainPort;
  readonly eSignature?: ESignaturePort;
  readonly embedder?: EmbedderPort;
}

export interface DocumentAI {
  readonly ocr: OCRPort;
  readonly brain: BrainPort | undefined;
  readonly eSignature: ESignaturePort;
  readonly embedder: EmbedderPort | undefined;
}

/**
 * Wire a Document AI instance.
 *
 *   const ai = createDocumentAI({ brain: realBrain });
 *   const doc = await ai.ocr.recognize({ bytes, mime, lang: ['sw'] });
 *
 * When `ocr` is omitted we default to the mock OCR with an empty fixture
 * so call-site wiring stays safe in unit tests. Pass a real adapter
 * in production.
 */
export function createDocumentAI(config: CreateDocumentAIConfig = {}): DocumentAI {
  return {
    ocr:
      config.ocr ??
      createMockOCRAdapter({ fixture: { pages: [] } }),
    brain: config.brain,
    eSignature: config.eSignature ?? createMockESignAdapter(),
    embedder: config.embedder,
  };
}
