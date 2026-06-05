/**
 * `@borjie/blind-review` — public surface.
 *
 * Blind-review indistinguishability panel (LP-16 / PO-22, M5 milestone)
 * for the Borjie mining-estate OS: anonymize -> shuffle -> N-reviewer
 * Turing-style panel over marginal mining decisions, with an
 * accuracy <= 0.55 indistinguishability bar.
 *
 * Pure functions, deterministic seeds, no live I/O. Ported from LITFIN
 * `src/core/security/blind-review`, re-skinned from credit to mining.
 */

export {
  INDISTINGUISHABILITY_BAR,
  DEFAULT_SEED,
  type DecisionAuthor,
  type MiningDecisionDomain,
  type MiningDecisionOutcome,
  type MiningDecisionSnapshot,
  type MarginalDecisionRecord,
  type ReviewerAssignment,
  type ReviewerVerdict,
  type BlindReviewDataset,
  type ConfusionMatrix,
  type BlindReviewReport,
} from './types.js';

export {
  anonymiseRationale,
  anonymiseRecord,
  deterministicShuffle,
  buildBlindReviewDataset,
  assignReviewers,
  createSyntheticFetcher,
  type FetchMarginalDecisionsInput,
  type MarginalDecisionFetcher,
  type BuildDatasetInput,
  type AssignReviewersInput,
  type SyntheticFetcherOptions,
} from './pipeline.js';

export {
  buildReviewerTask,
  createSyntheticReviewer,
  type ReviewerTask,
  type SyntheticReviewerHeuristic,
} from './reviewer-portal.js';

export {
  scoreVerdicts,
  reliabilityFlags,
  authorOf,
  type AccuracyScore,
  type ScoreInput,
} from './accuracy-scorer.js';

export { generateReport, type GenerateReportInput } from './report-generator.js';

import { assignReviewers, buildBlindReviewDataset, createSyntheticFetcher } from './pipeline.js';
import { buildReviewerTask, createSyntheticReviewer } from './reviewer-portal.js';
import { generateReport } from './report-generator.js';
import type { BlindReviewReport, ReviewerVerdict } from './types.js';

export interface RunCiPipelineInput {
  readonly limit?: number;
  readonly seed?: number;
  readonly reviewerIds?: ReadonlyArray<string>;
  /** Per-reviewer heuristic. Default: moderately good but imperfect. */
  readonly heuristics?: ReadonlyArray<{
    readonly aiDetectRate: number;
    readonly humanFalsePositiveRate: number;
  }>;
  readonly now?: () => number;
  readonly issuedAtIso?: string;
}

/**
 * One-shot CI runner: builds a synthetic dataset, runs N synthetic
 * reviewers, returns the report. No external IO. Suitable for the
 * red-team CI gate and the regulator drill.
 */
export async function runBlindReviewCi(
  input: RunCiPipelineInput = {},
): Promise<BlindReviewReport> {
  const reviewerIds = input.reviewerIds ?? [
    'officer-alpha',
    'officer-beta',
    'officer-gamma',
  ];
  const heuristics = input.heuristics ?? [
    { aiDetectRate: 0.58, humanFalsePositiveRate: 0.12 },
    { aiDetectRate: 0.55, humanFalsePositiveRate: 0.14 },
    { aiDetectRate: 0.61, humanFalsePositiveRate: 0.1 },
  ];
  const fetcher = createSyntheticFetcher({ ...(input.seed !== undefined ? { seed: input.seed } : {}) });
  const dataset = await buildBlindReviewDataset({
    fetcher,
    limit: input.limit ?? 100,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  const assignments = assignReviewers({
    dataset,
    reviewerIds,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  });

  const allVerdicts: ReviewerVerdict[] = [];
  for (let i = 0; i < reviewerIds.length; i++) {
    const assignment = assignments[i];
    const reviewerId = reviewerIds[i];
    const heuristic = heuristics[i % heuristics.length];
    if (!assignment || !reviewerId || !heuristic) continue;
    const task = buildReviewerTask(assignment, dataset, dataset.createdAtMs);
    const reviewer = createSyntheticReviewer(reviewerId, heuristic);
    for (const v of reviewer.review(task)) allVerdicts.push(v);
  }

  return generateReport({
    dataset,
    verdicts: allVerdicts,
    title: 'M5 Blind-Review Report (CI synthetic)',
    runId: dataset.id,
    ...(input.issuedAtIso !== undefined ? { issuedAtIso: input.issuedAtIso } : {}),
  });
}
