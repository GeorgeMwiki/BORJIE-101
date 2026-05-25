/**
 * Provider-fingerprint scrubber — strips strings that leak which LLM
 * provider is behind the Borjie brain.
 *
 * Ported from LITFIN `src/core/litfin-ai/llm/soul-router.ts` lines 85-142.
 *
 * **Critical idempotency fix:** LITFIN's iter-44 caught a HIGH bug
 * where `.test()` on a module-scope GLOBAL regex advances `lastIndex`
 * between calls, causing the scrubber to skip valid matches on the
 * second invocation. We only use `.replace()` here — it resets
 * `lastIndex` internally when called and is safe regardless of the
 * `g` flag.
 *
 * Patterns (cover Anthropic / OpenAI / Google / Meta / DeepSeek):
 *
 *   1. "I'm Claude, made by Anthropic" / "I am ChatGPT made by OpenAI"
 *   2. Standalone product names: Claude, ChatGPT, GPT-4, Gemini, Llama
 *   3. "I'm an AI assistant" / "I am a language model"
 *   4. "As an AI language model"
 *
 * The replacement uses "Borjie brain" so customer-facing text
 * stays on-brand and never reveals the underlying vendor.
 */

export interface ScrubResult {
  readonly text: string;
  readonly scrubbed: boolean;
}

interface FingerprintPattern {
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Patterns are exported for test coverage. Order matters: pattern 1
 * collapses the longer "I'm X, made by Y" form so pattern 2 doesn't
 * leave a dangling product name.
 *
 * All patterns are global (`g`) for multi-occurrence replacement
 * and case-insensitive (`i`). They are SAFE to reuse across calls
 * because we only ever invoke `.replace()` (NOT `.test()`).
 */
export const PROVIDER_FINGERPRINT_PATTERNS: ReadonlyArray<FingerprintPattern> =
  Object.freeze([
    // 1. "I'm Claude, made by Anthropic" — collapse the whole sentence.
    {
      pattern:
        /\bI(?:'m| am)\b[^.!?]*?\b(?:Anthropic|OpenAI|Google|Meta|DeepSeek)\b\.?/gi,
      replacement: "I'm the Borjie brain.",
    },
    // 2. Standalone product names (when not captured above).
    {
      pattern: /\b(?:Claude|ChatGPT|GPT-?4o?|GPT-5|Gemini|Llama)\b/gi,
      replacement: 'the Borjie brain',
    },
    // 3. Generic "I'm an AI assistant" / "I am a language model".
    {
      pattern:
        /\bI(?:'m| am)\s+(?:an?\s+)?(?:AI\s+(?:assistant|model)|language\s+model|AI)\b[.,!]?/gi,
      replacement: "I'm the Borjie brain.",
    },
    // 4. Sentence-initial "As an AI language model, ...".
    {
      pattern: /\bAs an AI(?:\s+(?:language\s+model|assistant))?[,.]?/gi,
      replacement: 'As the Borjie brain,',
    },
  ]);

/**
 * Strip provider fingerprints from `text`. Idempotent: calling this
 * twice with the same input returns the same output.
 *
 * Returns `{ scrubbed: true }` iff at least one pattern replaced
 * something. Useful for telemetry — we can alert when the scrubber
 * actually fires (signals that the system prompt isn't doing its job).
 */
export function scrubProviderFingerprints(text: string): ScrubResult {
  if (!text) return { text, scrubbed: false };
  let out = text;
  let scrubbed = false;
  for (const p of PROVIDER_FINGERPRINT_PATTERNS) {
    // `.replace()` resets `lastIndex` internally — safe to call
    // repeatedly on a module-scope global regex. Do NOT swap this
    // for `.test()` followed by `.replace()` — that breaks idempotency.
    const replaced = out.replace(p.pattern, p.replacement);
    if (replaced !== out) {
      scrubbed = true;
      out = replaced;
    }
  }
  // Clean up double spaces / spaces before punctuation left by
  // replacements.
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1');
  return { text: out, scrubbed };
}
