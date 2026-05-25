/**
 * Span-level citations.
 *
 * The default `Citation.excerpt` returns the whole retrieved chunk as
 * a single block (FRONT paper: "coarse citations"). We upgrade to
 * character-offset spans so the UI can highlight the EXACT line the
 * LLM cited inside a chunk. Cuts citation hallucination on the FRONT
 * benchmark from ~37% to single digits.
 *
 * Workflow:
 *   1. After the LLM emits an answer with `[chunkId]` markers, call
 *      `extractCitedSpans(answer, chunks)`.
 *   2. For each `[chunkId]` we locate the supporting sentence in the
 *      chunk by Jaccard-similarity-matching the surrounding LLM text
 *      against the chunk's sentence boundaries.
 *   3. Return `Citation` objects so the UI can highlight the span
 *      inside the PDF / viewer overlay.
 *
 * Pure module — zero I/O, deterministic. Safe from any tier.
 *
 * Ported from LITFIN `src/core/document-intelligence/contextual-rag/
 * span-citations.ts` (260 LOC). Functionally identical; uses the local
 * `tokenize` from `./bm25` so the citation tokeniser stays in sync with
 * the lexical retriever.
 *
 * @module @borjie/ai-copilot/retrieval/span-citations
 */

import { tokenize } from './bm25.js';
import type { ChunkSentence, ChunkSource, Citation } from './types.js';

// ===========================================================================
// Constants
// ===========================================================================

/** Inline citation marker regex. Matches `[chunk-abc]`, `[c_123]`, etc.
 *  Any non-whitespace chunk id with at least one alnum char. */
const CITATION_MARKER_RE = /\[([a-zA-Z0-9][\w:-]*)\]/g;

/** Window of LLM text we look at on either side of a citation marker
 *  to choose the best matching span. 240 chars covers most claim
 *  sentences without crossing into unrelated topics. */
const CONTEXT_WINDOW_CHARS = 240;

/** When the best Jaccard overlap is below this floor we keep the
 *  whole chunk as the span (better to over-highlight than mis-cite). */
const MIN_OVERLAP_FOR_SPAN = 0.15;

/** Sentence delimiter — keeps `Mr.` / `T.Sh.` runs intact by requiring
 *  whitespace + capital after the period. `\n` is also a boundary. */
const SENTENCE_SPLIT_RE =
  /(?<=[.!?])\s+(?=[A-Z0-9"'])|\n+/;

// ===========================================================================
// Sentence segmentation
// ===========================================================================

/**
 * Split a chunk into sentences AND record the character offsets each
 * sentence occupies inside the original chunk text. Offsets are
 * INCLUSIVE for `startOffset` and EXCLUSIVE for `endOffset` — i.e.
 * `chunk.text.slice(s.startOffset, s.endOffset) === s.text`.
 */
export function splitChunkIntoSentences(
  chunkText: string,
): ReadonlyArray<ChunkSentence> {
  if (!chunkText) return [];

  const sentences: Array<ChunkSentence> = [];
  let cursor = 0;
  const pieces = chunkText.split(SENTENCE_SPLIT_RE);
  for (const piece of pieces) {
    if (piece.length === 0) {
      cursor = advancePastWhitespace(chunkText, cursor);
      continue;
    }
    const found = chunkText.indexOf(piece, cursor);
    if (found < 0) {
      cursor = Math.min(chunkText.length, cursor + piece.length);
      continue;
    }
    const start = found;
    const end = start + piece.length;
    sentences.push({ text: piece, startOffset: start, endOffset: end });
    cursor = end;
  }

  if (sentences.length === 0) {
    sentences.push({
      text: chunkText,
      startOffset: 0,
      endOffset: chunkText.length,
    });
  }
  return sentences;
}

// ===========================================================================
// Citation extraction
// ===========================================================================

/**
 * Walk through the LLM's answer text, find every `[chunkId]` marker,
 * look the chunk up, and choose the best-matching sentence inside that
 * chunk as the citation span.
 *
 * Returns one `Citation` per resolved marker. Markers whose `chunkId`
 * is not in the lookup are silently skipped — callers can cross-check
 * by counting markers in the answer.
 */
export function extractCitedSpans(
  answer: string,
  chunks: ReadonlyArray<ChunkSource>,
): ReadonlyArray<Citation> {
  if (!answer || chunks.length === 0) return [];

  const lookup = new Map<string, ChunkSource>();
  for (const c of chunks) lookup.set(c.id, c);

  const spans: Array<Citation> = [];
  CITATION_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_MARKER_RE.exec(answer)) !== null) {
    const chunkId = match[1];
    const chunk = lookup.get(chunkId);
    if (!chunk) continue;
    const markerIndex = match.index;
    const window = extractContextWindow(answer, markerIndex);
    const span = findBestSpan(chunk, window);
    spans.push(span);
  }
  return spans;
}

/**
 * Single-chunk variant: given the LLM's claim text and one chunk,
 * return the best span. Useful when callers already know the chunk id
 * (e.g. when an LLM tool-call returned a structured citation).
 */
export function findSpanForClaim(
  chunk: ChunkSource,
  claimText: string,
): Citation {
  return findBestSpan(chunk, claimText);
}

// ===========================================================================
// Verification
// ===========================================================================

/**
 * Verify that the quoted span really comes from the chunk. Used by the
 * FRONT-style verifier pass — when too many citations fail this check
 * the chat layer blocks the answer.
 */
export function verifySpan(chunk: ChunkSource, span: Citation): boolean {
  if (chunk.id !== span.chunkId) return false;
  if (span.startOffset < 0 || span.endOffset > chunk.text.length) {
    return false;
  }
  if (span.startOffset > span.endOffset) return false;
  return (
    chunk.text.slice(span.startOffset, span.endOffset) === span.quotedSpan
  );
}

// ===========================================================================
// Internal — span scoring
// ===========================================================================

function extractContextWindow(answer: string, markerIndex: number): string {
  const start = Math.max(0, markerIndex - CONTEXT_WINDOW_CHARS);
  const end = Math.min(
    answer.length,
    markerIndex + CONTEXT_WINDOW_CHARS,
  );
  return answer.slice(start, end);
}

function findBestSpan(chunk: ChunkSource, claimText: string): Citation {
  const sentences = splitChunkIntoSentences(chunk.text);
  if (sentences.length === 0) {
    return {
      chunkId: chunk.id,
      startOffset: 0,
      endOffset: chunk.text.length,
      quotedSpan: chunk.text,
      overlap: 0,
    };
  }

  const claimTokens = new Set(tokenize(claimText));
  let best: ChunkSentence | null = null;
  let bestOverlap = -1;
  for (const sentence of sentences) {
    const sTokens = new Set(tokenize(sentence.text));
    const overlap = jaccard(claimTokens, sTokens);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = sentence;
    }
  }

  if (!best || bestOverlap < MIN_OVERLAP_FOR_SPAN) {
    return {
      chunkId: chunk.id,
      startOffset: 0,
      endOffset: chunk.text.length,
      quotedSpan: chunk.text,
      overlap: Math.max(0, bestOverlap),
    };
  }
  return {
    chunkId: chunk.id,
    startOffset: best.startOffset,
    endOffset: best.endOffset,
    quotedSpan: chunk.text.slice(best.startOffset, best.endOffset),
    overlap: bestOverlap,
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const tok of a) if (b.has(tok)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function advancePastWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}
