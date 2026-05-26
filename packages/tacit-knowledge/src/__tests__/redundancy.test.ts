/**
 * Redundancy checker — vector + lexical similarity decisions.
 */

import { describe, expect, it } from 'vitest';
import type { ExtractionDraft } from '../index.js';
import {
  createInMemoryVectorIndex,
  createRedundancyChecker,
  jaccardSimilarity,
} from '../index.js';

function draftFor(text: string): ExtractionDraft {
  return {
    entityKind: 'rule',
    entity: {
      text,
      structured: {},
      citations: [],
    },
    confidence: 0.8,
    novel: true,
  };
}

describe('redundancy checker', () => {
  it('marks an extraction novel when the vector index is empty', async () => {
    const index = createInMemoryVectorIndex();
    const checker = createRedundancyChecker(index);
    const decision = await checker.check({
      tenantId: 'tnt-1',
      draft: draftFor("You must leave at 04:40 to clear Geita weighbridge."),
    });
    expect(decision.kind).toBe('novel');
  });

  it('marks an extraction redundant when a near-identical cell exists', async () => {
    const index = createInMemoryVectorIndex();
    index.add({
      tenantId: 'tnt-1',
      cellId: 'cell-prior-1',
      text: 'You must leave at 04:40 to clear Geita weighbridge before day shift.',
    });
    const checker = createRedundancyChecker(index);
    const decision = await checker.check({
      tenantId: 'tnt-1',
      draft: draftFor(
        "You must leave at 04:40 to clear Geita weighbridge before day shift starts.",
      ),
    });
    expect(decision.kind).toBe('redundant');
    if (decision.kind === 'redundant') {
      expect(decision.cellId).toBe('cell-prior-1');
      expect(decision.similarity).toBeGreaterThanOrEqual(0.86);
    }
  });

  it('falls back to lexical Jaccard when no vector hit clears the threshold', async () => {
    const index = createInMemoryVectorIndex();
    const checker = createRedundancyChecker(index, {
      cosineThreshold: 0.99, // intentionally too tight for cosine to ever hit
    });
    const decision = await checker.check({
      tenantId: 'tnt-1',
      draft: draftFor("Compressor number three loads up with a high whine at six bar"),
      priorTexts: [
        {
          cellId: 'cell-lex-1',
          text: 'Compressor number three loads with a whine at six bar pressure',
        },
      ],
    });
    expect(decision.kind).toBe('redundant');
  });

  it('jaccard helper is symmetric + ranges over [0,1]', () => {
    const j = jaccardSimilarity(
      'compressor number three whine high pressure',
      'compressor number three whine six bar pressure',
    );
    expect(j).toBeGreaterThan(0);
    expect(j).toBeLessThan(1);
    const symmetric = jaccardSimilarity(
      'compressor number three whine six bar pressure',
      'compressor number three whine high pressure',
    );
    expect(symmetric).toBeCloseTo(j, 5);
  });
});
