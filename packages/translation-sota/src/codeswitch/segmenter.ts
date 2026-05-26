/**
 * Code-switch segmenter.
 *
 * Pure function. Walks the source text token-by-token and tags each
 * token with one of `{src, tgt, brand, proper, number, placeholder}`.
 *
 * Feature set borrowed from the 2016 ACL paper "Word-Level Language
 * Identification and Predicting Codeswitching Points in Swahili-
 * English Language Data" (https://aclanthology.org/W16-5803/) — a
 * simple combination of character n-gram, prefix, suffix, letter
 * case, and special-character features is sufficient at high accuracy
 * on Swahili-English code-switched text.
 *
 * Sheng inflections + proper nouns + brand tokens (Tumemadini, PML,
 * NEMC, USD) must NOT enter the translator. The runner uses the
 * `src`-tagged segments only.
 */

import type {
  CodeSwitchSegment,
  CodeSwitchTag,
  Glossary,
  LanguageCode,
} from '../types.js';
import { TRANSLATION_CONSTANTS } from '../types.js';

/**
 * Tokenise the source text into tagged code-switch segments.
 *
 * @param sourceText           text to segment.
 * @param sourceLang           caller-asserted source language. Tokens
 *                             matching this language get the `src` tag
 *                             and are sent to the translator.
 * @param targetLang           caller-asserted target language. Tokens
 *                             matching this language get the `tgt` tag
 *                             and pass through verbatim.
 * @param glossary             merged glossary used to recognise brand
 *                             terms (entries with `brand: true`).
 */
export function segmentCodeSwitch(
  sourceText: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  glossary: Glossary,
): ReadonlyArray<CodeSwitchSegment> {
  const segments: CodeSwitchSegment[] = [];
  const brandSet = brandLookup(glossary);
  const placeholderRegex = new RegExp(
    TRANSLATION_CONSTANTS.PLACEHOLDER_REGEX.source,
    'g',
  );

  // First, find placeholders and reserve their offsets so we don't
  // re-tag them as something else.
  const placeholderRanges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = placeholderRegex.exec(sourceText)) !== null) {
    placeholderRanges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
    segments.push(
      Object.freeze({
        text: match[0],
        tag: 'placeholder' as CodeSwitchTag,
        startByte: match.index,
        endByte: match.index + match[0].length,
      }),
    );
  }

  // Tokenise the remaining non-placeholder spans. We split on
  // whitespace AND punctuation so a token like `PML.` yields just
  // `PML` (the trailing period is dropped and not classified).
  // Internal punctuation (hyphens, apostrophes) stays via the
  // negative class.
  const tokenRegex = /[\p{L}\p{N}][\p{L}\p{N}\-'_]*/gu;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(sourceText)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (overlapsPlaceholder(start, end, placeholderRanges)) {
      continue;
    }
    const token = m[0];
    const tag = classifyToken(token, sourceLang, targetLang, brandSet, start);
    segments.push(
      Object.freeze({
        text: token,
        tag,
        startByte: start,
        endByte: end,
      }),
    );
  }

  segments.sort((a, b) => a.startByte - b.startByte);
  return Object.freeze(segments);
}

/**
 * Recombine segments by replacing each `src`-tagged span with its
 * translated equivalent (looked up from the provided `srcToTarget`
 * map). Non-`src` segments are preserved verbatim at their original
 * offsets.
 *
 * This is the inverse of the segmenter; the runner uses it to splice
 * the translated `src` spans back into the original frame so brand
 * tokens, numbers, and proper nouns survive verbatim.
 *
 * Note: today's tier-1 / tier-2 providers handle the full source
 * frame in-context, so the runner does not currently call this for
 * the final output (it instead lets the provider translate the
 * placeholder-laced source as a whole). This helper exists for
 * future use by tier-3 / segment-by-segment providers and for
 * test-fixture verification.
 */
export function recombineSegments(
  source: string,
  segments: ReadonlyArray<CodeSwitchSegment>,
  srcToTarget: ReadonlyMap<string, string>,
): string {
  let cursor = 0;
  let out = '';
  for (const seg of segments) {
    out += source.slice(cursor, seg.startByte);
    if (seg.tag === 'src') {
      const translated = srcToTarget.get(seg.text);
      out += translated !== undefined ? translated : seg.text;
    } else {
      out += seg.text;
    }
    cursor = seg.endByte;
  }
  out += source.slice(cursor);
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function brandLookup(glossary: Glossary): ReadonlySet<string> {
  const set = new Set<string>();
  for (const entry of glossary.entries) {
    if (entry.brand === true) {
      set.add(entry.srcTerm.toLowerCase());
      set.add(entry.targetTerm.toLowerCase());
    }
  }
  return set as ReadonlySet<string>;
}

function overlapsPlaceholder(
  start: number,
  end: number,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  for (const range of ranges) {
    if (start < range.end && end > range.start) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a single token. Order of precedence:
 *
 *   1. Brand / capability term (from glossary `brand: true`).
 *   2. Number-with-unit or pure number.
 *   3. Proper noun (Capitalised AND not at sentence start AND not a
 *      known stopword).
 *   4. Letter-case + script heuristic:
 *      - Pure ASCII + no Swahili-specific suffix → `tgt` if
 *        targetLang = en, else `src`.
 *      - Token containing characters outside ASCII alpha or matching
 *        a Swahili agglutination prefix → opposite.
 */
function classifyToken(
  token: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  brandSet: ReadonlySet<string>,
  offset: number,
): CodeSwitchTag {
  const lower = token.toLowerCase();
  if (brandSet.has(lower)) {
    return 'brand';
  }
  if (isNumberToken(token)) {
    return 'number';
  }
  if (isProperNoun(token, offset)) {
    return 'proper';
  }
  const detected = detectLanguage(token);
  if (detected === 'en' && targetLang === 'en') {
    return 'tgt';
  }
  if (detected === 'sw' && targetLang === 'sw') {
    return 'tgt';
  }
  if (detected === sourceLang) {
    return 'src';
  }
  // Ambiguous → assume source so it goes through the translator
  // (better to risk translating a borderline token than to drop it).
  return 'src';
}

function isNumberToken(token: string): boolean {
  return /^[\p{N}][\p{N}.,_/-]*$/u.test(token);
}

/**
 * Proper-noun heuristic: capitalised + not at byte offset 0 + at
 * least two characters. Tanzanian proper nouns include place names
 * like "Geita", "Mara", "Mwanza" plus brand-like institutional names
 * (which mostly come through the brandSet path already).
 */
function isProperNoun(token: string, offset: number): boolean {
  if (token.length < 2) {
    return false;
  }
  const first = token.charAt(0);
  if (first !== first.toUpperCase()) {
    return false;
  }
  if (first === first.toLowerCase()) {
    return false;
  }
  return offset > 0;
}

/**
 * Heuristic language detector for Swahili vs English tokens. Pure
 * feature-based, no model — keeps the segmenter hermetic.
 *
 * - English prefixes (the, of, with, when, …) and short Latin function
 *   words.
 * - Swahili prefixes (tu-, ni-, ku-, wa-, m-, ki-, vi-, …) common to
 *   agglutinated verbs and noun-class concord.
 */
function detectLanguage(token: string): LanguageCode {
  const lower = token.toLowerCase();
  if (SWAHILI_FUNCTION_WORDS.has(lower)) {
    return 'sw';
  }
  if (ENGLISH_FUNCTION_WORDS.has(lower)) {
    return 'en';
  }
  // Swahili noun-class / verb prefixes.
  if (/^(tu|ni|ku|wa|m|ki|vi|ji|li|ma|n)[a-z]/.test(lower)) {
    return 'sw';
  }
  // English-typical -tion / -ment / -ing suffixes.
  if (/(tion|ment|ing|ness|ity)$/.test(lower)) {
    return 'en';
  }
  // Pure ASCII alpha → lean English in our config (mining brand
  // tokens already went through brandSet).
  if (/^[a-z]+$/.test(lower)) {
    return 'en';
  }
  return 'sw';
}

const SWAHILI_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'na',
  'ya',
  'wa',
  'kwa',
  'la',
  'cha',
  'pa',
  'ku',
  'mwa',
  'ni',
  'ndiyo',
  'hapana',
  'sasa',
  'leo',
  'jana',
  'kesho',
  'ndugu',
  'parseli',
  'kuhusu',
  'imefika',
  'kwenye',
  'naomba',
  'ushauri',
  'shaka',
  'mia',
  'tisa',
  'themanini',
  'elfu',
  'hamsini',
  'gramu',
  'mita',
]);

const ENGLISH_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'the',
  'of',
  'and',
  'a',
  'an',
  'to',
  'in',
  'is',
  'it',
  'you',
  'that',
  'he',
  'was',
  'for',
  'on',
  'are',
  'with',
  'as',
  'his',
  'they',
  'at',
  'be',
  'this',
  'have',
  'from',
  'or',
  'one',
  'had',
  'by',
  'word',
  'but',
  'not',
  'what',
  'all',
  'were',
  'we',
  'when',
  'your',
  'can',
  'said',
  'there',
  'use',
  'each',
  'which',
  'she',
  'do',
  'how',
  'their',
  'if',
  'will',
  'about',
  'out',
  'many',
  'then',
  'them',
  'so',
  'some',
  'her',
  'would',
  'make',
  'like',
  'him',
  'into',
  'has',
  'two',
  'more',
  'go',
  'no',
  'way',
  'could',
  'my',
  'than',
  'first',
  'been',
  'call',
  'who',
  'oil',
  'its',
  'now',
  'find',
  'long',
  'down',
  'day',
  'did',
  'get',
  'come',
  'made',
  'may',
  'part',
  'i',
]);
