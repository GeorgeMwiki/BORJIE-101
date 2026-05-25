/**
 * createDoclingAdapter — REST port for IBM Docling.
 *
 * Docling is IBM Research's open-source document understanding pipeline
 * with strong table extraction and PDF/A parsing. We expose it as a
 * REST adapter (callers host their own Docling service or use the
 * IBM-hosted preview).
 *
 * Reference: https://github.com/DS4SD/docling
 */

import type { LanguageCode, OCRConfig, OCRPort, ParsedDocument, TextBlock, ExtractedTable } from '../types.js';
import { buildPage, buildParsedDocument } from './parsed-document-builder.js';

export interface DoclingAdapterConfig {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly fetcher?: typeof fetch;
  /**
   * Optional adapter id override — useful when running multiple Docling
   * instances (e.g. one for academic PDFs, one for invoices).
   */
  readonly id?: string;
}

interface DoclingResponse {
  readonly pages?: ReadonlyArray<{
    readonly page_number: number;
    readonly width?: number;
    readonly height?: number;
    readonly language?: string;
    readonly blocks?: ReadonlyArray<{
      readonly id?: string;
      readonly text: string;
      readonly bbox?: { x: number; y: number; width: number; height: number };
      readonly role?: string;
      readonly confidence?: number;
    }>;
    readonly tables?: ReadonlyArray<{
      readonly id?: string;
      readonly rows: ReadonlyArray<ReadonlyArray<string>>;
      readonly bbox?: { x: number; y: number; width: number; height: number };
      readonly confidence?: number;
    }>;
  }>;
}

export function createDoclingAdapter(config: DoclingAdapterConfig): OCRPort {
  const id = config.id ?? 'docling';
  return {
    id,
    async recognize(input: OCRConfig): Promise<ParsedDocument> {
      const fetchImpl = config.fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetchImpl) {
        return emptyDocument(input, `${id}-no-fetch`);
      }

      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(input.bytes)], { type: input.mime }),
        `doc.${guessExt(input.mime)}`
      );
      if (input.lang) {
        form.append('languages', input.lang.join(','));
      }
      if (input.layout) {
        form.append('layout', input.layout);
      }

      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        body: form,
      });

      if (!response.ok) {
        return emptyDocument(input, `${id}-http-${response.status}`);
      }

      const json = (await response.json()) as DoclingResponse;
      const pages = (json.pages ?? []).map((page) => {
        const blocks: TextBlock[] = (page.blocks ?? []).map((block, idx) => ({
          id: block.id ?? `b-${idx}`,
          text: block.text,
          bbox: block.bbox
            ? {
                x: block.bbox.x,
                y: block.bbox.y,
                width: block.bbox.width,
                height: block.bbox.height,
              }
            : { x: 0, y: 0, width: 1, height: 1 },
          role: mapRole(block.role),
          confidence: block.confidence ?? 0.85,
          language: normalizeLang(page.language),
        }));
        const tables: ExtractedTable[] = (page.tables ?? []).map((table, idx) => ({
          id: table.id ?? `t-${idx}`,
          bbox: table.bbox ?? { x: 0, y: 0, width: 1, height: 1 },
          rows: table.rows,
          confidence: table.confidence ?? 0.85,
        }));
        return buildPage({
          pageNumber: page.page_number,
          ...(page.width !== undefined ? { widthPt: page.width } : {}),
          ...(page.height !== undefined ? { heightPt: page.height } : {}),
          language: normalizeLang(page.language),
          blocks,
          tables,
        });
      });

      return await buildParsedDocument({
        sourceMime: input.mime,
        sourceBytes: input.bytes,
        pages: pages.length > 0 ? pages : [buildPage({ pageNumber: 1, blocks: [] })],
        producedBy: id,
      });
    },
  };
}

function mapRole(role?: string): TextBlock['role'] {
  switch (role) {
    case 'heading':
    case 'title':
      return 'heading';
    case 'list':
    case 'list_item':
      return 'list_item';
    case 'caption':
      return 'figure_caption';
    case 'footer':
      return 'footer';
    case 'header':
      return 'header';
    case 'page_number':
      return 'page_number';
    case 'signature':
      return 'signature';
    case 'table':
    case 'table_cell':
      return 'table_cell';
    default:
      return 'paragraph';
  }
}

function normalizeLang(lang: string | undefined): LanguageCode {
  if (!lang) return 'und';
  const lower = lang.toLowerCase();
  const map: Record<string, LanguageCode> = {
    eng: 'en',
    en: 'en',
    swa: 'sw',
    sw: 'sw',
    fra: 'fr',
    fr: 'fr',
    ara: 'ar',
    ar: 'ar',
    por: 'pt',
    pt: 'pt',
  };
  return map[lower] ?? 'und';
}

function guessExt(mime: string): string {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('tiff')) return 'tif';
  return 'bin';
}

async function emptyDocument(input: OCRConfig, marker: string): Promise<ParsedDocument> {
  return await buildParsedDocument({
    sourceMime: input.mime,
    sourceBytes: input.bytes,
    pages: [buildPage({ pageNumber: 1, blocks: [] })],
    producedBy: marker,
  });
}
