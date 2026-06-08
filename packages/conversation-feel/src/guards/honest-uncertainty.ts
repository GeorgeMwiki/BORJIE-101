/**
 * Honest "I don't know" guard.
 *
 * When confidence is below threshold or the information is not in memory +
 * retrieval + tools, the assistant says "I don't know" directly. No
 * theatrical apology. Format: "I don't know X. [What I do know is Y / I can
 * find out / would you tell me?]".
 *
 * Locale discipline: the user-facing line and the theatre-strip both operate
 * within ONE locale. An `sw` reply gets a Swahili admission and never an
 * English phrase, and vice versa.
 *
 * References:
 *  - Anthropic, "Sandbagging in Language Models" (2024) — calibrated honesty.
 *  - Lin, Hilton, Evans, "TruthfulQA" (2021) — false-confident outputs are
 *    a measurable failure mode.
 *  - Ji et al., "Survey of Hallucination" (2023).
 */

import type { Locale } from '../types.js';

export interface HonestUncertaintyInput {
  readonly calibrated_confidence: number; // 0..100
  readonly missing_required_info: ReadonlyArray<string>;
  readonly retrieval_returned_empty: boolean;
  readonly locale?: Locale;
  readonly tier?: 'low' | 'medium' | 'high' | 'critical';
  readonly question_topic?: string;
  readonly known_partial_info?: string;
}

export interface HonestUncertaintyResult {
  readonly should_admit: boolean;
  readonly reason: 'low_confidence' | 'missing_info' | 'no_retrieval_match' | 'none';
  readonly user_facing: string;
  readonly avoids_theatre: boolean;
}

const CONFIDENCE_THRESHOLDS = {
  low: 30,
  medium: 45,
  high: 60,
  critical: 75,
} as const;

/**
 * Pure: decide whether to admit "I don't know" and produce a clean line in
 * the active locale.
 */
export function decideHonestUncertainty(
  input: HonestUncertaintyInput,
): HonestUncertaintyResult {
  const locale: Locale = input.locale ?? 'en';
  const tier = input.tier ?? 'medium';
  const threshold = CONFIDENCE_THRESHOLDS[tier];

  let reason: HonestUncertaintyResult['reason'] = 'none';
  let admit = false;

  if (input.missing_required_info.length > 0) {
    admit = true;
    reason = 'missing_info';
  } else if (input.retrieval_returned_empty) {
    admit = true;
    reason = 'no_retrieval_match';
  } else if (input.calibrated_confidence < threshold) {
    admit = true;
    reason = 'low_confidence';
  }

  if (!admit) {
    return {
      should_admit: false,
      reason: 'none',
      user_facing: '',
      avoids_theatre: true,
    };
  }

  const line = buildLine(reason, input, locale);

  return {
    should_admit: true,
    reason,
    user_facing: line,
    avoids_theatre: !containsTheatre(line, locale),
  };
}

function buildLine(
  reason: HonestUncertaintyResult['reason'],
  input: HonestUncertaintyInput,
  locale: Locale,
): string {
  const topicFallback = locale === 'sw' ? 'jambo hilo' : 'that';
  const topic = input.question_topic ?? topicFallback;
  const partial = input.known_partial_info;

  if (locale === 'sw') {
    if (reason === 'missing_info') {
      const fields = input.missing_required_info.slice(0, 3).join(', ');
      return `Sina ${fields} bado. Nipe hayo nami nitajibu.`;
    }
    if (reason === 'no_retrieval_match') {
      return `Sina ${topic} katika ninachoona. ${
        partial
          ? `Ninachokijua: ${partial}.`
          : 'Niambie unachojua nami nitaendelea kutoka hapo.'
      }`;
    }
    return `Sina uhakika kuhusu ${topic}. ${
      partial ? `Ninachokijua kwa hakika: ${partial}.` : 'Ningependa kuthibitisha kabla ya kusema zaidi.'
    }`;
  }

  if (reason === 'missing_info') {
    const fields = input.missing_required_info.slice(0, 3).join(', ');
    return `I don't have ${fields} yet. Share that and I'll answer.`;
  }
  if (reason === 'no_retrieval_match') {
    return `I don't have ${topic} in what I can see. ${
      partial ? `What I do have: ${partial}.` : "Tell me what you know and I'll work from there."
    }`;
  }
  return `I'm not confident on ${topic}. ${
    partial ? `What I'm sure of: ${partial}.` : "I'd want to verify before saying more."
  }`;
}

const EN_THEATRE_RX =
  /\b(i('?m| am) (so |very |truly |really )?sorry|i apologi[sz]e|unfortunately[,\s]+i)\b/i;
const SW_THEATRE_RX =
  /\b(samahani|naomba radhi|nasikitika|kwa bahati mbaya[,\s]+si)\b/i;

function containsTheatre(line: string, locale: Locale): boolean {
  return locale === 'sw' ? SW_THEATRE_RX.test(line) : EN_THEATRE_RX.test(line);
}

/**
 * Pure: strip theatrical apology that wraps an "I don't know" admission, in
 * the active locale only. Substance after the apology is preserved.
 */
export function stripTheatreFromUncertainty(
  candidate: string,
  locale: Locale = 'en',
): string {
  if (locale === 'sw') {
    return candidate
      .replace(
        /\bsamahani,?\s+(?:lakini\s+)?(?=si(?:wezi|na)\b)/gi,
        '',
      )
      .replace(/\b(naomba radhi|nasikitika)[,\s]+(?:lakini\s+)?/gi, '')
      .replace(/\bkwa bahati mbaya,?\s+(si(?:wezi|na))/gi, '$1')
      .replace(/^\s*[,.]+\s*/, '')
      .trim();
  }
  return candidate
    .replace(
      /\bi(?:'?m| am) (?:so |very |truly |really )?sorry,?\s+(?:but\s+)?(?=i (?:don'?t|cannot|can'?t))/gi,
      '',
    )
    .replace(/\bi (?:apologi[sz]e|am sorry)[,\s]+(?:but\s+)?/gi, '')
    .replace(/\bunfortunately,?\s+i (don'?t|cannot|can'?t)/gi, 'I $1')
    .replace(/^\s*[,.]+\s*/, '')
    .trim();
}
