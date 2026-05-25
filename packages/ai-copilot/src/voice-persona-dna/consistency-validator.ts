/**
 * Persona consistency validator — Wave 28.
 *
 * Heuristic first-line scoring for "does this output match the pinned
 * persona?". Deliberately heuristic (no LLM) so the validator can run
 * inline on every output with zero cost and zero latency tax. An
 * LLM-as-judge upgrade path is documented below — the callers can wrap
 * this function with a confidence-boosting LLM pass where cost permits.
 *
 * Scoring rules:
 *
 *   1. Taboo phrases — hard-fail (severity 0.9) if the output contains
 *      any phrase from the persona's taboo list.
 *   2. Vocabulary register — compare casual / formal marker frequency
 *      to the profile's expected register.
 *   3. Pace — heuristic length window derived from the profile's WPM,
 *      flagging outputs that are wildly too short or too long for the
 *      spoken pace they claim.
 *   4. Code-switching — if the output contains non-primary-locale
 *      tokens but `codeSwitching` is undefined, flag the mismatch.
 *
 * The validator returns a 0-1 score, a list of violations, and
 * human-readable suggestions so the caller (Brain, UI, drift-detector)
 * can act on the report.
 *
 * LLM upgrade path:
 *   - Add an async `scorePersonaFitWithJudge(output, profile, judge)`
 *     that calls a lightweight judge prompt, averages its 0-1 score
 *     with the heuristic score, and upgrades violations.
 *   - Keep `scorePersonaFit` synchronous for hot-path usage.
 */

import type {
  PersonaFitReport,
  PersonaViolation,
  VoicePersonaProfile,
  VocabularyRegister,
} from './types.js';

// Markers — tuned for English (primary language). Swahili / Arabic
// checks are tokenised separately in the multi-script harness, which
// is the correct tool for those locales.

const CASUAL_MARKERS = [
  'gonna',
  'wanna',
  'kinda',
  'sorta',
  'yeah',
  'nope',
  'ok so',
  'lol',
  'tbh',
  'btw',
  'honestly',
  'just sayin',
];

const FORMAL_MARKERS = [
  'furthermore',
  'pursuant to',
  'notwithstanding',
  'hereinafter',
  'in accordance with',
  'kindly note',
  'respectfully',
  'with reference to',
];

const LITERARY_MARKERS = [
  'whereas',
  'herein',
  'aforementioned',
  'heretofore',
  'thereof',
  'whomsoever',
];

const COLLOQUIAL_MARKERS = [
  'hey',
  'yo',
  'dude',
  'bro',
  'buddy',
  'pal',
  'whatever',
];

// Word counts used as sanity bounds — NOT as hard limits. A two-line
// reply is fine for vendor coordination; a 2000-word rant is not.
const MIN_WORDS_PER_OUTPUT = 4;
const MAX_WORDS_PER_OUTPUT = 1200;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(haystack: string, needles: readonly string[]): number {
  const normalized = haystack.toLowerCase();
  return needles.reduce((acc, needle) => {
    if (!needle) return acc;
    const n = needle.toLowerCase();
    // Word-boundary match so short markers like 'yo' don't falsely
    // fire on 'your', 'pal' on 'palace', etc. Multi-word phrases still
    // match because \b sits between alphanumerics and non-alphanumerics.
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(n)}(?=$|[^a-z0-9])`, 'g');
    const matches = normalized.match(pattern);
    return acc + (matches ? matches.length : 0);
  }, 0);
}

function findFirstTaboo(
  output: string,
  taboos: readonly string[],
): string | null {
  const normalized = output.toLowerCase();
  for (const t of taboos) {
    if (!t) continue;
    if (normalized.includes(t.toLowerCase())) return t;
  }
  return null;
}

function wordCount(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

function expectedLengthWindow(
  wpm: number,
): { readonly min: number; readonly max: number } {
  // Assume a speaking turn of between ~3s (very short prompt) and ~90s
  // (long monologue). Length window is WPM-derived so a 155-WPM head
  // voice tolerates longer outputs than a 170-WPM fast tenant voice.
  const secondsFloor = 3;
  const secondsCeiling = 90;
  return {
    min: Math.max(
      MIN_WORDS_PER_OUTPUT,
      Math.round((wpm / 60) * secondsFloor),
    ),
    max: Math.min(
      MAX_WORDS_PER_OUTPUT,
      Math.round((wpm / 60) * secondsCeiling),
    ),
  };
}

function registerScore(
  output: string,
  expected: VocabularyRegister,
): readonly PersonaViolation[] {
  const casual = countOccurrences(output, CASUAL_MARKERS);
  const formal = countOccurrences(output, FORMAL_MARKERS);
  const literary = countOccurrences(output, LITERARY_MARKERS);
  const colloquial = countOccurrences(output, COLLOQUIAL_MARKERS);
  const violations: PersonaViolation[] = [];

  switch (expected) {
    case 'literary':
      if (casual + colloquial > 0) {
        violations.push({
          kind: 'register_too_casual',
          message:
            'Literary register required; output uses casual/colloquial markers.',
          severity: 0.8,
        });
      }
      break;
    case 'professional':
      if (colloquial > 0) {
        violations.push({
          kind: 'register_too_casual',
          message:
            'Professional register required; output uses colloquial markers.',
          severity: 0.6,
        });
      }
      if (literary > 1) {
        violations.push({
          kind: 'register_too_formal',
          message:
            'Professional register expected; output reads too literary.',
          severity: 0.3,
        });
      }
      break;
    case 'conversational':
      if (literary + formal > 2) {
        violations.push({
          kind: 'register_too_formal',
          message:
            'Conversational register expected; output reads too formal.',
          severity: 0.4,
        });
      }
      break;
    case 'colloquial':
      if (formal + literary > 0) {
        violations.push({
          kind: 'register_too_formal',
          message:
            'Colloquial register expected; output is stiff and formal.',
          severity: 0.5,
        });
      }
      break;
    default:
      break;
  }

  return violations;
}

function paceScore(
  output: string,
  profile: VoicePersonaProfile,
): readonly PersonaViolation[] {
  const words = wordCount(output);
  if (words === 0) return [];
  const { min, max } = expectedLengthWindow(profile.pace.wordsPerMinute);
  const violations: PersonaViolation[] = [];
  if (words < min) {
    violations.push({
      kind: 'pace_output_too_short',
      message: `Output is shorter (${words} words) than the minimum (${min}) for this persona's spoken pace.`,
      severity: 0.25,
    });
  }
  if (words > max) {
    violations.push({
      kind: 'pace_output_too_long',
      message: `Output is longer (${words} words) than the maximum (${max}) for this persona's spoken pace.`,
      severity: 0.35,
    });
  }
  return violations;
}

function codeSwitchScore(
  output: string,
  profile: VoicePersonaProfile,
): readonly PersonaViolation[] {
  // Very rough heuristic: detect non-ASCII / non-Latin tokens when
  // code-switching is not configured. Avoid false positives for
  // punctuation (ASCII only) and numerics.
  if (profile.codeSwitching && profile.codeSwitching.allowedInserts.length > 0) {
    return [];
  }
  const tokens = output.split(/\s+/u).filter(Boolean);
  const nonLatin = tokens.filter((t) =>
    // eslint-disable-next-line no-misleading-character-class -- intentional: codepoint-range detection for non-Latin scripts (Cyrillic, Arabic, Devanagari, Hiragana/Katakana, CJK, Hangul). The rule's grapheme-cluster heuristic does not apply to script-detection.
    /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/u.test(
      t,
    ),
  );
  if (nonLatin.length > 0) {
    return [
      {
        kind: 'code_switch_out_of_context',
        message:
          'Output contains non-Latin script but persona does not permit code-switching.',
        severity: 0.45,
        snippet: nonLatin.slice(0, 3).join(' '),
      },
    ];
  }
  return [];
}

function mergeSuggestions(violations: readonly PersonaViolation[]): string[] {
  const out: string[] = [];
  for (const v of violations) {
    switch (v.kind) {
      case 'taboo_used':
        out.push('Remove or rephrase the flagged taboo phrase.');
        break;
      case 'register_too_casual':
        out.push('Elevate the vocabulary — prefer formal phrasing.');
        break;
      case 'register_too_formal':
        out.push('Soften the vocabulary — prefer a conversational tone.');
        break;
      case 'pace_output_too_long':
        out.push('Shorten the reply; persona expects a conversational pace.');
        break;
      case 'pace_output_too_short':
        out.push('Add more context; persona should not sound clipped.');
        break;
      case 'missing_greeting':
        out.push('Open with one of the persona\'s pinned greeting patterns.');
        break;
      case 'missing_closing':
        out.push('Close with one of the persona\'s pinned closing patterns.');
        break;
      case 'code_switch_out_of_context':
        out.push(
          'Remove code-switched phrases; the persona is single-locale here.',
        );
        break;
      default:
        break;
    }
  }
  return Array.from(new Set(out));
}

/**
 * Main scoring entry point. Returns a PersonaFitReport.
 *
 *   - 1.0 = zero violations.
 *   - 0.0 = any taboo violation (hard-fail).
 *   - intermediate scores reflect the severity sum.
 */
export function scorePersonaFit(
  output: string,
  profile: VoicePersonaProfile,
): PersonaFitReport {
  const violations: PersonaViolation[] = [];

  const taboo = findFirstTaboo(output, profile.taboos);
  if (taboo !== null) {
    violations.push({
      kind: 'taboo_used',
      message: `Output contains a taboo phrase for this persona: "${taboo}".`,
      snippet: taboo,
      severity: 0.9,
    });
  }

  for (const v of registerScore(output, profile.vocabularyRegister)) violations.push(v);
  for (const v of paceScore(output, profile)) violations.push(v);
  for (const v of codeSwitchScore(output, profile)) violations.push(v);

  // Hard-fail on any taboo — return 0 immediately.
  if (violations.some((v) => v.kind === 'taboo_used')) {
    return {
      score: 0,
      violations,
      suggestions: mergeSuggestions(violations),
    };
  }

  // Otherwise subtract severity from a baseline of 1. Clamp to [0, 1].
  const severitySum = violations.reduce((acc, v) => acc + v.severity, 0);
  const rawScore = 1 - severitySum;
  const score = Math.max(0, Math.min(1, rawScore));

  return {
    score,
    violations,
    suggestions: mergeSuggestions(violations),
  };
}
