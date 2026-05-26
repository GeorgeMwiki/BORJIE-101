/**
 * Pure-JS chrF / chrF++ character-n-gram F-score.
 *
 * chrF is preferred over BLEU for morphologically rich low-resource
 * languages because diacritics and inflections don't penalise the
 * score the way BLEU's exact word-token matching does. arxiv
 * 2602.17425 finds that "in Indic ELRL diacritics impact accuracy,
 * penalizing BLEU, whereas character-based metrics like ChrF++ are
 * less sensitive to such variations":
 * https://arxiv.org/html/2602.17425v1
 *
 * sacrebleu reference implementation:
 *   https://github.com/mjpost/sacrebleu/blob/master/sacrebleu/metrics/chrf.py
 *   https://deepwiki.com/mjpost/sacrebleu/4.2-chrf-metric
 *
 * We implement the standard chrF (character-only n-gram F-score) with
 * default n-gram order 6 (sacrebleu's default), β=2 (recall weighted
 * twice as much as precision — also sacrebleu's default). Output range
 * is 0..1 (we return the unscaled F-score; sacrebleu multiplies by
 * 100 — the test fixtures expect the 0..1 form so we keep the spec
 * consistent here).
 */

export interface ChrfScore {
  readonly chrf: number;
  readonly precision: number;
  readonly recall: number;
  readonly ngramOrder: number;
  readonly beta: number;
}

export interface ChrfOptions {
  readonly ngramOrder?: number;
  readonly beta?: number;
  /** Strip whitespace before counting character n-grams. */
  readonly stripWhitespace?: boolean;
}

export function chrf(
  hypothesis: string,
  reference: string,
  options: ChrfOptions = {},
): ChrfScore {
  const ngramOrder = options.ngramOrder ?? 6;
  const beta = options.beta ?? 2;
  const stripWhitespace = options.stripWhitespace ?? false;

  const hypChars = prepare(hypothesis, stripWhitespace);
  const refChars = prepare(reference, stripWhitespace);

  if (hypChars.length === 0 && refChars.length === 0) {
    return Object.freeze({
      chrf: 1,
      precision: 1,
      recall: 1,
      ngramOrder,
      beta,
    });
  }
  if (hypChars.length === 0 || refChars.length === 0) {
    return Object.freeze({
      chrf: 0,
      precision: 0,
      recall: 0,
      ngramOrder,
      beta,
    });
  }

  let totalPrecision = 0;
  let totalRecall = 0;
  let activeOrders = 0;

  for (let n = 1; n <= ngramOrder; n += 1) {
    const hypCounts = ngramCounts(hypChars, n);
    const refCounts = ngramCounts(refChars, n);
    if (hypCounts.size === 0 || refCounts.size === 0) {
      continue;
    }
    let matches = 0;
    for (const [ngram, count] of hypCounts) {
      const refCount = refCounts.get(ngram) ?? 0;
      matches += Math.min(count, refCount);
    }
    const hypTotal = totalCount(hypCounts);
    const refTotal = totalCount(refCounts);
    if (hypTotal === 0 || refTotal === 0) {
      continue;
    }
    totalPrecision += matches / hypTotal;
    totalRecall += matches / refTotal;
    activeOrders += 1;
  }

  if (activeOrders === 0) {
    return Object.freeze({
      chrf: 0,
      precision: 0,
      recall: 0,
      ngramOrder,
      beta,
    });
  }

  const precision = totalPrecision / activeOrders;
  const recall = totalRecall / activeOrders;
  const beta2 = beta * beta;
  const denom = beta2 * precision + recall;
  const score = denom === 0 ? 0 : ((1 + beta2) * precision * recall) / denom;
  return Object.freeze({
    chrf: clamp(score, 0, 1),
    precision: clamp(precision, 0, 1),
    recall: clamp(recall, 0, 1),
    ngramOrder,
    beta,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prepare(text: string, stripWhitespace: boolean): string {
  const lowered = text.toLowerCase();
  return stripWhitespace ? lowered.replace(/\s+/g, '') : lowered;
}

function ngramCounts(chars: string, n: number): Map<string, number> {
  const counts = new Map<string, number>();
  const arr = Array.from(chars);
  if (arr.length < n) {
    return counts;
  }
  for (let i = 0; i <= arr.length - n; i += 1) {
    const ngram = arr.slice(i, i + n).join('');
    counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
  }
  return counts;
}

function totalCount(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  return total;
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) {
    return lo;
  }
  if (value > hi) {
    return hi;
  }
  return value;
}
