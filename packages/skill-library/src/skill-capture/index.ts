/**
 * @borjie/skill-library/skill-capture — Voyager skill-CAPTURE loop.
 *
 * The DARK half of the skill library, now lit: when a multi-step task
 * completes AND verifies, the MD describes it, embeds it, stores it as a
 * permanent reusable `CodeSkill`, and emits a `LearnedShortcut` — so
 * repeated work becomes a permanent capability.
 *
 *     solve → verify → describe → embed → store → compose
 *
 * Wire `captureSkillOnCompletion` at the orchestrator's post-turn /
 * consolidation completion-detection point. Everything is additive,
 * human-review-gated, and rail-composing (verify-gated, evidence-required,
 * never touches money/RLS/policy-gate).
 */

export {
  captureSkillOnCompletion,
  type CaptureHookOptions,
} from './completion-hook.js';

export {
  runCaptureLoop,
  type CaptureLoopOptions,
} from './capture-loop.js';

export { createHeuristicDescriber } from './heuristic-describer.js';

export {
  captureAuditHash,
  canonicalJson,
  GENESIS_HASH,
} from './audit.js';

export { toSkillSlug, suffixSlug } from './slug.js';

export {
  MIN_STEPS_FOR_CAPTURE,
  SKILL_SLUG_RE,
  type CompletedTask,
  type CompletedTaskStep,
  type SkillDescriber,
  type SkillEmbedder,
  type CaptureLogger,
  type CapturedLearnedShortcut,
  type SkillCaptureResult,
  type SkillCaptureSkipReason,
} from './types.js';
