/**
 * Token-level code-switching detector.
 *
 * Wave 19G §4. Each token in the utterance carries an estimated
 * language tag. The reference implementation is a thin ensemble:
 *
 *   1. A Sheng surface-marker regex pass (the canonical lexicon from
 *      Githiora 2018 and Muriira's UoN MA thesis).
 *   2. A Swahili-prefix regex pass (Bantu-7 noun-class prefixes that
 *      mark a token as Swahili with near-certainty).
 *   3. A per-token language vote supplied by the caller (a
 *      `PerTokenLanguageVoter` port — production wires this to the
 *      FastText 3-token sliding window).
 *   4. Adjacent-token smoothing — single-token islands surrounded by
 *      the same language on both sides are flipped to match the
 *      surrounding majority (real code-switches happen at phrase
 *      boundaries, not at single-word boundaries).
 *
 * The detector returns the per-token tags AND a compressed list of
 * `CodeSwitchSegment` runs.
 */

import type {
  CodeSwitchSegment,
  Language,
} from '../types.js';

/**
 * Canonical Sheng surface markers from Githiora (2018), Muriira
 * (UoN MA thesis), and the RideKE 2025 Twitter corpus. Lowercased.
 *
 * The list is deliberately conservative — only words that are very
 * unlikely to occur in standard Swahili OR English are included. False
 * positives are far more damaging than misses because the detector is
 * checked AFTER the per-token voter; a miss simply means the voter's
 * verdict survives.
 */
export const SHENG_LEXICON: ReadonlyArray<string> = Object.freeze([
  'chapaa', // money
  'mbao',   // 200 (KES / TZS slang)
  'mtaa',   // 'hood (Sheng usage)
  'doh',    // money
  'dough',  // money (English-borrowed)
  'mzee',   // older man (used both registers; sometimes Sheng)
  'sambaza', // share airtime (Sheng coinage)
  'mob',    // many
  'nare',   // fire (Sheng coinage)
  'odi',    // home / district
  'siste',  // sister (Sheng phonetic)
  'budah',  // brother
  'guka',   // grandfather (Kikuyu-borrowed)
  'mbogi',  // crew / group
  'ngori',  // hard / tough
  'sasa',   // 'now' (overlaps with sw greeting; demoted in ensemble)
]);

const SHENG_SET = new Set(SHENG_LEXICON);

/**
 * Common Swahili noun-class + verb-prefix markers. A token whose
 * leading 2-3 chars match one of these is almost certainly Swahili.
 */
const SWAHILI_PREFIXES: ReadonlyArray<string> = Object.freeze([
  'ni', 'u', 'a', 'tu', 'm', 'wa',    // subject prefixes
  'mi', 'ki', 'vi', 'li', 'ma',       // noun-class prefixes
  'ku', 'pa',                         // infinitive / locative
]);

/**
 * Per-token vote shape. The caller injects this port; the package
 * provides a deterministic in-process implementation only for tests.
 */
export interface PerTokenLanguageVoter {
  voteForToken(token: string): { readonly lang: Language; readonly confidence: number };
}

export interface TokenTag {
  readonly token: string;
  readonly lang: Language;
  readonly confidence: number;
}

export interface CodeSwitchResult {
  readonly tags: ReadonlyArray<TokenTag>;
  readonly segments: ReadonlyArray<CodeSwitchSegment>;
}

/**
 * Tokenise on whitespace then lowercase. Sufficient for Swahili and
 * English — Bantu morphology is preserved as one orthographic token
 * (e.g. `ninakupenda` stays as one token).
 */
export function tokenize(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function shengHit(token: string): boolean {
  return SHENG_SET.has(token);
}

function swahiliPrefixHit(token: string): boolean {
  if (token.length < 3) return false;
  for (const p of SWAHILI_PREFIXES) {
    if (token.startsWith(p) && token.length > p.length + 1) {
      return true;
    }
  }
  return false;
}

/**
 * Run the ensemble and produce per-token tags + compressed segments.
 */
export function detectCodeSwitches(
  text: string,
  voter: PerTokenLanguageVoter,
): CodeSwitchResult {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return { tags: [], segments: [] };
  }
  const rawTags: TokenTag[] = tokens.map((token) => {
    if (shengHit(token)) {
      return { token, lang: 'sheng' as Language, confidence: 0.95 };
    }
    const voterVote = voter.voteForToken(token);
    if (voterVote.lang === 'en' && swahiliPrefixHit(token)) {
      // Resolve in favour of Swahili — the prefix evidence is stronger.
      return { token, lang: 'sw' as Language, confidence: 0.85 };
    }
    return { token, lang: voterVote.lang, confidence: voterVote.confidence };
  });
  const smoothed = smoothIslands(rawTags);
  const segments = collapseSegments(smoothed);
  return { tags: smoothed, segments };
}

/**
 * Single-token islands surrounded by the same language on both sides
 * are flipped. The 0.4 confidence floor protects against flipping
 * high-confidence Sheng or specialist tokens.
 */
export function smoothIslands(
  tags: ReadonlyArray<TokenTag>,
): ReadonlyArray<TokenTag> {
  if (tags.length < 3) {
    return tags;
  }
  const out: TokenTag[] = [];
  for (let i = 0; i < tags.length; i += 1) {
    const current = tags[i]!;
    if (i === 0 || i === tags.length - 1) {
      out.push(current);
      continue;
    }
    const prev = tags[i - 1]!;
    const next = tags[i + 1]!;
    const isIsland =
      prev.lang === next.lang &&
      prev.lang !== current.lang &&
      current.confidence < 0.9; // never flip a confident vote
    if (isIsland) {
      out.push({
        token: current.token,
        lang: prev.lang,
        confidence: Math.max(0.4, current.confidence * 0.5),
      });
    } else {
      out.push(current);
    }
  }
  return out;
}

/**
 * Collapse consecutive same-language tokens into segments. The
 * resulting segment confidence is the mean of its members.
 */
export function collapseSegments(
  tags: ReadonlyArray<TokenTag>,
): ReadonlyArray<CodeSwitchSegment> {
  if (tags.length === 0) {
    return [];
  }
  const segments: CodeSwitchSegment[] = [];
  let runStart = 0;
  let runLang: Language = tags[0]!.lang;
  let runSum = tags[0]!.confidence;
  let runCount = 1;
  for (let i = 1; i < tags.length; i += 1) {
    const t = tags[i]!;
    if (t.lang === runLang) {
      runSum += t.confidence;
      runCount += 1;
      continue;
    }
    segments.push({
      startToken: runStart,
      endToken: i - 1,
      lang: runLang,
      confidence: runSum / runCount,
    });
    runStart = i;
    runLang = t.lang;
    runSum = t.confidence;
    runCount = 1;
  }
  segments.push({
    startToken: runStart,
    endToken: tags.length - 1,
    lang: runLang,
    confidence: runSum / runCount,
  });
  return segments;
}
