/**
 * Localised EU AI Act Art. 50 disclosure strings.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §5
 *
 * Each surface × locale yields a distinct phrasing tuned to the medium.
 * Localisation is delegated to JurisdictionalRules in domain models;
 * this module supplies the canonical en + sw + fr-RW forms.
 */

import { type DisclosureLocale, type DisclosureSurface } from './types.js';

/** Generic AI-identity sentence per locale. */
const IDENTITY_BY_LOCALE: Readonly<Record<DisclosureLocale, string>> = Object.freeze({
  en: 'You are speaking with BORJIE, an AI assistant.',
  'en-TZ': 'You are speaking with BORJIE, an AI assistant.',
  'en-KE': 'You are speaking with BORJIE, an AI assistant.',
  'en-UG': 'You are speaking with BORJIE, an AI assistant.',
  sw: 'Unaongea na BORJIE, msaidizi wa AI (akili bandia).',
  'sw-TZ': 'Unaongea na BORJIE, msaidizi wa AI (akili bandia).',
  'sw-KE': 'Unaongea na BORJIE, msaidizi wa AI (akili bandia).',
  'fr-RW': "Vous parlez à BORJIE, un assistant IA (intelligence artificielle).",
});

/** "Type 'human' anytime to reach a person" line — surface-tailored. */
const HUMAN_HANDOFF_BY_LOCALE: Readonly<Record<DisclosureLocale, string>> = Object.freeze({
  en: "Type 'human' anytime to reach a person.",
  'en-TZ': "Type 'human' anytime to reach a person.",
  'en-KE': "Type 'human' anytime to reach a person.",
  'en-UG': "Type 'human' anytime to reach a person.",
  sw: "Andika 'mtu' wakati wowote ili kuongea na mtu wa kweli.",
  'sw-TZ': "Andika 'mtu' wakati wowote ili kuongea na mtu wa kweli.",
  'sw-KE': "Andika 'mtu' wakati wowote ili kuongea na mtu wa kweli.",
  'fr-RW': "Tapez 'humain' à tout moment pour parler à une personne.",
});

/**
 * Compose the surface-tailored prelude.
 *
 *   chat / whatsapp / sms: "Hi, " + identity + handoff
 *   email: a footer block citing the statute
 *   voice: identity only (handoff offered later in flow)
 */
export function buildDisclosureText(
  surface: DisclosureSurface,
  locale: DisclosureLocale
): string {
  const identity = IDENTITY_BY_LOCALE[locale] ?? IDENTITY_BY_LOCALE.en;
  const handoff = HUMAN_HANDOFF_BY_LOCALE[locale] ?? HUMAN_HANDOFF_BY_LOCALE.en;
  switch (surface) {
    case 'chat':
      return `Hi — ${identity} ${handoff}`;
    case 'whatsapp':
      return `${identity} ${handoff}`;
    case 'sms':
      return `${identity} Reply HUMAN to reach a person.`;
    case 'email':
      return `[AI Disclosure] ${identity} This thread is handled by an AI assistant under EU AI Act Art. 50. ${handoff}`;
    case 'voice':
      return identity;
    default:
      return identity;
  }
}

/** Default locale if none requested. */
export const DEFAULT_LOCALE: DisclosureLocale = 'en-TZ';
