/**
 * citationCoverageGate — for AI-generated answers. Quantitative claims
 * (numbers, currencies, percentages, dates) must each be backed by N+
 * citations, where N defaults to 1.
 *
 * The gate tokenizes the answer, extracts quantitative tokens, then
 * checks that for each token, at least `minCoverage` citations quote a
 * substring containing the same token. Tokens with insufficient
 * citation coverage are listed as failure reasons.
 */

import type { QualityReport } from '../types.js';
import type { CitationCoverageGateInput, Gate } from './types.js';

export interface CitationCoverageGateOptions {
  /** Minimum citations per quantitative claim. Default 1. */
  readonly minCoverage: number;
}

// Quant-token grammar:
//   $1500, 1,500.00, 12.5%, 2024-12-31, 12/31/2024, plain 1500.
// We anchor on `(?<=^|[\s.,;:!?(])` rather than `\b` so currency
// prefixes (`$`) and the digit they precede are captured as a single
// token. Trailing `%` is included; numeric magnitudes with commas /
// decimals are supported.
const QUANT_TOKEN = /(?<=^|[\s.,;:!?(])(\$?\d[\d,]*(?:\.\d+)?%?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;

function extractQuantTokens(text: string): string[] {
  const out: string[] = [];
  // matchAll handles the lookbehind + capture-group case correctly.
  for (const m of text.matchAll(QUANT_TOKEN)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return Array.from(new Set(out));
}

export function citationCoverageGate(
  opts: CitationCoverageGateOptions,
): Gate<CitationCoverageGateInput> {
  const minCoverage = Math.max(1, opts.minCoverage);
  return {
    id: 'citationCoverageGate',
    async evaluate(input): Promise<QualityReport> {
      const tokens = input.quantitativeClaims ?? extractQuantTokens(input.answer);
      if (tokens.length === 0) {
        return {
          gateId: 'citationCoverageGate',
          score: { value: 1, threshold: 1, passed: true },
          reasons: ['no quantitative claims detected'],
        };
      }
      const uncovered: string[] = [];
      for (const token of tokens) {
        const supporting = input.citations.filter((c) => c.quote.includes(token));
        if (supporting.length < minCoverage) uncovered.push(token);
      }
      const value = (tokens.length - uncovered.length) / tokens.length;
      const passed = uncovered.length === 0;
      return {
        gateId: 'citationCoverageGate',
        score: { value, threshold: 1, passed },
        reasons: passed
          ? [`all ${tokens.length} quantitative claims have >= ${minCoverage} citation(s)`]
          : uncovered.map(
              (t) => `quantitative claim "${t}" lacks ${minCoverage} citation(s)`,
            ),
        details: { totalClaims: tokens.length, uncovered, minCoverage },
      };
    },
  };
}
