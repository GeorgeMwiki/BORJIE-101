/**
 * Rag-prefix builder — small-N alternative to LoRA fine-tuning.
 *
 * For tenants whose curated `TrainingPair` count is below the LoRA
 * convergence floor (default 200), the loop produces a retrieval-
 * augmented prompt prefix instead of training a parameter adapter. The
 * runtime prepends this prefix to every Mr. Mwikila system prompt.
 *
 * The builder is a pure function — input is the curated pairs + a token
 * budget; output is the prefix string. Pairs are sorted by aggregate
 * score (desc) then by recency (desc); the build stops when the next
 * pair would breach the budget.
 *
 * Token counting is approximation — we use the standard 4-chars-per-
 * token heuristic from OpenAI tokenisation docs
 * (https://platform.openai.com/tokenizer). Production wiring can swap in
 * a real tokeniser via the `tokenCounter` port if budget precision
 * matters.
 */

import type { TrainingPair } from '../types.js';

export interface TokenCounterPort {
  count(text: string): number;
}

export const approximateTokenCounter: TokenCounterPort = Object.freeze({
  count(text: string): number {
    if (typeof text !== 'string') {
      return 0;
    }
    return Math.ceil(text.length / 4);
  },
});

export interface RagPrefixConfig {
  /** Hard token ceiling. Default 4 000. */
  readonly maxTokens: number;
  /** Optional preamble text to prepend before any examples. */
  readonly preamble?: string;
  /** Optional token-counter port. Defaults to the 4-chars-per-token
   *  approximation. */
  readonly tokenCounter?: TokenCounterPort;
}

export const DEFAULT_RAG_PREFIX_CONFIG: RagPrefixConfig = Object.freeze({
  maxTokens: 4_000,
  preamble:
    'Few-shot exemplars (Mr. Mwikila — Borjie). Tanzanian mining-domain Swahili turns curated from prior live interactions.',
});

export interface RagPrefix {
  readonly text: string;
  readonly includedPairCount: number;
  readonly tokenCount: number;
}

/**
 * Build the prefix. Returns `RagPrefix` containing the prefix text
 * (preamble + numbered exemplars) plus accounting info.
 */
export function buildRagPrefix(
  pairs: ReadonlyArray<TrainingPair>,
  config: RagPrefixConfig = DEFAULT_RAG_PREFIX_CONFIG,
): RagPrefix {
  if (pairs.length === 0) {
    const preamble = config.preamble ?? '';
    const counter = config.tokenCounter ?? approximateTokenCounter;
    return Object.freeze({
      text: preamble,
      includedPairCount: 0,
      tokenCount: counter.count(preamble),
    });
  }

  const counter = config.tokenCounter ?? approximateTokenCounter;
  const preamble = config.preamble ?? DEFAULT_RAG_PREFIX_CONFIG.preamble ?? '';

  // Filter to included pairs only.
  const eligible = pairs.filter((p) => p.included);

  // Sort: aggregate-score desc, then recordedAt desc.
  const sorted = [...eligible].sort((a, b) => {
    const scoreDiff = b.scores.aggregate - a.scores.aggregate;
    if (Math.abs(scoreDiff) > 1e-9) {
      return scoreDiff;
    }
    // recordedAt is ISO, so string compare is chronological.
    return b.recordedAt.localeCompare(a.recordedAt);
  });

  const headerTokens = counter.count(preamble);
  let usedTokens = headerTokens;
  const lines: string[] = [];
  if (preamble.length > 0) {
    lines.push(preamble);
  }
  let included = 0;

  for (const pair of sorted) {
    const exemplar = `\n[exemplar ${included + 1} | lang=${pair.lang} | aggregate=${pair.scores.aggregate.toFixed(3)}]\nuser: ${pair.sourceText}\nmwikila: ${pair.targetText}`;
    const exemplarTokens = counter.count(exemplar);
    if (usedTokens + exemplarTokens > config.maxTokens) {
      break;
    }
    lines.push(exemplar);
    usedTokens += exemplarTokens;
    included++;
  }

  return Object.freeze({
    text: lines.join(''),
    includedPairCount: included,
    tokenCount: usedTokens,
  });
}
