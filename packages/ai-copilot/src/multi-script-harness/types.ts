/**
 * Multi-script robustness harness — types (Wave 28).
 *
 * The Brain supports Arabic (ar-AE), Swahili (sw-KE/sw-TZ), CJK
 * (ko-KR, ja-JP, zh-CN), Devanagari (hi-IN), Latin EA English, and
 * Latin EMEA/LATAM locales. Before this harness existed, we had no
 * regression gate — a model upgrade or prompt change could silently
 * drop quality in ar-AE (script correctness) or in sw-KE (register
 * fit) and nobody would see it until a tenant complained.
 *
 * The harness is port-driven:
 *   - `BrainOutputGenerator` — the system under test. Test callers
 *     wire their real Brain here, or a mock for harness self-tests.
 *   - `LLMJudge` — the scorer. Production wires a fast LLM; tests
 *     use a deterministic heuristic judge.
 *
 * Both ports accept a `ScriptTestCase` and surface a
 * `ScriptTestResult` with per-dimension rubric scores so we can slice
 * by locale, by script, or by rubric dimension when regressions hit.
 */

import type { LocaleBCP47 } from '../voice-persona-dna/types.js';

/**
 * ISO-15924-ish short script identifiers. Kept to the subset we
 * actually exercise so callers don't have to memorise the full list.
 */
export type ScriptCode =
  | 'Latn' // Latin
  | 'Cyrl' // Cyrillic
  | 'Arab' // Arabic
  | 'Hang' // Hangul (Korean)
  | 'Hani' // Han (Chinese / kanji)
  | 'Kana' // Katakana/Hiragana (Japanese kana)
  | 'Deva'; // Devanagari (Hindi)

/**
 * Rubric weights — sum to 1 (enforced via an invariant check at
 * module load). Every test case can pick its own weighting; e.g.
 * a regulator-letter cases weights grammar/register more than a
 * quick-tenant-reminder case.
 */
export interface TestRubric {
  readonly grammarWeight: number;
  readonly scriptCorrectnessWeight: number;
  readonly registerFitWeight: number;
  readonly culturalAppropriatenessWeight: number;
}

export interface ScriptTestCase {
  readonly id: string;
  readonly locale: LocaleBCP47;
  readonly script: ScriptCode;
  readonly testPrompt: string;
  readonly expectedRubric: TestRubric;
  /** Human tag for dashboard slicing: "rent-reminder", "arrears-notice"… */
  readonly scenario: string;
}

export interface RubricScores {
  readonly grammar: number;
  readonly scriptCorrectness: number;
  readonly registerFit: number;
  readonly culturalAppropriateness: number;
  /** Weighted composite in [0, 1]. */
  readonly composite: number;
}

export interface ScriptTestIssue {
  readonly dimension:
    | 'grammar'
    | 'scriptCorrectness'
    | 'registerFit'
    | 'culturalAppropriateness';
  readonly message: string;
}

export interface ScriptTestResult {
  readonly caseId: string;
  readonly locale: LocaleBCP47;
  readonly script: ScriptCode;
  readonly scenario: string;
  readonly passed: boolean;
  readonly rubricScores: RubricScores;
  readonly issues: readonly ScriptTestIssue[];
  readonly output: string;
}

/**
 * Port: generate an output given a test case. The real Brain plugs in
 * here. The harness calls `generate({ case })` once per case.
 */
export interface BrainOutputGenerator {
  generate(args: { readonly testCase: ScriptTestCase }): Promise<string>;
}

/**
 * Port: score an output against a rubric. Production wires a fast
 * judge LLM; tests use the heuristic judge.
 */
export interface LLMJudge {
  judge(args: {
    readonly testCase: ScriptTestCase;
    readonly output: string;
  }): Promise<Omit<ScriptTestResult, 'caseId' | 'locale' | 'script' | 'scenario' | 'output'>>;
}

/**
 * Report card. Aggregates pass-rate by locale + by scenario so
 * operators can see at a glance whether a regression is global or
 * script-specific.
 */
export interface MultiScriptAuditReport {
  readonly totalCases: number;
  readonly passed: number;
  readonly failed: number;
  readonly passRate: number;
  readonly byLocale: Readonly<Record<string, { passed: number; total: number }>>;
  readonly byScenario: Readonly<Record<string, { passed: number; total: number }>>;
  readonly results: readonly ScriptTestResult[];
  readonly generatedAt: string;
}

export const MIN_PASSING_COMPOSITE = 0.7;

export function validateRubricWeights(r: TestRubric): void {
  const sum =
    r.grammarWeight +
    r.scriptCorrectnessWeight +
    r.registerFitWeight +
    r.culturalAppropriatenessWeight;
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(
      `multi-script-harness: rubric weights must sum to 1 (got ${sum})`,
    );
  }
}
