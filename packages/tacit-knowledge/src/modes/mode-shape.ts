/**
 * Shared mode-shape contract.
 *
 * Each of the five interview modes ships an immutable `ModeTemplate`
 * — the canonical question template + pacing budget + density target
 * for that session shape. The engine reads the template to (a) shape
 * the system prompt for the LLM extractor and (b) enforce the pacing
 * (max questions in a row, max words per Mr. Mwikila utterance, etc.).
 *
 * See `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md` §2 for the
 * authoritative description of each mode.
 */

import type { InterviewMode } from '../types.js';

/**
 * Pacing budget — per-mode tuning of cognitive cost on the subject.
 */
export interface PacingBudget {
  /**
   * Max questions Mr. Mwikila may ask in a row before yielding.
   * Walk-the-floor caps this hard at 2; deal-replay allows 3.
   */
  readonly maxQuestionsInARow: number;
  /**
   * Soft cap on words per Mr. Mwikila utterance. The extractor's
   * chunking layer trims if exceeded.
   */
  readonly maxWordsPerUtterance: number;
  /**
   * Ratio of subject-speech-seconds : Mr. Mwikila-speech-seconds.
   * Walk-the-floor targets ~6:1; deal-replay targets ~2:1.
   */
  readonly speechRatioTarget: number;
  /**
   * Minimum dwell time (ms) the engine waits after the subject's
   * utterance before generating the next Mr. Mwikila utterance.
   * Post-incident sets this high to "leave silence".
   */
  readonly postSubjectDwellMs: number;
}

/**
 * Target density — how many know-how artifacts a typical session
 * of this mode is expected to yield. Used by telemetry to flag
 * sessions that are way under (subject not engaged) or way over
 * (extractor over-firing).
 */
export interface DensityTarget {
  readonly min: number;
  readonly max: number;
}

/**
 * One mode template. Frozen on construction.
 */
export interface ModeTemplate {
  readonly mode: InterviewMode;
  /**
   * The ordered question stems. The extractor adapts each stem to
   * the specific situation, but the order encodes the mode's
   * methodology.
   */
  readonly questions: ReadonlyArray<string>;
  readonly pacing: PacingBudget;
  readonly density: DensityTarget;
  /**
   * Free-form mode-internal notes baked into the system prompt
   * (e.g. blame-free framing for post-incident).
   */
  readonly directives: ReadonlyArray<string>;
}

/**
 * Helper to freeze a template at construction time. All consumers
 * receive a fully immutable object.
 */
export function freezeTemplate(template: ModeTemplate): ModeTemplate {
  const frozenPacing: PacingBudget = Object.freeze({ ...template.pacing });
  const frozenDensity: DensityTarget = Object.freeze({ ...template.density });
  return Object.freeze({
    mode: template.mode,
    questions: Object.freeze([...template.questions]),
    pacing: frozenPacing,
    density: frozenDensity,
    directives: Object.freeze([...template.directives]),
  });
}
