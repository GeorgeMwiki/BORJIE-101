/**
 * `@borjie/brain-llm-router/speculative-decoding` (LP-12) — SCAFFOLD surface.
 *
 * Draft-then-verify latency optimisation. Typed interface + minimal single-round
 * impl; the full multi-round token-acceptance loop is TODO(LP-12).
 */

export {
  speculativeDecode,
  isSpeculativeDecodingEnabled,
  type SpeculativeModelClient,
  type SpeculativeDecodeArgs,
  type SpeculativeDecodeStats,
  type SpeculativeDecodeResult,
} from './draft-then-verify.js';
