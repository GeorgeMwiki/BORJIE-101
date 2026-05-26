/**
 * Redundancy checker — vector + lexical similarity.
 *
 * Wave HARVEST. Decides whether an extracted entity duplicates a cell
 * already stored in cognitive-memory. Two passes:
 *
 *   1. Vector similarity via the injected `VectorIndex` port. Cosine
 *      threshold defaults to `REDUNDANCY_COSINE_THRESHOLD` (0.86).
 *   2. Lexical similarity — token Jaccard on canonicalised content,
 *      `REDUNDANCY_LEXICAL_THRESHOLD` (0.55). Used both as a fallback
 *      and as a confirmation when the vector index is offline.
 *
 * Returns either `{ kind: 'novel' }` (write a fresh cell) or
 * `{ kind: 'redundant', cellId, similarity }` (reinforce the
 * existing cell instead of duplicating).
 */

import type {
  ExtractionDraft,
  VectorIndex,
} from '../types.js';
import {
  REDUNDANCY_COSINE_THRESHOLD,
  REDUNDANCY_LEXICAL_THRESHOLD,
} from '../types.js';

export type RedundancyDecision =
  | { readonly kind: 'novel' }
  | { readonly kind: 'redundant'; readonly cellId: string; readonly similarity: number };

export interface RedundancyChecker {
  check(input: {
    readonly tenantId: string;
    readonly draft: ExtractionDraft;
    readonly priorTexts?: ReadonlyArray<{ readonly cellId: string; readonly text: string }>;
  }): Promise<RedundancyDecision>;
}

interface RedundancyCheckerOptions {
  readonly cosineThreshold: number;
  readonly lexicalThreshold: number;
}

const DEFAULT_OPTIONS: RedundancyCheckerOptions = {
  cosineThreshold: REDUNDANCY_COSINE_THRESHOLD,
  lexicalThreshold: REDUNDANCY_LEXICAL_THRESHOLD,
};

function canonicaliseTokens(text: string): ReadonlySet<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  return new Set(tokens);
}

export function jaccardSimilarity(a: string, b: string): number {
  const ta = canonicaliseTokens(a);
  const tb = canonicaliseTokens(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersect = 0;
  ta.forEach((t) => {
    if (tb.has(t)) intersect += 1;
  });
  const union = ta.size + tb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export function createRedundancyChecker(
  vectorIndex: VectorIndex,
  options: Partial<RedundancyCheckerOptions> = {},
): RedundancyChecker {
  const opts: RedundancyCheckerOptions = { ...DEFAULT_OPTIONS, ...options };

  return {
    async check(input: {
      readonly tenantId: string;
      readonly draft: ExtractionDraft;
      readonly priorTexts?: ReadonlyArray<{
        readonly cellId: string;
        readonly text: string;
      }>;
    }): Promise<RedundancyDecision> {
      // Pass 1 — vector index lookup.
      const vector = await vectorIndex.findNearest({
        tenantId: input.tenantId,
        text: input.draft.entity.text,
        threshold: opts.cosineThreshold,
      });
      if (vector !== null) {
        return {
          kind: 'redundant',
          cellId: vector.cellId,
          similarity: vector.similarity,
        };
      }
      // Pass 2 — lexical Jaccard fallback (used when vector index is
      // empty or no match clears the cosine threshold).
      if (input.priorTexts !== undefined) {
        let bestCell: string | null = null;
        let bestScore = 0;
        for (const prior of input.priorTexts) {
          const score = jaccardSimilarity(input.draft.entity.text, prior.text);
          if (score > bestScore) {
            bestScore = score;
            bestCell = prior.cellId;
          }
        }
        if (bestCell !== null && bestScore >= opts.lexicalThreshold) {
          return { kind: 'redundant', cellId: bestCell, similarity: bestScore };
        }
      }
      return { kind: 'novel' };
    },
  };
}
