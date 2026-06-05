/**
 * estimate-tokens — fast, allocator-light token heuristic.
 *
 * Ported from LITFIN `src/core/litfin-ai/llm/prompt-budget.ts:estimateTokens`.
 *
 * Tracks Claude / GPT tokenisers within ~10% across English + Swahili using a
 * hybrid of character-density and whitespace word-count. No tokeniser load, no
 * network — safe to call on every turn in the prompt hot path.
 *
 * Calibration notes (why the char/4 + word-count mean):
 *   - Claude / GPT average ~4 chars/token for English, ~5 for Swahili.
 *   - Whitespace count is a near-lower-bound (≈ one token per word worst case).
 *   - Averaging the two yields a conservative-but-tight estimate that does not
 *     under-count Swahili (longer agglutinative words) the way char/4 alone can.
 *
 * Pure module: no I/O, no mutation, never throws.
 */

const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token count for a single string. Returns 0 for empty / nullish.
 * EN/SW-safe (see calibration above). Deterministic and allocator-light — the
 * word count is computed by scanning char codes rather than `split`.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const charBased = Math.ceil(text.length / CHARS_PER_TOKEN);

  // Word count without allocating an array: count whitespace runs.
  let words = 0;
  let inWhitespace = true;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    const isWs = c === 32 /* space */ || c === 10 /* \n */ || c === 9 /* \t */ || c === 13; /* \r */
    if (isWs) {
      inWhitespace = true;
    } else if (inWhitespace) {
      words += 1;
      inWhitespace = false;
    }
  }

  // Conservative mean of the two estimates.
  return Math.ceil((charBased + words) / 2);
}

/** Sum the estimated tokens of many strings (e.g. message contents). */
export function estimateTokensOfMany(texts: readonly (string | null | undefined)[]): number {
  let total = 0;
  for (const t of texts) total += estimateTokens(t);
  return total;
}
