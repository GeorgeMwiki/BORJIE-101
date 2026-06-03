/**
 * Contamination guard — detect cross-language leak in translator
 * output (e.g. a Swahili reply that still contains English words, or
 * vice-versa).
 *
 * Heuristic only, but a STRONG heuristic: the zero-mix mandate (LP-23)
 * means a single content-word leak ("AI Credit biashara Officer" in an
 * English reply) must be caught, not just the handful of function words
 * the previous lexicon covered. We therefore combine three signals:
 *
 *   1. A function-word lexicon per language (fast, high precision).
 *   2. A content-word lexicon of common Swahili nouns/verbs/adjectives
 *      that a mining estate writes (biashara, leseni, mrabaha, mgodi ...)
 *      so a lone borrowed noun is flagged.
 *   3. Swahili morphology signals - Bantu noun-class / subject /
 *      verb-tense prefixes plus characteristic vowel-final orthography
 *      and Swahili-only digraphs - so an UNLISTED Swahili token is still
 *      recognised as Swahili by shape, not by dictionary membership.
 *
 * Why not reuse `@borjie/language-sota`? Its detectors
 * (`detectLanguage`, `detectCodeSwitches`) are abstract: every concrete
 * verdict comes from an INJECTED port (`DetectorPort` /
 * `PerTokenLanguageVoter`, wired to FastText in production). There is no
 * dependency-free, self-contained per-token detector to import, and this
 * guard must run synchronously and purely as the LAST line of defence.
 * We therefore reuse the morphology IDEA from its codeswitch detector
 * (the Swahili noun-class prefix set) inside this leaf, with no new
 * dependency.
 *
 * The contamination check is the LAST line of defence after the SOTA
 * runner. It NEVER throws by itself; `assertNoContamination` /
 * `ContaminationError` wrap it for callers that want a hard error.
 *
 * NOT a substitute for chrF/BLEU evaluation - those run async via the
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
 * Common English CONTENT words (nouns / verbs / adjectives) that a
 * mining-estate reply uses. Catches a lone English token inside an
 * otherwise-Swahili string even when no English function word leaked.
 * Deliberately excludes tokens that are also valid Swahili.
 */
const EN_CONTENT_WORDS: ReadonlySet<string> = new Set([
  'account',
  'credit',
  'officer',
  'licence',
  'license',
  'royalty',
  'payment',
  'balance',
  'welcome',
  'ready',
  'mine',
  'mining',
  'owner',
  'manager',
  'employee',
  'buyer',
  'seller',
  'gold',
  'mineral',
  'report',
  'today',
  'tomorrow',
  'yesterday',
  'available',
  'created',
  'updated',
  'pending',
  'approved',
  'rejected',
  'please',
  'thanks',
  'thank',
  'hello',
  'project',
  'yours',
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
  'za',
  'la',
  'cha',
  'vya',
  'kwamba',
  'yako',
  'wako',
  'zako',
  'yake',
  'wake',
]);

/**
 * Common Swahili CONTENT words (nouns / verbs / adjectives) a mining
 * estate writes. The "AI Credit biashara Officer" leak example is
 * caught here via `biashara`. Excludes tokens that are also valid
 * English.
 */
const SW_CONTENT_WORDS: ReadonlySet<string> = new Set([
  'biashara',
  'leseni',
  'mrabaha',
  'mgodi',
  'migodi',
  'akaunti',
  'malipo',
  'salio',
  'karibu',
  'habari',
  'asante',
  'tafadhali',
  'mwenye',
  'meneja',
  'mfanyakazi',
  'mnunuzi',
  'muuzaji',
  'dhahabu',
  'madini',
  'taarifa',
  'ripoti',
  'leo',
  'kesho',
  'jana',
  'tayari',
  'mwaka',
  'mwezi',
  'siku',
  'fedha',
  'pesa',
  'mradi',
]);

/**
 * Swahili Bantu prefixes - noun-class, subject, and verb-tense markers.
 * A token that starts with one of these AND is long enough to carry a
 * stem is very likely Swahili. Mirrors the noun-class prefix idea from
 * `@borjie/language-sota` codeswitch-detector, kept local to avoid a
 * cross-package dependency.
 */
const SW_PREFIXES: ReadonlyArray<string> = Object.freeze([
  'mw',
  'wa',
  'ki',
  'vi',
  'ji',
  'ma',
  'mi',
  'ku',
  'wana',
  'nina',
  'tuna',
  'una',
  'ana',
  'mna',
  'hawa',
  'amba',
]);

/**
 * Swahili-characteristic opening digraphs that almost never begin an
 * English word. The velar-nasal `ng` and prenasalised `mb/nd/nj` plus
 * `ny`/`dh` are strong Swahili shape signals.
 */
const SW_DIGRAPHS: ReadonlyArray<string> = Object.freeze([
  'ng',
  'mb',
  'nd',
  'nj',
  'ny',
  'dh',
]);

const VOWELS: ReadonlySet<string> = new Set(['a', 'e', 'i', 'o', 'u']);

export interface ContaminationCheckResult {
  readonly ok: boolean;
  readonly leakedTokens: ReadonlyArray<string>;
  readonly tokensChecked: number;
  readonly leakRatio: number;
  /**
   * True when at least one token was unambiguously identified as the
   * WRONG language (function word, content word, or strong morphology).
   * Callers that need zero-mix treat ANY hard leak as fatal regardless
   * of ratio.
   */
  readonly hasHardLeak: boolean;
}

// Keep an interior apostrophe inside a token so English contractions and
// the Swahili `ng'` velar nasal survive tokenisation; strip it for the
// length guard so a bare apostrophe is not a token.
const TOKEN_RE = /[A-Za-zÀ-ɏ']+/g;

function tokenise(text: string): string[] {
  return (text.match(TOKEN_RE) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.replace(/'/g, '').length > 0);
}

/**
 * Strong Swahili-shape signal for an UNLISTED token: a Bantu prefix on a
 * vowel-final stem, or a Swahili-only opening digraph on a vowel-final
 * word. Vowel-final is the dominant Swahili orthographic pattern; most
 * English content words end in a consonant. Conservative on purpose -
 * the listed lexicons carry the common cases, this only adds reach.
 */
function looksSwahili(token: string): boolean {
  const t = token.replace(/'/g, '');
  if (t.length < 4) return false;
  const last = t[t.length - 1] ?? '';
  if (!VOWELS.has(last)) return false;
  for (const d of SW_DIGRAPHS) {
    if (t.startsWith(d)) return true;
  }
  for (const p of SW_PREFIXES) {
    if (t.startsWith(p) && t.length >= p.length + 2) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a single token. Returns the language we are CONFIDENT it
 * belongs to, or `null` when the token is ambiguous / shared (numbers,
 * preserved acronyms, loanwords). Only confident verdicts count toward
 * a leak so shared tokens never trip the guard.
 */
function classifyToken(token: string): Locale | null {
  if (EN_STOPWORDS.has(token) || EN_CONTENT_WORDS.has(token)) return 'en';
  if (
    SW_STOPWORDS.has(token) ||
    SW_CONTENT_WORDS.has(token) ||
    looksSwahili(token)
  ) {
    return 'sw';
  }
  return null;
}

export interface ContaminationCheckOptions {
  /** Above this ratio, leak counts as contamination. Defaults to 0.10. */
  readonly maxLeakRatio?: number;
  /**
   * When true (default), ANY single confidently-wrong-language token
   * fails the check regardless of ratio - the zero-mix guarantee. Set
   * false only on surfaces that explicitly tolerate borrowed loanwords.
   */
  readonly failOnHardLeak?: boolean;
}

/**
 * Returns `ok=false` when the translation contains words from the SOURCE
 * (wrong) language. Pure heuristic - never throws by itself.
 *
 * A token is a leak when `classifyToken` is CONFIDENT it belongs to the
 * opposite language. By default a single hard leak fails the check
 * (zero-mix); the ratio threshold remains for callers that opt out of
 * hard-leak failure.
 */
export function checkContamination(
  output: string,
  targetLang: Locale,
  options?: ContaminationCheckOptions,
): ContaminationCheckResult {
  const maxLeakRatio = options?.maxLeakRatio ?? 0.1;
  const failOnHardLeak = options?.failOnHardLeak ?? true;
  const tokens = tokenise(output);
  if (tokens.length === 0) {
    return Object.freeze({
      ok: true,
      leakedTokens: [],
      tokensChecked: 0,
      leakRatio: 0,
      hasHardLeak: false,
    });
  }

  const wrongLang: Locale = targetLang === 'sw' ? 'en' : 'sw';

  const leaks: string[] = [];
  for (const t of tokens) {
    if (classifyToken(t) === wrongLang) {
      leaks.push(t);
    }
  }

  const leakRatio = leaks.length / tokens.length;
  const hasHardLeak = leaks.length > 0;
  const ok = failOnHardLeak ? leaks.length === 0 : leakRatio <= maxLeakRatio;

  return Object.freeze({
    ok,
    leakedTokens: leaks,
    tokensChecked: tokens.length,
    leakRatio,
    hasHardLeak,
  });
}

/**
 * Off-target ratio for the dynamic rewriter (LP-23). Returns the bare
 * ratio in [0,1] so the rewriter can decide whether to fire a live AI
 * rewrite. 0 means the text carries no confidently-wrong-language token.
 *
 * Pure - never throws. Mirrors the LITFIN `offTargetRatio` contract
 * (src/core/language-intelligence/dynamic-language-rewriter.ts) but
 * reuses Borjie's own detector instead of a separate engine. Note: the
 * rewriter ALSO inspects `hasHardLeak` (see `hasOffTargetLeak`) so a
 * single content-word leak fires a rewrite even though its ratio is tiny.
 */
export function offTargetRatio(
  text: string,
  targetLang: Locale,
  options?: ContaminationCheckOptions,
): number {
  return checkContamination(text, targetLang, options).leakRatio;
}

/**
 * True when the text carries at least one confidently-wrong-language
 * token. The rewriter uses this (not just the ratio) so a lone leaked
 * content word - whose ratio rounds toward zero - still triggers repair.
 */
export function hasOffTargetLeak(
  text: string,
  targetLang: Locale,
  options?: ContaminationCheckOptions,
): boolean {
  return checkContamination(text, targetLang, options).hasHardLeak;
}

export class ContaminationError extends Error {
  readonly leakedTokens: ReadonlyArray<string>;
  readonly leakRatio: number;
  readonly targetLang: Locale;

  constructor(targetLang: Locale, result: ContaminationCheckResult) {
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
 * Throws ContaminationError if the output leaks the wrong language.
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
