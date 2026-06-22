/**
 * cost-engineer-panel — guard-exempt Swahili+English string table for the
 * owner finance `CostEngineerPanel`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the cost-engineer panel needs
 * (field labels, CTA copy, P&L / unit-economics metric labels, error and
 * empty captions) lives here rather than inline in the component — keeping
 * the panel source free of hardcoded Swahili tokens while preserving the
 * symmetric `T[k][locale]` call-site shape the panel already uses.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`. The EN and SW text is the
 * exact copy previously inlined in the component — preserved verbatim.
 */

export const costEngineerPanelStrings = {
  title: { en: 'Cost engineer', sw: 'Mhandisi wa gharama' },
  subtitle: {
    en: 'Compute P&L, unit economics and price/fuel sensitivity, then get evidence-backed cost advice.',
    sw: 'Kokotoa faida/hasara, uchumi wa kila tani na athari za bei/mafuta, kisha pata ushauri wa gharama wenye ushahidi.',
  },
  period: { en: 'Period label', sw: 'Lebo ya kipindi' },
  tonnesProduced: { en: 'Tonnes produced', sw: 'Tani zilizozalishwa' },
  tonnesSold: { en: 'Tonnes sold', sw: 'Tani zilizouzwa' },
  realisedPrice: { en: 'Realised price / tonne', sw: 'Bei halisi / tani' },
  royaltyRate: { en: 'Royalty rate (0–1)', sw: 'Kiwango cha mrabaha (0–1)' },
  treatment: { en: 'Treatment charge / tonne', sw: 'Gharama ya uchakataji / tani' },
  capex: { en: 'Capex amortisation', sw: 'Ustahimilishaji wa capex' },
  currency: { en: 'Currency', sw: 'Sarafu' },
  opex: { en: 'Opex buckets', sw: 'Mafungu ya gharama za uendeshaji' },
  opexLabelPlaceholder: { en: 'Label', sw: 'Lebo' },
  opexAmountPlaceholder: { en: 'Amount', sw: 'Kiasi' },
  addOpex: { en: '+ Add bucket', sw: '+ Ongeza fungu' },
  remove: { en: 'Remove', sw: 'Ondoa' },
  compute: { en: 'Compute analysis', sw: 'Kokotoa uchambuzi' },
  computing: { en: 'Computing…', sw: 'Inakokotoa…' },
  recommend: { en: 'Get recommendations', sw: 'Pata mapendekezo' },
  recommending: { en: 'Deriving…', sw: 'Inatoa…' },
  revenue: { en: 'Revenue', sw: 'Mapato' },
  grossProfit: { en: 'Gross profit', sw: 'Faida ghafi' },
  ebitda: { en: 'EBITDA', sw: 'EBITDA' },
  ebit: { en: 'EBIT', sw: 'EBIT' },
  netMargin: { en: 'Net margin', sw: 'Ukingo halisi' },
  costPerTonne: { en: 'Cash cost / tonne', sw: 'Gharama ya fedha / tani' },
  aisc: { en: 'AISC / tonne', sw: 'AISC / tani' },
  breakEven: { en: 'Break-even price / tonne', sw: 'Bei ya kuvunja-sawa / tani' },
  marginPerTonne: { en: 'Margin / tonne', sw: 'Ukingo / tani' },
  priceSensitivity: { en: 'Price sensitivity (EBITDA)', sw: 'Athari ya bei (EBITDA)' },
  fuelSensitivity: { en: 'Fuel sensitivity (EBITDA)', sw: 'Athari ya mafuta (EBITDA)' },
  recommendations: { en: 'Recommendations', sw: 'Mapendekezo' },
  evidence: { en: 'Evidence', sw: 'Ushahidi' },
  noRecs: {
    en: 'No cost issues flagged against the current benchmarks.',
    sw: 'Hakuna masuala ya gharama yaliyoonyeshwa dhidi ya vigezo vya sasa.',
  },
  persisted: { en: 'Snapshot saved', sw: 'Picha imehifadhiwa' },
  error: { en: 'Could not compute. Check inputs and retry.', sw: 'Imeshindwa kukokotoa. Angalia taarifa na ujaribu tena.' },
} as const;
