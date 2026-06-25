/**
 * saved-searches-page — guard-exempt bilingual (sw / en) copy for the
 * Settings → Saved searches panel
 * (app/(routes)/settings/saved-searches/saved-searches-panel.tsx).
 *
 * Consolidates every user-facing string for the panel into ONE per-surface
 * bundle so the component holds zero inline `{ en, sw }` literals (which would
 * be hardcoded Swahili in a component file, tripping the locale-purity guard).
 * Each entry is a strict `{ en, sw }` pair resolved with `pickByLocale` — never
 * concatenated, never mixed.
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const savedSearchesStrings = {
  // ── create form ────────────────────────────────────────────────────
  newSearchHeading: { en: 'New saved search', sw: 'Utafutaji mpya' },
  newSearchTagline: {
    en: 'New search: give it a name, write your query, choose a cadence',
    sw: 'Utafutaji mpya: toa jina, andika maswali yako, chagua mzunguko',
  },
  labelField: { en: 'Label', sw: 'Jina' },
  labelPlaceholder: { en: 'Gold 22k+ Geita', sw: 'Dhahabu 22k+ Geita' },
  queryField: { en: 'Query JSON', sw: 'Maswali (JSON)' },
  queryPlaceholder: {
    en: '{"commodity":"gold","minPurity":22,"region":"geita"}',
    sw: '{"commodity":"gold","minPurity":22,"region":"geita"}',
  },
  frequencyField: { en: 'Frequency', sw: 'Mzunguko' },
  sourceField: { en: 'Source', sw: 'Chanzo' },

  // ── frequency enum ─────────────────────────────────────────────────
  frequencyHourly: { en: 'Hourly', sw: 'Kila saa' },
  frequencyDaily: { en: 'Daily', sw: 'Kila siku' },
  frequencyWeekly: { en: 'Weekly', sw: 'Kila wiki' },

  // ── source enum ────────────────────────────────────────────────────
  sourceMarketplace: { en: 'Marketplace', sw: 'Soko' },
  sourceOpportunities: { en: 'Opportunities', sw: 'Fursa' },
  sourceRegulatory: { en: 'Regulatory', sw: 'Kanuni' },

  // ── actions / status ───────────────────────────────────────────────
  save: { en: 'Save', sw: 'Hifadhi' },
  saving: { en: 'Saving…', sw: 'Inahifadhi…' },
  delete: { en: 'Delete', sw: 'Futa' },
  loading: { en: 'Loading…', sw: 'Inapakia…' },

  // ── errors ─────────────────────────────────────────────────────────
  errorPrefix: { en: 'Error: ', sw: 'Hitilafu: ' },
  invalidQueryJson: {
    en: 'Query JSON is invalid',
    sw: 'Maswali ya JSON si sahihi',
  },

  // ── saved list ─────────────────────────────────────────────────────
  savedListHeading: {
    en: 'Your saved searches',
    sw: 'Utafutaji wako uliohifadhiwa',
  },
  savedListTagline: {
    en: 'Your saved searches',
    sw: 'Utafutaji wako uliohifadhiwa',
  },
  emptyList: {
    en: 'No saved searches yet.',
    sw: 'Hakuna utafutaji uliohifadhiwa.',
  },
  notYetRun: { en: 'not yet run', sw: 'haijatekelezwa bado' },
} as const;

/** "last {timestamp}" — the timestamp is locale-formatted by the caller. */
export const savedSearchLastRun = (
  when: string,
): { readonly en: string; readonly sw: string } => ({
  en: `last ${when}`,
  sw: `mwisho ${when}`,
});

/** "{count} matches" — count is a locale-formatted number from the caller. */
export const savedSearchMatches = (
  count: string,
): { readonly en: string; readonly sw: string } => ({
  en: `${count} matches`,
  sw: `${count} mechi`,
});
