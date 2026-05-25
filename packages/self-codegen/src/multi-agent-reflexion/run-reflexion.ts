/**
 * runReflexionRound — three critics in parallel, combined verdict.
 *
 * Combination rule (same as three-layer-review):
 *   any 'block'    → block
 *   any 'comments' → comments
 *   all 'pass'     → pass
 */

import {
  type CriticName,
  type CriticVerdict,
  type ReflexionResult,
  type ReflexionRoundRequest,
} from './types.js';

export async function runReflexionRound(
  request: ReflexionRoundRequest,
): Promise<ReflexionResult> {
  if (request.critics.length === 0) {
    throw new Error('runReflexionRound requires at least one critic.');
  }
  const verdicts = await Promise.all(
    request.critics.map(async (critic) => {
      const r = await request.reviewer({
        diffSummary: request.draft.diffSummary,
        modifiedFiles: request.draft.modifiedFiles,
        critic,
      });
      const cv: CriticVerdict = Object.freeze({
        critic,
        status: r.verdict,
        findings: Object.freeze([...r.findings]),
      });
      return cv;
    }),
  );
  return combineCriticVerdicts(verdicts);
}

export function combineCriticVerdicts(
  verdicts: readonly CriticVerdict[],
): ReflexionResult {
  const hasBlock = verdicts.some((v) => v.status === 'block');
  const hasComments = verdicts.some((v) => v.status === 'comments');
  const verdict: 'pass' | 'comments' | 'block' = hasBlock
    ? 'block'
    : hasComments
      ? 'comments'
      : 'pass';
  const findings = verdicts.flatMap((v) =>
    v.findings.map((f) => Object.freeze({ critic: v.critic, ...f })),
  );
  return Object.freeze<ReflexionResult>({
    verdict,
    findings: Object.freeze(findings),
    perCritic: Object.freeze([...verdicts]),
  });
}

/**
 * The three-critic preset used by default everywhere.
 */
export const DEFAULT_CRITICS: readonly CriticName[] = ['factual', 'senior-eng', 'security'];
