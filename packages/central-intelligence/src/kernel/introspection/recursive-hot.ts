/**
 * Recursive Higher-Order Thought (HOT) — second- and N-th-order
 * introspection over the per-thought self-model.
 *
 * Closes parity-litfin §4.2 ("recursive HOT, Rosenthal-style"). The
 * first-order self-model (see ./per-thought-self-model.ts) describes
 * "what the agent is doing right now." A second-order self-model
 * reflects on the REASONING PROCESS that produced the first: is the
 * confidence well-calibrated, are the uncertainty axes actually
 * salient, is the agent posturing in a way that betrays a deeper
 * miscalibration?
 *
 * Recursion is bounded: by default we generate two levels (the first
 * being the input itself, the second being one HOT step over it). The
 * cap is 4 — beyond that the regress is philosophically incoherent
 * and computationally wasteful (Rosenthal 2005, Ch. 4).
 *
 * Pure module — no I/O, no model calls. Callers wire an
 * `IntrospectionJudge` from `./per-thought-self-model.ts` to lift the
 * heuristic shape to model-grade reflection; without the judge the
 * function falls back to a deterministic shape transformation.
 *
 * References
 *   - Rosenthal, D. M. (1986). "Two concepts of consciousness."
 *     Philosophical Studies, 49(3), 329-359. The HOT hierarchy:
 *     T → HOT(T) → HOT(HOT(T)). Rosenthal's view is that beyond the
 *     first HOT the additional levels add no qualitatively new
 *     conscious content, only metacognitive precision. We follow that
 *     and cap recursion at 4.
 *   - Rosenthal, D. M. (2005). "Consciousness and Mind." Oxford UP.
 *     Ch. 4 "The Higher-Order Theory of Consciousness."
 *   - Anthropic (2025). "On the biology of a large language model"
 *     and the 2025 monitorability paper — argues that second-order
 *     introspection ("the agent's view of its own reasoning") is a
 *     necessary surface for behavioural monitorability. This module
 *     materialises that surface deterministically so a monitor can
 *     diff first- vs second-order claims without the rest of the
 *     kernel.
 */

import {
  buildPerThoughtSelfModel,
  type IntrospectionContext,
  type IntrospectionJudge,
  type PerThoughtSelfModel,
  type SelfModelPosture,
  type ThoughtSnapshot,
} from './per-thought-self-model.js';

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

/** Default recursion depth — primary + 1 HOT. */
export const DEFAULT_HOT_DEPTH = 2;
/** Hard ceiling, per Rosenthal 2005 Ch. 4. */
export const MAX_HOT_DEPTH = 4;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * A single rung in the HOT hierarchy. `order = 1` is the primary
 * thought's self-model (first-order). `order = 2` is the HOT that
 * reflects on order 1, and so on.
 */
export interface HotRung {
  readonly order: number;
  readonly selfModel: PerThoughtSelfModel;
  /**
   * What the HOT *adds* to the rung below — calibration deltas,
   * surfaced contradictions, posture revisions.
   */
  readonly reflectionNotes: ReadonlyArray<string>;
}

export interface RecursiveHotResult {
  readonly rungs: ReadonlyArray<HotRung>;
  /** True iff the run was capped by `MAX_HOT_DEPTH`. */
  readonly cappedByMax: boolean;
  /** True iff recursion stopped early because the HOT converged. */
  readonly convergedEarly: boolean;
}

export interface RecursiveHotInput {
  readonly snapshot: ThoughtSnapshot;
  readonly context?: IntrospectionContext;
  /** Pre-computed first-order self-model. Built fresh if absent. */
  readonly primarySelfModel?: PerThoughtSelfModel;
  /** Optional judge — applied at every rung. */
  readonly judge?: IntrospectionJudge;
  /** Depth ∈ [1, MAX_HOT_DEPTH]. Out-of-range values are clamped. */
  readonly depth?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate a bounded HOT stack over a thought + its first-order self-
 * model. Pure function — equal input produces equal output.
 */
export function generateRecursiveHot(
  input: RecursiveHotInput,
): RecursiveHotResult {
  const depth = clampDepth(input.depth ?? DEFAULT_HOT_DEPTH);
  const cappedByMax = (input.depth ?? DEFAULT_HOT_DEPTH) > MAX_HOT_DEPTH;

  const buildArgs: {
    snapshot: ThoughtSnapshot;
    context?: IntrospectionContext;
    judge?: IntrospectionJudge;
  } = { snapshot: input.snapshot };
  if (input.context !== undefined) buildArgs.context = input.context;
  if (input.judge !== undefined) buildArgs.judge = input.judge;

  const primary = input.primarySelfModel
    ?? buildPerThoughtSelfModel(buildArgs);

  const rungs: Array<HotRung> = [
    { order: 1, selfModel: primary, reflectionNotes: [] },
  ];

  let convergedEarly = false;
  for (let order = 2; order <= depth; order += 1) {
    const previous = rungs[order - 2];
    if (!previous) break;
    const next = reflectOn(previous, input.snapshot, input.context, input.judge);
    rungs.push(next);
    if (hasConverged(previous, next)) {
      convergedEarly = true;
      break;
    }
  }

  return { rungs, cappedByMax, convergedEarly };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function clampDepth(d: number): number {
  if (!Number.isFinite(d)) return DEFAULT_HOT_DEPTH;
  const floored = Math.floor(d);
  if (floored < 1) return 1;
  if (floored > MAX_HOT_DEPTH) return MAX_HOT_DEPTH;
  return floored;
}

/**
 * Produce one rung above `previous`. The new rung's self-model takes
 * `previous.selfModel` as its OBJECT — the thought it reflects on is
 * not the original user-facing thought but the prior self-model
 * itself. This is the Rosenthal HOT step.
 */
function reflectOn(
  previous: HotRung,
  primarySnapshot: ThoughtSnapshot,
  context: IntrospectionContext | undefined,
  judge: IntrospectionJudge | undefined,
): HotRung {
  const reflectionSnapshot = selfModelAsSnapshot(
    previous.selfModel,
    primarySnapshot,
    previous.order + 1,
  );

  const reflectionContext = liftContext(context);

  const buildArgs: {
    snapshot: ThoughtSnapshot;
    context?: IntrospectionContext;
    judge?: IntrospectionJudge;
  } = { snapshot: reflectionSnapshot };
  if (reflectionContext !== undefined) buildArgs.context = reflectionContext;
  if (judge !== undefined) buildArgs.judge = judge;

  const reflectedSelfModel = buildPerThoughtSelfModel(buildArgs);

  const reflectionNotes = computeReflectionNotes(
    previous.selfModel,
    reflectedSelfModel,
  );

  return {
    order: previous.order + 1,
    selfModel: reflectedSelfModel,
    reflectionNotes,
  };
}

/**
 * Encode a self-model as a thought-snapshot so the same heuristic /
 * judge pipeline can consume it. The reflection task hint says
 * explicitly that this snapshot is a reflection on order N-1.
 */
function selfModelAsSnapshot(
  sm: PerThoughtSelfModel,
  primarySnapshot: ThoughtSnapshot,
  newOrder: number,
): ThoughtSnapshot {
  const text = renderSelfModelAsProse(sm);
  const out: { -readonly [K in keyof ThoughtSnapshot]: ThoughtSnapshot[K] } = {
    text,
    producerConfidence: sm.confidence,
    taskHint: `reflecting on order-${newOrder - 1} self-model`,
  };
  if (typeof primarySnapshot.surface === 'string') {
    out.surface = primarySnapshot.surface;
  }
  return out;
}

function renderSelfModelAsProse(sm: PerThoughtSelfModel): string {
  const parts: Array<string> = [];
  parts.push(`I am ${sm.posture}. My task is ${sm.task}.`);
  parts.push(`My confidence is ${sm.confidence.toFixed(2)}.`);
  if (sm.uncertaintyAxes.length > 0) {
    parts.push(
      `I am uncertain about: ${sm.uncertaintyAxes.join(', ')}.`,
    );
  }
  if (sm.commitments.length > 0) {
    parts.push(`I have committed to: ${sm.commitments.join('; ')}.`);
  }
  if (sm.openQuestions.length > 0) {
    parts.push(`I still need to answer: ${sm.openQuestions.join(' ')}`);
  }
  return parts.join(' ');
}

/**
 * The HOT context is a softened copy of the underlying context. At
 * higher orders the agent rarely has new tool evidence, so we strip
 * tool-call signals to avoid confidence inflation in the reflection.
 */
function liftContext(
  context: IntrospectionContext | undefined,
): IntrospectionContext | undefined {
  if (!context) return undefined;
  const out: { -readonly [K in keyof IntrospectionContext]: IntrospectionContext[K] } =
    {};
  if (typeof context.citationCount === 'number') {
    out.citationCount = context.citationCount;
  }
  out.toolCallsIssued = false;
  if (Array.isArray(context.softeningGates)) {
    out.softeningGates = context.softeningGates;
  }
  if (typeof context.stakes === 'string') out.stakes = context.stakes;
  return out;
}

/**
 * Produce a stable, sorted list of reflection notes — the deltas
 * between the prior and reflected self-models. This is the surface
 * that a monitor reads to detect calibration drift across HOT levels.
 */
function computeReflectionNotes(
  prior: PerThoughtSelfModel,
  reflected: PerThoughtSelfModel,
): ReadonlyArray<string> {
  const notes: Array<string> = [];

  const confDelta = reflected.confidence - prior.confidence;
  if (Math.abs(confDelta) >= 0.1) {
    const direction = confDelta > 0 ? 'increased' : 'decreased';
    notes.push(
      `confidence-${direction}-on-reflection:${confDelta.toFixed(2)}`,
    );
  }

  if (reflected.posture !== prior.posture) {
    notes.push(
      `posture-revised:${prior.posture}->${reflected.posture}`,
    );
  }

  const newAxes = setDiff(reflected.uncertaintyAxes, prior.uncertaintyAxes);
  for (const axis of newAxes) notes.push(`new-uncertainty:${axis}`);

  const droppedAxes = setDiff(prior.uncertaintyAxes, reflected.uncertaintyAxes);
  for (const axis of droppedAxes) notes.push(`dismissed-uncertainty:${axis}`);

  notes.sort((a, b) => a.localeCompare(b));
  return notes;
}

function setDiff(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const setB = new Set(b);
  return a.filter((x) => !setB.has(x));
}

/**
 * Convergence: the HOT stops adding signal when the new rung has the
 * same posture, near-identical confidence, and the same uncertainty
 * axes as the rung below. At that point further recursion is wasted.
 */
function hasConverged(prev: HotRung, next: HotRung): boolean {
  const samePosture: boolean = prev.selfModel.posture === next.selfModel.posture;
  const sameConfidence: boolean =
    Math.abs(prev.selfModel.confidence - next.selfModel.confidence) < 0.01;
  const sameAxes: boolean = arrayEquals(
    prev.selfModel.uncertaintyAxes,
    next.selfModel.uncertaintyAxes,
  );
  const noNewNotes: boolean = next.reflectionNotes.length === 0;
  return samePosture && sameConfidence && sameAxes && noNewNotes;
}

function arrayEquals(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Re-export the posture type so consumers only need to import from
// this barrel when they're working at the HOT level.
export type { SelfModelPosture };
