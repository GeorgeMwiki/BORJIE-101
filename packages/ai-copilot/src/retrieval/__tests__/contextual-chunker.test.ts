/**
 * Tests for retrieval/contextual-chunker.
 *
 * Covers:
 *   1. Identity path when `skipLlm` is true.
 *   2. Identity path when no `contextualizeFn` is supplied.
 *   3. Identity path when document text is empty.
 *   4. Happy path: per-chunk preface is attached + concatenated into embedText.
 *   5. Batch size honours the option.
 *   6. Per-batch LLM failure does NOT poison successful batches.
 *   7. Unknown chunkIndex in the LLM response is dropped.
 *   8. Preface is truncated to maxPrefaceChars.
 *   9. parseContextSummaries tolerates prose preamble around the JSON.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  contextualizeChunks,
  parseContextSummaries,
  type ContextualizeFn,
} from '../contextual-chunker.js';

const DOC = [
  'Inspection report — Property #4421 (Mikocheni, Dar es Salaam).',
  '',
  'Section 1. Building exterior.',
  'Roof in good condition; gutters need clearing.',
  '',
  'Section 2. Interior — Unit A.',
  'Bathroom tap leaking; kitchen cabinets sound.',
].join('\n');

const CHUNKS: ReadonlyArray<string> = [
  'Building exterior. Roof in good condition; gutters need clearing.',
  'Unit A interior. Bathroom tap leaking; kitchen cabinets sound.',
  'Recommendations: replace tap within 14 days; clear gutters in dry season.',
];

describe('retrieval/contextual-chunker', () => {
  it('returns identity chunks when skipLlm is true', async () => {
    const result = await contextualizeChunks(DOC, CHUNKS, { skipLlm: true });
    expect(result.length).toBe(3);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].chunkIndex).toBe(i);
      expect(result[i].contextSummary).toBe('');
      expect(result[i].embedText).toBe(CHUNKS[i]);
      expect(result[i].chunkText).toBe(CHUNKS[i]);
    }
  });

  it('returns identity chunks when no contextualizeFn is wired', async () => {
    const result = await contextualizeChunks(DOC, CHUNKS);
    expect(result.length).toBe(3);
    for (const c of result) {
      expect(c.contextSummary).toBe('');
      expect(c.embedText).toBe(c.chunkText);
    }
  });

  it('returns identity chunks when document text is empty', async () => {
    const result = await contextualizeChunks('', CHUNKS, {
      contextualizeFn: vi.fn(),
    });
    expect(result.length).toBe(3);
    for (const c of result) {
      expect(c.contextSummary).toBe('');
    }
  });

  it('returns empty array for empty chunk input', async () => {
    const result = await contextualizeChunks(DOC, [], { skipLlm: true });
    expect(result).toEqual([]);
  });

  it('attaches per-chunk preface and concatenates into embedText', async () => {
    const stub: ContextualizeFn = vi.fn(async (input) =>
      input.chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        summary: `Context for chunk ${c.chunkIndex}.`,
      })),
    );

    const result = await contextualizeChunks(DOC, CHUNKS, {
      contextualizeFn: stub,
    });

    expect(result.length).toBe(3);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].chunkIndex).toBe(i);
      expect(result[i].contextSummary).toBe(`Context for chunk ${i}.`);
      expect(
        result[i].embedText.startsWith(`Context for chunk ${i}.`),
      ).toBe(true);
      expect(result[i].embedText.endsWith(CHUNKS[i])).toBe(true);
    }
    expect(stub).toHaveBeenCalled();
  });

  it('honours the batchSize option', async () => {
    const batchCalls: number[] = [];
    const stub: ContextualizeFn = vi.fn(async (input) => {
      batchCalls.push(input.chunks.length);
      return input.chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        summary: `s${c.chunkIndex}`,
      }));
    });

    await contextualizeChunks(DOC, CHUNKS, {
      contextualizeFn: stub,
      batchSize: 2,
    });

    // 3 chunks, batchSize 2 → 2 batches: [2, 1].
    expect(batchCalls).toEqual([2, 1]);
  });

  it('isolates per-batch failures from successful batches', async () => {
    const stub: ContextualizeFn = vi.fn(async (input) => {
      if (input.chunks[0]?.chunkIndex === 0) {
        throw new Error('simulated batch failure');
      }
      return input.chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        summary: `ok-${c.chunkIndex}`,
      }));
    });

    const result = await contextualizeChunks(DOC, CHUNKS, {
      contextualizeFn: stub,
      batchSize: 1,
    });

    expect(result.length).toBe(3);
    // Failed batch → identity.
    expect(result[0].contextSummary).toBe('');
    expect(result[0].embedText).toBe(CHUNKS[0]);
    // Subsequent batches succeed.
    expect(result[1].contextSummary).toBe('ok-1');
    expect(result[2].contextSummary).toBe('ok-2');
  });

  it('drops summaries whose chunkIndex is unknown', async () => {
    const stub: ContextualizeFn = vi.fn(async (input) => [
      { chunkIndex: 99, summary: 'rogue' },
      { chunkIndex: input.chunks[0].chunkIndex, summary: 'kept' },
    ]);

    const result = await contextualizeChunks(DOC, CHUNKS.slice(0, 1), {
      contextualizeFn: stub,
    });
    expect(result.length).toBe(1);
    expect(result[0].contextSummary).toBe('kept');
  });

  it('truncates preface to maxPrefaceChars', async () => {
    const longSummary = 'a'.repeat(2000);
    const stub: ContextualizeFn = vi.fn(async (input) =>
      input.chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        summary: longSummary,
      })),
    );
    const result = await contextualizeChunks(DOC, CHUNKS, {
      contextualizeFn: stub,
      maxPrefaceChars: 100,
    });
    expect(result[0].contextSummary.length).toBeLessThanOrEqual(100);
  });
});

describe('retrieval/contextual-chunker / parseContextSummaries', () => {
  it('parses a clean JSON array', () => {
    const text =
      '[{"chunkIndex":0,"summary":"first"},{"chunkIndex":1,"summary":"second"}]';
    const out = parseContextSummaries(text, [0, 1]);
    expect(out).toEqual([
      { chunkIndex: 0, summary: 'first' },
      { chunkIndex: 1, summary: 'second' },
    ]);
  });

  it('tolerates prose preamble around the JSON', () => {
    const text =
      'Here are the summaries:\n[{"chunkIndex":0,"summary":"first"}]\nDone.';
    const out = parseContextSummaries(text, [0]);
    expect(out).toEqual([{ chunkIndex: 0, summary: 'first' }]);
  });

  it('drops entries with unexpected chunkIndex', () => {
    const text = '[{"chunkIndex":99,"summary":"rogue"}]';
    const out = parseContextSummaries(text, [0, 1]);
    expect(out).toEqual([]);
  });

  it('returns empty array on malformed JSON', () => {
    expect(parseContextSummaries('not json', [0])).toEqual([]);
    expect(parseContextSummaries('', [0])).toEqual([]);
  });
});
