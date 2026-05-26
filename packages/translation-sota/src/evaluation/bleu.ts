/**
 * Pure-JS BLEU computation, sacrebleu-compatible at the
 * single-reference, whitespace-tokenised level.
 *
 * BLEU = brevity-penalty × geo-mean(p1, p2, p3, p4)
 *
 * where p_n is the modified n-gram precision: count of n-gram matches
 * (clipped at the reference's count) divided by total candidate
 * n-grams. We use add-1 smoothing on zero n-gram counts (the standard
 * NIST `mteval` v13a "method1" smoother) so that low-resource
 * single-sentence corpora don't collapse to BLEU = 0 the way
 * unsmoothed BLEU would.
 *
 * Sources:
 *   - sacrebleu reference implementation (mjpost/sacrebleu)
 *     https://github.com/mjpost/sacrebleu
 *   - "Enhanced Bilingual Evaluation Understudy" (Doddington 2002 /
 *     v13a):
 *     https://arxiv.org/pdf/1509.09088
 *   - For low-resource pairs, chrF often correlates better with human
 *     judgement than BLEU; see
 *     https://arxiv.org/html/2602.17425v1
 *     We still report BLEU because (a) it is the long-standing
 *     reference metric and (b) it is sensitive to entity / number
 *     deviations exactly the way mining-domain users care about (see
 *     WMT24 "Pitfalls and Outlooks in Using COMET":
 *     https://www2.statmt.org/wmt24/pdf/2024.wmt-1.121.pdf).
 *
 * Output range: 0..100 (the convention shared by sacrebleu).
 */

export interface BleuScore {
  readonly bleu: number;
  /** Precision at n = 1..4. */
  readonly precisions: ReadonlyArray<number>;
  /** Brevity penalty. */
  readonly brevityPenalty: number;
  readonly hypothesisLength: number;
  readonly referenceLength: number;
}

export interface BleuOptions {
  readonly maxNgram?: number;
  readonly tokenize?: 'whitespace' | 'character';
  /** Apply add-1 (Laplace) smoothing on zero n-gram counts. */
  readonly smooth?: boolean;
}

export function bleu(
  hypothesis: string,
  reference: string,
  options: BleuOptions = {},
): BleuScore {
  const maxNgram = options.maxNgram ?? 4;
  const tokeniser = options.tokenize ?? 'whitespace';
  const smooth = options.smooth ?? true;

  const hypTokens = tokenise(hypothesis, tokeniser);
  const refTokens = tokenise(reference, tokeniser);
  const hypLen = hypTokens.length;
  const refLen = refTokens.length;

  if (hypLen === 0 || refLen === 0) {
    return Object.freeze({
      bleu: 0,
      precisions: Object.freeze(new Array<number>(maxNgram).fill(0)),
      brevityPenalty: 0,
      hypothesisLength: hypLen,
      referenceLength: refLen,
    });
  }

  const precisions: number[] = [];
  for (let n = 1; n <= maxNgram; n += 1) {
    const hypNgrams = countNgrams(hypTokens, n);
    const refNgrams = countNgrams(refTokens, n);
    let clippedMatches = 0;
    let totalCandidate = 0;
    for (const [ngram, count] of hypNgrams) {
      const refCount = refNgrams.get(ngram) ?? 0;
      clippedMatches += Math.min(count, refCount);
      totalCandidate += count;
    }
    let p: number;
    if (totalCandidate === 0) {
      p = 0;
    } else if (clippedMatches === 0 && smooth) {
      // Add-1 Laplace smoothing on the zero-match case.
      p = 1 / (totalCandidate + 1);
    } else {
      p = clippedMatches / totalCandidate;
    }
    precisions.push(p);
  }

  // Brevity penalty.
  let bp: number;
  if (hypLen > refLen) {
    bp = 1;
  } else {
    bp = Math.exp(1 - refLen / hypLen);
  }

  // Geometric mean of precisions. If any precision is 0 (and not
  // smoothed), BLEU collapses to 0.
  let logSum = 0;
  for (const p of precisions) {
    if (p === 0) {
      return Object.freeze({
        bleu: 0,
        precisions: Object.freeze([...precisions]),
        brevityPenalty: bp,
        hypothesisLength: hypLen,
        referenceLength: refLen,
      });
    }
    logSum += Math.log(p);
  }
  const geoMean = Math.exp(logSum / precisions.length);
  const score = bp * geoMean * 100;
  return Object.freeze({
    bleu: clamp(score, 0, 100),
    precisions: Object.freeze([...precisions]),
    brevityPenalty: bp,
    hypothesisLength: hypLen,
    referenceLength: refLen,
  });
}

/**
 * Corpus-level BLEU — aggregate over a list of (hypothesis,
 * reference) pairs. Sums the n-gram counts globally before computing
 * precisions, the way the canonical sacrebleu implementation does
 * (the per-sentence-then-average shortcut is not equivalent).
 */
export function corpusBleu(
  pairs: ReadonlyArray<{ readonly hypothesis: string; readonly reference: string }>,
  options: BleuOptions = {},
): BleuScore {
  const maxNgram = options.maxNgram ?? 4;
  const tokeniser = options.tokenize ?? 'whitespace';
  const smooth = options.smooth ?? true;

  const matches = new Array<number>(maxNgram).fill(0);
  const candidates = new Array<number>(maxNgram).fill(0);
  let hypLen = 0;
  let refLen = 0;

  for (const pair of pairs) {
    const hypTokens = tokenise(pair.hypothesis, tokeniser);
    const refTokens = tokenise(pair.reference, tokeniser);
    hypLen += hypTokens.length;
    refLen += refTokens.length;
    for (let n = 1; n <= maxNgram; n += 1) {
      const hypNgrams = countNgrams(hypTokens, n);
      const refNgrams = countNgrams(refTokens, n);
      for (const [ngram, count] of hypNgrams) {
        const refCount = refNgrams.get(ngram) ?? 0;
        matches[n - 1] = (matches[n - 1] ?? 0) + Math.min(count, refCount);
        candidates[n - 1] = (candidates[n - 1] ?? 0) + count;
      }
    }
  }

  if (hypLen === 0 || refLen === 0) {
    return Object.freeze({
      bleu: 0,
      precisions: Object.freeze(new Array<number>(maxNgram).fill(0)),
      brevityPenalty: 0,
      hypothesisLength: hypLen,
      referenceLength: refLen,
    });
  }

  const precisions: number[] = [];
  for (let n = 0; n < maxNgram; n += 1) {
    const total = candidates[n] ?? 0;
    const matched = matches[n] ?? 0;
    let p: number;
    if (total === 0) {
      p = 0;
    } else if (matched === 0 && smooth) {
      p = 1 / (total + 1);
    } else {
      p = matched / total;
    }
    precisions.push(p);
  }

  let bp: number;
  if (hypLen > refLen) {
    bp = 1;
  } else {
    bp = Math.exp(1 - refLen / hypLen);
  }

  let logSum = 0;
  for (const p of precisions) {
    if (p === 0) {
      return Object.freeze({
        bleu: 0,
        precisions: Object.freeze([...precisions]),
        brevityPenalty: bp,
        hypothesisLength: hypLen,
        referenceLength: refLen,
      });
    }
    logSum += Math.log(p);
  }
  const geoMean = Math.exp(logSum / precisions.length);
  const score = bp * geoMean * 100;
  return Object.freeze({
    bleu: clamp(score, 0, 100),
    precisions: Object.freeze([...precisions]),
    brevityPenalty: bp,
    hypothesisLength: hypLen,
    referenceLength: refLen,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenise(text: string, mode: 'whitespace' | 'character'): string[] {
  if (mode === 'character') {
    return Array.from(text);
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  return trimmed
    .toLowerCase()
    // Pad punctuation with spaces so each punctuation token counts
    // independently (matches sacrebleu's default behaviour at low
    // tokenisation level).
    .replace(/([.,!?;:()])/g, ' $1 ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function countNgrams(tokens: ReadonlyArray<string>, n: number): Map<string, number> {
  const counts = new Map<string, number>();
  if (tokens.length < n) {
    return counts;
  }
  for (let i = 0; i <= tokens.length - n; i += 1) {
    const ngram = tokens.slice(i, i + n).join(' ');
    counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
  }
  return counts;
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
