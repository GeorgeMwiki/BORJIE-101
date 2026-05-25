/**
 * Pure helpers to build ParsedDocument values. Each OCR adapter calls
 * these so the produced shape is consistent across engines, which keeps
 * downstream RAG / form-extraction / accessibility happy.
 */

import type {
  DocumentPage,
  LanguageCode,
  ParsedDocument,
  TextBlock,
  ExtractedTable,
} from '../types.js';
import { sha256Hex } from './sha256.js';

export interface BuildPageInput {
  readonly pageNumber: number;
  readonly widthPt?: number;
  readonly heightPt?: number;
  readonly language?: LanguageCode;
  readonly blocks: ReadonlyArray<TextBlock>;
  readonly tables?: ReadonlyArray<ExtractedTable>;
}

export function buildPage(input: BuildPageInput): DocumentPage {
  const language = input.language ?? pickDominantLanguage(input.blocks);
  const text = input.blocks
    .map((block) => block.text)
    .filter((entry) => entry.length > 0)
    .join('\n');
  const widthPt = input.widthPt ?? 612;
  const heightPt = input.heightPt ?? 792;
  return {
    pageNumber: input.pageNumber,
    widthPt,
    heightPt,
    language,
    blocks: input.blocks,
    tables: input.tables ?? [],
    text,
  };
}

export interface BuildParsedDocumentInput {
  readonly id?: string;
  readonly sourceMime: string;
  readonly sourceBytes: Uint8Array;
  readonly pages: ReadonlyArray<DocumentPage>;
  readonly producedBy: string;
  readonly producedAt?: Date;
}

export async function buildParsedDocument(
  input: BuildParsedDocumentInput
): Promise<ParsedDocument> {
  const sha = await sha256Hex(input.sourceBytes);
  const id = input.id ?? `doc-${sha.slice(0, 12)}`;
  const text = input.pages.map((page) => page.text).join('\f');
  const dominantLanguage = pickDominantLanguageAcrossPages(input.pages);
  const producedAt = input.producedAt ?? new Date();
  return {
    id,
    sourceMime: input.sourceMime,
    sourceSha256: sha,
    pages: input.pages,
    text,
    dominantLanguage,
    producedBy: input.producedBy,
    producedAt,
  };
}

function pickDominantLanguage(blocks: ReadonlyArray<TextBlock>): LanguageCode {
  if (blocks.length === 0) return 'und';
  const counts = new Map<LanguageCode, number>();
  for (const block of blocks) {
    const lang = block.language ?? 'und';
    counts.set(lang, (counts.get(lang) ?? 0) + block.text.length);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]![0];
}

function pickDominantLanguageAcrossPages(
  pages: ReadonlyArray<DocumentPage>
): LanguageCode {
  if (pages.length === 0) return 'und';
  const counts = new Map<LanguageCode, number>();
  for (const page of pages) {
    counts.set(page.language, (counts.get(page.language) ?? 0) + page.text.length);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]![0];
}
