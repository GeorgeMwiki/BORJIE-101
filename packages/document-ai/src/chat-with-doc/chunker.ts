/**
 * Doc chunker. Produces retrieval-ready spans backed by their original
 * block ids so citations always resolve to a real block + bbox.
 *
 * Strategy: walk the document in reading order, append blocks to the
 * current chunk until `maxChars` is reached, then start a new one.
 * Headings always start a new chunk so retrieval doesn't smear context.
 */

import type { DocumentPage, ParsedDocument } from '../types.js';

export interface DocChunk {
  readonly docId: string;
  readonly pageNumber: number;
  readonly blockIds: ReadonlyArray<string>;
  readonly text: string;
}

export interface ChunkOptions {
  readonly maxChars?: number;
}

export function chunkDocument(doc: ParsedDocument, options: ChunkOptions = {}): DocChunk[] {
  const maxChars = options.maxChars ?? 1200;
  const chunks: DocChunk[] = [];
  for (const page of doc.pages) {
    chunks.push(...chunkPage(doc.id, page, maxChars));
  }
  return chunks;
}

function chunkPage(docId: string, page: DocumentPage, maxChars: number): DocChunk[] {
  const out: DocChunk[] = [];
  let currentBlocks: string[] = [];
  let currentText = '';
  for (const block of page.blocks) {
    const startsNew =
      block.role === 'heading' && currentText.length > 0;
    if (startsNew || currentText.length + block.text.length > maxChars) {
      if (currentText.length > 0) {
        out.push({
          docId,
          pageNumber: page.pageNumber,
          blockIds: currentBlocks,
          text: currentText.trim(),
        });
      }
      currentBlocks = [];
      currentText = '';
    }
    currentBlocks.push(block.id);
    currentText += `${block.text}\n`;
  }
  if (currentText.length > 0) {
    out.push({
      docId,
      pageNumber: page.pageNumber,
      blockIds: currentBlocks,
      text: currentText.trim(),
    });
  }
  return out;
}
