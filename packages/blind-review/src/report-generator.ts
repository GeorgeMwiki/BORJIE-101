/**
 * Report generator for the blind-review pipeline.
 *
 * Emits a regulator-readable Markdown report: dataset summary,
 * per-reviewer accuracy, confusion matrix, aggregate accuracy with the
 * indistinguishability verdict, and reviewer reliability flags.
 *
 * Pure function. No file I/O. The caller persists the markdown.
 */

import {
  reliabilityFlags,
  scoreVerdicts,
  type AccuracyScore,
  type ScoreInput,
} from './accuracy-scorer.js';
import type {
  BlindReviewDataset,
  BlindReviewReport,
  ReviewerVerdict,
} from './types.js';

export interface GenerateReportInput extends ScoreInput {
  readonly title?: string;
  readonly runId?: string;
  /** Clock override for a deterministic "issued at" line in tests. */
  readonly issuedAtIso?: string;
}

interface RenderInput {
  readonly score: AccuracyScore;
  readonly dataset: BlindReviewDataset;
  readonly verdicts: ReadonlyArray<ReviewerVerdict>;
  readonly flags: ReadonlyArray<{
    readonly reviewerId: string;
    readonly flag: 'above' | 'below';
    readonly accuracy: number;
  }>;
  readonly title?: string;
  readonly runId?: string;
  readonly issuedAtIso: string;
}

export function generateReport(input: GenerateReportInput): BlindReviewReport {
  const score = scoreVerdicts(input);
  const flags = reliabilityFlags(score.perReviewer);
  const md = renderMarkdown({
    score,
    dataset: input.dataset,
    verdicts: input.verdicts,
    flags,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    issuedAtIso: input.issuedAtIso ?? new Date().toISOString(),
  });

  return {
    datasetId: input.dataset.id,
    totalReviews: score.totalReviews,
    accuracy: score.accuracy,
    indistinguishable: score.indistinguishable,
    perReviewer: score.perReviewer.map((r) => ({
      reviewerId: r.reviewerId,
      accuracy: Number(r.accuracy.toFixed(3)),
      nReviews: r.nReviews,
    })),
    confusionMatrix: score.confusionMatrix,
    markdown: md,
    passed: score.indistinguishable,
  };
}

function renderMarkdown(input: RenderInput): string {
  const mineralBuckets = Array.from(
    new Set([
      ...input.dataset.aiRecords.map((r) => r.mineralBucket),
      ...input.dataset.humanRecords.map((r) => r.mineralBucket),
    ]),
  ).sort();
  const regionBuckets = Array.from(
    new Set([
      ...input.dataset.aiRecords.map((r) => r.regionBucket),
      ...input.dataset.humanRecords.map((r) => r.regionBucket),
    ]),
  ).sort();

  const lines: string[] = [];
  lines.push(`# ${input.title ?? 'M5 Blind-Review Report'}`);
  lines.push('');
  lines.push(`Run id: ${input.runId ?? 'n/a'}`);
  lines.push(`Dataset id: ${input.dataset.id}`);
  lines.push(`Issued at: ${input.issuedAtIso}`);
  lines.push('');
  lines.push('## Dataset');
  lines.push('');
  lines.push(
    `- Total cases: ${input.dataset.totalSize} (AI: ${input.dataset.aiRecords.length}; Human: ${input.dataset.humanRecords.length})`,
  );
  lines.push(`- Mineral buckets: ${mineralBuckets.join(', ')}`);
  lines.push(`- Region buckets: ${regionBuckets.join(', ')}`);
  lines.push('');
  lines.push('## Aggregate accuracy');
  lines.push('');
  lines.push(
    `Reviewers were correct on ${input.score.correct} of ${input.score.totalReviews} judgements (accuracy ${(input.score.accuracy * 100).toFixed(1)} percent).`,
  );
  lines.push('');
  lines.push(
    `Indistinguishability bar: at or below 55 percent. M5 milestone: ${input.score.indistinguishable ? 'PASS' : 'FAIL'}.`,
  );
  lines.push('');
  lines.push('## Per-reviewer accuracy');
  lines.push('');
  lines.push('| Reviewer | n | Correct | Accuracy |');
  lines.push('|---|---:|---:|---:|');
  for (const r of input.score.perReviewer) {
    lines.push(
      `| ${r.reviewerId} | ${r.nReviews} | ${r.correct} | ${(r.accuracy * 100).toFixed(1)}% |`,
    );
  }
  lines.push('');
  lines.push('## Confusion matrix');
  lines.push('');
  lines.push('|  | predicted AI | predicted Human |');
  lines.push('|---|---:|---:|');
  lines.push(
    `| actual AI | ${input.score.confusionMatrix.aiCorrectlyIdentified} | ${input.score.confusionMatrix.aiMisidentifiedAsHuman} |`,
  );
  lines.push(
    `| actual Human | ${input.score.confusionMatrix.humanMisidentifiedAsAi} | ${input.score.confusionMatrix.humanCorrectlyIdentified} |`,
  );
  lines.push('');
  if (input.flags.length > 0) {
    lines.push('## Reliability flags');
    lines.push('');
    for (const f of input.flags) {
      lines.push(
        `- Reviewer ${f.reviewerId} accuracy ${(f.accuracy * 100).toFixed(1)} percent (${f.flag === 'above' ? 'much higher' : 'much lower'} than peer band).`,
      );
    }
    lines.push('');
  }
  lines.push('## Protocol');
  lines.push('');
  lines.push(
    '- Marginal mining decisions split 50/50 between Mr. Mwikila and senior officers of the same estate.',
  );
  lines.push(
    '- Records anonymised: NIDA, licence number, phone, account number, email, and name patterns redacted.',
  );
  lines.push(
    '- Senior officers, blinded, randomised order; deterministic seed for replay (mulberry32).',
  );
  lines.push(
    '- Pass criterion: aggregate accuracy at or below 55 percent.',
  );
  lines.push('');
  lines.push('## Citations');
  lines.push('');
  lines.push('- ReConcile (Chen et al, ACL 2024) round-table multi-agent debate.');
  lines.push('- Anthropic Constitutional AI (Bai et al, 2022).');
  lines.push('- Hu et al ICML 2025, Theory of Mind Benchmarks are Broken for LLMs.');
  lines.push('- AGENCYBENCH 2025.');

  return lines.join('\n');
}
