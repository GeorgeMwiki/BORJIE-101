/**
 * Cost & finance mocks (O-W-12).
 *
 * Monthly P&L by mineral, costs grouped by category, EBITDA waterfall.
 * Numbers reflect a small-mid Tanzanian operator with both gold (heavy
 * weight) and coltan (small experimental contribution).
 */

export interface PnLRow {
  readonly label: string;
  readonly tzsM: number;
  readonly group: 'revenue' | 'cogs' | 'opex' | 'other';
}

export const PNL_MOCK: ReadonlyArray<PnLRow> = [
  { label: 'Gold sales (Nyakabale)', tzsM: 612, group: 'revenue' },
  { label: 'Gold sales (Kakola)', tzsM: 184, group: 'revenue' },
  { label: 'Coltan sales (Mbeya)', tzsM: 28, group: 'revenue' },
  { label: 'Stockpile movement', tzsM: 22, group: 'revenue' },
  { label: 'Extraction labour', tzsM: -118, group: 'cogs' },
  { label: 'Processing & reagents', tzsM: -94, group: 'cogs' },
  { label: 'Diesel & utilities', tzsM: -71, group: 'cogs' },
  { label: 'Royalty (6%)', tzsM: -50, group: 'cogs' },
  { label: 'Treasury haircut', tzsM: -34, group: 'cogs' },
  { label: 'CSR commitments', tzsM: -24, group: 'opex' },
  { label: 'Admin & overhead', tzsM: -42, group: 'opex' },
  { label: 'FX revaluation', tzsM: -7, group: 'other' },
];

export interface BreakEven {
  readonly goldPriceUsdOz: number;
  readonly siteUnitCostTzsPerG: number;
  readonly tzsUsd: number;
  readonly netMarginTzsPerG: number;
}

export function computeBreakEven(
  goldPriceUsdOz: number,
  tzsUsd: number,
  siteUnitCostTzsPerG: number,
): BreakEven {
  const tzsPerGramme = (goldPriceUsdOz / 31.1035) * tzsUsd;
  const netMarginTzsPerG = tzsPerGramme - siteUnitCostTzsPerG;
  return { goldPriceUsdOz, siteUnitCostTzsPerG, tzsUsd, netMarginTzsPerG };
}
