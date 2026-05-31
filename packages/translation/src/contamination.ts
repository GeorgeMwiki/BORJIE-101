/**
 * Contamination guard — detect cross-language leak in translator
 * output (e.g. a Swahili reply that still contains English words, or
 * vice-versa).
 *
 * Heuristic only — uses script + a small lexicon of common stopwords.
 * The contamination check is the LAST line of defence after the
 * SOTA runner; it throws when the leak ratio exceeds the threshold
 * so the caller falls open to source text rather than ship a broken
 * mixed-language string to the user.
 *
 * NOT a substitute for chrF/BLEU evaluation — those run async via the
 * translation-runs table.
 */

import type { Locale } from './types.js';

/**
 * Common English-only function words. Kept short and uppercase-tolerant
 * via toLowerCase() before lookup. Words like "no" / "data" appear in
 * both languages, hence omitted.
 */
const EN_STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'with',
  'from',
  'this',
  'that',
  'have',
  'will',
  'your',
  'their',
  'about',
  'which',
  'these',
  'those',
  'would',
  'could',
  'should',
  'because',
  'while',
  'before',
  'after',
  'during',
  'between',
  'against',
  'through',
]);

/**
 * Common Swahili-only function words. Same selection criteria as the
 * English list.
 */
const SW_STOPWORDS: ReadonlySet<string> = new Set([
  'kwa',
  'ya',
  'wa',
  'na',
  'ni',
  'kwenye',
  'kutoka',
  'hii',
  'hiyo',
  'huu',
  'ile',
  'kabla',
  'baada',
  'wakati',
  'kupitia',
  'kati',
  'pamoja',
  'lakini',
  'hivyo',
  'ndio',
  'hapana',
  'ndani',
  'nje',
  'juu',
  'chini',
]);

export interface ContaminationCheckResult {
  readonly ok: boolean;
  readonly leakedTokens: ReadonlyArray<string>;
  readonly tokensChecked: number;
  readonly leakRatio: number;
}

const TOKEN_RE = /[a-zA-ZÀ-ɏ]+/g;

function tokenise(text: string): string[] {
  return (text.match(TOKEN_RE) ?? []).map((t) => t.toLowerCase());
}

export interface ContaminationCheckOptions {
  /** Above this ratio, leak counts as contamination. Defaults to 0.10. */
  readonly maxLeakRatio?: number;
}

/**
 * Returns `ok=false` when the translation contains too many words from
 * the SOURCE language. Pure heuristic — never throws by itself.
 */
export function checkContamination(
  output: string,
  targetLang: Locale,
  options?: ContaminationCheckOptions,
): ContaminationCheckResult {
  const maxLeakRatio = options?.maxLeakRatio ?? 0.10;
  const tokens = tokenise(output);
  if (tokens.length === 0) {
    return Object.freeze({
      ok: true,
      leakedTokens: [],
      tokensChecked: 0,
      leakRatio: 0,
    });
  }

  // Detect words from the OPPOSITE language inside the output.
  const wrongStopwords = targetLang === 'sw' ? EN_STOPWORDS : SW_STOPWORDS;

  const leaks: string[] = [];
  for (const t of tokens) {
    if (wrongStopwords.has(t)) {
      leaks.push(t);
    }
  }

  const leakRatio = leaks.length / tokens.length;
  return Object.freeze({
    ok: leakRatio <= maxLeakRatio,
    leakedTokens: leaks,
    tokensChecked: tokens.length,
    leakRatio,
  });
}

export class ContaminationError extends Error {
  readonly leakedTokens: ReadonlyArray<string>;
  readonly leakRatio: number;
  readonly targetLang: Locale;

  constructor(
    targetLang: Locale,
    result: ContaminationCheckResult,
  ) {
    super(
      `Contamination detected in ${targetLang} output: ${result.leakedTokens.length} leaked tokens (${(result.leakRatio * 100).toFixed(1)}%)`,
    );
    this.name = 'ContaminationError';
    this.leakedTokens = result.leakedTokens;
    this.leakRatio = result.leakRatio;
    this.targetLang = targetLang;
  }
}

/**
 * Throws ContaminationError if leak exceeds threshold.
 */
export function assertNoContamination(
  output: string,
  targetLang: Locale,
  options?: ContaminationCheckOptions,
): void {
  const result = checkContamination(output, targetLang, options);
  if (!result.ok) {
    throw new ContaminationError(targetLang, result);
  }
}
