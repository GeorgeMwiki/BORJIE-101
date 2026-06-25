/**
 * Inventory surface (O-W-10, consumables / spares) — per-file {en, sw}
 * string module.
 *
 * Single language per active locale (zero-mix canon). Every key carries a
 * REAL Swahili translation; no machine-translation stubs, no English value
 * sitting in the `sw` slot. The endpoint `hint` strings are diagnostic and
 * not user copy — they stay as the bare path on both locales by design.
 */

export const inventorySurfaceStrings = {
  refresh: { en: 'Refresh', sw: 'Onyesha upya' },

  // Reorder candidates section
  reorderTitle: { en: 'Reorder candidates', sw: 'Bidhaa za kuagiza tena' },
  reorderSubtitle: {
    en: 'SKUs at or below their minimum, banded by value (ABC) with suggested order quantities.',
    sw: 'Bidhaa zilizo kwenye au chini ya kiwango cha chini, zilizopangwa kwa thamani (ABC) na idadi zinazopendekezwa za kuagiza.',
  },
  reorderLoadFailedTitle: {
    en: 'Could not load reorder candidates',
    sw: 'Imeshindwa kupakia bidhaa za kuagiza tena',
  },
  reorderEmptyTitle: { en: 'Nothing to reorder', sw: 'Hakuna cha kuagiza tena' },
  reorderEmptyBody: {
    en: 'No SKU is at or below its minimum stock level. Add SKUs and record stock movements to drive replenishment.',
    sw: 'Hakuna bidhaa iliyo kwenye au chini ya kiwango chake cha chini cha hifadhi. Ongeza bidhaa na rekodi mienendo ya hifadhi ili kuendesha ujazaji.',
  },

  // On-hand value section
  onHandTitle: { en: 'Stock on-hand value', sw: 'Thamani ya hifadhi iliyopo' },
  onHandSubtitle: {
    en: 'Σ quantity × unit cost by category — replayed from the movement log.',
    sw: 'Σ idadi × gharama ya kipimo kwa kila kundi — iliyochezwa upya kutoka kwa rekodi ya mienendo.',
  },
  onHandLoadFailedTitle: {
    en: 'Could not load on-hand value',
    sw: 'Imeshindwa kupakia thamani ya hifadhi iliyopo',
  },
  onHandEmptyTitle: { en: 'No stock on hand', sw: 'Hakuna hifadhi iliyopo' },
  onHandEmptyBody: {
    en: 'Recorded receipts will accumulate on-hand value here, grouped by category and valued at unit cost.',
    sw: 'Risiti zilizorekodiwa zitakusanya thamani ya hifadhi iliyopo hapa, zikipangwa kwa kundi na kuthaminiwa kwa gharama ya kipimo.',
  },

  // Generic load error
  unknownError: { en: 'unknown error', sw: 'hitilafu isiyojulikana' },

  // Reorder table columns
  colSku: { en: 'SKU', sw: 'Bidhaa' },
  colBand: { en: 'Band', sw: 'Kundi' },
  colOnHand: { en: 'On hand', sw: 'Iliyopo' },
  colMinimum: { en: 'Minimum', sw: 'Kiwango cha chini' },
  colShortfall: { en: 'Shortfall', sw: 'Upungufu' },
  colSuggestedQty: { en: 'Suggested qty', sw: 'Idadi inayopendekezwa' },
  colLeadDays: { en: 'Lead (days)', sw: 'Muda wa kusubiri (siku)' },

  // On-hand table columns + totals. The value header is currency-neutral
  // by design — the payload carries minor-units with no ISO code, so we
  // never assert a hardcoded symbol/code.
  colCategory: { en: 'Category', sw: 'Kundi' },
  colReportingValue: {
    en: 'Value (reporting ccy)',
    sw: 'Thamani (sarafu ya ripoti)',
  },
  total: { en: 'Total', sw: 'Jumla' },
} as const;
