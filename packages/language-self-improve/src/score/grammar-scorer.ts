/**
 * Grammar scorer — delegates to a swahili-linguistics port for Swahili,
 * and uses a lightweight LLM-grader port for non-Swahili.
 *
 * Both ports are injected; no direct cross-package imports because the
 * sibling Wave 19H `swahili-linguistics` package may not yet exist when
 * this wave lands.
 *
 * The Swahili port is expected to detect noun-class violations
 * (the most common Mr. Mwikila failure mode — every Swahili noun
 * carries one of 18 noun classes that propagate agreement on adjectives,
 * verbs, and possessives). The fallback LLM grader is provider-agnostic.
 */

import type { LanguageTag } from '../types.js';

export interface GrammarIssue {
  readonly kind: 'noun-class-violation' | 'agreement-error' | 'syntax-error' | 'other';
  readonly span: string;
  readonly message: string;
}

export interface GrammarResult {
  readonly score: number;
  readonly issues: ReadonlyArray<GrammarIssue>;
}

export interface SwahiliLinguisticsPort {
  gradeGrammar(text: string, lang: LanguageTag): Promise<GrammarResult>;
}

export interface LlmGraderPort {
  grade(text: string, lang: LanguageTag): Promise<GrammarResult>;
}

export interface GrammarScorerConfig {
  readonly swahili: SwahiliLinguisticsPort;
  readonly fallback: LlmGraderPort;
}

const SWAHILI_TAGS: ReadonlySet<string> = new Set([
  'sw',
  'sw-bongo',
  'sw-coast',
  'sw-lake',
  'sheng',
]);

export async function scoreGrammar(
  text: string,
  lang: LanguageTag,
  config: GrammarScorerConfig,
): Promise<GrammarResult> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return Object.freeze({ score: 1, issues: Object.freeze([]) });
  }
  try {
    if (SWAHILI_TAGS.has(lang)) {
      return await config.swahili.gradeGrammar(text, lang);
    }
    return await config.fallback.grade(text, lang);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Grammar scorer: port failed — ${message}`);
  }
}

/**
 * A simple deterministic noun-class checker — useful for tests when no
 * real Swahili port is wired. Implements a tiny rule set so a unit test
 * can confirm "ki + class-1-noun" trips a violation. The checker is
 * intentionally conservative; production wires the real port.
 */
export const naiveSwahiliPort: SwahiliLinguisticsPort = Object.freeze({
  async gradeGrammar(
    text: string,
    _lang: LanguageTag,
  ): Promise<GrammarResult> {
    const issues: GrammarIssue[] = [];
    // Toy rule: "ki" prefix paired with a class-1 noun ("mtu") is
    // always a noun-class violation (the correct form is "mtu yule" /
    // "mtu mzuri", not "ki mtu").
    const violationPattern = /\bki\s+mtu\b/i;
    if (violationPattern.test(text)) {
      issues.push(
        Object.freeze({
          kind: 'noun-class-violation' as const,
          span: 'ki mtu',
          message: '`ki` prefix cannot govern class-1 noun `mtu`.',
        }),
      );
    }
    // Toy rule: detect missing noun-class agreement on adjective.
    const missingAgreement = /\bmtu\s+kubwa\b/i;
    if (missingAgreement.test(text)) {
      issues.push(
        Object.freeze({
          kind: 'agreement-error' as const,
          span: 'mtu kubwa',
          message: 'Class-1 noun requires class-1 adjective: "mtu mkubwa".',
        }),
      );
    }
    const score = issues.length === 0 ? 1 : Math.max(0, 1 - issues.length * 0.2);
    return Object.freeze({
      score,
      issues: Object.freeze(issues),
    });
  },
});

export const passthroughLlmGrader: LlmGraderPort = Object.freeze({
  async grade(text: string, _lang: LanguageTag): Promise<GrammarResult> {
    // Deterministic offline default — assume well-formed if non-empty.
    return Object.freeze({
      score: text.trim().length === 0 ? 0 : 1,
      issues: Object.freeze([]),
    });
  },
});
