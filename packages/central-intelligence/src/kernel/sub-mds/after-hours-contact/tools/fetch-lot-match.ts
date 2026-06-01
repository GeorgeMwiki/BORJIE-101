/**
 * `after_hours.fetch_lot_match` — read tier.
 *
 * Given inquiry criteria, finds matching mineral lots in the
 * inventory. Pure scoring function; data is injected by the caller
 * (production wires the lot inventory repository, tests inject
 * fixtures).
 */

export interface LotRecord {
  readonly id: string;
  readonly siteId: string;
  readonly lotRef: string;
  readonly mineral: string;
  readonly grade: string;
  readonly quantityKg: number;
  readonly region: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly available: boolean;
  readonly availableFromMs: number;
}

export interface FetchLotMatchArgs {
  readonly lots: ReadonlyArray<LotRecord>;
  readonly mineral?: string;
  readonly maxBudgetMinor?: number;
  readonly region?: string;
  readonly availableByMs?: number;
}

export interface MatchedLot {
  readonly lot: LotRecord;
  readonly score: number;
  readonly rationale: string;
}

export interface FetchLotMatchResult {
  readonly matches: ReadonlyArray<MatchedLot>;
  readonly considered: number;
  readonly priceBand?: { readonly minMinor: number; readonly maxMinor: number; readonly currency: string };
}

export function fetchLotMatch(args: FetchLotMatchArgs): FetchLotMatchResult {
  const eligible: MatchedLot[] = [];
  for (const l of args.lots) {
    if (!l.available) continue;
    if (args.availableByMs !== undefined && l.availableFromMs > args.availableByMs) continue;
    let score = 0;
    const parts: string[] = [];
    if (args.mineral !== undefined) {
      if (l.mineral.toLowerCase() === args.mineral.toLowerCase()) {
        score += 3;
        parts.push(`mineral=match`);
      } else {
        continue;
      }
    }
    if (args.region !== undefined) {
      if (l.region.toLowerCase() === args.region.toLowerCase()) {
        score += 2;
        parts.push('region=match');
      } else {
        // not a hard filter — regions can be approximate
        parts.push('region=other');
      }
    }
    if (args.maxBudgetMinor !== undefined) {
      if (l.priceMinor <= args.maxBudgetMinor) {
        score += 2;
        parts.push('budget=ok');
      } else if (l.priceMinor <= args.maxBudgetMinor * 1.1) {
        score += 0.5;
        parts.push('budget=slightly-over');
      } else {
        continue;
      }
    }
    eligible.push({
      lot: l,
      score: Number(score.toFixed(2)),
      rationale: parts.length > 0 ? parts.join(', ') : 'no-filters-applied',
    });
  }
  eligible.sort((a, b) => b.score - a.score);
  const top = eligible.slice(0, 5);

  let priceBand: FetchLotMatchResult['priceBand'];
  if (top.length > 0) {
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    const firstLot = top[0]!.lot;
    const currency = firstLot.currency;
    for (const m of top) {
      if (m.lot.priceMinor < min) min = m.lot.priceMinor;
      if (m.lot.priceMinor > max) max = m.lot.priceMinor;
    }
    priceBand = { minMinor: min, maxMinor: max, currency };
  }

  return Object.freeze({
    matches: Object.freeze(top),
    considered: args.lots.length,
    ...(priceBand ? { priceBand: Object.freeze(priceBand) } : {}),
  });
}
