/**
 * licence-cockpit — guard-exempt bilingual (sw / en) copy for the
 * per-licence cockpit surface and the licences index hero, which
 * previously rendered hardcoded English under the localized cockpit
 * chrome (the split-brain class).
 *
 * Covered surfaces: components/licence/LicenceSurface.tsx,
 * components/licence/CountdownCards.tsx, components/licence/DormancyCard.tsx,
 * components/licence/RenewalActions.tsx, the LicencesList status pills +
 * dormancy label, and the licences/page.tsx hero actions.
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 * Every leaf is an `{ en, sw }` pair (or a pure function returning one
 * when the original interpolated a value), picked with `pickByLocale`.
 */

import type { Locale } from '@/lib/locale-shared';

export const licenceCockpitStrings = {
  // ── components/licence/LicenceSurface.tsx ─────────────────────────
  surface: {
    notFoundTitle: { en: 'Licence not found', sw: 'Leseni haijapatikana' },
    notFoundBody: {
      en: 'This licence does not exist for your account, or the link is stale. Open a licence from your licences list.',
      sw: 'Leseni hii haipo kwenye akaunti yako, au kiungo kimepitwa na wakati. Fungua leseni kutoka kwenye orodha yako ya leseni.',
    },
    loadErrorTitle: {
      en: 'Could not load this licence',
      sw: 'Imeshindwa kupakia leseni hii',
    },
    loadErrorBody: (detail: string) => ({
      en: `The licence cockpit failed to load. ${detail}`,
      sw: `Dashibodi ya leseni imeshindwa kupakia. ${detail}`,
    }),
    loadErrorRetry: { en: 'Please try again.', sw: 'Tafadhali jaribu tena.' },
    noDataTitle: { en: 'No licence data', sw: 'Hakuna data ya leseni' },
    noDataBody: {
      en: 'This licence has no renewal, dormancy, or payment data recorded yet.',
      sw: 'Leseni hii bado haina data ya kuongeza muda, dormancy, au malipo iliyorekodiwa.',
    },
    summaryTitle: { en: 'Licence summary', sw: 'Muhtasari wa leseni' },
    refLabel: { en: 'Reference', sw: 'Kumbukumbu' },
    mineralLabel: { en: 'Mineral', sw: 'Madini' },
    siteLabel: { en: 'Site', sw: 'Eneo' },
  },

  // Mineral enum → localized label (raw enum tokens never render directly).
  mineral: {
    gold: { en: 'Gold', sw: 'Dhahabu' },
    coltan: { en: 'Coltan', sw: 'Koltani' },
    tanzanite: { en: 'Tanzanite', sw: 'Tanzanite' },
  },

  // ── components/licence/CountdownCards.tsx ─────────────────────────
  countdown: {
    gate: (key: string) => ({
      en: `${key} renewal gate`,
      sw: `Lango la kuongeza ${key}`,
    }),
    reached: { en: 'reached', sw: 'imefikiwa' },
    daysToGo: (days: number) => ({
      en: `${days}d to go`,
      sw: `siku ${days} zimebaki`,
    }),
    window: (opens: string, closes: string) => ({
      en: `window opens ${opens} · closes ${closes}`,
      sw: `dirisha hufunguka ${opens} · hufungwa ${closes}`,
    }),
  },

  // ── components/licence/DormancyCard.tsx ───────────────────────────
  dormancy: {
    title: {
      en: 'Dormancy score (Mining Act 2010 §44)',
      sw: 'Alama ya dormancy (Sheria ya Madini 2010 §44)',
    },
  },

  // ── components/licence/RenewalActions.tsx ─────────────────────────
  renewal: {
    title: { en: 'Renewal pack', sw: 'Pakiti ya kuongeza muda' },
    completePct: (pct: number) => ({
      en: `${pct}% complete`,
      sw: `${pct}% imekamilika`,
    }),
    generate: {
      en: 'Generate renewal pack',
      sw: 'Tengeneza pakiti ya kuongeza muda',
    },
    ready: {
      en: 'Renewal pack ready for review.',
      sw: 'Pakiti ya kuongeza muda iko tayari kukaguliwa.',
    },
    openPdf: { en: 'Open PDF', sw: 'Fungua PDF' },
    // Renewal-pack checklist item KEYS → owner-facing labels. The backend
    // emits stable keys in `renewalPackMissing` (locale-neutral wire); we map
    // each to the active locale here. Unknown keys fall back to the raw token
    // (single-locale, never a cross-language gloss).
    packItem: {
      epp: { en: 'Environmental Protection Plan', sw: 'Mpango wa Kulinda Mazingira' },
      eia: {
        en: 'Environmental Impact Assessment',
        sw: 'Tathmini ya Athari za Mazingira',
      },
      community_benefit: {
        en: 'Community benefit agreement',
        sw: 'Mkataba wa manufaa ya jamii',
      },
      annual_fee_paid: { en: 'Annual fee receipt', sw: 'Risiti ya ada ya mwaka' },
      production_returns: {
        en: 'Production returns filed',
        sw: 'Taarifa za uzalishaji zimewasilishwa',
      },
    },
  },

  // ── components/licences/LicencesList.tsx (status pills + dormancy) ─
  list: {
    pillActive: { en: 'Active', sw: 'Hai' },
    pillExpiring: { en: 'Expiring soon', sw: 'Inakaribia kuisha' },
    pillExpired: { en: 'Expired', sw: 'Imekwisha' },
    pillInReview: { en: 'In review', sw: 'Inakaguliwa' },
    pillUnknown: { en: 'Unknown', sw: 'Haijulikani' },
    dormancyLabel: { en: 'Dormancy', sw: 'Dormancy' },
  },

  // ── licence/page.tsx (no licence selected via ?id=) ───────────────
  page: {
    noSelectionTitle: {
      en: 'No licence selected',
      sw: 'Hakuna leseni iliyochaguliwa',
    },
    noSelectionBody: {
      en: 'Open a licence from your licences list to see its renewal window, dormancy score, and payment history.',
      sw: 'Fungua leseni kutoka kwenye orodha yako ya leseni ili kuona dirisha la kuongeza muda, alama ya dormancy, na historia ya malipo.',
    },
  },

  // ── licences/page.tsx (hero actions) ──────────────────────────────
  hero: {
    draftRenewalPack: {
      en: 'Draft renewal pack',
      sw: 'Tayarisha pakiti ya kuongeza',
    },
    noExpiringNote: {
      en: 'No expiring licence',
      sw: 'Hakuna leseni inayokaribia kuisha',
    },
    askMasterBrain: { en: 'Ask Master Brain', sw: 'Uliza Akili Kuu' },
  },
} as const;

/**
 * Localized mineral label for the licence-cockpit mineral enum. Falls back
 * to the raw token (single-locale, never a cross-language gloss) for an
 * unexpected value so an unknown mineral surfaces honestly rather than
 * silently disappearing.
 */
export function mineralLabel(locale: Locale, mineral: string): string {
  const table = licenceCockpitStrings.mineral as Record<
    string,
    { readonly en: string; readonly sw: string } | undefined
  >;
  const entry = table[mineral];
  return entry ? entry[locale] : mineral;
}

/**
 * Localized label for a renewal-pack checklist item KEY emitted by the backend
 * in `renewalPackMissing` (locale-neutral wire). Falls back to the raw key
 * token (single-locale, never a cross-language gloss) for an unexpected value
 * so an unknown obligation surfaces honestly rather than disappearing.
 */
export function renewalPackItemLabel(locale: Locale, key: string): string {
  const table = licenceCockpitStrings.renewal.packItem as Record<
    string,
    { readonly en: string; readonly sw: string } | undefined
  >;
  const entry = table[key];
  return entry ? entry[locale] : key;
}
