/**
 * Consolidation cycle — barrel.
 *
 * The brain's "sleep" pass: episodic → semantic + procedural +
 * reflective. See consolidation-cycle.ts for the orchestrator and
 * consolidation-types.ts for the public types.
 */

export {
  runConsolidationCycle,
  FACT_EXTRACTION_SYSTEM_PROMPT,
  REFLECTIVE_DIGEST_SYSTEM_PROMPT,
  type DetectedPattern,
} from './consolidation-cycle.js';

export {
  DEFAULT_CONSOLIDATION_CONFIG,
  type ConsolidationConfig,
  type ConsolidationDeps,
  type ConsolidationJudgeCallArgs,
  type ConsolidationJudgePort,
  type ConsolidationLogger,
  type ConsolidationReport,
  type ConsolidationScope,
  type ExtractedFact,
  type ReflectiveDigestPayload,
} from './consolidation-types.js';
