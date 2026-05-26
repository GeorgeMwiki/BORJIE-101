/**
 * Finance / P&L type shapes (O-W-12) plus the pure break-even helper.
 */

export interface PnLRow {
  readonly label: string;
  readonly tzsM: number;
  readonly group: 'revenue' | 'cogs' | 'opex' | 'other';
}

export interface BreakEven {
  readonly goldPriceUsdOz: number;
  readonly siteUnitCostTzsPerG: number;
  readonly tzsUsd: number;
  readonly netMarginTzsPerG: number;
}

const GRAMMES_PER_TROY_OUNCE = 31.1035;

/**
 * Pure break-even calculator. No mock data: this is the contract
 * formula used by the live finance screen for the on-page slider.
 */
export function computeBreakEven(
  goldPriceUsdOz: number,
  tzsUsd: number,
  siteUnitCostTzsPerG: number,
): BreakEven {
  const tzsPerGramme = (goldPriceUsdOz / GRAMMES_PER_TROY_OUNCE) * tzsUsd;
  const netMarginTzsPerG = tzsPerGramme - siteUnitCostTzsPerG;
  return { goldPriceUsdOz, siteUnitCostTzsPerG, tzsUsd, netMarginTzsPerG };
}
