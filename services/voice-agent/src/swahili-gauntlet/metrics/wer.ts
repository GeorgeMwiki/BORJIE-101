/**
 * Word Error Rate (WER) for the Swahili gauntlet.
 *
 * Implementation: classic Levenshtein edit distance over normalised token
 * sequences, divided by the reference token count. Returns a number in
 * [0, ∞) — values > 1 mean the hypothesis has more insertions than the
 * reference has tokens, which is a real STT failure mode for low-resource
 * languages (the model hallucinates extra tokens).
 *
 * Normalisation pass:
 *   1. Lowercase (Unicode-aware).
 *   2. Strip leading/trailing whitespace.
 *   3. Drop punctuation except apostrophes inside words (e.g. "n'enda").
 *   4. Collapse runs of whitespace to a single space.
 *   5. Re-join hyphenated agglutinated tokens — "tu-ta-kwenda" → "tutakwenda"
 *      — so Swahili morpheme-segmentation differences don't penalise the
 *      hypothesis.
 *
 * Pure function — same input always produces the same output. Safe to call
 * from the runner inside a tight loop.
 */

const PUNCTUATION_RE = /[.,!?;:"()\[\]{}<>]/gu;
const HYPHEN_SEGMENTATION_RE = /(\p{L})-(\p{L})/gu;
const WHITESPACE_RE = /\s+/gu;

export interface WerResult {
  readonly wer: number;
  readonly substitutions: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly referenceLength: number;
  readonly hypothesisLength: number;
}

/**
 * Normalise a transcript prior to scoring. Public so the runner can log
 * normalised forms for human review.
 */
export function normaliseTranscript(text: string): string {
  if (text.length === 0) return '';
  const lower = text.toLowerCase();
  const dehyphenated = lower.replace(HYPHEN_SEGMENTATION_RE, '$1$2');
  const depunctuated = dehyphenated.replace(PUNCTUATION_RE, ' ');
  const collapsed = depunctuated.replace(WHITESPACE_RE, ' ').trim();
  return collapsed;
}

/** Tokenise a normalised transcript into a flat list of words. */
export function tokenise(normalised: string): ReadonlyArray<string> {
  if (normalised.length === 0) return [];
  return normalised.split(' ');
}

/**
 * Compute WER between a reference and a hypothesis transcript.
 *
 * Empty reference is a degenerate case: WER is 0 if hypothesis is also empty,
 * otherwise the function reports the hypothesis length as pure insertions
 * with WER = hypothesis_length / 1 (denominator floored at 1 to avoid /0).
 */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const refTokens = tokenise(normaliseTranscript(reference));
  const hypTokens = tokenise(normaliseTranscript(hypothesis));

  const m = refTokens.length;
  const n = hypTokens.length;

  // Standard edit-distance DP with three counters tracked separately so we
  // can report sub / ins / del breakdown. The tracking matrix mirrors `dp`.
  // dp[i][j] = best edit distance from ref[..i] to hyp[..j]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  // op[i][j] in {'s','i','d','='} — recorded so we can count operation types.
  const op: string[][] = Array.from({ length: m + 1 }, () => new Array<string>(n + 1).fill('='));

  for (let i = 0; i <= m; i++) {
    dp[i]![0] = i;
    op[i]![0] = 'd';
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j;
    op[0]![j] = 'i';
  }
  op[0]![0] = '=';

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const refTok = refTokens[i - 1];
      const hypTok = hypTokens[j - 1];
      if (refTok === hypTok) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
        op[i]![j] = '=';
        continue;
      }
      const sub = dp[i - 1]![j - 1]! + 1;
      const ins = dp[i]![j - 1]! + 1;
      const del = dp[i - 1]![j]! + 1;
      const best = Math.min(sub, ins, del);
      dp[i]![j] = best;
      op[i]![j] = best === sub ? 's' : best === ins ? 'i' : 'd';
    }
  }

  // Walk the chosen path to tally op types.
  let i = m;
  let j = n;
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  while (i > 0 || j > 0) {
    const o = op[i]![j];
    if (o === '=') {
      i--;
      j--;
    } else if (o === 's') {
      substitutions++;
      i--;
      j--;
    } else if (o === 'i') {
      insertions++;
      j--;
    } else {
      deletions++;
      i--;
    }
  }

  const denominator = m === 0 ? 1 : m;
  const wer = (substitutions + insertions + deletions) / denominator;
  return {
    wer,
    substitutions,
    insertions,
    deletions,
    referenceLength: m,
    hypothesisLength: n,
  };
}

/** Threshold guard used by the runner; spec §3 sets 8 % aggregate. */
export const WER_AGGREGATE_TARGET = 0.08;
export const WER_PER_UTTERANCE_TARGET = 0.12;
