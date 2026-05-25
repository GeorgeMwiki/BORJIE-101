/**
 * Skill-promotion — Voyager-style auto-promotion of recurring procedural
 * patterns into skill-registry rows.
 *
 * Closes §4.6 of `.planning/parity-litfin/00-STATUS-2026-05-18.md`:
 *
 *   "skill-registry.schema.ts is shipped but the auto-promotion path
 *    (procedural → skill) is not wired."
 *
 * Public surface:
 *
 *   Types:      ProceduralTrace, ToolCall, CandidateSkill, PromotionDecision,
 *               PromotionRecord, PromotionVerdict, SkillRegistryWriter.
 *   Constants:  MIN_OCCURRENCES, MIN_SUCCESS_RATE, CHI_SQUARED_CRITICAL_95,
 *               MIN_NGRAM, MAX_NGRAM.
 *   Functions:  extractCandidates, evaluateCandidate, evaluateCandidates,
 *               promoteSkill, buildPromotionRecord, createInMemorySkillRegistry.
 *
 * Wiring point (production): the consolidation worker (nightly stage
 * 04-promote, see `kernel-memory-semantic.schema`) reads procedural
 * traces from the kernel-trace store, runs them through:
 *
 *     traces → extractCandidates() → evaluateCandidates()
 *            → filter(verdict==='promote') → promoteSkill(…, drizzleWriter)
 *
 * and writes the resulting rows to `skill_registry`.
 */

export * from './types.js';
export {
  extractCandidates,
  type PatternExtractorOptions,
} from './pattern-extractor.js';
export {
  evaluateCandidate,
  evaluateCandidates,
  type SignificanceGateOptions,
} from './significance-gate.js';
export {
  promoteSkill,
  buildPromotionRecord,
  createInMemorySkillRegistry,
  type PromoterDeps,
  type PromoteResult,
} from './promoter.js';
