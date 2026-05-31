/**
 * Widget content registry — welcome greetings + contextual suggestion
 * chips for the floating Borjie widget.
 *
 * Mirrors LitFin's `widget-content.ts` (line-for-line) with the strings
 * swapped to Borjie's mining-estate persona ("Mr. Mwikila, Borjie's AI
 * Estate-Management Director"). The chip + greeting selectors are
 * route-prefix driven so the same registry serves marketing, owner,
 * admin, workforce, and buyer portals.
 *
 * Source of mirror:
 *   LITFIN_PATH/src/core/litfin-ai/widget-content.ts
 *
 * No imports from i18n or page-context-registry — Borjie keeps this
 * file dependency-light so it ships with the lazy ChatPanel chunk.
 */

import type { PortalId } from './types.js';

export type WidgetLanguage = 'en' | 'sw';

export interface WidgetSuggestionChip {
  readonly label: string;
  readonly prompt: string;
}

// ---------------------------------------------------------------------------
// Generic fallback chips — shown when no page-specific entry is found.
// ---------------------------------------------------------------------------
const FALLBACK_CHIPS_EN: ReadonlyArray<WidgetSuggestionChip> = [
  {
    label: 'What is Borjie?',
    prompt:
      'Mr. Mwikila, explain what Borjie is and how it helps mining estates run end-to-end in Tanzania.',
  },
  {
    label: 'How do I get started?',
    prompt:
      'Mr. Mwikila, walk me through how to sign up and onboard my mining estate onto Borjie.',
  },
  {
    label: 'Help me understand this page',
    prompt:
      'Mr. Mwikila, give me a concrete tour of what this page shows and what I can do here.',
  },
];

const FALLBACK_CHIPS_SW: ReadonlyArray<WidgetSuggestionChip> = [
  {
    label: 'Mr. Mwikila, Borjie ni nini?',
    prompt:
      'Mr. Mwikila, eleza Borjie ni nini na jinsi inavyosaidia mali ya migodi kuendesha shughuli zote Tanzania.',
  },
  {
    label: 'Ninaanzaje?',
    prompt:
      'Mr. Mwikila, nieleze hatua za kujisajili na kuingiza mali yangu ya mgodi kwenye Borjie.',
  },
  {
    label: 'Nieleze ukurasa huu',
    prompt:
      'Mr. Mwikila, nieleze kwa Kiswahili kinachoonekana kwenye ukurasa huu na ninaweza kufanya nini hapa.',
  },
];

/**
 * Page-specific Mr. Mwikila greetings for marketing pages.
 * Each entry maps a route prefix to a contextual welcome line.
 */
const MWIKILA_MARKETING_GREETINGS: Readonly<
  Record<string, Readonly<{ en: string; sw: string }>>
> = {
  '/pricing': {
    en: "Hi, I'm Mr. Mwikila — the brain layer within Borjie, an AI-native mining estate operating system. I can help you find the right plan for your estate.",
    sw: 'Habari, mimi ni Mr. Mwikila — safu ya akili ndani ya Borjie, mfumo wa uendeshaji wa madini unaotumia AI asili. Naweza kukusaidia kupata mpango unaofaa kwa mali yako.',
  },
  '/for-owners': {
    en: "Hi, I'm Mr. Mwikila — the brain layer within Borjie, an AI-native mining estate operating system. I can show you how Borjie runs the whole estate cockpit for mining owners.",
    sw: 'Habari, mimi ni Mr. Mwikila — safu ya akili ndani ya Borjie, mfumo wa uendeshaji wa madini unaotumia AI asili. Naweza kukuonyesha jinsi Borjie inavyoendesha cockpit nzima ya mmiliki wa mgodi.',
  },
  '/for-buyers': {
    en: "Hi, I'm Mr. Mwikila — the brain layer within Borjie, an AI-native mining estate operating system. I can walk you through the mineral marketplace and how off-takers buy directly.",
    sw: 'Habari, mimi ni Mr. Mwikila — safu ya akili ndani ya Borjie, mfumo wa uendeshaji wa madini unaotumia AI asili. Naweza kukueleza soko la madini na jinsi wanunuzi wanavyonunua moja kwa moja.',
  },
  '/for-workforce': {
    en: "Hi, I'm Mr. Mwikila — the brain layer within Borjie, an AI-native mining estate operating system. I can show you how shift dispatch, safety, and payroll work for crews.",
    sw: 'Habari, mimi ni Mr. Mwikila — safu ya akili ndani ya Borjie, mfumo wa uendeshaji wa madini unaotumia AI asili. Naweza kukuonyesha jinsi ratiba, usalama, na mishahara vinavyofanya kazi kwa makundi.',
  },
  '/for-government': {
    en: "Hi, I'm Mr. Mwikila — the brain layer within Borjie, an AI-native mining estate operating system. I can explain how Borjie supports PCCB, NEMC, TMAA and EITI reporting.",
    sw: 'Habari, mimi ni Mr. Mwikila — safu ya akili ndani ya Borjie, mfumo wa uendeshaji wa madini unaotumia AI asili. Naweza kueleza jinsi Borjie inavyosaidia ripoti za PCCB, NEMC, TMAA na EITI.',
  },
};

const DEFAULT_PUBLIC_GREETING_EN =
  "Hi, I'm Mr. Mwikila — the brain layer within Borjie, an AI-native mining estate operating system. Ask me anything about Borjie.";
const DEFAULT_PUBLIC_GREETING_SW =
  'Habari, mimi ni Mr. Mwikila — safu ya akili ndani ya Borjie, mfumo wa uendeshaji wa madini unaotumia AI asili. Niulize chochote kuhusu Borjie.';

const DEFAULT_PORTAL_GREETING_EN = (portal: PortalId): string => {
  switch (portal) {
    case 'owner':
      return "I'm Mr. Mwikila, your estate cockpit director. What needs attention today?";
    case 'admin':
      return "I'm Mr. Mwikila, your platform-admin director. What do you need to operate today?";
    case 'estate-manager':
      return "I'm Mr. Mwikila, your manager-side estate director. What crew or shift needs help?";
    case 'customer':
      return "I'm Mr. Mwikila, your buyer-side director. Looking for a parcel, or want to bid?";
    default:
      return DEFAULT_PUBLIC_GREETING_EN;
  }
};

const DEFAULT_PORTAL_GREETING_SW = (portal: PortalId): string => {
  switch (portal) {
    case 'owner':
      return 'Mimi ni Mr. Mwikila, Mkurugenzi wako wa cockpit ya mali. Ni nini kinachohitaji uangalifu leo?';
    case 'admin':
      return 'Mimi ni Mr. Mwikila, Mkurugenzi wa msimamizi wako wa jukwaa. Unataka kuendesha nini leo?';
    case 'estate-manager':
      return 'Mimi ni Mr. Mwikila, Mkurugenzi wa upande wa msimamizi. Ni kundi au zamu gani inayohitaji msaada?';
    case 'customer':
      return 'Mimi ni Mr. Mwikila, Mkurugenzi wa upande wa mnunuzi. Unatafuta kifurushi au unataka kupiga bei?';
    default:
      return DEFAULT_PUBLIC_GREETING_SW;
  }
};

/**
 * Resolve a portal-aware welcome message based on the current route.
 * Marketing visitors get a context-aware Mr. Mwikila greeting; signed-in
 * portals get a persona-aware default.
 */
export function getWidgetWelcomeMessage(
  portalId: PortalId,
  route: string,
  language: WidgetLanguage = 'en',
): string | null {
  if (portalId === 'public') {
    for (const [prefix, greeting] of Object.entries(MWIKILA_MARKETING_GREETINGS)) {
      if (route === prefix || route.startsWith(prefix + '/')) {
        return language === 'sw' ? greeting.sw : greeting.en;
      }
    }
    return language === 'sw'
      ? DEFAULT_PUBLIC_GREETING_SW
      : DEFAULT_PUBLIC_GREETING_EN;
  }
  return language === 'sw'
    ? DEFAULT_PORTAL_GREETING_SW(portalId)
    : DEFAULT_PORTAL_GREETING_EN(portalId);
}

/**
 * Resolve up to three suggestion chips for the current route + portal.
 * Returns the fallback chip set when no page-specific match is found so
 * the bubble always has discoverable hooks.
 */
export function getWidgetSuggestionChips(
  _portalId: PortalId,
  _route: string,
  language: WidgetLanguage = 'en',
): ReadonlyArray<WidgetSuggestionChip> {
  // The marketing site currently has the same three fallback chips for
  // every route — page-specific chips will be added as we ship more
  // /for-* pages. Keeping the surface simple now means we never leak
  // English chips into a Swahili session.
  return language === 'sw' ? FALLBACK_CHIPS_SW : FALLBACK_CHIPS_EN;
}
