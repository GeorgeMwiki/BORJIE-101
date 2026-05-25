/**
 * `leasing.fetch_unit_match` — read tier.
 *
 * Given inquiry criteria, finds matching units in the portfolio.
 * Pure scoring function; data is injected by the caller (production
 * wires the unit repository, tests inject fixtures).
 */

export interface UnitRecord {
  readonly id: string;
  readonly propertyId: string;
  readonly block: string;
  readonly unitLabel: string;
  readonly bedrooms: number;
  readonly neighborhood: string;
  readonly rentMinor: number;
  readonly currency: string;
  readonly available: boolean;
  readonly availableFromMs: number;
}

export interface FetchUnitMatchArgs {
  readonly units: ReadonlyArray<UnitRecord>;
  readonly bedrooms?: number;
  readonly maxBudgetMinor?: number;
  readonly neighborhood?: string;
  readonly availableByMs?: number;
}

export interface MatchedUnit {
  readonly unit: UnitRecord;
  readonly score: number;
  readonly rationale: string;
}

export interface FetchUnitMatchResult {
  readonly matches: ReadonlyArray<MatchedUnit>;
  readonly considered: number;
  readonly priceBand?: { readonly minMinor: number; readonly maxMinor: number; readonly currency: string };
}

export function fetchUnitMatch(args: FetchUnitMatchArgs): FetchUnitMatchResult {
  const eligible: MatchedUnit[] = [];
  for (const u of args.units) {
    if (!u.available) continue;
    if (args.availableByMs !== undefined && u.availableFromMs > args.availableByMs) continue;
    let score = 0;
    const parts: string[] = [];
    if (args.bedrooms !== undefined) {
      if (u.bedrooms === args.bedrooms) {
        score += 3;
        parts.push(`br=match`);
      } else {
        continue;
      }
    }
    if (args.neighborhood !== undefined) {
      if (u.neighborhood.toLowerCase() === args.neighborhood.toLowerCase()) {
        score += 2;
        parts.push('area=match');
      } else {
        // not a hard filter — neighborhoods can be approximate
        parts.push('area=other');
      }
    }
    if (args.maxBudgetMinor !== undefined) {
      if (u.rentMinor <= args.maxBudgetMinor) {
        score += 2;
        parts.push('budget=ok');
      } else if (u.rentMinor <= args.maxBudgetMinor * 1.1) {
        score += 0.5;
        parts.push('budget=slightly-over');
      } else {
        continue;
      }
    }
    eligible.push({
      unit: u,
      score: Number(score.toFixed(2)),
      rationale: parts.length > 0 ? parts.join(', ') : 'no-filters-applied',
    });
  }
  eligible.sort((a, b) => b.score - a.score);
  const top = eligible.slice(0, 5);

  let priceBand: FetchUnitMatchResult['priceBand'];
  if (top.length > 0) {
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    const firstUnit = top[0]!.unit;
    const currency = firstUnit.currency;
    for (const m of top) {
      if (m.unit.rentMinor < min) min = m.unit.rentMinor;
      if (m.unit.rentMinor > max) max = m.unit.rentMinor;
    }
    priceBand = { minMinor: min, maxMinor: max, currency };
  }

  return Object.freeze({
    matches: Object.freeze(top),
    considered: args.units.length,
    ...(priceBand ? { priceBand: Object.freeze(priceBand) } : {}),
  });
}
