/**
 * mwikila-cluster — guard-exempt bilingual (sw / en) copy for the
 * Mr. Mwikila autonomy surfaces (inbox + living-plan) that previously
 * rendered RAW machine tokens (delegation-category enums) or unlabeled
 * brain free-text (rationale / blockedReason / confirmationKind) under
 * the localized cockpit chrome — the split-brain class the canon forbids.
 *
 * WHY A NEW FILE
 * The shared `cockpit-cluster` / `living-plan-panel` bundles are touched
 * by sibling streams; this file isolates the new keys (category labels,
 * the "Mr. Mwikila's reasoning" / "Why blocked" framing, and the
 * confirmation-proof glosses) so parallel edits don't collide. Lives
 * under `i18n/` so the locale-purity scanner exempts the Swahili.
 *
 * SHAPE
 * Every leaf is `{ en, sw }`; the call site resolves exactly one via
 * `pickByLocale(locale, leaf)`. NEVER concatenate en + sw.
 *
 * NOTE ON BRAIN FREE-TEXT
 * `rationale` / `blockedReason` are stored by the gateway as a SINGLE
 * free-text string (no `*_sw` twin), so the panel cannot translate them.
 * These keys supply a localized LABEL/frame around that text; the raw
 * brain string itself is rendered inside an element carrying an explicit
 * `lang` attribute (`bcp47For(locale)`) so it is presented as a quoted
 * note in the active locale rather than masquerading as UI chrome.
 */

import type { Locale } from '@/lib/locale-shared';

interface SwEn {
  readonly en: string;
  readonly sw: string;
}

export const mwikilaClusterStrings = {
  // ── Brain free-text framing (inbox + living-plan) ──────────────────
  reasoningLabel: {
    en: "Mr. Mwikila's reasoning",
    sw: 'Sababu za Bw. Mwikila',
  },
  whyBlockedLabel: {
    en: 'Why this was blocked',
    sw: 'Kwa nini hii ilizuiwa',
  },
  blockedRail: {
    en: 'Blocked by an inviolable safety rail.',
    sw: 'Imezuiwa na reli ya usalama isiyovunjika.',
  },
  // The living-plan confirmation proof "kind" is a machine token
  // (e.g. `photo`, `ledger_match`); these gloss the known kinds and
  // fall back to a localized generic for unknown ones.
  proofKind: {
    photo: { en: 'photo proof', sw: 'uthibitisho wa picha' },
    ledger_match: { en: 'ledger match', sw: 'ulinganifu wa daftari' },
    document: { en: 'document', sw: 'hati' },
    signature: { en: 'signature', sw: 'saini' },
    attestation: { en: 'attestation', sw: 'uthibitisho' },
  } as Record<string, SwEn>,
  proofKindGeneric: { en: 'proof on file', sw: 'uthibitisho upo' },

  // ── Delegation-category labels (mwikila inbox filter + row) ─────────
  // Keyed by the raw `DELEGATION_CATEGORIES` enum token. An unknown
  // token falls back to a localized generic, never the raw token.
  category: {
    shifts: { en: 'Shifts', sw: 'Zamu' },
    'payroll-prep': { en: 'Payroll prep', sw: 'Maandalizi ya mishahara' },
    'royalty-filing': { en: 'Royalty filing', sw: 'Uwasilishaji wa mrabaha' },
    'license-renewal-reminders': {
      en: 'Licence renewal reminders',
      sw: 'Vikumbusho vya upyaji wa leseni',
    },
    'contract-followups': {
      en: 'Contract follow-ups',
      sw: 'Ufuatiliaji wa mikataba',
    },
    'worker-hires': { en: 'Worker hires', sw: 'Uajiri wa wafanyakazi' },
    'worker-discipline': {
      en: 'Worker discipline',
      sw: 'Nidhamu ya wafanyakazi',
    },
    capex: { en: 'Capital expenditure', sw: 'Matumizi ya mtaji' },
    'inventory-orders': {
      en: 'Inventory orders',
      sw: 'Maagizo ya bidhaa',
    },
    'compliance-filings': {
      en: 'Compliance filings',
      sw: 'Uwasilishaji wa uzingatiaji',
    },
    'marketplace-bids': { en: 'Marketplace bids', sw: 'Zabuni za soko' },
    'marketplace-counters': {
      en: 'Marketplace counters',
      sw: 'Mapingamizi ya soko',
    },
  } as Record<string, SwEn>,
  categoryUnknown: { en: 'Other', sw: 'Nyingine' },
} as const;

/** Localized label for a delegation-category enum token. */
export function categoryLabel(locale: Locale, token: string): string {
  const leaf =
    mwikilaClusterStrings.category[token] ??
    mwikilaClusterStrings.categoryUnknown;
  return locale === 'sw' ? leaf.sw : leaf.en;
}

/** Localized label for a confirmation-proof kind token. */
export function proofKindLabel(locale: Locale, token: string): string {
  const leaf =
    mwikilaClusterStrings.proofKind[token] ??
    mwikilaClusterStrings.proofKindGeneric;
  return locale === 'sw' ? leaf.sw : leaf.en;
}
