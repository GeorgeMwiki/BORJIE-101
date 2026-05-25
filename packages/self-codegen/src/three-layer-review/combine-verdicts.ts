/**
 * Combine three review verdicts into one.
 *
 * Rule: any 'block' → block; any 'comments' → comments; all 'pass' → pass.
 * Findings concatenate, preserving the originating layer's name as a
 * tag on each finding via the `layer` field already on the verdict.
 */

import {
  type ICodeReviewer,
  type ReviewInput,
  type ReviewVerdict,
} from './types.js';

export function combineVerdicts(
  verdicts: readonly ReviewVerdict[],
): ReviewVerdict {
  if (verdicts.length === 0) {
    return Object.freeze<ReviewVerdict>({
      status: 'pass',
      findings: Object.freeze([]),
      layer: 'combined',
    });
  }
  const hasBlock = verdicts.some((v) => v.status === 'block');
  const hasComments = verdicts.some((v) => v.status === 'comments');
  const status = hasBlock ? 'block' : hasComments ? 'comments' : 'pass';
  const findings = verdicts.flatMap((v) => v.findings);
  return Object.freeze<ReviewVerdict>({
    status,
    findings: Object.freeze([...findings]),
    layer: 'combined',
  });
}

export async function runThreeLayerReview(
  input: ReviewInput,
  reviewers: readonly ICodeReviewer[],
): Promise<ReviewVerdict> {
  if (reviewers.length === 0) {
    throw new Error('Three-layer review requires at least one reviewer.');
  }
  const verdicts = await Promise.all(reviewers.map((r) => r.review(input)));
  return combineVerdicts(verdicts);
}
