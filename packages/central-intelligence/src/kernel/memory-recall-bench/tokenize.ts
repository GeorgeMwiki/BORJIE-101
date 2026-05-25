/**
 * Memory Recall Bench — tokeniser + token-F1.
 *
 * Deliberately tiny. Locale-agnostic: splits on Unicode word boundaries,
 * lowercases, strips empty tokens. Mirrors the corpus pre-processing
 * used by LITFIN's recall harness so baseline diffs are comparable.
 */

const SPLIT_RX = /[^\p{L}\p{N}]+/u;

/**
 * Tokenise `text` into normalised lowercase tokens. Returns a frozen
 * array (immutable — callers MUST NOT mutate).
 */
export function tokenise(text: string): ReadonlyArray<string> {
  if (typeof text !== 'string' || text.length === 0) {
    return Object.freeze([]);
  }
  const lowered = text.toLowerCase();
  const parts = lowered.split(SPLIT_RX).filter((tok) => tok.length > 0);
  return Object.freeze(parts);
}

/**
 * Token-level F1 between `expected` and `actual`. Returns 0 when either
 * side is empty (the standard SQuAD convention).
 */
export function tokenF1(expected: string, actual: string): number {
  const expectedTokens = tokenise(expected);
  const actualTokens = tokenise(actual);
  if (expectedTokens.length === 0 || actualTokens.length === 0) {
    return 0;
  }
  // Build multiset intersection.
  const expectedCounts = new Map<string, number>();
  for (const tok of expectedTokens) {
    expectedCounts.set(tok, (expectedCounts.get(tok) ?? 0) + 1);
  }
  let common = 0;
  for (const tok of actualTokens) {
    const remaining = expectedCounts.get(tok) ?? 0;
    if (remaining > 0) {
      common += 1;
      expectedCounts.set(tok, remaining - 1);
    }
  }
  if (common === 0) {
    return 0;
  }
  const precision = common / actualTokens.length;
  const recall = common / expectedTokens.length;
  return (2 * precision * recall) / (precision + recall);
}
