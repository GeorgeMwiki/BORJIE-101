/**
 * Reviewer portal — builds the per-reviewer task package for the
 * Turing-style blind-review study, and a deterministic synthetic reviewer
 * for CI (so the pipeline runs end-to-end without humans).
 *
 * Each reviewer receives a randomised order of all records with author
 * labels stripped. A `ReviewerTask` is JSON-serialisable so it can be
 * pushed to a UI, exported, or piped into the synthetic reviewer.
 */

import type {
  BlindReviewDataset,
  DecisionAuthor,
  MarginalDecisionRecord,
  ReviewerAssignment,
  ReviewerVerdict,
} from './types.js';

export interface ReviewerTask {
  readonly reviewerId: string;
  readonly datasetId: string;
  readonly issuedAtMs: number;
  readonly instructions: string;
  readonly cards: ReadonlyArray<{
    readonly recordId: string;
    readonly caseIdMasked: string;
    readonly decision: string;
    readonly anonymisedRationale: string;
    readonly summary: Readonly<Record<string, unknown>>;
  }>;
}

const STANDARD_INSTRUCTIONS = [
  'Welcome senior officer. Below are anonymised marginal mining decisions.',
  'For each decision, indicate whether you believe the rationale was authored by:',
  '  AI (Mr. Mwikila) OR HUMAN (a senior officer of the same estate).',
  'Read each rationale once. Do not seek the case file. Do not collaborate with other reviewers.',
  'Any reviewer accuracy below 55 percent is treated as indistinguishable from chance for the M5 milestone.',
  'Time per card: 60 to 90 seconds.',
].join('\n');

function maskCaseId(id: string): string {
  if (id.length <= 4) return '****';
  return `${id.slice(0, 2)}****${id.slice(-2)}`;
}

export function buildReviewerTask(
  assignment: ReviewerAssignment,
  dataset: BlindReviewDataset,
  issuedAtMs: number = Date.now(),
): ReviewerTask {
  const lookup = new Map<string, MarginalDecisionRecord>();
  for (const r of dataset.aiRecords) lookup.set(r.id, r);
  for (const r of dataset.humanRecords) lookup.set(r.id, r);

  const cards = assignment.recordIds.map((id) => {
    const rec = lookup.get(id);
    if (!rec) {
      throw new Error(
        `Reviewer task references unknown record id ${id} (dataset=${dataset.id})`,
      );
    }
    return {
      recordId: rec.id,
      caseIdMasked: maskCaseId(rec.caseId),
      decision: rec.decision,
      anonymisedRationale: rec.rationale,
      summary: rec.snapshot,
    };
  });

  return {
    reviewerId: assignment.reviewerId,
    datasetId: dataset.id,
    issuedAtMs,
    instructions: STANDARD_INSTRUCTIONS,
    cards,
  };
}

// ---------------------------------------------------------------------------
// Synthetic CI reviewer
// ---------------------------------------------------------------------------

export interface SyntheticReviewerHeuristic {
  /** Probability of correctly detecting an AI rationale given AI markers. */
  readonly aiDetectRate: number;
  /** Probability of misidentifying a human rationale as AI. */
  readonly humanFalsePositiveRate: number;
  /** Optional fixed bias. */
  readonly bias?: DecisionAuthor;
}

const AI_MARKERS: ReadonlyArray<RegExp> = [
  /Assay:.*?Royalty:/s,
  /\bgrade\b.+\bcoverage\b/,
  /^[123]\.\s/m,
  /Decision:\s+(approve|reject|request_more_info)/i,
  /Indicators show/i,
];

const HUMAN_MARKERS: ReadonlyArray<RegExp> = [
  /\bim\b|\bdont\b|\bcant\b/i,
  /--/,
  /\bassay grade\b/i,
  /\bleaning\b/i,
];

function pseudoRand(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

export function createSyntheticReviewer(
  reviewerId: string,
  heuristic: SyntheticReviewerHeuristic,
): { readonly review: (task: ReviewerTask) => ReadonlyArray<ReviewerVerdict> } {
  return {
    review(task) {
      const verdicts: ReviewerVerdict[] = [];
      let i = 0;
      for (const card of task.cards) {
        const aiHits = AI_MARKERS.filter((re) =>
          re.test(card.anonymisedRationale),
        ).length;
        const humanHits = HUMAN_MARKERS.filter((re) =>
          re.test(card.anonymisedRationale),
        ).length;
        const score = aiHits - humanHits;
        const drift = pseudoRand(reviewerId + card.recordId + String(i));
        let guess: DecisionAuthor;
        if (score > 0) {
          guess = drift < heuristic.aiDetectRate ? 'ai' : 'human';
        } else if (score < 0) {
          guess = drift < heuristic.humanFalsePositiveRate ? 'ai' : 'human';
        } else {
          guess = drift < 0.5 ? 'ai' : 'human';
        }
        if (heuristic.bias && drift < 0.05) guess = heuristic.bias;
        verdicts.push({
          reviewerId,
          recordId: card.recordId,
          guess,
          confidence: Math.min(0.95, 0.55 + Math.abs(score) * 0.1),
        });
        i++;
      }
      return verdicts;
    },
  };
}
