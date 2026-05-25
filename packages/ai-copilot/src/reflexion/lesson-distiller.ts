/**
 * Lesson distiller — Phase E gap-closure (P8 Gap 7).
 *
 * Pure function. Given a chain-of-thought trace, the turn's outcome,
 * and the eval/judge verdict, produces at most one Reflexion-style
 * lesson (Shinn et al. 2023, arXiv:2303.11366). Returns `null` when
 * the turn was uneventful — i.e. nothing worth carrying forward into
 * the next system prompt.
 *
 * "Uneventful" = clean success AND high judge score AND no tool error
 * observed in the trace. The distiller deliberately errs on the side
 * of NOT emitting a lesson: every lesson costs prompt tokens on every
 * future turn, so the bar is high.
 *
 * No I/O, no clock, no PRNG — `now()` and `id()` are injected so the
 * caller controls determinism in tests.
 */

import {
  type CotTrace,
  type JudgeVerdict,
  type Lesson,
  type TurnOutcomeRecord,
  JUDGE_LESSON_THRESHOLD,
  LESSON_MAX_CHARS,
} from './types.js';

export interface DistillerDeps {
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Defaults to a deterministic `lsn_<traceId>_<judge.verdict>` id. */
  readonly id?: (trace: CotTrace, verdict: JudgeVerdict) => string;
}

/**
 * Decide whether the turn carries any teaching signal.
 *
 * Returns `true` (i.e. skip) when:
 *   - outcome is `uneventful`, OR
 *   - outcome is `success` AND judge.score >= JUDGE_LESSON_THRESHOLD AND
 *     no observation in the trace looks like a tool error.
 */
function isUneventful(
  trace: CotTrace,
  outcome: TurnOutcomeRecord,
  judge: JudgeVerdict,
): boolean {
  if (outcome.outcome === 'uneventful') return true;
  if (outcome.outcome !== 'success') return false;
  if (judge.verdict !== 'pass') return false;
  if (judge.score < JUDGE_LESSON_THRESHOLD) return false;
  return !traceHasErrorSignal(trace);
}

/**
 * Heuristic — looks at observation strings for common error tokens.
 * Cheap and good-enough for the distiller's "should I bother?" gate.
 */
function traceHasErrorSignal(trace: CotTrace): boolean {
  for (const step of trace.steps) {
    const obs = step.observation?.toLowerCase() ?? '';
    if (!obs) continue;
    if (
      obs.includes('error') ||
      obs.includes('failed') ||
      obs.includes('timeout') ||
      obs.includes('denied') ||
      obs.includes('refused')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Pick the most informative step. Prefers the first step that has an
 * observation (since that's where a tool error or surprise would show
 * up); falls back to the last thought step.
 */
function pickPivotStep(trace: CotTrace): {
  index: number;
  thought: string;
  tool?: string;
} {
  for (const step of trace.steps) {
    if (step.observation) {
      const result: { index: number; thought: string; tool?: string } = {
        index: step.index,
        thought: step.thought,
      };
      if (step.tool !== undefined) {
        result.tool = step.tool;
      }
      return result;
    }
  }
  const last = trace.steps[trace.steps.length - 1];
  if (!last) return { index: 0, thought: '(empty trace)' };
  const fallback: { index: number; thought: string; tool?: string } = {
    index: last.index,
    thought: last.thought,
  };
  if (last.tool !== undefined) {
    fallback.tool = last.tool;
  }
  return fallback;
}

/**
 * Compose the imperative lesson sentence. Kept rule-based on purpose —
 * the distiller runs synchronously inside the post-turn pipeline, so
 * we don't want to depend on an LLM call here. A future enhancement
 * may layer an optional LLM-rewrite step behind a port.
 */
function composeLessonText(
  trace: CotTrace,
  outcome: TurnOutcomeRecord,
  judge: JudgeVerdict,
): string {
  const pivot = pickPivotStep(trace);
  const toolHint = pivot.tool ? ` when using ${pivot.tool}` : '';
  const judgeHint = judge.rationale ? ` Judge noted: ${judge.rationale}` : '';
  let base: string;
  switch (outcome.outcome) {
    case 'failure':
      base = `Avoid the pattern from trace step ${pivot.index}${toolHint}; the turn failed (judge ${judge.score.toFixed(2)}).`;
      break;
    case 'partial':
      base = `Tighten the approach from trace step ${pivot.index}${toolHint}; the turn only partially succeeded (judge ${judge.score.toFixed(2)}).`;
      break;
    case 'success':
      base = `Re-check the approach from trace step ${pivot.index}${toolHint}; the turn passed but only at judge ${judge.score.toFixed(2)}.`;
      break;
    default:
      base = `Review trace step ${pivot.index}${toolHint}.`;
  }
  const full = `${base}${judgeHint}`.trim();
  return full.length > LESSON_MAX_CHARS
    ? `${full.slice(0, LESSON_MAX_CHARS - 1)}…`
    : full;
}

function buildEvidence(trace: CotTrace, pivotIndex: number, tool?: string): string {
  const toolPart = tool ? ` / tool=${tool}` : '';
  return `trace:${trace.traceId} / step ${pivotIndex}${toolPart}`;
}

/**
 * Initial recency score. The renderer decays this over time and the
 * store may bump it on near-duplicates. We start fresh lessons at 1.0
 * with a small penalty for already-high judge scores (those are less
 * urgent teaching material).
 */
function initialRecencyScore(judge: JudgeVerdict, outcome: TurnOutcomeRecord): number {
  let base = 1.0;
  if (outcome.outcome === 'success') base = 0.85;
  if (outcome.outcome === 'partial') base = 0.95;
  // Penalise high scores slightly — a 0.65 lesson is more urgent than a 0.5
  // (a 0.5 is already a clear failure; 0.65 is a near-miss we want to fix).
  const scoreAdj = Math.max(0, 0.1 - judge.score * 0.1);
  return Math.min(1, base + scoreAdj);
}

function defaultId(trace: CotTrace, verdict: JudgeVerdict): string {
  return `lsn_${trace.traceId}_${verdict.verdict}`;
}

/**
 * Pure distillation. Returns `null` when there's nothing to learn.
 */
export function distillLesson(
  trace: CotTrace,
  outcome: TurnOutcomeRecord,
  judge: JudgeVerdict,
  deps: DistillerDeps = {},
): Lesson | null {
  if (isUneventful(trace, outcome, judge)) return null;
  if (trace.steps.length === 0) return null;

  const now = deps.now ?? (() => new Date());
  const id = deps.id ?? defaultId;
  const pivot = pickPivotStep(trace);
  const lessonText = composeLessonText(trace, outcome, judge);
  const evidence = buildEvidence(trace, pivot.index, pivot.tool);

  return {
    id: id(trace, judge),
    tenantId: trace.tenantId,
    taskTag: trace.taskTag,
    lesson: lessonText,
    evidence,
    createdAt: now().toISOString(),
    recencyScore: initialRecencyScore(judge, outcome),
  };
}
