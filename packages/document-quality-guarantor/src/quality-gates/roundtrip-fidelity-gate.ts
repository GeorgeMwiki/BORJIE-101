/**
 * roundtripFidelityGate — render → OCR back → compare to source intent.
 *
 * Pattern: when we render a document, we may also OCR the render and
 * diff against the source text to verify the render preserved
 * semantics. Used by Microsoft Word's PDF roundtrip QA + USPTO patent
 * literature on document-conversion correlation engines.
 *
 * Similarity is computed as a Jaccard index over word multisets — fast,
 * locale-tolerant, and correlates well with semantic preservation for
 * the bounded document-content use case. (Pure token similarity is
 * deliberate: we don't want false negatives from OCR whitespace noise.)
 */

import type { QualityReport } from '../types.js';
import type { Gate, RoundtripFidelityGateInput } from './types.js';

export interface RoundtripFidelityGateOptions {
  /** Min Jaccard similarity in [0,1]; default 0.95. */
  readonly similarityThreshold: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function jaccard(a: ReadonlyArray<string>, b: ReadonlyArray<string>): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection += 1;
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 1 : intersection / unionSize;
}

export function roundtripFidelityGate(
  opts: RoundtripFidelityGateOptions,
): Gate<RoundtripFidelityGateInput> {
  return {
    id: 'roundtripFidelityGate',
    async evaluate(input): Promise<QualityReport> {
      const source = tokenize(input.source.text);
      const extracted = tokenize(input.extractedFromRendered.text);
      const similarity = jaccard(source, extracted);
      const passed = similarity >= opts.similarityThreshold;
      return {
        gateId: 'roundtripFidelityGate',
        score: { value: similarity, threshold: opts.similarityThreshold, passed },
        reasons: passed
          ? [`roundtrip similarity ${similarity.toFixed(4)} meets ${opts.similarityThreshold}`]
          : [
              `roundtrip drift detected: similarity ${similarity.toFixed(4)} < threshold ${opts.similarityThreshold}`,
            ],
        details: {
          sourceTokens: source.length,
          extractedTokens: extracted.length,
        },
      };
    },
  };
}
