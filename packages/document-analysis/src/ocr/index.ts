/**
 * OCR layer — born-digital text extraction first, Tesseract scans second.
 *
 * Production wiring:
 *  - born-digital PDFs → `pdf-parse` (lazy import)
 *  - scanned PDFs / images → `tesseract.js` with `eng + swa`
 *
 * Tests + fixtures use plain text already (.txt fixtures), so the
 * production path is exercised via the lazy adapter contract.
 */

export { detectLanguage, type DetectedLanguage } from './language.js';
export { extractText, type OcrResult } from './extract-text.js';
export {
  runTesseract,
  TesseractUnavailableError,
  type TesseractOptions,
} from './tesseract-adapter.js';
