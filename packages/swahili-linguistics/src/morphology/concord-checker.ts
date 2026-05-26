/**
 * Concord checker (Wave 19H).
 *
 * Verifies that a verb's subject concord agrees with the noun class
 * of its surface subject noun. Honours the animate-override: human-
 * denoting nouns *regardless of formal class* take class 1/2
 * (a-/wa-) agreement.
 *
 * Sources:
 *   - UVA Kamusi Project — "Noun classification in Swahili"
 *     https://www2.iath.virginia.edu/swahili/sect2.html (accessed 2026-05-26)
 *   - Wikipedia "Swahili grammar"
 *     https://en.wikipedia.org/wiki/Swahili_grammar (accessed 2026-05-26)
 */

import type {
  ConcordCheckResult,
  ConcordViolation,
  NounClass,
} from '../types.js';
import { detectNounClass } from './noun-class-detector.js';
import { analyzeVerb } from './verb-analyzer.js';

/**
 * Expected subject concord per noun class (with animate-override
 * applied at the call site).
 */
const SUBJECT_CONCORD_BY_CLASS: ReadonlyMap<NounClass, string> = new Map([
  [1, 'a'],
  [2, 'wa'],
  [3, 'u'],
  [4, 'i'],
  [5, 'li'],
  [6, 'ya'],
  [7, 'ki'],
  [8, 'vi'],
  [9, 'i'],
  [10, 'zi'],
  [11, 'u'],
  [12, 'ka'],
  [13, 'tu'],
  [14, 'u'],
  [15, 'ku'],
  [16, 'pa'],
  [17, 'ku'],
  [18, 'mu'],
]);

/**
 * Given a noun class + animacy hint, return the expected subject
 * concord. The animate-override (cl. 1/2 for all human nouns) is
 * applied here.
 */
export function expectedSubjectConcord(
  cls: NounClass,
  isAnimate: boolean,
  isPlural: boolean,
): string {
  if (isAnimate) {
    return isPlural ? 'wa' : 'a';
  }
  return SUBJECT_CONCORD_BY_CLASS.get(cls) ?? 'a';
}

/**
 * Check the subject concord of `verbSurface` against the noun class
 * of `subjectNoun`. Returns a frozen ConcordCheckResult.
 */
export function checkSubjectConcord(
  subjectNoun: string,
  verbSurface: string,
): ConcordCheckResult {
  const noun = detectNounClass(subjectNoun);
  const verb = analyzeVerb(verbSurface);

  const isPlural = noun.pluralClass === null && noun.nounClass % 2 === 0;
  const expected = expectedSubjectConcord(
    noun.nounClass,
    noun.isAnimate,
    isPlural,
  );

  // Pull the actual subject prefix from the verb morphemes.
  const subjMorpheme = verb.morphemes.find((m) => m.slot === 'subj');
  const actual = subjMorpheme?.value ?? '';

  if (actual === expected) {
    return Object.freeze({
      pass: true,
      violations: Object.freeze([]),
    });
  }

  // Special-case: animate-override-missed.
  const violation: ConcordViolation = noun.isAnimate
    ? Object.freeze({
        kind: 'animate-override-missed' as const,
        expected,
        actual,
        position: 0,
      })
    : Object.freeze({
        kind: 'class-mismatch' as const,
        expected,
        actual,
        position: 0,
      });

  return Object.freeze({
    pass: false,
    violations: Object.freeze([violation]),
  });
}
