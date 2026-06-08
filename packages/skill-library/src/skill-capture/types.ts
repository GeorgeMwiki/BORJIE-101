/**
 * Voyager-style skill-CAPTURE loop — shared types.
 *
 * The DARK half of the skill library: while `voyager-library` RETRIEVES
 * and EXECUTES skills, this module CAPTURES them. When a multi-step task
 * completes AND verifies successfully, the MD turns that trajectory into a
 * permanent reusable capability:
 *
 *     solve → verify → describe → embed → store → compose
 *
 * Reference: Voyager (NVIDIA) — a self-growing library of executable code
 * skills indexed by embeddings IS the agent's long-term procedural memory.
 * Borjie inverts the auto-curriculum: instead of the model proposing tasks,
 * the OWNER's real (verified) work becomes the curriculum.
 *
 * ADDITIVE & RAIL-COMPOSING: capture NEVER executes anything and NEVER
 * touches the money path, RLS, or policy-gate. It records a parameterised
 * description of work that ALREADY succeeded + verified. A captured skill
 * is HUMAN-REVIEW-GATED (`human_reviewed: false`) so the four-eye gate
 * inspects the auto-extraction before the orchestrator may ever invoke it.
 * Capture only ADDS a candidate; it can never widen authority.
 *
 * No runtime deps beyond the package's own modules + `zod`. The describe
 * (NL summary) and embed (vector) steps are PORTS — production wires Claude
 * + a real embedder; tests inject deterministic stubs.
 *
 * @module @borjie/skill-library/skill-capture
 */

import type { CodeSkill } from '../voyager-library/types.js';

// ---------------------------------------------------------------------------
// Trajectory — the raw material handed to capture
// ---------------------------------------------------------------------------

/**
 * One executed step of a completed task. Mirrors the kernel
 * skill-compiler's `SessionTraceStep` so a kernel trace can be passed in
 * unchanged, plus an optional `params` map of caller-supplied values that
 * become the skill's parameters when templatised.
 */
export interface CompletedTaskStep {
  /** Tool / sub-step identifier that ran (e.g. `mining.compute_royalty`). */
  readonly tool: string;
  /** The arguments the step ran with. Param values inside are templatised. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Whether this individual step succeeded. Failed steps are dropped. */
  readonly success: boolean;
}

/**
 * A multi-step task that has completed. The completion hook only fires
 * capture when `verified === true` — the verify gate is mandatory.
 */
export interface CompletedTask {
  /** Tenant the task ran under. Carried onto the captured skill. */
  readonly tenant_id: string;
  /** Jurisdiction binding (`'platform'` for neutral; else e.g. `'TZ'`). */
  readonly jurisdiction: 'platform' | string;
  /** The owner/agent intent that started the task — the NL trigger. */
  readonly intent: string;
  /** Ordered executed steps. Capture needs >= MIN_STEPS_FOR_CAPTURE. */
  readonly steps: ReadonlyArray<CompletedTaskStep>;
  /**
   * Caller-supplied parameter map: value → param-name. Any matching
   * primitive arg value in a step is templatised to `{{paramName}}`.
   */
  readonly params?: Readonly<Record<string, string>>;
  /**
   * MANDATORY verify gate. Capture is a no-op unless this is `true`.
   * The completion hook trusts the caller's verifier (workflow-step
   * effect satisfied / loop-quality-gates pass / Auditor evidence chain
   * non-empty) — capture does not re-run verification.
   */
  readonly verified: boolean;
  /** Correlation id for audit + tracing. */
  readonly correlation_id: string;
  /**
   * Evidence ids that justified the task (LMBM / corpus). Borjie's
   * evidence-required rule: a captured skill MUST carry >= 1. Capture
   * is rejected with `no_evidence` otherwise.
   */
  readonly evidence_ids: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Ports — describe + embed are injected
// ---------------------------------------------------------------------------

/**
 * The "describe" step. Given a verified trajectory, produce a concise NL
 * description of the reusable capability. Production wires Claude; tests
 * inject a deterministic stub. MUST be pure-ish (no side effects on the
 * library). A throw is caught by the hook and surfaces as a soft error.
 */
export type SkillDescriber = (input: {
  readonly intent: string;
  readonly steps: ReadonlyArray<CompletedTaskStep>;
  readonly jurisdiction: 'platform' | string;
}) => Promise<{
  /** One-line capability name (becomes the slug + display name). */
  readonly name: string;
  /** NL description used for retrieval + human readability. */
  readonly description: string;
}>;

/**
 * The "embed" step. Maps the NL description to a vector for retrieval.
 * Production wires a real embedding API; tests inject the deterministic
 * `embed` helper from builtin-skills.
 */
export type SkillEmbedder = (text: string) => ReadonlyArray<number>;

/**
 * Pino-compatible structured logger (no `console`). All fields optional —
 * a no-op logger is the default.
 */
export interface CaptureLogger {
  readonly info?: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn?: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
}

// ---------------------------------------------------------------------------
// LearnedShortcut — the surfaced byproduct of a capture
// ---------------------------------------------------------------------------

/**
 * A LearnedShortcut emitted alongside a captured skill so the chat-UI can
 * offer "do this again" one-tap. Field names match
 * `@borjie/chat-ui` `LearnedShortcut` so the row can be forwarded without
 * remapping. `confidence` starts at the compiler's confidence and rises
 * with success_count over time (the ranker re-normalises downstream).
 */
export interface CapturedLearnedShortcut {
  /** Stable action id — `skill:<slug>`. */
  readonly id: string;
  /** Display label — the captured skill's name. */
  readonly label: string;
  /** Relative confidence in [0, 1]. */
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Result — the discriminated union the hook returns
// ---------------------------------------------------------------------------

export type SkillCaptureSkipReason =
  | 'not_verified'
  | 'too_few_steps'
  | 'no_successful_steps'
  | 'no_evidence'
  | 'duplicate'
  | 'describe_failed'
  | 'compile_failed';

/**
 * The completion hook never throws on a non-capturable task — it returns
 * `captured: false` with a reason so the caller can log + move on. Hard
 * programmer errors (missing library, bad config) still throw at entry.
 */
export type SkillCaptureResult =
  | {
      readonly captured: true;
      /** The new permanent skill, registered into the library. */
      readonly skill: CodeSkill;
      /** The LearnedShortcut to surface in the UI. */
      readonly shortcut: CapturedLearnedShortcut;
      /** Whether this skill COMPOSED an existing one vs created fresh. */
      readonly composed_from: string | null;
      /** Append-only audit hash for the capture event. */
      readonly audit_hash: string;
    }
  | {
      readonly captured: false;
      readonly reason: SkillCaptureSkipReason;
      /** Human-readable detail. */
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A "multi-step task" worth capturing has at least this many SUCCESSFUL
 * steps. A single-tool one-shot is not a reusable procedure.
 */
export const MIN_STEPS_FOR_CAPTURE = 2 as const;

/** Slug pattern shared with the kernel skill-compiler proposed_id rule. */
export const SKILL_SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
