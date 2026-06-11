/**
 * THE single completion-detection hook for Voyager skill capture.
 *
 * This is the one function the orchestrator's post-turn / consolidation
 * pass wires in: when a multi-step task COMPLETES and VERIFIES, call
 * `captureSkillOnCompletion(task, opts)`. It runs the Voyager loop
 * (describe → embed → store → compose) and returns the captured skill +
 * a LearnedShortcut, or a typed skip reason.
 *
 * Why a single hook: the spec's CAPTURE stage says "on a self-verified
 * novel success, the post-turn/consolidation pass calls compile + auto-
 * suggest → human-gate → promote". This hook IS that call site, kept as
 * ONE additive entry point so wiring it is a one-liner and removing it can
 * never regress an existing flow.
 *
 * RAIL-COMPOSING GUARANTEES (a violation would fail the lane):
 *   - Capture is GATED on `task.verified === true`. If verification did
 *     not pass, NOTHING is captured. The hook only ADDS gating.
 *   - Capture requires >= 1 `evidence_id` (Borjie evidence-required rule).
 *   - The captured skill lands `human_reviewed: false` — it CANNOT auto-
 *     fire until a human (four-eye) promotes it; capture widens no
 *     authority and touches no money path / RLS / policy-gate.
 *   - The hook NEVER throws on a non-capturable task — it returns a typed
 *     skip so the caller logs and moves on. Capture is best-effort
 *     enrichment, never a blocker on the real task.
 *
 * @module @borjie/skill-library/skill-capture/completion-hook
 */

import {
  type CompletedTask,
  type SkillCaptureResult,
} from './types.js';
import { runCaptureLoop, type CaptureLoopOptions } from './capture-loop.js';

/**
 * Options the orchestrator binds once and reuses per completion.
 * `library`, `describer`, `embedder` are the production wiring points
 * (live VoyagerSkillLibrary, Claude describer, real embedder); `now` /
 * `prevAuditHash` / `logger` are injectable for determinism + chaining.
 */
export type CaptureHookOptions = CaptureLoopOptions;

/**
 * The completion-detection point. Returns a discriminated result; never
 * throws on bad-but-recoverable input. Throws only on a hard programmer
 * error (missing task / options) at the entry boundary.
 */
export async function captureSkillOnCompletion(
  task: CompletedTask,
  opts: CaptureHookOptions,
): Promise<SkillCaptureResult> {
  if (!task) throw new Error('[skill-capture] task is required');
  if (!opts || !opts.library || !opts.describer || !opts.embedder) {
    throw new Error(
      '[skill-capture] opts.library, opts.describer, and opts.embedder are required',
    );
  }

  // ── verify gate (MANDATORY, rail-composing — ADD-only) ─────────────────
  if (task.verified !== true) {
    return {
      captured: false,
      reason: 'not_verified',
      detail: 'task did not pass verification; nothing captured',
    };
  }

  // ── evidence gate (Borjie evidence-required rule) ──────────────────────
  if (!Array.isArray(task.evidence_ids) || task.evidence_ids.length === 0) {
    return {
      captured: false,
      reason: 'no_evidence',
      detail: 'captured skills must cite >= 1 evidence_id; none supplied',
    };
  }

  return runCaptureLoop(task, opts);
}
