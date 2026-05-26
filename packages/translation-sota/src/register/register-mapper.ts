/**
 * Register / honorific mapper.
 *
 * Detects the source register (formal / neutral / casual) by scanning
 * for Tanzanian honorific tokens and formal verbal markers, then
 * rewrites the provider output if the provider stripped them.
 *
 * Same approach the formality-sensitive MT (FSMT) literature uses:
 *   - arxiv 2311.13475 "Machine Translation to Control Formality
 *     Features in the Target Language" (November 2023):
 *     https://arxiv.org/pdf/2311.13475
 *   - arxiv 2405.11942 "FAME-MT Dataset: Formality Awareness Made Easy
 *     for Machine Translation Purposes" (May 2024):
 *     https://arxiv.org/pdf/2405.11942
 *
 * Tanzanian usage differs from Kenyan usage on a few terms — we default
 * to Tanzanian formal register since that's the Borjie user base
 * (FOUNDER_LOCKED — persona "Mr. Mwikila").
 *   - https://manenomatamu.wordpress.com/2011/11/20/swahili-kenyan-vs-tanzanian-speak-round-3-polite-expressions/
 */

import type { LanguageCode, RegisterLevel, RegisterTag } from '../types.js';
import {
  HONORIFIC_LEXICON_EN,
  HONORIFIC_LEXICON_SW,
} from '../glossary/seed-mining-glossary.js';

/**
 * Detect the register tag of a source utterance. Presence-based:
 *
 *   - Any honorific from the lexicon → formal.
 *   - Polite imperative markers ("tafadhali", "naomba", "please",
 *     "kindly", "may we", "may I") → formal.
 *   - Otherwise → neutral.
 *
 * The caller can override via the explicit `TranslationRequest.register`
 * field; this detection runs only when no caller hint was passed.
 */
export function detectRegister(
  sourceText: string,
  sourceLang: LanguageCode,
): RegisterTag {
  const lex =
    sourceLang === 'sw' ? HONORIFIC_LEXICON_SW : HONORIFIC_LEXICON_EN;
  const lower = sourceText.toLowerCase();
  for (const honorific of lex) {
    if (lower.includes(honorific)) {
      return Object.freeze({
        level: 'formal' as RegisterLevel,
        honorific,
      });
    }
  }
  if (sourceLang === 'sw') {
    if (/(tafadhali|naomba|nakuomba|ningependa)\b/.test(lower)) {
      return Object.freeze({
        level: 'formal' as RegisterLevel,
        honorific: undefined,
      });
    }
  } else {
    if (/(\bplease\b|\bkindly\b|\bmay (we|i)\b)/.test(lower)) {
      return Object.freeze({
        level: 'formal' as RegisterLevel,
        honorific: undefined,
      });
    }
  }
  return Object.freeze({
    level: 'neutral' as RegisterLevel,
    honorific: undefined,
  });
}

/**
 * Apply register preservation to provider output. When the source was
 * tagged `formal` but the provider's English / Swahili output starts
 * casually (no honorific, no polite prefix), we splice in the
 * canonical honorific opener for the target language.
 *
 * The function is intentionally non-destructive — it only PREPENDS
 * when the opener is missing, never rewrites content. Tests assert
 * idempotency.
 */
export function applyRegister(
  output: string,
  register: RegisterTag,
  targetLang: LanguageCode,
): string {
  if (register.level !== 'formal') {
    return output;
  }
  const trimmed = output.trimStart();
  if (alreadyOpensWithHonorific(trimmed, targetLang)) {
    return output;
  }
  const opener = formalOpener(targetLang, register.honorific);
  return `${opener}, ${output}`;
}

function alreadyOpensWithHonorific(
  output: string,
  targetLang: LanguageCode,
): boolean {
  const lex =
    targetLang === 'sw' ? HONORIFIC_LEXICON_SW : HONORIFIC_LEXICON_EN;
  const lower = output.toLowerCase();
  for (const honorific of lex) {
    if (lower.startsWith(honorific)) {
      return true;
    }
  }
  return false;
}

function formalOpener(
  targetLang: LanguageCode,
  honorific: string | undefined,
): string {
  if (targetLang === 'sw') {
    return capitalise(honorific ?? 'Ndugu');
  }
  return 'Dear sir or madam';
}

function capitalise(token: string): string {
  if (token.length === 0) {
    return token;
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}
