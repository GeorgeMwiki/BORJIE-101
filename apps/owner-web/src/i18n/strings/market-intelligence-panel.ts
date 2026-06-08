/**
 * market-intelligence-panel — guard-exempt Swahili+English string table
 * for `components/market/MarketIntelligencePanel.tsx`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the panel needs (titles, metric
 * labels, loading / error captions, forecast-band copy) lives here rather
 * than inline in the component — keeping the panel source free of
 * hardcoded Swahili tokens while preserving the symmetric
 * `T[k][locale]` call-site shape the component already uses.
 *
 * SHAPE
 * Each leaf is `{ en, sw }`, mirroring the original inline `const T`
 * exactly so existing call-sites (`tr(k) => T[k][locale]`) work unchanged.
 */

export const marketIntelligencePanelStrings = {
  title: { en: 'Market intelligence', sw: 'Akili ya soko' },
  subtitle: {
    en: 'Live commodity price, buy/sell/hold signal, 90-day demand forecast and active disruptions.',
    sw: 'Bei ya bidhaa moja kwa moja, ishara ya nunua/uza/shikilia, utabiri wa mahitaji wa siku 90 na vikwazo vilivyopo.',
  },
  commodity: { en: 'Commodity', sw: 'Bidhaa' },
  latestPrice: { en: 'Latest price', sw: 'Bei ya hivi karibuni' },
  source: { en: 'Source', sw: 'Chanzo' },
  asOf: { en: 'As of', sw: 'Hadi' },
  signal: { en: 'Signal', sw: 'Ishara' },
  confidence: { en: 'confidence', sw: 'uhakika' },
  reasoning: { en: 'Reasoning', sw: 'Sababu' },
  forecast: { en: '90-day forecast band', sw: 'Bendi ya utabiri wa siku 90' },
  forecastConfidence: { en: 'Band coverage', sw: 'Ufunikaji wa bendi' },
  drivers: { en: 'Drivers', sw: 'Vichocheo' },
  disruptions: { en: 'Active disruptions', sw: 'Vikwazo vilivyopo' },
  noDisruptions: { en: 'No active disruptions.', sw: 'Hakuna vikwazo vilivyopo.' },
  feedUnavailable: {
    en: 'No live price feed for this commodity yet. Gold is fed from the LBMA fix; copper and tanzanite feeds are not wired.',
    sw: 'Hakuna chanzo cha bei moja kwa moja kwa bidhaa hii bado. Dhahabu inatoka LBMA; shaba na tanzanite hazijaunganishwa.',
  },
  insufficientHistory: {
    en: 'Not enough price history yet to forecast — the feed appends fixes over time.',
    sw: 'Hakuna historia ya kutosha ya bei kutabiri bado — chanzo huongeza bei kadri muda unavyokwenda.',
  },
  loading: { en: 'Loading…', sw: 'Inapakia…' },
  error: { en: 'Could not load.', sw: 'Imeshindwa kupakia.' },
  now: { en: 'now', sw: 'sasa' },
  day90: { en: 'day 90', sw: 'siku 90' },
} as const;
