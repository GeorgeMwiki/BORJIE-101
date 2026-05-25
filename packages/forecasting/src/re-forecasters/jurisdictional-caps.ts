/**
 * Jurisdictional rent caps.
 *
 * Real estate rent forecasts must respect statutory ceilings (e.g.
 * Tanzania Rent Restriction Act caps year-on-year rent rises;
 * Germany Mietpreisbremse caps to local Mietspiegel + 10%; many EU
 * member states have similar regimes). We codify the cap policy here
 * so every RE forecaster applies them uniformly.
 *
 * The cap policy is intentionally a pure data structure — adding a
 * jurisdiction is a one-line PR. Unknown jurisdictions default to a
 * permissive 50% YoY ceiling (effectively no cap).
 */

export interface RentCapPolicy {
  /** Maximum YoY % growth allowed (as a decimal, e.g. 0.07 for 7%). */
  readonly maxYoYGrowthPct: number;
  /** Optional max absolute rent (in series unit). */
  readonly absoluteMax?: number;
  /** Free-text source for audit (e.g. "TZ Rent Restriction Act s.18"). */
  readonly source: string;
}

const RENT_CAPS: Readonly<Record<string, RentCapPolicy>> = Object.freeze({
  TZ: {
    maxYoYGrowthPct: 0.10,
    source: 'TZ Rent Restriction Act (presumptive cap, requires per-LGA verification)',
  },
  KE: {
    maxYoYGrowthPct: 0.10,
    source: 'KE Rent Restriction Act + Rent Tribunal Act',
  },
  UG: {
    maxYoYGrowthPct: 0.10,
    source: 'UG Rent Restriction Act',
  },
  DE: {
    maxYoYGrowthPct: 0.10,
    source: 'DE Mietpreisbremse (Mietspiegel + 10%)',
  },
  FR: {
    maxYoYGrowthPct: 0.035,
    source: 'FR IRL ceiling (Loi ELAN)',
  },
  // No cap: most US states, UK, JP, AU etc.
  US: { maxYoYGrowthPct: 1.00, source: 'US no federal cap (some state/municipal caps apply)' },
  GB: { maxYoYGrowthPct: 1.00, source: 'UK no statutory cap (free market)' },
});

const DEFAULT_POLICY: RentCapPolicy = Object.freeze({
  maxYoYGrowthPct: 0.50,
  source: 'default permissive policy (unknown jurisdiction)',
});

export function rentCapFor(jurisdiction: string | undefined): RentCapPolicy {
  if (!jurisdiction) return DEFAULT_POLICY;
  // Match by exact code, or by country prefix for sub-region codes.
  const code = jurisdiction.toUpperCase();
  if (RENT_CAPS[code]) return RENT_CAPS[code]!;
  const root = code.split('-')[0]!;
  if (RENT_CAPS[root]) return RENT_CAPS[root]!;
  return DEFAULT_POLICY;
}

/** Apply the rent cap policy to a forecast point. Returns the capped
 *  value plus a flag indicating whether the cap was hit. */
export function applyRentCap(args: {
  readonly forecast: number;
  readonly priorPeriodValue: number;
  readonly policy: RentCapPolicy;
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
