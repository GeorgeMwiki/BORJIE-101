/**
 * Self-consistency vote over per-field extraction shots (LP-26).
 *
 * Structured extraction at temperature 0 is brittle on OCR noise. Running a
 * few shots and majority-voting catches almost every fragile field without
 * doubling cost, and disagreement is the highest-signal escalation trigger
 * before a human looks. This is self-consistency decoding (Wang et al. 2022)
 * applied to field extraction — pure, no model calls here; the host runs the
 * shots and hands us the per-shot field lists.
 *
 * @module @borjie/document-reconciliation/self-consistency
 */

/** A single extracted field as understood by the extractor pipeline. */
export interface ExtractedFieldLike {
  readonly field_name: string;
  readonly value: unknown;
  /** Confidence on a 0..100 scale. */
  readonly confidence: number;
}

export interface FieldVote {
  readonly fieldName: string;
  readonly value: unknown;
  /** Fraction of shots that produced the winning value, 0..1. */
  readonly agreement: number;
  readonly flaggedDisagreement: boolean;
  readonly distinctValues: number;
}

export interface VoteResult {
  readonly merged: readonly ExtractedFieldLike[];
  readonly votes: readonly FieldVote[];
}

const DEFAULT_DISAGREEMENT_THRESHOLD = 0.33;

function stableValueKey(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${typeof value}:${String(value).trim().toLowerCase()}`;
  }
  if (value instanceof Date) return `date:${value.toISOString()}`;
  try {
    return `json:${JSON.stringify(value, Object.keys(value as object).sort())}`;
  } catch {
    return 'unhashable';
  }
}

/**
 * Vote across N per-shot extraction lists. For each field name, pick the
 * value with the highest agreement; ties break by first occurrence. The
 * merged confidence blends agreement (70%) with the top reported confidence
 * (30%), matching the extractor pipeline's scale.
 *
 * `flaggedDisagreement` marks a field whose agreement fell below
 * `1 - disagreementThreshold` — the signal the host escalates on.
 */
export function voteOnFields(
  shots: readonly (readonly ExtractedFieldLike[])[],
  disagreementThreshold: number = DEFAULT_DISAGREEMENT_THRESHOLD,
): VoteResult {
  if (shots.length === 0) return { merged: [], votes: [] };

  const fieldUniverse = new Set<string>();
  for (const shot of shots) {
    for (const f of shot) fieldUniverse.add(f.field_name);
  }

  const merged: ExtractedFieldLike[] = [];
  const votes: FieldVote[] = [];

  for (const name of fieldUniverse) {
    const buckets = new Map<
      string,
      { value: unknown; count: number; firstIndex: number; topConfidence: number }
    >();
    shots.forEach((shot, idx) => {
      const match = shot.find((f) => f.field_name === name);
      if (!match) return;
      const key = stableValueKey(match.value);
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
        if (match.confidence > existing.topConfidence) existing.topConfidence = match.confidence;
      } else {
        buckets.set(key, { value: match.value, count: 1, firstIndex: idx, topConfidence: match.confidence });
      }
    });

    let best: { value: unknown; count: number; firstIndex: number; topConfidence: number } | null = null;
    for (const entry of buckets.values()) {
      if (!best || entry.count > best.count || (entry.count === best.count && entry.firstIndex < best.firstIndex)) {
        best = entry;
      }
    }
    if (!best) continue;

    const agreement = best.count / shots.length;
    merged.push({
      field_name: name,
      value: best.value,
      confidence: Math.round(Math.max(0, Math.min(100, agreement * 100 * 0.7 + best.topConfidence * 0.3))),
    });
    votes.push({
      fieldName: name,
      value: best.value,
      agreement: Number(agreement.toFixed(4)),
      flaggedDisagreement: agreement < 1 - disagreementThreshold,
      distinctValues: buckets.size,
    });
  }

  return { merged: Object.freeze(merged), votes: Object.freeze(votes) };
}
