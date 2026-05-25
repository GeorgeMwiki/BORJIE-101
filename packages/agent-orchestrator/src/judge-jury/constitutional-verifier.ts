/**
 * Constitutional-AI verifier — the strict mode of judge-jury.
 *
 * Flow:
 *   1. judge-panel verifies candidate against rubric
 *   2. if rejected: run `runConstitutionalCritique` over the candidate
 *      using a principle list derived from the rubric criteria
 *   3. re-submit the revised draft to the judge panel
 *   4. cap at maxPasses
 */

import { runConstitutionalCritique } from '../single-agent/constitutional-critique.js';
import type {
  AgentSpec,
  BrainPort,
} from '../types.js';
import type { JudgeRuntime, JudgeRubricCriterion, JudgeVerdict } from './judge-panel.js';

export interface RunConstitutionalVerifierInput {
  readonly agent: AgentSpec;
  readonly brain: BrainPort;
  readonly judges: JudgeRuntime;
  readonly rubric: ReadonlyArray<JudgeRubricCriterion>;
  readonly candidate: string;
  readonly maxPasses?: number;
}

export interface ConstitutionalVerifierResult {
  readonly accepted: boolean;
  readonly finalCandidate: string;
  readonly passes: ReadonlyArray<{
    readonly attempt: number;
    readonly candidate: string;
    readonly verdict: JudgeVerdict;
    readonly critique?: string;
  }>;
}

export const DEFAULT_CONSTITUTIONAL_MAX_PASSES = 3;

export async function runConstitutionalVerifier(
  input: RunConstitutionalVerifierInput,
): Promise<ConstitutionalVerifierResult> {
  const maxPasses = input.maxPasses ?? DEFAULT_CONSTITUTIONAL_MAX_PASSES;
  if (maxPasses < 1) throw new Error('maxPasses must be >= 1');

  const passes: {
    attempt: number;
    candidate: string;
    verdict: JudgeVerdict;
    critique?: string;
  }[] = [];

  let candidate = input.candidate;

  for (let attempt = 1; attempt <= maxPasses; attempt++) {
    const verdict = await input.judges.verify(candidate);
    if (verdict.accept) {
      passes.push({ attempt, candidate, verdict });
      return Object.freeze({ accepted: true, finalCandidate: candidate, passes });
    }
    if (attempt === maxPasses) {
      passes.push({ attempt, candidate, verdict });
      return Object.freeze({ accepted: false, finalCandidate: candidate, passes });
    }
    // Synthesise principles from the rubric — the critic uses the
    // rubric's criteria as the constitution to enforce.
    const principles = input.rubric.map((c) => `${c.key}: ${c.description}`);
    const critique = await runConstitutionalCritique({
      agent: input.agent,
      draft: candidate,
      brain: input.brain,
      principles,
    });
    passes.push({ attempt, candidate, verdict, critique: critique.critique });
    if (!critique.changed) {
      // Stuck — won't improve further.
      return Object.freeze({ accepted: false, finalCandidate: candidate, passes });
    }
    candidate = critique.revised;
  }

  return Object.freeze({ accepted: false, finalCandidate: candidate, passes });
}
