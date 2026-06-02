/**
 * Jurisdictional royalty caps.
 *
 * Mining royalty / ground-rent forecasts must respect statutory
 * ceilings (e.g. the Tanzania Mining Act sets mineral-royalty rates by
 * mineral class; Kenya's Mining Act + regulations set comparable
 * rates; many jurisdictions cap year-on-year escalation of negotiated
 * offtake consideration). We codify the cap policy here so every
 * recurring-entity forecaster applies them uniformly.
 *
 * The cap policy is intentionally a pure data structure — adding a
 * jurisdiction is a one-line PR. Unknown jurisdictions default to a
 * permissive 50% YoY ceiling (effectively no cap).
 */

export interface RoyaltyCapPolicy {
  /** Maximum YoY % growth allowed (as a decimal, e.g. 0.07 for 7%). */
  readonly maxYoYGrowthPct: number;
  /** Optional max absolute royalty (in series unit). */
  readonly absoluteMax?: number;
  /** Free-text source for audit (e.g. "TZ Mining Act royalty schedule"). */
  readonly source: string;
}

/** @deprecated Use {@link RoyaltyCapPolicy}. */
export type RentCapPolicy = RoyaltyCapPolicy;

const ROYALTY_CAPS: Readonly<Record<string, RoyaltyCapPolicy>> = Object.freeze({
  TZ: {
    maxYoYGrowthPct: 0.10,
    source: 'TZ Mining Act royalty schedule (presumptive cap, requires per-mineral verification)',
  },
  KE: {
    maxYoYGrowthPct: 0.10,
    source: 'KE Mining Act + Mining (Dealings in Minerals) Regulations',
  },
  UG: {
    maxYoYGrowthPct: 0.10,
    source: 'UG Mining and Minerals Act royalty schedule',
  },
  DE: {
    maxYoYGrowthPct: 0.10,
    source: 'DE Bundesberggesetz (Förderabgabe escalation guidance)',
  },
  FR: {
    maxYoYGrowthPct: 0.035,
    source: 'FR Code minier redevance ceiling',
  },
  // No cap: most US states, UK, JP, AU etc.
  US: { maxYoYGrowthPct: 1.00, source: 'US no federal cap (some state/lease-specific caps apply)' },
  GB: { maxYoYGrowthPct: 1.00, source: 'UK no statutory cap (negotiated royalties)' },
});

const DEFAULT_POLICY: RoyaltyCapPolicy = Object.freeze({
  maxYoYGrowthPct: 0.50,
  source: 'default permissive policy (unknown jurisdiction)',
});

export function royaltyCapFor(jurisdiction: string | undefined): RoyaltyCapPolicy {
  if (!jurisdiction) return DEFAULT_POLICY;
  // Match by exact code, or by country prefix for sub-region codes.
  const code = jurisdiction.toUpperCase();
  if (ROYALTY_CAPS[code]) return ROYALTY_CAPS[code]!;
  const root = code.split('-')[0]!;
  if (ROYALTY_CAPS[root]) return ROYALTY_CAPS[root]!;
  return DEFAULT_POLICY;
}

/** @deprecated Use {@link royaltyCapFor}. */
export const rentCapFor = royaltyCapFor;

/** Apply the royalty cap policy to a forecast point. Returns the capped
 *  value plus a flag indicating whether the cap was hit. */
export function applyRoyaltyCap(args: {
  readonly forecast: number;
  readonly priorPeriodValue: number;
  readonly policy: RoyaltyCapPolicy;
}): { readonly value: number; readonly capped: boolean } {
  const { forecast, priorPeriodValue, policy } = args;
  const maxAllowed = priorPeriodValue * (1 + policy.maxYoYGrowthPct);
  let value = forecast;
  let capped = false;
  if (forecast > maxAllowed) {
    value = maxAllowed;
    capped = true;
  }
  if (policy.absoluteMax != null && value > policy.absoluteMax) {
    value = policy.absoluteMax;
    capped = true;
  }
  return { value, capped };
}

/** @deprecated Use {@link applyRoyaltyCap}. */
export const applyRentCap = applyRoyaltyCap;
