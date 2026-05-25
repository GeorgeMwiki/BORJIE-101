/**
 * Internal debate + counterfactual reasoning — types.
 *
 * The "multiple voices in your head" pattern: high-stakes decisions
 * invoke 2–3 internal agents arguing different angles, then a
 * synthesiser. Counterfactual prompts force the brain to imagine
 * alternative paths.
 *
 * This addresses two genuine LLM limitations:
 *   1. Single-pass LLMs commit to the first plausible answer; debate
 *      forces consideration of alternatives.
 *   2. Single-perspective LLMs lack a critic; multi-voice gives a
 *      built-in critic.
 *
 * Mirrors LITFIN's debate / debate-runner / theory-of-mind patterns,
 * scoped to property management.
 *
 * Every side-effect (LLM calls, clock) routes through an injected
 * port so unit tests run pure.
 */

import type { Sensor } from '../kernel-types.js';

// ─────────────────────────────────────────────────────────────────────
// Voices — each persona pins a stance via a system-prompt fragment.
// The synthesiser is itself a voice; the runner picks it out by
// `synthesiserVoiceId` to render the final answer.
// ─────────────────────────────────────────────────────────────────────

export type DebatePersona =
  | 'advocate'
  | 'critic'
  | 'devils-advocate'
  | 'pragmatist'
  | 'synthesiser';

export interface DebateVoice {
  /** Stable id; e.g. 'advocate' | 'critic' | 'devils-advocate' | 'synthesiser'. */
  readonly id: string;
  readonly displayName: string;
  /** System-prompt fragment that pins the stance for this voice. */
  readonly stancePrompt: string;
  readonly persona: DebatePersona;
}

// ─────────────────────────────────────────────────────────────────────
// Config — voices, max rounds, the synthesiser id, and a token budget.
// ─────────────────────────────────────────────────────────────────────

export interface DebateConfig {
  readonly voices: ReadonlyArray<DebateVoice>;
  /** Default 2. */
  readonly maxRounds: number;
  /** Must be the id of a voice in `voices`. */
  readonly synthesiserVoiceId: string;
  /** Total tokens across all voices; default 4000. */
  readonly tokenBudget?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Contributions + outcome — what the runner produces.
// ─────────────────────────────────────────────────────────────────────

export interface DebateContribution {
  readonly voiceId: string;
  readonly round: number;
  readonly text: string;
  readonly latencyMs: number;
}

export interface DebateOutcome {
  readonly contributions: ReadonlyArray<DebateContribution>;
  readonly synthesis: string;
  /** Estimated; rough sum of text lengths divided by 4. */
  readonly tokenSpent: number;
  /** True if final round had ≥80% jaccard similarity to prior round. */
  readonly converged: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Deps — same Sensor port the kernel uses; called once per voice per
// round (plus once for the synthesiser).
// ─────────────────────────────────────────────────────────────────────

export interface DebateDeps {
  readonly sensor: Sensor;
  readonly clock?: () => number;
}
