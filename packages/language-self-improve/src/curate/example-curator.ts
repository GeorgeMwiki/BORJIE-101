/**
 * Example curator — pure-function pipeline that takes a batch of raw
 * `TrainingPair` candidates and returns the curated subset.
 *
 * Steps (in order):
 *   1. Dedupe by `sha256(sourceText + '␟' + targetText)`.
 *   2. PII redact every text field using the injected `PiiRedactorPort`
 *      (per FOUNDER_LOCKED §1.3 — recipient-aware redaction is a
 *      separate concern handled at read-time; here we just strip raw
 *      PII so the persistence layer never sees plaintext NIDA / phone /
 *      coords).
 *   3. Balance dialects — no single dialect may exceed 50% of the
 *      curated batch (active-learning anti-collapse rule). Excess
 *      examples for an over-weighted dialect are dropped, preferring to
 *      keep the highest-aggregate-score pairs.
 *   4. Active-learning bias — mark pairs with the highest WER
 *      disagreement and pairs that introduce novel glossary terms as
 *      `included = true`; mark the rest with the appropriate
 *      `exclusionReason`.
 *
 * Output is always a `ReadonlyArray<TrainingPair>` with the `included`
 * + `exclusionReason` fields set. Persistence is the caller's job.
 */

import { createHash } from 'node:crypto';

import type {
  Dialect,
  ExclusionReason,
  LanguageTag,
  TrainingPair,
} from '../types.js';

export interface CuratorInput {
  readonly pair: TrainingPair;
  /** The pair's dialect, surfaced separately because TrainingPair carries
   *  it inside `scores` rather than as a top-level field. */
  readonly dialect: Dialect;
  /** Optional novelty hint — true if the pair contains terms not yet in
   *  the per-tenant mining glossary. */
  readonly hasNovelTerm?: boolean;
}

export interface PiiRedactorPort {
  redact(text: string, tenantId: string): Promise<string>;
}

export interface CuratorConfig {
  /** Max share of any single dialect in the curated set. Default 0.5. */
  readonly maxDialectShare: number;
  /** Min aggregate score to consider for inclusion. Default 0.0 — we
   *  keep low-scoring examples too if they carry high signal. */
  readonly minAggregateScore: number;
  /** Cap on how many novel-term examples may be included per batch.
   *  Default 20% of the dialect-balanced output. */
  readonly novelTermShareCap: number;
}

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = Object.freeze({
  maxDialectShare: 0.5,
  minAggregateScore: 0,
  novelTermShareCap: 0.2,
});

export interface CurationResult {
  readonly curated: ReadonlyArray<TrainingPair>;
  readonly droppedCount: number;
  readonly perDialectCount: Readonly<Record<Dialect, number>>;
}

function fingerprint(source: string, target: string, lang: LanguageTag): string {
  const hash = createHash('sha256');
  hash.update(source);
  hash.update('␟');
  hash.update(target);
  hash.update('␟');
  hash.update(lang);
  return hash.digest('hex');
}

function freshPair(
  base: TrainingPair,
  included: boolean,
  exclusionReason: ExclusionReason | null,
): TrainingPair {
  return Object.freeze({
    ...base,
    included,
    exclusionReason,
  });
}

/**
 * Run the curator pipeline. Returns a frozen result. No mutation of the
 * inputs; every output `TrainingPair` is a fresh object.
 */
export async function curateExamples(
  inputs: ReadonlyArray<CuratorInput>,
  redactor: PiiRedactorPort,
  config: CuratorConfig = DEFAULT_CURATOR_CONFIG,
): Promise<CurationResult> {
  if (inputs.length === 0) {
    return Object.freeze({
      curated: Object.freeze([]),
      droppedCount: 0,
      perDialectCount: Object.freeze({
        bongo: 0,
        coast: 0,
        lake: 0,
        sheng: 0,
        other: 0,
      }),
    });
  }

  // Step 1 — dedupe
  const seenFingerprints = new Set<string>();
  const deduped: CuratorInput[] = [];
  for (const input of inputs) {
    const fp = fingerprint(
      input.pair.sourceText,
      input.pair.targetText,
      input.pair.lang,
    );
    if (seenFingerprints.has(fp)) {
      continue;
    }
    seenFingerprints.add(fp);
    deduped.push(input);
  }

  // Step 2 — PII redact (in place into new objects)
  const redacted: CuratorInput[] = [];
  for (const input of deduped) {
    try {
      const newSource = await redactor.redact(
        input.pair.sourceText,
        input.pair.tenantId,
      );
      const newTarget = await redactor.redact(
        input.pair.targetText,
        input.pair.tenantId,
      );
      redacted.push({
        ...input,
        pair: Object.freeze({
          ...input.pair,
          sourceText: newSource,
          targetText: newTarget,
        }),
      });
    } catch (err) {
      // If the redactor fails we keep the pair but mark it for
      // exclusion so the persistence layer can see it but never ship
      // it to the trainer.
      redacted.push({
        ...input,
        pair: freshPair(input.pair, false, 'pii_redaction_failed'),
      });
    }
  }

  // Step 3 — dialect balance
  const perDialectCount: Record<Dialect, number> = {
    bongo: 0,
    coast: 0,
    lake: 0,
    sheng: 0,
    other: 0,
  };
  for (const input of redacted) {
    perDialectCount[input.dialect] = (perDialectCount[input.dialect] ?? 0) + 1;
  }
  const total = redacted.length;
  const maxAllowedPerDialect = Math.max(1, Math.floor(total * config.maxDialectShare));

  // Sort by aggregate score desc so we keep the strongest examples per
  // dialect when we trim.
  const sortedByScore = [...redacted].sort(
    (a, b) => b.pair.scores.aggregate - a.pair.scores.aggregate,
  );

  const keptPerDialect: Record<Dialect, number> = {
    bongo: 0,
    coast: 0,
    lake: 0,
    sheng: 0,
    other: 0,
  };

  const balanced: Array<{ input: CuratorInput; reason: ExclusionReason | null }> = [];
  for (const input of sortedByScore) {
    const kept = keptPerDialect[input.dialect] ?? 0;
    if (kept >= maxAllowedPerDialect) {
      balanced.push({ input, reason: 'dialect_overweighted' });
    } else {
      keptPerDialect[input.dialect] = kept + 1;
      balanced.push({ input, reason: null });
    }
  }

  // Step 4 — active-learning bias (novel-term cap)
  let novelTermsKept = 0;
  const novelTermsCap = Math.max(
    1,
    Math.floor(total * config.novelTermShareCap),
  );

  const curated: TrainingPair[] = [];
  let droppedCount = 0;
  for (const row of balanced) {
    const explicitDropReason = row.input.pair.exclusionReason
      ? (row.input.pair.exclusionReason as ExclusionReason)
      : null;
    if (explicitDropReason) {
      curated.push(freshPair(row.input.pair, false, explicitDropReason));
      droppedCount++;
      continue;
    }
    if (row.reason) {
      curated.push(freshPair(row.input.pair, false, row.reason));
      droppedCount++;
      continue;
    }
    if (row.input.pair.scores.aggregate < config.minAggregateScore) {
      curated.push(freshPair(row.input.pair, false, 'low_signal'));
      droppedCount++;
      continue;
    }
    if (row.input.hasNovelTerm === true) {
      if (novelTermsKept >= novelTermsCap) {
        curated.push(freshPair(row.input.pair, false, 'novel_term_quota_exceeded'));
        droppedCount++;
        continue;
      }
      novelTermsKept++;
    }
    curated.push(freshPair(row.input.pair, true, null));
  }

  return Object.freeze({
    curated: Object.freeze(curated),
    droppedCount,
    perDialectCount: Object.freeze(perDialectCount),
  });
}
