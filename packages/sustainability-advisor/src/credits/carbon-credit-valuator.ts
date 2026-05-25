/**
 * Carbon credit valuator — VCS, Gold Standard, EU ETS, REDD+,
 * Article 6.4 (PACM).
 *
 * Pure function over an injected `CarbonPriceFeed` port. The default
 * `createStubCarbonPriceFeed` returns mid-of-band 2026-05 prices so
 * the valuator runs offline; production wires a real feed
 * (ICE Endex for EUA, AlliedOffsets / Viridios AI for voluntary).
 */

import type {
  CarbonCreditQuote,
  CarbonPriceFeed,
  CreditStandard,
  CurrencyCode,
} from '../types.js';

/** Mid-market spot stubs in USD/tCO2e (May 2026). */
export const STUB_SPOT_USD: Readonly<Record<CreditStandard, number>> = Object.freeze({
  VCS:          6.5,    // nature-based avg
  GoldStandard: 9.0,    // community-projects avg
  EU_ETS:       84.0,   // EUA Mar-27 forward, mid May 2026
  Article_6_4:  18.0,   // first-issuance indicative
  CDM_legacy:   1.0,    // very thin
  REDD_plus:    4.5,    // grade B+ baseline
});

/** Indicative quality grade (Sylvera/CarbonPlan scale A..D). */
export const STUB_QUALITY_GRADES: Readonly<Record<CreditStandard, 'A' | 'B' | 'C' | 'D' | null>> = Object.freeze({
  VCS:          'B',
  GoldStandard: 'A',
  EU_ETS:       null,
  Article_6_4:  'A',
  CDM_legacy:   'D',
  REDD_plus:    'C',
});

/** Stub FX from USD — tighten with real FX feed in production. */
const STUB_FX_FROM_USD: Readonly<Record<CurrencyCode, number>> = Object.freeze({
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  KES: 129.0,
  TZS: 2480.0,
  UGX: 3650.0,
  RWF: 1290.0,
  NGN: 1480.0,
  ZAR: 18.4,
});

export interface CarbonCreditValuationInputs {
  readonly standard: CreditStandard;
  readonly tonnesCO2e: number;
  readonly currency: CurrencyCode;
  /** Optional forward tenor labels caller is interested in. */
  readonly forwardTenors?: ReadonlyArray<string>;
  /** Override the feed (e.g. live ICE Endex adapter). */
  readonly feed?: CarbonPriceFeed;
}

/**
 * Pure async: get a credit quote priced in the caller's currency.
 */
export async function valuateCarbonCredits(
  inputs: CarbonCreditValuationInputs,
): Promise<CarbonCreditQuote> {
  if (!Number.isFinite(inputs.tonnesCO2e) || inputs.tonnesCO2e < 0) {
    throw new RangeError('carbon-credit: tonnesCO2e must be ≥ 0');
  }

  const feed = inputs.feed ?? createStubCarbonPriceFeed();
  const spot = await feed.spot(inputs.standard, inputs.currency);
  const forwards = inputs.forwardTenors
    ? await feed.forwards(inputs.standard, inputs.currency)
    : {};

  return {
    standard: inputs.standard,
    tonnesCO2e: inputs.tonnesCO2e,
    spotPrice: round2(spot.price),
    currency: inputs.currency,
    spotTotal: round2(spot.price * inputs.tonnesCO2e),
    forwards,
    qualityGrade: STUB_QUALITY_GRADES[inputs.standard],
    asOf: spot.asOf,
    feedSource: spot.source,
  };
}

/**
 * Default stub feed — pure, deterministic, returns mid-of-band
 * prices as of 2026-05-24. Use only when an injected adapter is
 * not available.
 */
export function createStubCarbonPriceFeed(asOf: string = '2026-05-24'): CarbonPriceFeed {
  return {
    async spot(standard, currency) {
      const usd = STUB_SPOT_USD[standard];
      const fx = STUB_FX_FROM_USD[currency];
      if (fx === undefined) {
        throw new RangeError(`stub-feed: no FX for ${currency}`);
      }
      return {
        price: usd * fx,
        asOf,
        source: 'STUB_2026-05',
      };
    },
    async forwards(standard, currency) {
      const usd = STUB_SPOT_USD[standard];
      const fx = STUB_FX_FROM_USD[currency];
      if (fx === undefined) {
        throw new RangeError(`stub-feed: no FX for ${currency}`);
      }
      // Indicative contango / backwardation curve.
      return {
        'M+3':   round2(usd * fx * 1.01),
        'M+6':   round2(usd * fx * 1.03),
        'Dec-26': round2(usd * fx * 1.05),
        'Dec-27': round2(usd * fx * 1.10),
        'Dec-30': round2(usd * fx * 1.25),
      };
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
