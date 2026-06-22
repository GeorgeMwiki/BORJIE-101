/**
 * Counterparties surface (O-W-24) — per-file {en, sw} string module.
 *
 * Single language per active locale (zero-mix canon). Every key carries a
 * REAL Swahili translation; no machine-translation stubs, no English value
 * sitting in the `sw` slot.
 */

export const counterpartiesStrings = {
  searchPlaceholder: { en: 'Search by name', sw: 'Tafuta kwa jina' },
  filterAll: { en: 'All', sw: 'Zote' },
  colName: { en: 'Name', sw: 'Jina' },
  colType: { en: 'Type', sw: 'Aina' },
  colCountry: { en: 'Country', sw: 'Nchi' },
  colScorecard: { en: 'Scorecard', sw: 'Alama' },
  colActions: { en: '', sw: '' },
  open: { en: 'Open', sw: 'Fungua' },
  emptyTitle: { en: 'No counterparties yet', sw: 'Hakuna washirika bado' },
  emptyBody: {
    en: 'Use Mr. Mwikila to add the first external party your operation touches.',
    sw: 'Tumia Bw. Mwikila kuongeza mshirika wa kwanza wa nje anayehusika na shughuli zako.',
  },
  tileCounterparties: { en: 'Counterparties', sw: 'Washirika' },
  tileDownstream: { en: 'Downstream', sw: 'Mnyororo wa chini' },
  tileRegulators: { en: 'Regulators', sw: 'Wadhibiti' },
  tileAdjacent: { en: 'Adjacent', sw: 'Wa karibu' },
  drawerEyebrow: { en: 'Counterparty', sw: 'Mshirika' },
  timeline: { en: 'Engagement timeline', sw: 'Ratiba ya ushirikiano' },
  timelineEmpty: { en: 'No engagements logged yet.', sw: 'Hakuna ushirikiano uliorekodiwa bado.' },
  audit: { en: 'audit', sw: 'ukaguzi' },
} as const;
