/**
 * Deterministic summary-LLM fixture for tests.
 *
 * Wave BLACKBOARD-CORE. The summary generator depends on a
 * `SummaryLLMPort`. Tests inject this fixture so the response is
 * predictable: the summary text is a count of input chunks plus the
 * first 4 characters of each chunk, and the token count is faithfully
 * computed via the same 4-chars-per-token estimator the generator
 * uses.
 *
 * No randomness — calling `.summarise(req)` with the same `req`
 * always returns the same response.
 */

import type {
  SummaryLLMPort,
  SummaryLLMRequest,
  SummaryLLMResponse,
} from '../summary/summary-generator.js';

export interface DeterministicSummaryLLMOptions {
  /** Force the returned text length to roughly this number of characters. */
  readonly forceChars?: number;
}

export function createDeterministicSummaryLLM(
  options: DeterministicSummaryLLMOptions = {},
): SummaryLLMPort {
  return {
    async summarise(req: SummaryLLMRequest): Promise<SummaryLLMResponse> {
      // Build a deterministic short summary: `SUMMARY[<n>]: <head> ...`.
      // We project the first `targetTokens * 4` characters from the
      // joined chunks so the response respects the requested budget.
      const joined = req.chunks.join(' | ');
      const targetChars =
        options.forceChars ?? Math.max(40, req.targetTokens * 4);
      const head = joined.slice(0, targetChars);
      const text = `SUMMARY[${req.chunks.length}]: ${head}`;
      const tokenCount = Math.ceil(text.length / 4);
      return { text, tokenCount };
    },
  };
}
