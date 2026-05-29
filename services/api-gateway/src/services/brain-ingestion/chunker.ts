/**
 * Text chunker — splits long text into overlapping windows so embeddings
 * fit the model's 8K-token input and recall retrieves relevant slices.
 *
 * Wave COMPANY-BRAIN (C-1).
 *
 * Pure function. No I/O. Test-friendly.
 *
 * Defaults match the SOTA for retrieval-quality (1000 chars, 150 overlap
 * — same as document-intelligence/EmbeddingService).
 */

import { createHash } from 'node:crypto';
import type { TextChunk } from './types.js';

export interface ChunkOptions {
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  /** Stable seed (usually the upload id) for chunk-id derivation. */
  readonly seed: string;
}

const DEFAULT_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

/**
 * Detect markdown headings so each chunk can carry a stable `section`
 * label. Used by the recall layer to render "this came from §3 of your
 * royalty contract" in the answer citation.
 */
function detectSection(text: string): string | null {
  const m = text.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/m);
  if (!m) return null;
  return m[2]?.trim() ?? null;
}

function deriveChunkId(seed: string, index: number): string {
  // sha256(seed||index)[0..16] keeps chunk ids deterministic across
  // re-runs (durability promise) and short enough for indexes.
  const h = createHash('sha256');
  h.update(`${seed}::${index}`);
  return h.digest('hex').slice(0, 24);
}

export function chunkText(
  text: string,
  options: ChunkOptions,
): ReadonlyArray<TextChunk> {
  if (!text) return [];
  const chunkSize = options.chunkSize ?? DEFAULT_SIZE;
  const overlap = options.chunkOverlap ?? DEFAULT_OVERLAP;
  if (chunkSize <= 0) return [];

  // Normalise whitespace but preserve newlines so heading detection works.
  const clean = text.replace(/[ \t\r\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  let idx = 0;

  while (start < clean.length) {
    const end = Math.min(clean.length, start + chunkSize);
    const slice = clean.slice(start, end);
    const section = detectSection(slice);
    chunks.push({
      id: deriveChunkId(options.seed, idx),
      text: slice,
      section,
      chunkIndex: idx,
    });
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
    idx += 1;
  }

  return Object.freeze(chunks);
}
