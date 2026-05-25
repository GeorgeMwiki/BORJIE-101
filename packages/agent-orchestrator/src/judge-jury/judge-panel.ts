/**
 * Judge / jury panel — composable verifier. Many judges score the
 * same candidate against a shared rubric; the panel returns a
 * majority verdict + per-judge breakdown.
 *
 * Designed to plug into the central-intelligence 5-rubric judge
 * already in the repo (per spec W1.4) — each judge is a small
 * `Judge` port that the panel parallelises.
 */

import type { BrainPort } from '../types.js';

export interface JudgeRubricCriterion {
  readonly key: string;
  readonly description: string;
  readonly weight: number;
}

export interface JudgeScore {
  readonly judgeId: string;
  readonly criterionScores: ReadonlyArray<{ readonly key: string; readonly score: number; readonly rationale: string }>;
  /** Weighted sum over the rubric. */
  readonly overall: number;
  /** Whether this single judge accepts the candidate. */
  readonly accept: boolean;
  /** Optional confidence in [0,1]. */
  readonly confidence: number;
}

export interface Judge {
  readonly id: string;
  evaluate(input: { readonly candidate: string; readonly rubric: ReadonlyArray<JudgeRubricCriterion>; readonly brain: BrainPort }): Promise<JudgeScore>;
}

export interface JudgePanelInput {
  readonly judges: ReadonlyArray<Judge>;
  readonly brain: BrainPort;
  readonly rubric: ReadonlyArray<JudgeRubricCriterion>;
  /** Minimum acceptance ratio for the panel verdict. Default 0.5. */
  readonly acceptanceThreshold?: number;
}

export interface JudgeVerdict {
  readonly accept: boolean;
  /** acceptCount / totalJudges */
  readonly ratio: number;
  /** Mean of per-judge `overall`. */
  readonly meanScore: number;
  readonly breakdown: ReadonlyArray<JudgeScore>;
  readonly threshold: number;
}

export interface JudgeRuntime {
  verify(candidate: string): Promise<JudgeVerdict>;
}

export const DEFAULT_ACCEPTANCE_THRESHOLD = 0.5;

export function createJudgePanel(input: JudgePanelInput): JudgeRuntime {
  if (input.judges.length === 0) throw new Error('judges must be non-empty');
  if (input.rubric.length === 0) throw new Error('rubric must be non-empty');
  const threshold = input.acceptanceThreshold ?? DEFAULT_ACCEPTANCE_THRESHOLD;
  return {
    async verify(candidate: string): Promise<JudgeVerdict> {
      const breakdown = await Promise.all(
        input.judges.map((j) =>
          j.evaluate({ candidate, rubric: input.rubric, brain: input.brain }),
        ),
      );
      const accepted = breakdown.filter((s) => s.accept).length;
      const ratio = accepted / breakdown.length;
      const meanScore = breakdown.reduce((acc, s) => acc + s.overall, 0) / breakdown.length;
      return Object.freeze({
        accept: ratio >= threshold,
        ratio,
        meanScore,
        breakdown,
        threshold,
      });
    },
  };
}

/**
 * Convenience: standalone verification when you already have a built
 * panel + want a one-shot call.
 */
export async function verifyOutput(input: {
  readonly candidate: string;
  readonly judges: JudgeRuntime;
}): Promise<JudgeVerdict> {
  return input.judges.verify(input.candidate);
}
