/**
 * Recipient locale resolution.
 *
 * Centralises the "what locale should this surface render in" rule
 * so every send site agrees:
 *
 *   profile.preferred_language
 *   ↓ falls back to
 *   tenant.default_language
 *   ↓ falls back to
 *   'en'  (English-default per CLAUDE.md update 2026-05-31)
 *
 * Callers pass whatever they have; the resolver picks the first
 * truthy ISO-639-1 code that maps to a supported language.
 */

import type { Locale } from './types.js';

const SUPPORTED: ReadonlySet<Locale> = new Set(['sw', 'en']);

export interface RecipientLocaleInputs {
  readonly profilePreferredLanguage?: string | null | undefined;
  readonly tenantDefaultLanguage?: string | null | undefined;
  readonly fallback?: Locale;
}

export function resolveRecipientLocale(inputs: RecipientLocaleInputs): Locale {
  const fallback = inputs.fallback ?? 'en';

  const candidates = [
    inputs.profilePreferredLanguage,
    inputs.tenantDefaultLanguage,
  ];

  for (const c of candidates) {
    if (typeof c === 'string') {
      const normalised = c.trim().toLowerCase() as Locale;
      if (SUPPORTED.has(normalised)) {
        return normalised;
      }
    }
  }
  return fallback;
}

/** Returns the OPPOSITE locale for canonical-source → recipient translation. */
export function sourceLangFor(targetLang: Locale): Locale {
  return targetLang === 'sw' ? 'en' : 'sw';
}
