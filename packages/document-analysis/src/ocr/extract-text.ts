/**
 * High-level text extraction selector. Picks the right adapter based on
 * MIME type and falls back gracefully when an optional dep is missing.
 *
 * Production paths:
 *   - text/plain, text/* → decode as UTF-8.
 *   - application/pdf → try pdf-parse (born-digital); if that yields
 *     nothing meaningful, escalate to Tesseract on each rasterised page.
 *   - image/* → Tesseract directly.
 *
 * The synthetic .txt fixtures used in tests hit the first path and never
 * load the optional deps.
 */

import { detectLanguage, type DetectedLanguage } from './language.js';
import { runTesseract, TesseractUnavailableError } from './tesseract-adapter.js';

export interface OcrResult {
  readonly text: string;
  readonly language: DetectedLanguage;
  /** Best-effort confidence in [0,1]. 1.0 for born-digital text. */
  readonly confidence: number;
  /** Best-effort page count if known. */
  readonly pageCount: number | null;
  /** Adapter that produced the result. */
  readonly method: 'native' | 'pdf-parse' | 'tesseract';
}

export interface ExtractTextInput {
  readonly content: Buffer | string;
  readonly mimeType: string;
  /** Hint from upstream: skip pdf-parse and go straight to OCR. */
  readonly forceOcr?: boolean;
}

const TEXT_LIKE_MIMES = new Set([
  'text/plain',
  'text/html',
  'text/markdown',
  'message/rfc822',
  'application/json',
]);

function isTextLikeMime(mime: string): boolean {
  return TEXT_LIKE_MIMES.has(mime) || mime.startsWith('text/');
}

function decodeText(buf: Buffer | string): string {
  return typeof buf === 'string' ? buf : buf.toString('utf8');
}

/**
 * Try the born-digital PDF path. Returns null if pdf-parse is unavailable
 * or extracted text is too short to be considered meaningful.
 */
async function tryPdfParse(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
} | null> {
  try {
    // Lazy import — optional dep. Cast via unknown because pdf-parse
    // does not ship its own types; we narrow the surface below.
    const mod: unknown = await import(
      /* @vite-ignore */ 'pdf-parse' as string
    ).catch(() => null);
    if (!mod) return null;
    const modShape = mod as { default?: unknown };
    const fn = (modShape.default ?? mod) as (buf: Buffer) => Promise<{
      text: string;
      numpages: number;
    }>;
    const parsed = await fn(buffer);
    const text = parsed.text?.trim() ?? '';
    if (text.length < 16) {
      // Scanned PDF (image-only) — pdf-parse returns ~empty.
      return null;
    }
    return { text, pageCount: parsed.numpages ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Extract text from a document buffer. Selects the right adapter.
 *
 * If the document is plain text (or fixture-style), returns immediately
 * with `method: 'native'` and confidence 1.0.
 */
export async function extractText(input: ExtractTextInput): Promise<OcrResult> {
  const { mimeType, content, forceOcr } = input;

  // Text-like → trivial.
  if (isTextLikeMime(mimeType) && !forceOcr) {
    const text = decodeText(content);
    return {
      text,
      language: detectLanguage(text),
      confidence: 1.0,
      pageCount: null,
      method: 'native',
    };
  }

  // PDF → try born-digital, then OCR.
  if (mimeType === 'application/pdf') {
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    if (!forceOcr) {
      const parsed = await tryPdfParse(buffer);
      if (parsed) {
        return {
          text: parsed.text,
          language: detectLanguage(parsed.text),
          confidence: 0.95,
          pageCount: parsed.pageCount,
          method: 'pdf-parse',
        };
      }
    }
    // Fall through to OCR.
    try {
      const ocr = await runTesseract(buffer);
      return {
        text: ocr.text,
        language: detectLanguage(ocr.text),
        confidence: ocr.confidence,
        pageCount: null,
        method: 'tesseract',
      };
    } catch (err) {
      // Graceful degrade: either the dep is missing or the engine could
      // not parse the bytes. Either way we return an empty result with
      // method='pdf-parse' so the caller knows the PDF branch was taken.
      if (
        err instanceof TesseractUnavailableError ||
        err instanceof Error
      ) {
        return {
          text: '',
          language: 'mixed',
          confidence: 0,
          pageCount: null,
          method: 'pdf-parse',
        };
      }
      throw err;
    }
  }

  // Images → Tesseract direct.
  if (mimeType.startsWith('image/')) {
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    try {
      const ocr = await runTesseract(buffer);
      return {
        text: ocr.text,
        language: detectLanguage(ocr.text),
        confidence: ocr.confidence,
        pageCount: 1,
        method: 'tesseract',
      };
    } catch (err) {
      if (err instanceof TesseractUnavailableError || err instanceof Error) {
        return {
          text: '',
          language: 'mixed',
          confidence: 0,
          pageCount: 1,
          method: 'tesseract',
        };
      }
      throw err;
    }
  }

  // Unknown → best-effort decode.
  const text = decodeText(content);
  return {
    text,
    language: detectLanguage(text),
    confidence: 0.5,
    pageCount: null,
    method: 'native',
  };
}
