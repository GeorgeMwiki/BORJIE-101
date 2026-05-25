/**
 * createMarkerAdapter — REST port for datalab.to's Marker.
 *
 * Marker is the academic-PDF leader: best-in-class for math, multi-column
 * layouts, and reference lists. Slower than Docling on bulk invoices but
 * unmatched on dense PDFs.
 *
 * Reference: https://github.com/VikParuchuri/marker
 *             https://www.datalab.to/
 */

import type { LanguageCode, OCRConfig, OCRPort, ParsedDocument, TextBlock } from '../types.js';
import { buildPage, buildParsedDocument } from './parsed-document-builder.js';

export interface MarkerAdapterConfig {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly fetcher?: typeof fetch;
  /** Marker outputs markdown — we keep it raw under `text` if requested. */
  readonly preserveMarkdown?: boolean;
}

interface MarkerResponse {
  readonly markdown?: string;
  readonly pages?: ReadonlyArray<{
    readonly page: number;
    readonly markdown?: string;
    readonly text?: string;
  }>;
  readonly metadata?: {
    readonly languages?: ReadonlyArray<string>;
  };
}

export function createMarkerAdapter(config: MarkerAdapterConfig): OCRPort {
  return {
    id: 'marker',
    async recognize(input: OCRConfig): Promise<ParsedDocument> {
      const fetchImpl = config.fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetchImpl) {
        return emptyDocument(input, 'marker-no-fetch');
      }

      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(input.bytes)], { type: input.mime }),
        'doc.pdf'
      );
      if (input.lang) {
        form.append('langs', input.lang.join(','));
      }
      form.append('output_format', 'json');

      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        body: form,
      });
      if (!response.ok) {
        return emptyDocument(input, `marker-http-${response.status}`);
      }
      const json = (await response.json()) as MarkerResponse;

      const lang = normalizeMarkerLang(json.metadata?.languages?.[0]);
      const pages = (json.pages ?? []).map((page) => {
        const text = config.preserveMarkdown
          ? page.markdown ?? page.text ?? ''
          : stripMarkdown(page.markdown ?? page.text ?? '');
        const blocks: TextBlock[] = text
          ? [
              {
                id: `b-${page.page}`,
                text,
                bbox: { x: 0, y: 0, width: 1, height: 1 },
                role: 'paragraph',
                confidence: 0.9,
                language: lang,
              },
            ]
          : [];
        return buildPage({
          pageNumber: page.page,
          blocks,
          language: lang,
        });
      });

      // Fall back to the document-wide markdown when per-page breakdown
      // wasn't returned by the Marker server.
      if (pages.length === 0 && json.markdown) {
        const text = config.preserveMarkdown ? json.markdown : stripMarkdown(json.markdown);
        pages.push(
          buildPage({
            pageNumber: 1,
            blocks: [
              {
                id: 'b-0',
                text,
                bbox: { x: 0, y: 0, width: 1, height: 1 },
                role: 'paragraph',
                confidence: 0.9,
                language: lang,
              },
            ],
            language: lang,
          })
        );
      }

      return await buildParsedDocument({
        sourceMime: input.mime,
        sourceBytes: input.bytes,
        pages: pages.length > 0 ? pages : [buildPage({ pageNumber: 1, blocks: [] })],
        producedBy: 'marker',
      });
    },
  };
}

function stripMarkdown(input: string): string {
  return input
    .replace(/[#*_`>]+/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMarkerLang(lang: string | undefined): LanguageCode {
  if (!lang) return 'und';
  const m: Record<string, LanguageCode> = {
    English: 'en',
    Swahili: 'sw',
    French: 'fr',
    Arabic: 'ar',
    Portuguese: 'pt',
  };
  return m[lang] ?? 'und';
}

async function emptyDocument(input: OCRConfig, marker: string): Promise<ParsedDocument> {
  return await buildParsedDocument({
    sourceMime: input.mime,
    sourceBytes: input.bytes,
    pages: [buildPage({ pageNumber: 1, blocks: [] })],
    producedBy: marker,
  });
}
