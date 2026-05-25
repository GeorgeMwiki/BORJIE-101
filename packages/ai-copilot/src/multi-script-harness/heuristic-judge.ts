/**
 * Deterministic heuristic judge for the multi-script harness.
 *
 * Production wires a fast judge LLM. This heuristic judge is used by the
 * harness self-tests and in CI to guarantee "some scoring happened" even
 * when no LLM is reachable — so a silent no-op doesn't masquerade as a
 * green run. It scores four rubric dimensions against the expected
 * script and locale of the test case.
 *
 * The heuristic is intentionally conservative — easier to tighten later
 * than to explain away a false green.
 */

import type {
  LLMJudge,
  RubricScores,
  ScriptTestCase,
  ScriptTestIssue,
  ScriptTestResult,
} from './types.js';
import { MIN_PASSING_COMPOSITE } from './types.js';

const SCRIPT_REGEX: Record<string, RegExp> = Object.freeze({
  Latn: /[A-Za-zÀ-ÖØ-öø-ÿĀ-žḀ-ỿ]/,
  Cyrl: /[\u0400-\u04FF]/,
  Arab: /[\u0600-\u06FF\u0750-\u077F]/,
  Hang: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
  Hani: /[\u4E00-\u9FFF\u3400-\u4DBF]/,
  Kana: /[\u3040-\u30FF]/,
  Deva: /[\u0900-\u097F]/,
});

const CATEGORY_HINTS: Record<string, readonly string[]> = {
  'rent-reminder': ['rent', 'reminder', 'kodi', 'إيجار', 'Miete', '임대', '賃料', 'renta'],
  'arrears-notice': ['arrears', 'overdue', 'متأخرات', 'Rückstand', '滞納'],
  'lease-renewal': ['renewal', 'BGB', '557', 'extension', 'erneuerung'],
  'move-out': ['move-out', 'checklist', '이사', '退去', 'mudança'],
  'regulator-letter': ['regulator', 'compliance', '法', '規制', 'statute'],
  'viewing-confirmation': ['viewing', 'appointment', 'visite', '见面', 'confirmation'],
  'deposit-dispute': ['deposit', 'dispute', 'जमा', 'fianza', 'kaution'],
  'portfolio-briefing': ['briefing', 'portfolio', 'overnight', 'autonomous'],
  'tenant-welcome': ['welcome', 'checklist', '欢迎', '입주', 'bienvenida'],
  'code-switch': ['karibu', 'rent', 'breakdown'],
  'maintenance-update': ['maintenance', 'work order', 'encanamento', 'manutenção'],
  'owner-statement': ['owner', 'statement', 'retenciones', 'retención'],
};

function countScriptChars(text: string, script: string): number {
  const regex = SCRIPT_REGEX[script];
  if (!regex) return 0;
  let count = 0;
  for (const ch of text) {
    if (regex.test(ch)) count += 1;
  }
  return count;
}

function scoreScriptCorrectness(output: string, script: string): number {
  const total = output.length;
  if (total === 0) return 0;
  const scriptCount = countScriptChars(output, script);
  // Latin is the universal baseline — don't penalise mixed Latin in
  // non-Latin outputs too harshly (urls, numbers, brand names are Latin).
  if (script === 'Latn') return scriptCount / total;
  return Math.min(1, (scriptCount / total) * 1.4);
}

function scoreGrammar(output: string): number {
  const trimmed = output.trim();
  if (trimmed.length === 0) return 0;
  const sentences = trimmed.split(/[.!?。！？؟]/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return 0.4;
  const avgLen = trimmed.length / sentences.length;
  // Sentences 15-180 chars feel natural; outside that is suspicious.
  if (avgLen < 15) return 0.55;
  if (avgLen > 220) return 0.55;
  return 0.9;
}

function scoreRegisterFit(output: string, scenario: string): number {
  const hints = CATEGORY_HINTS[scenario];
  if (!hints || hints.length === 0) return 0.75;
  const lower = output.toLowerCase();
  const hits = hints.filter((h) => lower.includes(h.toLowerCase())).length;
  if (hits === 0) return 0.55;
  return Math.min(1, 0.6 + hits * 0.15);
}

function scoreCulturalAppropriateness(output: string, locale: string): number {
  const lower = output.toLowerCase();
  const offensive = ['dude', 'bro', 'lol', 'lmao', 'yo '];
  for (const term of offensive) {
    if (lower.includes(term)) return 0.4;
  }
  // Greetings / polite markers lift the score modestly.
  const polite = ['please', 'kindly', 'dear', 'mr.', 'ms.', 'mrs.', 'habari', 'السلام', 'bitte', '안녕'];
  const politeHits = polite.filter((p) => lower.includes(p)).length;
  if (politeHits > 0) return Math.min(1, 0.7 + politeHits * 0.1);
  if (locale.startsWith('en-')) return 0.8;
  return 0.7;
}

export function scoreRubric(
  testCase: ScriptTestCase,
  output: string,
): { scores: RubricScores; issues: readonly ScriptTestIssue[] } {
  const grammar = scoreGrammar(output);
  const scriptCorrectness = scoreScriptCorrectness(output, testCase.script);
  const registerFit = scoreRegisterFit(output, testCase.scenario);
  const culturalAppropriateness = scoreCulturalAppropriateness(output, testCase.locale);
  const rubric = testCase.expectedRubric;
  const composite =
    grammar * rubric.grammarWeight +
    scriptCorrectness * rubric.scriptCorrectnessWeight +
    registerFit * rubric.registerFitWeight +
    culturalAppropriateness * rubric.culturalAppropriatenessWeight;

  const scores: RubricScores = Object.freeze({
    grammar,
    scriptCorrectness,
    registerFit,
    culturalAppropriateness,
    composite,
  });

  const issues: ScriptTestIssue[] = [];
  if (scriptCorrectness < 0.7) {
    issues.push({
      dimension: 'scriptCorrectness',
      message: `Output carries too few ${testCase.script} characters for locale ${testCase.locale}.`,
    });
  }
  if (grammar < 0.6) {
    issues.push({
      dimension: 'grammar',
      message: 'Sentence structure looks degenerate (fragments or runaway sentences).',
    });
  }
  if (registerFit < 0.6) {
    issues.push({
      dimension: 'registerFit',
      message: `Output missed scenario-specific vocabulary for '${testCase.scenario}'.`,
    });
  }
  if (culturalAppropriateness < 0.6) {
    issues.push({
      dimension: 'culturalAppropriateness',
      message: 'Register carries markers inappropriate for a landlord/tenant channel.',
    });
  }

  return { scores, issues: Object.freeze(issues) };
}

export const heuristicJudge: LLMJudge = Object.freeze({
  async judge(args: { readonly testCase: ScriptTestCase; readonly output: string }): Promise<
    Omit<ScriptTestResult, 'caseId' | 'locale' | 'script' | 'scenario' | 'output'>
  > {
    const { scores, issues } = scoreRubric(args.testCase, args.output);
    const passed = scores.composite >= MIN_PASSING_COMPOSITE && issues.length === 0;
    return Object.freeze({
      passed,
      rubricScores: scores,
      issues,
    });
  },
});
