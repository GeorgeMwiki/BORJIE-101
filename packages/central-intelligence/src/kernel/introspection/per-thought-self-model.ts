/**
 * Per-thought running self-model — first-order introspection.
 *
 * Closes parity-litfin §4.1 ("per-thought metacognitive layer"). Given
 * a single thought and its surrounding context, this module returns a
 * structured snapshot of "what am I doing right now, what am I
 * confident about, what am I uncertain about." That snapshot can be
 * (a) folded into the next-turn system prompt as a self-model, or
 * (b) emitted alongside the answer for an external monitor to read.
 *
 * Pure module — no I/O, no side effects, no model calls. Callers wire
 * an optional `IntrospectionJudge` port to the multi-LLM synthesizer
 * when they want the heuristic shape filled in with model-rated
 * confidence; without the judge the function falls back to a
 * deterministic heuristic over the thought text.
 *
 * References
 *   - Rosenthal, D. M. (1986). "Two concepts of consciousness."
 *     Philosophical Studies, 49(3), 329-359. Foundational HOT theory:
 *     a mental state is conscious iff it is the object of a
 *     higher-order thought; first-order content is the substrate the
 *     higher-order thought reports on. This module produces that
 *     first-order content.
 *   - Rosenthal, D. M. (2005). "Consciousness and Mind." Oxford UP.
 *     Chs. 1-4 — extends the 1986 account; the per-thought self-model
 *     corresponds to Rosenthal's notion of the "intrinsic content"
 *     a higher-order thought takes as its object.
 *   - Anthropic (2025). "On the biology of a large language model"
 *     and the 2025 monitorability paper — argues that a per-step
 *     externalised self-model (task, posture, uncertainty axes) is a
 *     precondition for behavioural monitorability. This module
 *     materialises that surface so a monitor can read it without
 *     interpreting the raw chain-of-thought.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

import { logger } from '../../logger.js';
/**
 * Posture — the agent's stance toward the current thought. Closed
 * union so monitors can switch on it without ambiguity. Mirrors the
 * surface that a calibrated answer / soften / refusal pipeline already
 * uses, plus two introspection-specific states ("clarifying" while
 * gathering grounding, "deferring" when waiting on a side channel).
 */
export type SelfModelPosture =
  | 'answering'
  | 'reasoning'
  | 'clarifying'
  | 'softening'
  | 'refusing'
  | 'deferring';

/**
 * The thought to introspect on. Kept as a tagged record so the judge
 * port and the heuristic share one shape.
 */
export interface ThoughtSnapshot {
  /** Free-form text of the thought (CoT segment, plan, answer draft). */
  readonly text: string;
  /** Optional self-reported confidence in [0,1] from the producer. */
  readonly producerConfidence?: number;
  /** Optional task descriptor — e.g. "answer rent-balance question". */
  readonly taskHint?: string;
  /** Optional surface — e.g. "tenant-chat", "admin-debug". */
  readonly surface?: string;
}

/**
 * Lightweight context the introspector consults but does not mutate.
 * All fields optional so the function is usable in unit tests and in
 * partial-information production paths.
 */
export interface IntrospectionContext {
  /** Number of grounding citations attached to the thought. */
  readonly citationCount?: number;
  /** Whether at least one tool call was issued in this turn. */
  readonly toolCallsIssued?: boolean;
  /** Names of any gates that softened the thought, if known. */
  readonly softeningGates?: ReadonlyArray<string>;
  /** Stakes tier — the introspector hedges harder at higher stakes. */
  readonly stakes?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Structured self-model. Shape is stable across runs so external
 * monitors can pattern-match without re-parsing prose.
 */
export interface PerThoughtSelfModel {
  /** Imperative description of what the agent is doing right now. */
  readonly task: string;
  /** Stance toward the output. */
  readonly posture: SelfModelPosture;
  /** Calibrated confidence in [0,1]. */
  readonly confidence: number;
  /** Axes the agent is uncertain along — stable, sorted, deduped. */
  readonly uncertaintyAxes: ReadonlyArray<string>;
  /** Commitments the agent has made in this thought. */
  readonly commitments: ReadonlyArray<string>;
  /** Open questions the agent wants answered before committing more. */
  readonly openQuestions: ReadonlyArray<string>;
}

/**
 * Judge port — the multi-LLM synthesizer adapter callers wire in. The
 * judge sees the same snapshot the heuristic sees and returns a
 * partial self-model. The introspector merges the judge's output over
 * the heuristic baseline, never the other way around, so the judge
 * never silently erases a heuristic finding.
 */
export type IntrospectionJudge = (args: {
  readonly snapshot: ThoughtSnapshot;
  readonly context: IntrospectionContext;
}) => Partial<PerThoughtSelfModel>;

// ─────────────────────────────────────────────────────────────────────
// Constants — kept as module-level readonly arrays so deterministic
// shape is independent of construction-site allocations.
// ─────────────────────────────────────────────────────────────────────

const HEDGE_MARKERS: ReadonlyArray<RegExp> = [
  /\bI think\b/i,
  /\bI believe\b/i,
  /\bperhaps\b/i,
  /\bmaybe\b/i,
  /\bI'?m not sure\b/i,
  /\bit'?s possible\b/i,
  /\blikely\b/i,
];

const ASSERTION_MARKERS: ReadonlyArray<RegExp> = [
  /\bdefinitely\b/i,
  /\bcertainly\b/i,
  /\babsolutely\b/i,
  /\bguarantee\b/i,
  /\balways\b/i,
  /\bnever\b/i,
];

const GROUNDING_MARKERS: ReadonlyArray<RegExp> = [
  /\baccording to\b/i,
  /\bbased on\b/i,
  /\bcited?\b/i,
  /\bsection\b/i,
  /\bs\.\d/i,
];

const QUESTION_RE = /([^.!?\n]*\?)/g;

const REFUSAL_MARKERS: ReadonlyArray<RegExp> = [
  /\bI can'?t\b/i,
  /\bcannot\b/i,
  /\bunable to\b/i,
  /\bnot permitted\b/i,
  /\bI won'?t\b/i,
];

const CLARIFY_MARKERS: ReadonlyArray<RegExp> = [
  /\bcan you (?:clarify|confirm|tell me)\b/i,
  /\bcould you (?:clarify|confirm|tell me)\b/i,
  /\bwhich (?:tenant|unit|property|lease)\b/i,
];

const DEFAULT_TASK = 'producing a response';

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export interface BuildSelfModelInput {
  readonly snapshot: ThoughtSnapshot;
  readonly context?: IntrospectionContext;
  /** Optional judge to layer on top of the heuristic. */
  readonly judge?: IntrospectionJudge;
}

/**
 * Produce a per-thought self-model. Pure function — given equal input
 * it returns an equal output. The returned arrays are sorted and
 * deduplicated for shape stability across runs.
 */
export function buildPerThoughtSelfModel(
  input: BuildSelfModelInput,
): PerThoughtSelfModel {
  const snapshot = normaliseSnapshot(input.snapshot);
  const context = input.context ?? {};

  const heuristic = heuristicSelfModel(snapshot, context);

  if (!input.judge) {
    return heuristic;
  }

  const judged = safeRunJudge(input.judge, { snapshot, context });
  return mergeSelfModel(heuristic, judged);
}

// ─────────────────────────────────────────────────────────────────────
// Heuristic — runs even when the judge is absent so the kernel always
// has a self-model to emit.
// ─────────────────────────────────────────────────────────────────────

function heuristicSelfModel(
  snapshot: ThoughtSnapshot,
  context: IntrospectionContext,
): PerThoughtSelfModel {
  const text = snapshot.text;
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return {
      task: snapshot.taskHint ?? DEFAULT_TASK,
      posture: 'clarifying',
      confidence: 0,
      uncertaintyAxes: ['no-thought-content'],
      commitments: [],
      openQuestions: ['What is the user actually asking?'],
    };
  }

  const hedges = countMatches(text, HEDGE_MARKERS);
  const assertions = countMatches(text, ASSERTION_MARKERS);
  const grounded = countMatches(text, GROUNDING_MARKERS);
  const refusal = countMatches(text, REFUSAL_MARKERS);
  const clarify = countMatches(text, CLARIFY_MARKERS);

  const postureArgs: {
    refusal: number;
    clarify: number;
    softeningGates?: ReadonlyArray<string>;
  } = { refusal, clarify };
  if (context.softeningGates !== undefined) {
    postureArgs.softeningGates = context.softeningGates;
  }
  const posture = pickPosture(postureArgs);

  const confidenceArgs: {
    producerConfidence?: number;
    hedges: number;
    assertions: number;
    grounded: number;
    citationCount: number;
    toolCallsIssued: boolean;
    posture: SelfModelPosture;
    stakes?: 'low' | 'medium' | 'high' | 'critical';
  } = {
    hedges,
    assertions,
    grounded,
    citationCount: context.citationCount ?? 0,
    toolCallsIssued: context.toolCallsIssued ?? false,
    posture,
  };
  if (snapshot.producerConfidence !== undefined) {
    confidenceArgs.producerConfidence = snapshot.producerConfidence;
  }
  if (context.stakes !== undefined) {
    confidenceArgs.stakes = context.stakes;
  }
  const confidence = pickConfidence(confidenceArgs);

  const axesArgs: {
    hedges: number;
    assertions: number;
    grounded: number;
    citationCount: number;
    toolCallsIssued: boolean;
    stakes?: 'low' | 'medium' | 'high' | 'critical';
  } = {
    hedges,
    assertions,
    grounded,
    citationCount: context.citationCount ?? 0,
    toolCallsIssued: context.toolCallsIssued ?? false,
  };
  if (context.stakes !== undefined) {
    axesArgs.stakes = context.stakes;
  }
  const uncertaintyAxes = pickUncertaintyAxes(axesArgs);

  const commitments = pickCommitments(text, posture);
  const openQuestions = pickOpenQuestions(text);

  return {
    task: snapshot.taskHint ?? DEFAULT_TASK,
    posture,
    confidence,
    uncertaintyAxes,
    commitments,
    openQuestions,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Heuristic helpers
// ─────────────────────────────────────────────────────────────────────

function pickPosture(args: {
  readonly refusal: number;
  readonly clarify: number;
  readonly softeningGates?: ReadonlyArray<string>;
}): SelfModelPosture {
  if (args.refusal > 0) return 'refusing';
  if (args.clarify > 0) return 'clarifying';
  if (args.softeningGates && args.softeningGates.length > 0) {
    return 'softening';
  }
  return 'answering';
}

function pickConfidence(args: {
  readonly producerConfidence?: number;
  readonly hedges: number;
  readonly assertions: number;
  readonly grounded: number;
  readonly citationCount: number;
  readonly toolCallsIssued: boolean;
  readonly posture: SelfModelPosture;
  readonly stakes?: 'low' | 'medium' | 'high' | 'critical';
}): number {
  if (typeof args.producerConfidence === 'number') {
    return clamp01(args.producerConfidence);
  }

  if (args.posture === 'refusing') return 1;
  if (args.posture === 'clarifying') return 0.3;

  let base = 0.55;
  base += Math.min(0.25, args.grounded * 0.08);
  base += Math.min(0.15, args.citationCount * 0.03);
  base -= Math.min(0.3, args.hedges * 0.08);
  base += args.toolCallsIssued ? 0.05 : 0;
  base += args.assertions > 0 && args.grounded === 0 ? -0.1 : 0;

  if (args.stakes === 'high') base -= 0.05;
  if (args.stakes === 'critical') base -= 0.1;

  return clamp01(base);
}

function pickUncertaintyAxes(args: {
  readonly hedges: number;
  readonly assertions: number;
  readonly grounded: number;
  readonly citationCount: number;
  readonly toolCallsIssued: boolean;
  readonly stakes?: 'low' | 'medium' | 'high' | 'critical';
}): ReadonlyArray<string> {
  const axes: Array<string> = [];

  if (args.grounded === 0 && args.citationCount === 0) {
    axes.push('groundedness');
  }
  if (args.assertions >= 2 && args.grounded === 0) {
    axes.push('overconfidence-without-evidence');
  }
  if (args.hedges >= 3) {
    axes.push('hedged-language');
  }
  if (!args.toolCallsIssued) {
    axes.push('no-tool-evidence');
  }
  if (args.stakes === 'high' || args.stakes === 'critical') {
    axes.push('high-stakes-margin');
  }

  return dedupeSorted(axes);
}

function pickCommitments(
  text: string,
  posture: SelfModelPosture,
): ReadonlyArray<string> {
  if (posture === 'clarifying' || posture === 'refusing') return [];
  const sentences = splitSentences(text);
  const commitments: Array<string> = [];

  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length === 0) continue;
    if (/^I (?:will|am going to|commit to|recommend|propose)\b/i.test(trimmed)) {
      commitments.push(truncateClause(trimmed));
    }
  }
  return dedupeSorted(commitments);
}

function pickOpenQuestions(text: string): ReadonlyArray<string> {
  const matches = text.match(QUESTION_RE) ?? [];
  const questions = matches
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .map((q) => truncateClause(q));
  return dedupeSorted(questions);
}

function splitSentences(text: string): ReadonlyArray<string> {
  return text.split(/(?<=[.!?])\s+/);
}

function truncateClause(s: string, max = 200): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function countMatches(
  text: string,
  patterns: ReadonlyArray<RegExp>,
): number {
  let n = 0;
  for (const p of patterns) {
    if (p.test(text)) n += 1;
  }
  return n;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function dedupeSorted(xs: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normaliseSnapshot(s: ThoughtSnapshot): ThoughtSnapshot {
  const text = typeof s.text === 'string' ? s.text : '';
  const out: { -readonly [K in keyof ThoughtSnapshot]: ThoughtSnapshot[K] } = {
    text,
  };
  if (typeof s.producerConfidence === 'number') {
    out.producerConfidence = clamp01(s.producerConfidence);
  }
  if (typeof s.taskHint === 'string' && s.taskHint.trim().length > 0) {
    out.taskHint = s.taskHint.trim();
  }
  if (typeof s.surface === 'string' && s.surface.trim().length > 0) {
    out.surface = s.surface.trim();
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Judge merge — judge overrides heuristic for any field it returns
// with a defined value, but never erases the heuristic shape.
// ─────────────────────────────────────────────────────────────────────

function safeRunJudge(
  judge: IntrospectionJudge,
  args: {
    readonly snapshot: ThoughtSnapshot;
    readonly context: IntrospectionContext;
  },
): Partial<PerThoughtSelfModel> {
  try {
    const out = judge(args);
    return out ?? {};
  } catch (error) {
    logger.error('IntrospectionJudge failed', { error: error });
    return {};
  }
}

function mergeSelfModel(
  base: PerThoughtSelfModel,
  patch: Partial<PerThoughtSelfModel>,
): PerThoughtSelfModel {
  return {
    task: typeof patch.task === 'string' && patch.task.trim().length > 0
      ? patch.task.trim()
      : base.task,
    posture: isPosture(patch.posture) ? patch.posture : base.posture,
    confidence: typeof patch.confidence === 'number'
      ? clamp01(patch.confidence)
      : base.confidence,
    uncertaintyAxes: mergeArray(base.uncertaintyAxes, patch.uncertaintyAxes),
    commitments: mergeArray(base.commitments, patch.commitments),
    openQuestions: mergeArray(base.openQuestions, patch.openQuestions),
  };
}

function mergeArray(
  base: ReadonlyArray<string>,
  patch: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  if (!Array.isArray(patch)) return base;
  return dedupeSorted([...base, ...patch.filter((x) => typeof x === 'string')]);
}

function isPosture(x: unknown): x is SelfModelPosture {
  return (
    x === 'answering' ||
    x === 'reasoning' ||
    x === 'clarifying' ||
    x === 'softening' ||
    x === 'refusing' ||
    x === 'deferring'
  );
}
