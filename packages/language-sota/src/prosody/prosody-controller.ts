/**
 * Prosody controller — output SSML for the downstream TTS providers.
 *
 * SSML is the W3C-standardised XML markup that providers like Google
 * Cloud TTS, AWS Polly Neural, and Microsoft Azure understand (W3C
 * SSML 1.1 recommendation). ElevenLabs v3 does NOT support break tags
 * but does accept the prosody envelope verbatim — we emit a portable
 * subset that all providers understand and let the provider port drop
 * unsupported tags as needed.
 *
 * The XML escaping uses only the five required entity references — no
 * external XML library, no I/O.
 */

import type { Language, Prosody } from '../types.js';

export interface SsmlInput {
  readonly text: string;
  readonly lang: Language;
  readonly prosody: Prosody;
}

export interface SsmlConfig {
  /** Default rate in [50, 200] — 100 is normal speed. */
  readonly defaultRatePct?: number;
  /** Default pitch semitone offset in [-12, 12]. */
  readonly defaultPitchSt?: number;
  /** When true, wrap user-question utterances with rising prosody. */
  readonly emphasiseRisingQuestions?: boolean;
}

const LANGUAGE_LOCALE: Readonly<Record<Language, string>> = Object.freeze({
  en: 'en-US',
  sw: 'sw-TZ',
  sheng: 'sw-KE',
  'code-switch': 'sw-TZ',
});

/**
 * Build the canonical SSML document for an utterance. The returned
 * string is a well-formed XML fragment beginning with `<speak …>`.
 */
export function buildSsml(
  input: SsmlInput,
  config: SsmlConfig = {},
): string {
  const locale = LANGUAGE_LOCALE[input.lang];
  const rate = config.defaultRatePct ?? 100;
  const pitchSt = config.defaultPitchSt ?? 0;
  const ratePct = `${rate}%`;
  const pitchTag = pitchSt === 0 ? '0st' : `${pitchSt > 0 ? '+' : ''}${pitchSt}st`;
  const inner = wrapWithProsody(
    input.text,
    input.prosody,
    config.emphasiseRisingQuestions ?? true,
  );
  return [
    `<speak version="1.1" xml:lang="${locale}">`,
    `<prosody rate="${ratePct}" pitch="${pitchTag}">`,
    inner,
    `</prosody>`,
    `</speak>`,
  ].join('');
}

function wrapWithProsody(
  text: string,
  prosody: Prosody,
  emphasiseRising: boolean,
): string {
  const escaped = escapeXml(text);
  if (prosody.intonationShape === 'rising' && emphasiseRising) {
    return `<prosody pitch="+2st">${escaped}</prosody>`;
  }
  if (prosody.intonationShape === 'falling') {
    return `<prosody pitch="-1st">${escaped}</prosody>`;
  }
  if (prosody.intonationShape === 'undulating') {
    return `<emphasis level="strong">${escaped}</emphasis>`;
  }
  return escaped;
}

/**
 * XML-escape the five required entities. No dependency on a DOM
 * library — the spec wants pure functions.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
