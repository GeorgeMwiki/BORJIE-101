/**
 * WER (Word Error Rate) scorer — pure function.
 *
 * Reference: jiwer library (https://github.com/jitsi/jiwer) — the
 * Levenshtein edit distance on a tokenised word stream after
 * normalisation, divided by the reference token count.
 *
 *   WER = (S + D + I) / N
 *
 * where S = substitutions, D = deletions, I = insertions, N = reference
 * length in tokens.
 *
 * Normalisation pass preserves Swahili noun-class prefixes — agglutinative
 * morphology means "tutakwenda" and "tu-ta-kwenda" must score identically.
 * The strategy is conservative — strip whitespace + lowercase + drop
 * punctuation, then collapse runs of inner-hyphens to a single hyphen.
 *
 * Live-test discipline: this is a pure function; no I/O, no LLM. The
 * scorer is fully deterministic and stable across calls.
 */

const PUNCT_RE = /[.,!?;:"'`()[\]{}<>«»„"–—…]/g;
const WHITESPACE_RE = /\s+/g;
const HYPHEN_RUN_RE = /-+/g;

export interface WerComputation {
  readonly wer: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  readonly referenceTokens: number;
  readonly hypothesisTokens: number;
}

export function normaliseForWer(text: string): ReadonlyArray<string> {
  if (typeof text !== 'string') {
    return Object.freeze([]);
  }
  const lowered = text.toLowerCase();
  const stripped = lowered
    .replace(PUNCT_RE, ' ')
    .replace(HYPHEN_RUN_RE, '-')
    .trim();
  if (stripped.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(
    stripped
      .split(WHITESPACE_RE)
      .map((tok) => tok.replace(/^-+|-+$/g, ''))
      .filter((tok) => tok.length > 0),
  );
}

/**
 * Word Error Rate. Returns a `WerComputation` carrying the rate plus the
 * substitution / deletion / insertion counts.
 *
 * Empty reference: returns `wer = 0` if hypothesis is also empty,
 * otherwise `wer = 1` (all-insertion). This matches the `jiwer`
 * convention.
 */
export function computeWer(
  reference: string,
  hypothesis: string,
): WerComputation {
  const refTokens = normaliseForWer(reference);
  const hypTokens = normaliseForWer(hypothesis);

  const m = refTokens.length;
  const n = hypTokens.length;

  if (m === 0) {
    return Object.freeze({
      wer: n === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: n,
      referenceTokens: 0,
      hypothesisTokens: n,
    });
  }

  // Levenshtein edit distance with op-tracking.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  const op: Array<Array<'s' | 'd' | 'i' | 'm'>> = Array.from(
    { length: m + 1 },
    () => new Array<'s' | 'd' | 'i' | 'm'>(n + 1).fill('m'),
  );

  for (let i = 0; i <= m; i++) {
    const row = dp[i];
    const opRow = op[i];
    if (!row || !opRow) {
      continue;
    }
    row[0] = i;
    opRow[0] = 'd';
  }
  for (let j = 0; j <= n; j++) {
    const row = dp[0];
    const opRow = op[0];
    if (!row || !opRow) {
      continue;
    }
    row[j] = j;
    opRow[j] = 'i';
  }
  const opZero = op[0];
  if (opZero) {
    opZero[0] = 'm';
  }

  for (let i = 1; i <= m; i++) {
    const rowI = dp[i];
    const rowIm1 = dp[i - 1];
    const opI = op[i];
    if (!rowI || !rowIm1 || !opI) {
      continue;
    }
    const refTok = refTokens[i - 1];
    for (let j = 1; j <= n; j++) {
      const hypTok = hypTokens[j - 1];
      const match = refTok === hypTok;
      const subCost = (rowIm1[j - 1] ?? 0) + (match ? 0 : 1);
      const delCost = (rowIm1[j] ?? 0) + 1;
      const insCost = (rowI[j - 1] ?? 0) + 1;
      let best = subCost;
      let opChoice: 's' | 'd' | 'i' | 'm' = match ? 'm' : 's';
      if (delCost < best) {
        best = delCost;
        opChoice = 'd';
      }
      if (insCost < best) {
        best = insCost;
        opChoice = 'i';
      }
      rowI[j] = best;
      opI[j] = opChoice;
    }
  }

  // Backtrace.
  let i = m;
  let j = n;
  let s = 0;
  let d = 0;
  let ins = 0;
  while (i > 0 || j > 0) {
    const opRow = op[i];
    if (!opRow) {
      break;
    }
    const choice = i === 0 ? 'i' : j === 0 ? 'd' : opRow[j];
    if (choice === 'm') {
      i--;
      j--;
    } else if (choice === 's') {
      s++;
      i--;
      j--;
    } else if (choice === 'd') {
      d++;
      i--;
    } else if (choice === 'i') {
      ins++;
      j--;
    } else {
      break;
    }
  }

  const wer = (s + d + ins) / m;
  return Object.freeze({
    wer,
    substitutions: s,
    deletions: d,
    insertions: ins,
    referenceTokens: m,
    hypothesisTokens: n,
  });
}

/**
 * Convenience: returns just the WER float, clamped to `[0, 1]`. A WER
 * above 1.0 (more insertions than reference tokens) is clipped to 1.0
 * — the scoring envelope assumes `[0, 1]`.
 */
export function scoreWer(reference: string, hypothesis: string): number {
  const { wer } = computeWer(reference, hypothesis);
  return Math.max(0, Math.min(1, wer));
}
