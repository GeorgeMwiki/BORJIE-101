/**
 * createAnthropicVisionAdapter — high-quality OCR + handwriting via the
 * Anthropic Vision API. Especially strong for messy scans, handwritten
 * meter readings, stamped invoices, and forms in Swahili / French.
 *
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/vision
 *
 * Adapter is fetch-injectable so tests don't need network access.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import type { OCRConfig, OCRPort, ParsedDocument, TextBlock } from '../types.js';
import { buildPage, buildParsedDocument } from './parsed-document-builder.js';

export interface AnthropicVisionAdapterConfig {
  readonly apiKey: string;
  /** Override the model id used for OCR. */
  readonly model?: string;
  readonly endpoint?: string;
  /** Injectable fetch — node 18+ has global fetch; tests inject mocks. */
  readonly fetcher?: typeof fetch;
  /** Maximum tokens for OCR response. */
  readonly maxTokens?: number;
}

interface AnthropicVisionResponse {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
}

export function createAnthropicVisionAdapter(
  config: AnthropicVisionAdapterConfig
): OCRPort {
  const endpoint = config.endpoint ?? 'https://api.anthropic.com/v1/messages';
  const model = config.model ?? getModelLatest('opus');
  const maxTokens = config.maxTokens ?? 4096;

  return {
    id: 'anthropic-vision',
    async recognize(input: OCRConfig): Promise<ParsedDocument> {
      const fetchImpl =
        config.fetcher ??
        (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetchImpl) {
        return emptyDocument(input, 'anthropic-vision-no-fetch');
      }

      const base64 = uint8ToBase64(input.bytes);
      const body = {
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: input.mime, data: base64 },
              },
              {
                type: 'text',
                text: buildPrompt(input),
              },
            ],
          },
        ],
      };

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return emptyDocument(input, `anthropic-vision-http-${response.status}`);
      }

      const json = (await response.json()) as AnthropicVisionResponse;
      const text = (json.content ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text!)
        .join('\n');

      const blocks: TextBlock[] = text
        ? [
            {
              id: 'b-0',
              text,
              bbox: { x: 0, y: 0, width: 1, height: 1 },
              role: 'paragraph',
              confidence: 0.92, // empirically calibrated for Claude vision
              language: input.lang?.[0] ?? 'und',
            },
          ]
        : [];

      return await buildParsedDocument({
        sourceMime: input.mime,
        sourceBytes: input.bytes,
        pages: [
          buildPage({
            pageNumber: 1,
            blocks,
            language: input.lang?.[0] ?? 'und',
          }),
        ],
        producedBy: 'anthropic-vision',
      });
    },
  };
}

function buildPrompt(input: OCRConfig): string {
  const langHint = input.lang?.join(', ') ?? 'English (auto-detect if other)';
  const layoutHint =
    input.layout === 'full'
      ? 'Preserve layout exactly. Mark handwritten lines with [HW]. Mark stamps with [STAMP]. Mark signatures with [SIG].'
      : input.layout === 'text-only'
        ? 'Extract plain text in reading order. No formatting markers.'
        : 'Preserve reading order, paragraph breaks, and table structure.';
  return [
    'You are an OCR engine. Extract ALL text from the attached document.',
    `Expected languages: ${langHint}.`,
    layoutHint,
    'Return only the extracted text — no preamble, no commentary.',
  ].join(' ');
}

async function emptyDocument(input: OCRConfig, marker: string): Promise<ParsedDocument> {
  return await buildParsedDocument({
    sourceMime: input.mime,
    sourceBytes: input.bytes,
    pages: [
      buildPage({
        pageNumber: 1,
        blocks: [],
        language: input.lang?.[0] ?? 'und',
      }),
    ],
    producedBy: marker,
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Use Buffer when available (Node), fall back to btoa for browsers.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // eslint-disable-next-line no-undef -- SCRUB-5f: rule-disabled because btoa is a browser global used only on the no-Buffer fallback path
  return btoa(binary);
}
