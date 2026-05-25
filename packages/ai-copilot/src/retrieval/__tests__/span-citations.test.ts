/**
 * Tests for retrieval/span-citations.
 *
 * Covers:
 *   1. splitChunkIntoSentences records offsets so
 *      `slice(start,end) === text` for every sentence.
 *   2. extractCitedSpans returns a span when the LLM cites a known chunk.
 *   3. extractCitedSpans skips unknown chunk ids.
 *   4. extractCitedSpans resolves multiple citations in one answer.
 *   5. verifySpan accepts valid spans, rejects mismatched offsets /
 *      chunk-id / out-of-range offsets.
 *   6. Low-overlap citations fall back to the whole chunk (better to
 *      over-highlight than mis-cite).
 *   7. findSpanForClaim returns the best sentence directly.
 *   8. Span output maps response back to source spans —
 *      `quotedSpan === chunk.text.slice(start, end)`.
 */

import { describe, it, expect } from 'vitest';
import {
  splitChunkIntoSentences,
  extractCitedSpans,
  findSpanForClaim,
  verifySpan,
} from '../span-citations.js';
import type { ChunkSource } from '../types.js';

const CHUNK_A_TEXT = [
  'Lease rent is TZS 850,000 per month for Unit A.',
  'Service charge is TZS 75,000 per month.',
  'Total monthly billing therefore lands at TZS 925,000.',
].join(' ');

const CHUNK_B_TEXT = [
  'Roof leakage is the dominant maintenance concern.',
  'Plumbing issues are a secondary concern.',
].join(' ');

const CHUNKS: ReadonlyArray<ChunkSource> = [
  { id: 'chunk-a', text: CHUNK_A_TEXT },
  { id: 'chunk-b', text: CHUNK_B_TEXT },
];

describe('retrieval/span-citations / splitChunkIntoSentences', () => {
  it('offsets satisfy slice(start,end) === sentence text', () => {
    const sentences = splitChunkIntoSentences(CHUNK_A_TEXT);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const s of sentences) {
      expect(CHUNK_A_TEXT.slice(s.startOffset, s.endOffset)).toBe(s.text);
    }
  });

  it('returns a single span for unsplittable text', () => {
    const sentences = splitChunkIntoSentences('one short fragment');
    expect(sentences.length).toBe(1);
    expect(sentences[0].startOffset).toBe(0);
    expect(sentences[0].endOffset).toBe('one short fragment'.length);
  });

  it('returns empty array for empty input', () => {
    expect(splitChunkIntoSentences('')).toEqual([]);
  });
});

describe('retrieval/span-citations / extractCitedSpans', () => {
  it('returns a span when the LLM cites a known chunk', () => {
    const answer =
      'Total monthly billing therefore lands at TZS 925,000 [chunk-a].';
    const spans = extractCitedSpans(answer, CHUNKS);
    expect(spans.length).toBe(1);
    expect(spans[0].chunkId).toBe('chunk-a');
    // Best sentence should mention the total.
    expect(spans[0].quotedSpan.toLowerCase()).toContain('total');
  });

  it('skips unknown chunk ids', () => {
    const answer = 'Some claim [does-not-exist].';
    const spans = extractCitedSpans(answer, CHUNKS);
    expect(spans).toEqual([]);
  });

  it('resolves multiple citations in one answer', () => {
    const answer =
      'Roof leakage is the largest concern [chunk-b]. ' +
      'Rent is 850,000 per month [chunk-a].';
    const spans = extractCitedSpans(answer, CHUNKS);
    expect(spans.length).toBe(2);
    expect(spans[0].chunkId).toBe('chunk-b');
    expect(spans[1].chunkId).toBe('chunk-a');
  });

  it('quotedSpan equals chunk.text.slice(start, end) — maps response to source', () => {
    const answer =
      'Rent for Unit A is TZS 850,000 per month [chunk-a].';
    const spans = extractCitedSpans(answer, CHUNKS);
    expect(spans.length).toBe(1);
    const s = spans[0];
    expect(CHUNK_A_TEXT.slice(s.startOffset, s.endOffset)).toBe(
      s.quotedSpan,
    );
    expect(verifySpan(CHUNKS[0], s)).toBe(true);
  });
});

describe('retrieval/span-citations / findSpanForClaim', () => {
  it('returns the highest-overlap sentence', () => {
    const span = findSpanForClaim(
      CHUNKS[1],
      'Plumbing issues are a follow-on concern.',
    );
    expect(span.chunkId).toBe('chunk-b');
    expect(span.quotedSpan.toLowerCase()).toContain('plumbing');
  });

  it('falls back to whole-chunk span when overlap is below the floor', () => {
    const span = findSpanForClaim(
      CHUNKS[0],
      'Something entirely unrelated to leases.',
    );
    expect(span.chunkId).toBe('chunk-a');
    expect(span.startOffset).toBe(0);
    expect(span.endOffset).toBe(CHUNK_A_TEXT.length);
  });
});

describe('retrieval/span-citations / verifySpan', () => {
  it('rejects offsets that point outside the chunk', () => {
    const ok = verifySpan(CHUNKS[0], {
      chunkId: 'chunk-a',
      startOffset: 0,
      endOffset: 9999,
      quotedSpan: 'ignored',
      overlap: 1,
    });
    expect(ok).toBe(false);
  });

  it('rejects mismatched chunk ids', () => {
    const ok = verifySpan(CHUNKS[0], {
      chunkId: 'chunk-b',
      startOffset: 0,
      endOffset: 5,
      quotedSpan: CHUNK_A_TEXT.slice(0, 5),
      overlap: 1,
    });
    expect(ok).toBe(false);
  });

  it('accepts valid spans where quotedSpan matches the slice', () => {
    const sentences = splitChunkIntoSentences(CHUNK_A_TEXT);
    const s = sentences[0];
    const ok = verifySpan(CHUNKS[0], {
      chunkId: 'chunk-a',
      startOffset: s.startOffset,
      endOffset: s.endOffset,
      quotedSpan: s.text,
      overlap: 0.9,
    });
    expect(ok).toBe(true);
  });

  it('rejects reversed offsets', () => {
    const ok = verifySpan(CHUNKS[0], {
      chunkId: 'chunk-a',
      startOffset: 10,
      endOffset: 5,
      quotedSpan: '',
      overlap: 1,
    });
    expect(ok).toBe(false);
  });
});
