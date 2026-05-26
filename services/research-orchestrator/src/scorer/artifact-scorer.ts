/**
 * Artifact scorer — orchestrator-side wrapper around the shared scorer.
 *
 * Per DEEP_RESEARCH_SPEC §4.3 (Scorer) + §7 (Source quality scoring
 * rubric), every artifact is scored on:
 *   - Source quality (9-class rubric base score)
 *   - Recency (×0.7 if >90 days for fast-moving topics)
 *   - Agreement with other sources (+0.10 boost, capped at 1.0)
 *   - Internal-corpus consistency (×0.5 if contradicts)
 *
 * The adapters in `@borjie/research-tools` stamp a preliminary score
 * onto each artifact at retrieval time. THIS module re-scores after
 * cross-referencing all artifacts in the plan so the corroboration
 * boost is applied correctly (an artifact can't know what other
 * artifacts the plan returned at adapter-call time).
 *
 * Pure function. Returns a NEW artifact array — no mutation per
 * project immutability rule.
 *
 * @module research-orchestrator/scorer/artifact-scorer
 */

import type {
  ResearchArtifact,
  SourceClass,
} from '../types.js';

const SOURCE_BASE_SCORE: Readonly<Record<SourceClass, number>> = Object.freeze({
  tz_official: 0.95,
  tier1_market: 0.9,
  academic: 0.85,
  corporate_filing: 0.85,
  established_news: 0.75,
  trade_press: 0.7,
  forum: 0.3,
  generic_blog: 0.2,
  ai_generated: 0.1,
});

const HIGH_QUALITY_CLASSES: ReadonlySet<SourceClass> = new Set([
  'tz_official',
  'tier1_market',
  'academic',
  'corporate_filing',
  'established_news',
]);

export interface RescoreOptions {
  readonly artifacts: ReadonlyArray<ResearchArtifact>;
  /** Whether the topic is fast-moving (prices, regs). Drives 90-day decay. */
  readonly fast_moving_topic?: boolean;
  /**
   * Caller-supplied list of high-confidence corpus claims that, if
   * contradicted by an artifact, trigger the ×0.5 decay + a
   * disagreement entry.
   */
  readonly corpus_high_confidence_claims?: ReadonlyArray<string>;
  /** ISO override for tests. */
  readonly nowIso?: string;
}

export interface RescoreResult {
  readonly artifacts: ReadonlyArray<ResearchArtifact>;
  readonly disagreement_count: number;
}

/**
 * Re-score artifacts after cross-referencing. Returns a NEW array.
 */
export function rescoreArtifacts(options: RescoreOptions): RescoreResult {
  const arts = options.artifacts;
  if (arts.length === 0) {
    return { artifacts: arts, disagreement_count: 0 };
  }

  // Build a quick "how many other high-quality sources agree per topic
  // bucket" map. We use the artifact's title as the topic bucket
  // proxy — a real implementation would extract claims via an LLM, but
  // the runner-side scorer keeps it cheap + deterministic.
  const highQualityCount = new Map<string, number>();
  for (const a of arts) {
    if (HIGH_QUALITY_CLASSES.has(a.source_class)) {
      const bucket = topicBucket(a.title);
      highQualityCount.set(bucket, (highQualityCount.get(bucket) ?? 0) + 1);
    }
  }

  let disagreementCount = 0;
  const rescored: Array<ResearchArtifact> = [];

  for (const art of arts) {
    let score = SOURCE_BASE_SCORE[art.source_class];

    // AI-generated cap — DEEP_RESEARCH_SPEC §7.
    if (art.bias_flags.includes('ai_generated')) {
      score = Math.min(score, 0.2);
    }

    // Recency decay.
    if (options.fast_moving_topic === true) {
      const ageDays = ageDaysOf(art.retrieved_at, options.nowIso);
      if (ageDays > 90) score *= 0.7;
    }

    // Corroboration boost.
    const bucket = topicBucket(art.title);
    const corrob = (highQualityCount.get(bucket) ?? 0) - (HIGH_QUALITY_CLASSES.has(art.source_class) ? 1 : 0);
    if (corrob >= 2) score = Math.min(1.0, score + 0.1);

    // Internal-consistency contradiction.
    const contradictsCorpus = (options.corpus_high_confidence_claims ?? []).some((c) =>
      contentContradicts(art.content, c),
    );
    if (contradictsCorpus) {
      score *= 0.5;
      disagreementCount += 1;
    }

    // Clamp.
    score = Math.max(0, Math.min(1, score));

    rescored.push({
      ...art,
      quality_score: score,
    });
  }

  return {
    artifacts: Object.freeze(rescored),
    disagreement_count: disagreementCount,
  };
}

function topicBucket(title: string): string {
  // First 4 normalised words — coarse-enough for the test pass and
  // small-vocabulary domains. Real upgrade path: LLM-based claim
  // extraction.
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join('-');
}

function ageDaysOf(retrievedIso: string, nowIso?: string): number {
  const retrieved = new Date(retrievedIso).getTime();
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  return Math.max(0, (now - retrieved) / 86_400_000);
}

function contentContradicts(content: string, claim: string): boolean {
  // Simple negation heuristic — if the claim appears with a leading
  // 'not', 'no', 'never' (case-insensitive) within a 50-char window.
  const lc = content.toLowerCase();
  const lcClaim = claim.toLowerCase();
  const idx = lc.indexOf(lcClaim);
  if (idx === -1) return false;
  const prefix = lc.slice(Math.max(0, idx - 50), idx);
  return /(\bnot\b|\bno\b|\bnever\b|\bfalse\b)/.test(prefix);
}
