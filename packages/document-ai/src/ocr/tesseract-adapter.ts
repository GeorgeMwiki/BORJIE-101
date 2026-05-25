/**
 * createTesseractAdapter — local-default OCR.
 *
 * tesseract.js is a peer dep. We import it dynamically so consumers
 * that only want the Anthropic Vision or Docling adapters don't pay
 * the bundle cost. Falls back to a structured error result when the
 * peer dep is missing.
 *
 * Reference: https://github.com/naptha/tesseract.js
 */

import type {
  LanguageCode,
  OCRConfig,
  OCRPort,
  ParsedDocument,
  TextBlock,
} from '../types.js';
import { buildPage, buildParsedDocument } from './parsed-document-builder.js';

export interface TesseractAdapterConfig {
  readonly langs?: ReadonlyArray<LanguageCode>;
  /**
   * Injectable for testing — when present, this loader is used instead
   * of dynamically importing `tesseract.js`. Lets the test suite verify
   * the adapter wiring without installing the peer dep.
   */
  readonly loader?: () => Promise<TesseractLike>;
  /** Optional logger override for verbose mode. */
  readonly logger?: (msg: string) => void;
}

/**
 * Minimum surface of tesseract.js this adapter needs. Keeping it small
 * lets us mock cleanly without re-implementing the whole API.
 */
export interface TesseractLike {
  recognize(
    image: Uint8Array | string,
    langs: string,
    options?: Record<string, unknown>
  ): Promise<{
    data: {
      text: string;
      confidence: number;
      blocks?: ReadonlyArray<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    };
  }>;
}

const TESSERACT_LANG_MAP: Readonly<Record<LanguageCode, string>> = Object.freeze({
  en: 'eng',
  sw: 'swa',
  fr: 'fra',
  ar: 'ara',
  pt: 'por',
  rw: 'kin',
  lg: 'eng', // Luganda fallback; tesseract has no first-class pack
  so: 'som',
  am: 'amh',
  yo: 'yor',
  ig: 'ibo',
  ha: 'hau',
  zu: 'zul',
  und: 'eng',
});

export function createTesseractAdapter(config: TesseractAdapterConfig = {}): OCRPort {
  return {
    id: 'tesseract',
    async recognize(input: OCRConfig): Promise<ParsedDocument> {
      const langs = config.langs ?? input.lang ?? ['en'];
      const tessLangString = langs.map((code) => TESSERACT_LANG_MAP[code]).join('+');

      const lib = await loadTesseract(config.loader);
      if (!lib) {
        // Peer dep missing — return an empty but well-formed document so
        // callers can branch without try/catch.
        return await buildParsedDocument({
          sourceMime: input.mime,
          sourceBytes: input.bytes,
          pages: [
            buildPage({
              pageNumber: 1,
              blocks: [],
              language: langs[0] ?? 'und',
            }),
          ],
          producedBy: 'tesseract-missing',
        });
      }

      const result = await lib.recognize(input.bytes, tessLangString, {
        logger: config.logger,
      });

      const widthPt = 612;
      const heightPt = 792;
      const blocks: TextBlock[] = (result.data.blocks ?? []).map((block, idx) => ({
        id: `b-${idx}`,
        text: block.text,
        bbox: {
          x: clamp01(block.bbox.x0 / widthPt),
          y: clamp01(block.bbox.y0 / heightPt),
          width: clamp01((block.bbox.x1 - block.bbox.x0) / widthPt),
          height: clamp01((block.bbox.y1 - block.bbox.y0) / heightPt),
        },
        role: 'paragraph',
        confidence: block.confidence / 100,
        language: langs[0] ?? 'und',
      }));

      // Fall back to a single full-page block when tesseract.js didn't
      // return per-block layout (the simple `recognize()` overload).
      const finalBlocks =
        blocks.length > 0
          ? blocks
          : [
              {
                id: 'b-0',
                text: result.data.text,
                bbox: { x: 0, y: 0, width: 1, height: 1 },
                role: 'paragraph' as const,
                confidence: result.data.confidence / 100,
                language: langs[0] ?? 'und',
              },
            ];

      return await buildParsedDocument({
        sourceMime: input.mime,
        sourceBytes: input.bytes,
        pages: [
          buildPage({
            pageNumber: 1,
            widthPt,
            heightPt,
            blocks: finalBlocks,
            language: langs[0] ?? 'und',
          }),
        ],
        producedBy: 'tesseract',
      });
    },
  };
}

async function loadTesseract(
  loader?: () => Promise<TesseractLike>
): Promise<TesseractLike | null> {
  if (loader) {
    return await loader();
  }
  try {
    const mod = (await import('tesseract.js' as string)) as unknown as TesseractLike;
    return mod;
  } catch {
    return null;
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
