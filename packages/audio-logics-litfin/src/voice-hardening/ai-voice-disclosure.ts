/**
 * AI-voice disclosure builder (LP-27).
 *
 * Synthetic-voice disclosure floor (SB 942 + EU AI Act Art 50; TZ PDPA good
 * practice): every customer-facing synthesised voice session must prepend an
 * audible disclosure to the first TTS chunk and write a tamper-evident audit
 * anchor. This module builds the localised header text + its SHA-256 anchor +
 * a UI badge label. The streaming TTS layer prepends the text; the host
 * writes the audit row.
 *
 * Customer-facing copy uses commas / colons / periods only (no em dashes),
 * per the project style invariant. Single-language per active locale.
 *
 * @module @borjie/audio-logics-litfin/voice-hardening/ai-voice-disclosure
 */

import { createHash } from 'node:crypto';

export type DisclosureLocale = 'en' | 'sw' | 'sw-TZ' | 'sw-KE';

const DISCLOSURE_TEXT: Readonly<Record<DisclosureLocale, string>> = Object.freeze({
  en: 'AI voice notice: this is an AI voice, not a human caller.',
  sw: 'Tangazo la sauti ya AI: hii ni sauti ya AI, sio mtu halisi.',
  'sw-TZ': 'Tangazo la sauti ya AI: hii ni sauti ya AI, sio mtu halisi.',
  'sw-KE': 'Tangazo la sauti ya AI: hii ni sauti ya AI, sio mtu halisi.',
});

const BADGE_LABEL: Readonly<Record<DisclosureLocale, string>> = Object.freeze({
  en: 'AI voice',
  sw: 'Sauti ya AI',
  'sw-TZ': 'Sauti ya AI',
  'sw-KE': 'Sauti ya AI',
});

export interface DisclosureHeader {
  readonly locale: DisclosureLocale;
  /** Spoken text to prepend to the first TTS chunk per session. */
  readonly text: string;
  /** SHA-256 of the header text (utf-8) — the audit anchor. */
  readonly sha256: string;
  /** Short UI badge label. */
  readonly badge: string;
}

/** Normalise an arbitrary locale string to a supported disclosure locale. */
export function normaliseDisclosureLocale(input: string): DisclosureLocale {
  const lower = input.toLowerCase();
  if (lower === 'sw-tz') return 'sw-TZ';
  if (lower === 'sw-ke') return 'sw-KE';
  if (lower === 'sw' || lower.startsWith('sw-')) return 'sw';
  return 'en';
}

/**
 * Build the localised AI-voice disclosure header. Unknown locale falls back
 * to English so a session is never silently undisclosed; the returned
 * `locale` reflects the resolved value.
 */
export function buildDisclosureHeader(locale: DisclosureLocale | string): DisclosureHeader {
  const resolved = normaliseDisclosureLocale(locale);
  const text = DISCLOSURE_TEXT[resolved];
  const badge = BADGE_LABEL[resolved];
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  return { locale: resolved, text, sha256, badge };
}

/** UI-only helper: badge string for the voice control bar. */
export function getDisclosureBadge(locale: DisclosureLocale | string): string {
  return BADGE_LABEL[normaliseDisclosureLocale(locale)];
}
