/**
 * Noun-class detector (Wave 19H).
 *
 * Given a Swahili noun surface form, identify its Bantu noun class
 * (1..18) and derive the plural-class pairing. The detector is
 * conservative: when ambiguous, we return the lower-confidence
 * candidate plus a confidence score < 1.
 *
 * Sources cited for the class inventory and the class-prefix table:
 *   - "Swahili grammar" — Wikipedia
 *     https://en.wikipedia.org/wiki/Swahili_grammar (accessed 2026-05-26)
 *   - "Noun classification in Swahili" — UVA Kamusi Project
 *     https://www2.iath.virginia.edu/swahili/sect2.html (accessed 2026-05-26)
 *   - Appendix:Swahili noun classes — Wiktionary
 *     https://en.wiktionary.org/wiki/Appendix:Swahili_noun_classes (accessed 2026-05-26)
 */

import type { NounAnalysis, NounClass } from '../types.js';
import { SwahiliLinguisticsError } from '../types.js';

/**
 * Class-prefix table. Order matters: the detector tries longest /
 * most-specific prefixes first. Wherever a class admits multiple
 * surface allomorphs (e.g. m-/mw-/mu- for class 1+3), all listed.
 */
interface ClassPrefixRule {
  readonly prefixes: ReadonlyArray<string>;
  readonly cls: NounClass;
  readonly pluralCls: NounClass | null;
  /** Soft hint: if true, treat the noun as animate (drives concord). */
  readonly typicallyAnimate: boolean;
}

const CLASS_PREFIX_RULES: ReadonlyArray<ClassPrefixRule> = Object.freeze([
  // Class 1 — human singular (m-, mw-, mu-)
  { prefixes: ['mwana', 'mwa'], cls: 1, pluralCls: 2, typicallyAnimate: true },
  { prefixes: ['mw'], cls: 1, pluralCls: 2, typicallyAnimate: true },
  { prefixes: ['mu'], cls: 1, pluralCls: 2, typicallyAnimate: true },
  // Class 2 — human plural (wa-)
  { prefixes: ['wa'], cls: 2, pluralCls: null, typicallyAnimate: true },
  // Class 4 — tree/object plural (mi-)
  { prefixes: ['mi'], cls: 4, pluralCls: null, typicallyAnimate: false },
  // Class 6 — ma- plural / liquids
  { prefixes: ['ma'], cls: 6, pluralCls: null, typicallyAnimate: false },
  // Class 8 — vi-/vy- plural
  { prefixes: ['vy'], cls: 8, pluralCls: null, typicallyAnimate: false },
  { prefixes: ['vi'], cls: 8, pluralCls: null, typicallyAnimate: false },
  // Class 7 — ki-/ch- singular
  { prefixes: ['ch'], cls: 7, pluralCls: 8, typicallyAnimate: false },
  { prefixes: ['ki'], cls: 7, pluralCls: 8, typicallyAnimate: false },
  // Class 15 — ku- infinitive / verbal noun
  { prefixes: ['ku'], cls: 15, pluralCls: null, typicallyAnimate: false },
  // Class 11 / 14 — u- (abstract / mass)
  { prefixes: ['u'], cls: 11, pluralCls: null, typicallyAnimate: false },
  // Class 3 — tree/object singular (m-, mw-, mu-)
  { prefixes: ['m'], cls: 3, pluralCls: 4, typicallyAnimate: false },
  // Location classes — pa-/ku-/mu- (less common as bare nominal prefixes)
  { prefixes: ['pa'], cls: 16, pluralCls: null, typicallyAnimate: false },
]);

/**
 * Override list — common nouns that don't match the rule heuristic.
 * Each entry pins (term, lemma, class, plural class, animate).
 */
const OVERRIDES: ReadonlyMap<
  string,
  { lemma: string; cls: NounClass; pluralCls: NounClass | null; animate: boolean }
> = new Map([
  // Class 1/2 animate
  ['mtu', { lemma: 'mtu', cls: 1 as NounClass, pluralCls: 2 as NounClass, animate: true }],
  ['watu', { lemma: 'mtu', cls: 2 as NounClass, pluralCls: null, animate: true }],
  ['mchimbaji', { lemma: 'mchimbaji', cls: 1 as NounClass, pluralCls: 2 as NounClass, animate: true }],
  ['wachimbaji', { lemma: 'mchimbaji', cls: 2 as NounClass, pluralCls: null, animate: true }],
  ['mtoto', { lemma: 'mtoto', cls: 1 as NounClass, pluralCls: 2 as NounClass, animate: true }],
  ['watoto', { lemma: 'mtoto', cls: 2 as NounClass, pluralCls: null, animate: true }],
  ['kiongozi', { lemma: 'kiongozi', cls: 7 as NounClass, pluralCls: 8 as NounClass, animate: true }],
  ['viongozi', { lemma: 'kiongozi', cls: 8 as NounClass, pluralCls: null, animate: true }],
  // Class 3/4 (trees, objects with m-/mi- prefix)
  ['mgodi', { lemma: 'mgodi', cls: 3 as NounClass, pluralCls: 4 as NounClass, animate: false }],
  ['migodi', { lemma: 'mgodi', cls: 4 as NounClass, pluralCls: null, animate: false }],
  ['mti', { lemma: 'mti', cls: 3 as NounClass, pluralCls: 4 as NounClass, animate: false }],
  ['miti', { lemma: 'mti', cls: 4 as NounClass, pluralCls: null, animate: false }],
  // Class 5/6 (ji-/Ø-/l- → ma-)
  ['jiwe', { lemma: 'jiwe', cls: 5 as NounClass, pluralCls: 6 as NounClass, animate: false }],
  ['mawe', { lemma: 'jiwe', cls: 6 as NounClass, pluralCls: null, animate: false }],
  ['leseni', { lemma: 'leseni', cls: 5 as NounClass, pluralCls: 6 as NounClass, animate: false }],
  ['jambo', { lemma: 'jambo', cls: 5 as NounClass, pluralCls: 6 as NounClass, animate: false }],
  ['mambo', { lemma: 'jambo', cls: 6 as NounClass, pluralCls: null, animate: false }],
  ['jino', { lemma: 'jino', cls: 5 as NounClass, pluralCls: 6 as NounClass, animate: false }],
  ['meno', { lemma: 'jino', cls: 6 as NounClass, pluralCls: null, animate: false }],
  // Class 7/8
  ['kitabu', { lemma: 'kitabu', cls: 7 as NounClass, pluralCls: 8 as NounClass, animate: false }],
  ['vitabu', { lemma: 'kitabu', cls: 8 as NounClass, pluralCls: null, animate: false }],
  ['kibali', { lemma: 'kibali', cls: 7 as NounClass, pluralCls: 8 as NounClass, animate: false }],
  ['vibali', { lemma: 'kibali', cls: 8 as NounClass, pluralCls: null, animate: false }],
  ['kitu', { lemma: 'kitu', cls: 7 as NounClass, pluralCls: 8 as NounClass, animate: false }],
  ['vitu', { lemma: 'kitu', cls: 8 as NounClass, pluralCls: null, animate: false }],
  // Class 9/10 (N-/Ø-, often invariant in singular/plural)
  ['ndizi', { lemma: 'ndizi', cls: 9 as NounClass, pluralCls: 10 as NounClass, animate: false }],
  ['nyumba', { lemma: 'nyumba', cls: 9 as NounClass, pluralCls: 10 as NounClass, animate: false }],
  ['dhahabu', { lemma: 'dhahabu', cls: 9 as NounClass, pluralCls: null, animate: false }],
  ['almasi', { lemma: 'almasi', cls: 9 as NounClass, pluralCls: 10 as NounClass, animate: false }],
  // Class 11 (u-) / 14 abstract
  ['uchimbaji', { lemma: 'uchimbaji', cls: 11 as NounClass, pluralCls: null, animate: false }],
  ['utajiri', { lemma: 'utajiri', cls: 14 as NounClass, pluralCls: null, animate: false }],
  // Class 15 (ku- infinitive)
  ['kuchimba', { lemma: 'kuchimba', cls: 15 as NounClass, pluralCls: null, animate: false }],
  // Class 16 (pa- locative)
  ['mahali', { lemma: 'mahali', cls: 16 as NounClass, pluralCls: null, animate: false }],
]);

/**
 * Animacy hint — common surface forms that denote humans / animals.
 */
const ANIMATE_STEMS: ReadonlySet<string> = new Set([
  'tu', 'toto', 'zee', 'ke', 'naume', 'chimbaji', 'fanyakazi',
  'fundi', 'kuu', 'eni', 'asaa', 'enzi', 'kongwe', 'wenyeji',
  'ongozi', 'eli', 'eshimiwa', 'akilishi',
]);

/**
 * Derive plural-class given a singular class. Reflects the canonical
 * Bantu pairing rules from Wikipedia "Swahili grammar".
 */
export function derivePluralClass(cls: NounClass): NounClass | null {
  switch (cls) {
    case 1:
      return 2;
    case 3:
      return 4;
    case 5:
      return 6;
    case 7:
      return 8;
    case 9:
      return 10;
    case 11:
      return 10;
    case 12:
      return 13;
    case 14:
      return 6;
    case 15:
      return null;
    default:
      return null;
  }
}

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Detect the noun class of `surface`. Returns a frozen NounAnalysis
 * with confidence in [0, 1].
 *
 * Throws SwahiliLinguisticsError('INVALID_INPUT') on empty input.
 */
export function detectNounClass(surface: string): NounAnalysis {
  if (typeof surface !== 'string') {
    throw new SwahiliLinguisticsError(
      'surface must be a string',
      'INVALID_INPUT',
    );
  }
  const normalised = normalise(surface);
  if (normalised === '') {
    throw new SwahiliLinguisticsError(
      'surface must be non-empty',
      'INVALID_INPUT',
    );
  }

  // 1. Hard overrides — high confidence.
  const override = OVERRIDES.get(normalised);
  if (override !== undefined) {
    return Object.freeze({
      surface,
      lemma: override.lemma,
      nounClass: override.cls,
      pluralClass: override.pluralCls,
      isAnimate: override.animate,
      confidence: 1.0,
    });
  }

  // 2. Prefix-rule sweep — longest-prefix-first.
  for (const rule of CLASS_PREFIX_RULES) {
    for (const prefix of rule.prefixes) {
      if (normalised.startsWith(prefix)) {
        const stem = normalised.slice(prefix.length);
        const animate =
          rule.typicallyAnimate ||
          ANIMATE_STEMS.has(stem) ||
          [...ANIMATE_STEMS].some((s) => stem.endsWith(s));
        const pluralCls = rule.pluralCls ?? derivePluralClass(rule.cls);
        return Object.freeze({
          surface,
          lemma: normalised,
          nounClass: rule.cls,
          pluralClass: pluralCls,
          isAnimate: animate,
          confidence: 0.7,
        });
      }
    }
  }

  // 3. Fallback — class 9 (N-/Ø-) is the catch-all for non-prefixed nouns
  //    in canonical Bantu morphology.
  return Object.freeze({
    surface,
    lemma: normalised,
    nounClass: 9,
    pluralClass: 10,
    isAnimate: false,
    confidence: 0.4,
  });
}

/**
 * Derive a plural surface from a singular surface by analysing the
 * class and applying the canonical prefix swap. Returns null when the
 * class has no plural pairing.
 */
export function derivePluralSurface(surface: string): string | null {
  const analysis = detectNounClass(surface);
  if (analysis.pluralClass === null) {
    return null;
  }
  // Hard override: look up the reverse pairing in OVERRIDES table.
  for (const [k, v] of OVERRIDES) {
    if (
      v.lemma === analysis.lemma &&
      v.cls === analysis.pluralClass &&
      v.pluralCls === null
    ) {
      return k;
    }
  }
  // Prefix swap heuristic.
  return applyPluralPrefixSwap(surface, analysis.nounClass, analysis.pluralClass);
}

function applyPluralPrefixSwap(
  surface: string,
  fromCls: NounClass,
  toCls: NounClass,
): string | null {
  const lower = surface.toLowerCase();
  // 1 → 2: m-/mw-/mu- → wa-
  if (fromCls === 1 && toCls === 2) {
    if (lower.startsWith('mw')) return 'wa' + lower.slice(2);
    if (lower.startsWith('mu')) return 'wa' + lower.slice(2);
    if (lower.startsWith('m')) return 'wa' + lower.slice(1);
  }
  // 3 → 4: m- → mi-
  if (fromCls === 3 && toCls === 4) {
    if (lower.startsWith('m')) return 'mi' + lower.slice(1);
  }
  // 5 → 6: ji-/Ø → ma-
  if (fromCls === 5 && toCls === 6) {
    if (lower.startsWith('ji')) return 'ma' + lower.slice(2);
    return 'ma' + lower;
  }
  // 7 → 8: ki-/ch- → vi-/vy-
  if (fromCls === 7 && toCls === 8) {
    if (lower.startsWith('ch')) return 'vy' + lower.slice(2);
    if (lower.startsWith('ki')) return 'vi' + lower.slice(2);
  }
  // 9 → 10: invariant by default
  if (fromCls === 9 && toCls === 10) {
    return lower;
  }
  // 11 → 10: u- → Ø (drop u-)
  if (fromCls === 11 && toCls === 10) {
    if (lower.startsWith('u')) return lower.slice(1);
  }
  return null;
}
