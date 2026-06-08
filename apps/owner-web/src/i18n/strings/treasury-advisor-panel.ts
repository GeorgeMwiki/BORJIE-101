/**
 * treasury-advisor-panel — guard-exempt Swahili+English string table for
 * the owner treasury surface (`TreasuryAdvisorPanel`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal this panel needs (labels, CTA
 * copy, captions) lives here rather than inline in the component —
 * keeping the panel source free of hardcoded Swahili tokens while
 * preserving the `T[k][locale]` call-site shape the component already
 * uses.
 *
 * SHAPE
 * Flat map keyed by token. Each leaf is `{ en, sw }`. Imported into the
 * component aliased to `T` so existing call sites (`T[k][locale]`) keep
 * working unchanged.
 */

export const treasuryAdvisorPanelStrings = {
  title: { en: 'Treasury advisor', sw: 'Mshauri wa hazina' },
  subtitle: {
    en: 'Project cash runway and FX exposure from your balances and scheduled flows, then get evidence-backed treasury advice.',
    sw: 'Kadiria mtiririko wa fedha na hatari ya sarafu kutoka salio na malipo yaliyopangwa, kisha pata ushauri wa hazina wenye ushahidi.',
  },
  base: { en: 'Base currency', sw: 'Sarafu ya msingi' },
  horizon: { en: 'Horizon (days)', sw: 'Muda (siku)' },
  balances: { en: 'Cash balances', sw: 'Salio la fedha' },
  cashflows: { en: 'Scheduled cashflows', sw: 'Mitiririko iliyopangwa' },
  addBalance: { en: '+ Add balance', sw: '+ Ongeza salio' },
  addFlow: { en: '+ Add cashflow', sw: '+ Ongeza mtiririko' },
  remove: { en: 'Remove', sw: 'Ondoa' },
  compute: { en: 'Project runway', sw: 'Kadiria mtiririko' },
  computing: { en: 'Projecting…', sw: 'Inakadiria…' },
  recommend: { en: 'Get recommendations', sw: 'Pata mapendekezo' },
  recommending: { en: 'Deriving…', sw: 'Inatoa…' },
  startingBalance: { en: 'Starting balance', sw: 'Salio la kuanzia' },
  minBalance: { en: 'Minimum balance', sw: 'Salio la chini kabisa' },
  zeroCrossing: { en: 'Cash-out date', sw: 'Tarehe ya kuisha fedha' },
  neverInHorizon: { en: 'None within horizon', sw: 'Hakuna ndani ya muda' },
  exposure: { en: 'FX exposure (net, base)', sw: 'Hatari ya sarafu (halisi, msingi)' },
  recommendations: { en: 'Recommendations', sw: 'Mapendekezo' },
  evidence: { en: 'Evidence', sw: 'Ushahidi' },
  noRecs: {
    en: 'No treasury risks flagged against the current policy.',
    sw: 'Hakuna hatari za hazina zilizoonyeshwa dhidi ya sera ya sasa.',
  },
  persisted: { en: 'Snapshot saved', sw: 'Picha imehifadhiwa' },
  error: { en: 'Could not project. Check inputs and retry.', sw: 'Imeshindwa kukadiria. Angalia taarifa na ujaribu tena.' },
  direction: { en: 'Dir', sw: 'Mwelekeo' },
  due: { en: 'Due', sw: 'Tarehe' },
  amount: { en: 'Amount', sw: 'Kiasi' },
  category: { en: 'Category', sw: 'Aina' },
} as const;
