/**
 * Google Vision OCR provider — implements IOCRProvider.
 *
 * Uses @google-cloud/vision ImageAnnotatorClient. SDK loaded via dynamic
 * import so the service package compiles without the dep installed.
 */

import type { ExtractedField, OCRProvider } from '../types/index.js';
import type { IOCRProvider } from '../services/ocr-extraction.service.js';
import type { GoogleVisionConfig } from './types.js';
import { logger } from '../utils/logger.js';

export interface VisionExtractOptions {
  readonly language?: string;
  readonly extractStructuredData?: boolean;
  readonly documentType?: string;
}

export interface VisionExtractResult {
  rawText: string;
  structuredData: Record<string, unknown> | null;
  fields: ExtractedField[];
  confidence: number;
  language: string;
  pageCount: number;
}

/** Minimal structural typing of the parts of Vision we use. */
interface VisionVertex {
  x?: number;
  y?: number;
}
interface VisionBoundingPoly {
  vertices?: ReadonlyArray<VisionVertex>;
}
interface VisionWord {
  confidence?: number;
  symbols?: ReadonlyArray<{ text?: string }>;
  boundingBox?: VisionBoundingPoly;
}
interface VisionParagraph {
  confidence?: number;
  words?: ReadonlyArray<VisionWord>;
  boundingBox?: VisionBoundingPoly;
}
interface VisionBlock {
  confidence?: number;
  paragraphs?: ReadonlyArray<VisionParagraph>;
  boundingBox?: VisionBoundingPoly;
}
interface VisionPage {
  confidence?: number;
  blocks?: ReadonlyArray<VisionBlock>;
}
interface VisionResult {
  fullTextAnnotation?: {
    text?: string;
    pages?: ReadonlyArray<VisionPage>;
  };
  error?: { message?: string } | null;
}

type VisionClientLike = {
  documentTextDetection(
    request: unknown
  ): Promise<ReadonlyArray<VisionResult | undefined>>;
};

export class VisionAuthError extends Error {
  readonly code = 'VISION_AUTH' as const;
}
export class VisionNetworkError extends Error {
  readonly code = 'VISION_NETWORK' as const;
}
export class VisionDocumentError extends Error {
  readonly code = 'VISION_DOCUMENT' as const;
}
export class VisionSdkMissingError extends Error {
  readonly code = 'VISION_SDK_MISSING' as const;
}

export class GoogleVisionProvider implements IOCRProvider {
  readonly name: OCRProvider = 'google_vision';
  private client: VisionClientLike | null = null;

  constructor(private readonly config: GoogleVisionConfig) {
    if (!config.projectId) {
      throw new Error('GoogleVisionProvider requires config.projectId');
    }
  }

  private async getClient(): Promise<VisionClientLike> {
    if (this.client) return this.client;

    let sdk: {
      ImageAnnotatorClient: new (cfg: unknown) => VisionClientLike;
    };
    try {
      sdk = (await import('@google-cloud/vision')) as unknown as typeof sdk;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new VisionSdkMissingError(
        `@google-cloud/vision is not installed: ${msg}`
      );
    }

    const clientConfig: Record<string, unknown> = {
      projectId: this.config.projectId,
    };
    if (this.config.keyFilename) {
      clientConfig.keyFilename = this.config.keyFilename;
    } else if (this.config.credentials) {
      clientConfig.credentials = this.config.credentials;
    }
    // If GOOGLE_APPLICATION_CREDENTIALS env var is set, the SDK picks it up
    // automatically — no extra config needed.

    this.client = new sdk.ImageAnnotatorClient(clientConfig);
    return this.client;
  }

  async extractText(
    buffer: Buffer,
    mimeType: string,
    options?: VisionExtractOptions
  ): Promise<VisionExtractResult> {
    logger.info('GoogleVisionProvider.extractText', {
      bytes: buffer.byteLength,
      mimeType,
      projectId: this.config.projectId,
      documentType: options?.documentType,
    });

    const request: Record<string, unknown> = {
      image: { content: buffer },
    };
    if (options?.language) {
      request.imageContext = { languageHints: [options.language] };
    }

    let response: VisionResult;
    try {
      const client = await this.getClient();
      const [raw] = await client.documentTextDetection(request);
      if (!raw) {
        throw new VisionDocumentError('Vision returned empty response');
      }
      if (raw.error?.message) {
        throw new VisionDocumentError(raw.error.message);
      }
      response = raw;
    } catch (err) {
      if (err instanceof VisionSdkMissingError) throw err;
      if (err instanceof VisionDocumentError) throw err;
      throw classifyVisionError(err);
    }

    const fullText = response.fullTextAnnotation?.text ?? '';
    const pages = response.fullTextAnnotation?.pages ?? [];
    const fields = mapPagesToFields(pages, fullText, options?.documentType);
    const confidence = averagePageConfidence(pages);

    return {
      rawText: fullText,
      structuredData: {
        provider: 'google_vision',
        documentType: options?.documentType ?? null,
      },
      fields,
      confidence,
      language: options?.language ?? this.config.defaultLanguage ?? 'en',
      pageCount: pages.length,
    };
  }
}

/**
 * Map Vision's page/block/paragraph tree into ExtractedField[]. For simple
 * key-value detection we fall back to a regex scan over the full text
 * (Vision's basic API does not return formFields — that's Document AI).
 */
export function mapPagesToFields(
  pages: ReadonlyArray<VisionPage>,
  fullText: string,
  _documentType?: string
): ExtractedField[] {
  const fields: ExtractedField[] = [];

  // Emit a field per block with its aggregated text — coarse but preserves
  // spatial grouping and per-block confidence.
  pages.forEach((page, pageIdx) => {
    const blocks = page.blocks ?? [];
    blocks.forEach((block, blockIdx) => {
      const text = blockText(block);
      if (!text) return;
      fields.push({
        fieldName: `page_${pageIdx + 1}_block_${blockIdx + 1}`,
        value: text,
        confidence: clampConfidence(block.confidence ?? page.confidence ?? 0),
        boundingBox: polyToBoundingBox(block.boundingBox),
        normalized: false,
        validationStatus:
          (block.confidence ?? 0) >= 0.75 ? 'valid' : 'uncertain',
      });
    });
  });

  // Regex-based key-value pass over the rawText for common ID fields.
  for (const field of extractKeyValuePairs(fullText)) {
    fields.push(field);
  }

  return fields;
}

function blockText(block: VisionBlock): string {
  const paragraphs = block.paragraphs ?? [];
  const parts: string[] = [];
  for (const p of paragraphs) {
    const words = p.words ?? [];
    for (const w of words) {
      const symbols = w.symbols ?? [];
      parts.push(symbols.map((s) => s.text ?? '').join(''));
    }
  }
  return parts.join(' ').trim();
}

function polyToBoundingBox(
  poly: VisionBoundingPoly | undefined
): ExtractedField['boundingBox'] {
  const verts = poly?.vertices ?? [];
  if (verts.length === 0) return null;
  const xs = verts.map((v) => v.x ?? 0);
  const ys = verts.map((v) => v.y ?? 0);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return Math.min(1, n / 100);
  return n;
}

function averagePageConfidence(pages: ReadonlyArray<VisionPage>): number {
  if (pages.length === 0) return 0;
  const vals = pages
    .map((p) => p.confidence)
    .filter((c): c is number => typeof c === 'number');
  if (vals.length === 0) return 0;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

/**
 * Naive regex key-value extractor over raw text — covers common ID docs
 * (national ID, licence, utility bill). Confidence is lower than block-level
 * since this is heuristic.
 */
export function extractKeyValuePairs(rawText: string): ExtractedField[] {
  if (!rawText) return [];
  const patterns: ReadonlyArray<{ name: string; re: RegExp }> = [
    { name: 'full_name', re: /(?:full\s*name|name)\s*[:\-]\s*(.+)/i },
    { name: 'id_number', re: /(?:id\s*(?:no|number)|id#)\s*[:\-]\s*([A-Za-z0-9\-]+)/i },
    { name: 'date_of_birth', re: /(?:date\s*of\s*birth|dob)\s*[:\-]\s*([\d\/\-\.]+)/i },
    { name: 'issue_date', re: /issue\s*date\s*[:\-]\s*([\d\/\-\.]+)/i },
    { name: 'expiry_date', re: /(?:expiry\s*date|expires?)\s*[:\-]\s*([\d\/\-\.]+)/i },
    { name: 'nationality', re: /nationality\s*[:\-]\s*(.+)/i },
    { name: 'gender', re: /(?:sex|gender)\s*[:\-]\s*([A-Za-z]+)/i },
  ];

  const out: ExtractedField[] = [];
  const seen = new Set<string>();
  for (const { name, re } of patterns) {
    const m = rawText.match(re);
    if (!m) continue;
    const val = m[1].split('\n')[0].trim();
    if (!val || seen.has(name)) continue;
    seen.add(name);
    out.push({
      fieldName: name,
      value: val,
      confidence: 0.6,
      boundingBox: null,
      normalized: false,
      validationStatus: 'uncertain',
    });
  }
  return out;
}

function classifyVisionError(err: unknown): Error {
  const code = (err as { code?: number | string })?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === 16 || /unauthenticated|permission_denied|credentials/i.test(message)) {
    return new VisionAuthError(`Vision auth failed: ${message}`);
  }
  if (code === 14 || /unavailable|timeout|enotfound|econnreset/i.test(message)) {
    return new VisionNetworkError(`Vision network error: ${message}`);
  }
  return new VisionDocumentError(`Vision error: ${message}`);
}

export function createGoogleVisionProvider(
  config: GoogleVisionConfig
): GoogleVisionProvider {
  return new GoogleVisionProvider(config);
}
