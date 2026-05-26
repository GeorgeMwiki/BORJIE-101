/**
 * Verb analyzer (Wave 19H).
 *
 * Decomposes a Swahili verb surface form into the canonical slot
 * structure:
 *
 *   [NEG] [SUBJ] [NEG2] [TAM] [REL] [OBJ] [ROOT] [EXT...] [FV] [POST]
 *
 * Worked example: `ninakusoma` →
 *   ni-  (subj 1sg)
 *   -na- (TAM present)
 *   -ku- (obj 2sg)
 *   -som- (root "read")
 *   -a   (FV indicative)
 *
 * Sources:
 *   - Wikipedia "Swahili grammar"
 *     https://en.wikipedia.org/wiki/Swahili_grammar (accessed 2026-05-26)
 *   - Lipps, J. "XSMA: A Finite-state Morphological Analyzer for Swahili"
 *     https://www.academia.edu/13640271/XSMA_A_Finite_state_Morphological_Analyzer_for_Swahili
 *     (accessed 2026-05-26)
 *   - "An analysis of Swahili verbal inflection and derivational morphemes"
 *     https://www.journals.jozacpublishers.com/jllls/article/download/470/306
 *     (accessed 2026-05-26)
 */

import type { Morpheme, VerbAnalysis } from '../types.js';
import { SwahiliLinguisticsError } from '../types.js';

/**
 * Subject concords. Maps prefix → human-readable role.
 * For class 1 vs 3 we disambiguate via context, but both share the
 * `a-` agreement marker.
 */
const SUBJECT_PREFIXES: ReadonlyArray<{ prefix: string; gloss: string }> = [
  { prefix: 'tu', gloss: '1pl' },
  { prefix: 'wa', gloss: 'cl2' },
  { prefix: 'mu', gloss: '2pl' }, // mu- = 2pl (formal mwe in some texts)
  { prefix: 'm', gloss: '2pl' },
  { prefix: 'ni', gloss: '1sg' },
  { prefix: 'u', gloss: '2sg' },
  { prefix: 'a', gloss: 'cl1' },
  { prefix: 'i', gloss: 'cl4_or_9' },
  { prefix: 'zi', gloss: 'cl10' },
  { prefix: 'li', gloss: 'cl5' },
  { prefix: 'ya', gloss: 'cl6' },
  { prefix: 'ki', gloss: 'cl7' },
  { prefix: 'vi', gloss: 'cl8' },
  { prefix: 'ku', gloss: 'cl15' },
  { prefix: 'pa', gloss: 'cl16' },
];

/**
 * Tense / aspect / mood (TAM) markers.
 */
const TAM_MARKERS: ReadonlyArray<{ marker: string; gloss: string }> = [
  { marker: 'ngali', gloss: 'past-counterfactual' },
  { marker: 'nge', gloss: 'conditional' },
  { marker: 'ja', gloss: 'not-yet' },
  { marker: 'na', gloss: 'present' },
  { marker: 'me', gloss: 'perfect' },
  { marker: 'li', gloss: 'past' },
  { marker: 'ta', gloss: 'future' },
  { marker: 'ki', gloss: 'situative' },
  { marker: 'hu', gloss: 'habitual' },
  { marker: 'a', gloss: 'general-present' },
];

/**
 * Object concords. Almost identical to subject set but the second-
 * person `-ku-` differs from subject `u-`.
 */
const OBJECT_PREFIXES: ReadonlyArray<{ prefix: string; gloss: string }> = [
  { prefix: 'tu', gloss: '1pl' },
  { prefix: 'wa', gloss: 'cl2' },
  { prefix: 'ku', gloss: '2sg' },
  { prefix: 'ni', gloss: '1sg' },
  { prefix: 'mu', gloss: '2pl' },
  { prefix: 'm', gloss: 'cl1_obj' },
  { prefix: 'i', gloss: 'cl4_or_9' },
  { prefix: 'zi', gloss: 'cl10' },
  { prefix: 'li', gloss: 'cl5' },
  { prefix: 'ya', gloss: 'cl6' },
  { prefix: 'ki', gloss: 'cl7' },
  { prefix: 'vi', gloss: 'cl8' },
];

const FINAL_VOWELS: ReadonlySet<string> = new Set(['a', 'e', 'i']);

const NEG_PREFIX = 'ha';

interface ParseAttempt {
  readonly remaining: string;
  readonly morphemes: ReadonlyArray<Morpheme>;
  readonly subject: string | null;
  readonly tam: string | null;
  readonly object: string | null;
  readonly fv: string | null;
  readonly negated: boolean;
}

function tryStripPrefix(
  remaining: string,
  candidates: ReadonlyArray<{ prefix: string; gloss: string }>,
): { matched: { prefix: string; gloss: string }; rest: string } | null {
  // Longest match wins.
  let best: { prefix: string; gloss: string } | null = null;
  for (const cand of candidates) {
    if (
      remaining.startsWith(cand.prefix) &&
      (best === null || cand.prefix.length > best.prefix.length)
    ) {
      best = cand;
    }
  }
  if (best === null) return null;
  return { matched: best, rest: remaining.slice(best.prefix.length) };
}

function stripFinalVowel(stem: string): {
  fv: string | null;
  root: string;
} {
  if (stem.length === 0) return { fv: null, root: stem };
  const last = stem.slice(-1);
  if (FINAL_VOWELS.has(last)) {
    return { fv: last, root: stem.slice(0, -1) };
  }
  return { fv: null, root: stem };
}

function pushMorpheme(
  acc: ReadonlyArray<Morpheme>,
  m: Morpheme,
): ReadonlyArray<Morpheme> {
  return Object.freeze([...acc, m]);
}

/**
 * Analyse a verb surface form. Returns a frozen VerbAnalysis with
 * `confidence` reflecting how cleanly the slots were resolved.
 */
export function analyzeVerb(surface: string): VerbAnalysis {
  if (typeof surface !== 'string') {
    throw new SwahiliLinguisticsError(
      'surface must be a string',
      'INVALID_INPUT',
    );
  }
  const normalised = surface.trim().toLowerCase();
  if (normalised === '') {
    throw new SwahiliLinguisticsError(
      'surface must be non-empty',
      'INVALID_INPUT',
    );
  }

  let attempt: ParseAttempt = {
    remaining: normalised,
    morphemes: Object.freeze([]),
    subject: null,
    tam: null,
    object: null,
    fv: null,
    negated: false,
  };

  // Slot 0 — negative prefix `ha-` (main-clause negation).
  if (attempt.remaining.startsWith(NEG_PREFIX)) {
    const restAfterNeg = attempt.remaining.slice(NEG_PREFIX.length);
    // Only consume `ha-` if a subject prefix follows immediately.
    const probe = tryStripPrefix(restAfterNeg, SUBJECT_PREFIXES);
    if (probe !== null) {
      attempt = {
        ...attempt,
        remaining: restAfterNeg,
        morphemes: pushMorpheme(attempt.morphemes, {
          value: NEG_PREFIX,
          slot: 'neg',
          gloss: 'neg',
        }),
        negated: true,
      };
    }
  }

  // Slot 1 — subject concord.
  const subj = tryStripPrefix(attempt.remaining, SUBJECT_PREFIXES);
  if (subj !== null) {
    attempt = {
      ...attempt,
      remaining: subj.rest,
      morphemes: pushMorpheme(attempt.morphemes, {
        value: subj.matched.prefix,
        slot: 'subj',
        gloss: subj.matched.gloss,
      }),
      subject: subj.matched.gloss,
    };
  }

  // Slot 3 — TAM.
  const tam = tryStripPrefix(attempt.remaining, TAM_MARKERS.map(
    (m) => ({ prefix: m.marker, gloss: m.gloss }),
  ));
  if (tam !== null) {
    attempt = {
      ...attempt,
      remaining: tam.rest,
      morphemes: pushMorpheme(attempt.morphemes, {
        value: tam.matched.prefix,
        slot: 'tam',
        gloss: tam.matched.gloss,
      }),
      tam: tam.matched.gloss,
    };
  }

  // Slot 5 — object concord (only if something remains for the root).
  if (attempt.remaining.length >= 3) {
    const obj = tryStripPrefix(attempt.remaining, OBJECT_PREFIXES);
    if (obj !== null && obj.rest.length >= 2) {
      // Heuristic: only treat as object if a recognisable root (>=2 chars
      // ending in valid FV) remains.
      const tail = obj.rest;
      const lastChar = tail.slice(-1);
      if (FINAL_VOWELS.has(lastChar)) {
        attempt = {
          ...attempt,
          remaining: obj.rest,
          morphemes: pushMorpheme(attempt.morphemes, {
            value: obj.matched.prefix,
            slot: 'obj',
            gloss: obj.matched.gloss,
          }),
          object: obj.matched.gloss,
        };
      }
    }
  }

  // Slot 6 — root (everything before FV).
  const { fv, root } = stripFinalVowel(attempt.remaining);
  if (root.length > 0) {
    attempt = {
      ...attempt,
      remaining: '',
      morphemes: pushMorpheme(attempt.morphemes, {
        value: root,
        slot: 'root',
        gloss: `root[${root}]`,
      }),
    };
  }

  // Slot n+1 — final vowel.
  if (fv !== null) {
    attempt = {
      ...attempt,
      morphemes: pushMorpheme(attempt.morphemes, {
        value: fv,
        slot: 'fv',
        gloss: fv === 'a' ? 'indicative' : fv === 'e' ? 'subjunctive' : 'fv',
      }),
      fv,
    };
  }

  const lemma = `${root || normalised}${fv ?? 'a'}`;

  const slotsFilled = [
    attempt.subject !== null,
    attempt.tam !== null,
    root.length > 0,
    fv !== null,
  ].filter(Boolean).length;
  const confidence = Math.min(1, slotsFilled / 3.5);

  return Object.freeze({
    surface,
    lemma,
    morphemes: attempt.morphemes,
    subject: attempt.subject,
    tense: attempt.tam,
    object: attempt.object,
    fv: attempt.fv,
    negated: attempt.negated,
    confidence,
  });
}
