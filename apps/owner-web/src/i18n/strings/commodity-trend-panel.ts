/**
 * commodity-trend-panel — guard-exempt Swahili+English string table for
 * the owner treasury surface (`CommodityTrendPanel`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal this panel needs (heading,
 * captions, states, the commodity dropdown labels) lives here rather than
 * inline in the component — keeping the panel source free of hardcoded
 * strings and rendering exactly ONE language per active locale.
 *
 * SHAPE
 * Flat map keyed by token. Each leaf is `{ en, sw }`; functional leaves
 * return `{ en, sw }` when the original interpolated a value. The call
 * site resolves exactly one via `pickByLocale` — NEVER concatenate.
 */

import type { Locale } from '@/lib/locale-shared';
import type { Commodity } from '@/lib/queries/commodity-intelligence';

interface SwEn {
  readonly en: string;
  readonly sw: string;
}

export const commodityTrendPanelStrings = {
  title: { en: 'Commodity trend advisor', sw: 'Mshauri wa mwelekeo wa madini' },
  subtitle: {
    en: 'Benchmark price trend + lock / delay-sale signals',
    sw: 'Mwelekeo wa bei ya kigezo + ishara za kufunga / kuahirisha mauzo',
  },
  selectCommodity: { en: 'Select commodity', sw: 'Chagua madini' },
  unavailable: {
    en: 'Advisor unavailable. Try again shortly.',
    sw: 'Mshauri hapatikani. Jaribu tena hivi punde.',
  },
  latest: { en: 'Latest', sw: 'Ya hivi karibuni' },
  perTonne: { en: '/ tonne', sw: '/ tani' },
  sources: (list: string): SwEn => ({
    en: `sources: ${list}`,
    sw: `vyanzo: ${list}`,
  }),
  noTickerData: {
    en: 'No ticker data for this commodity yet.',
    sw: 'Hakuna data ya bei kwa madini haya bado.',
  },
  evidence: (ids: string): SwEn => ({
    en: `Evidence: ${ids}`,
    sw: `Ushahidi: ${ids}`,
  }),
  noSignals: {
    en: 'No price-action signals at current thresholds.',
    sw: 'Hakuna ishara za mwenendo wa bei kwa vigezo vya sasa.',
  },
  commodity: {
    gold: { en: 'Gold', sw: 'Dhahabu' },
    silver: { en: 'Silver', sw: 'Fedha' },
    copper: { en: 'Copper', sw: 'Shaba' },
    cobalt: { en: 'Cobalt', sw: 'Kobalti' },
    nickel: { en: 'Nickel', sw: 'Nikeli' },
    tin: { en: 'Tin', sw: 'Bati' },
    zinc: { en: 'Zinc', sw: 'Zinki' },
    lead: { en: 'Lead', sw: 'Risasi' },
  } satisfies Record<Commodity, SwEn>,
} as const;

/** Convenience: select one locale variant from a `{ en, sw }` leaf. */
export function pickCommodity(locale: Locale, leaf: SwEn): string {
  return locale === 'sw' ? leaf.sw : leaf.en;
}
