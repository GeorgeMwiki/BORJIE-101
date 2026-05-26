/**
 * Treasury / FX type shapes (O-W-17) plus the pure sell-vs-hold simulator.
 */

export interface FxTick {
  readonly day: number;
  readonly tzsUsd: number;
  readonly goldUsdOz: number;
}

export interface SellSimulationInput {
  readonly grammesAvailable: number;
  readonly goldPriceAssumptionUsdOz: number;
  readonly tzsUsd: number;
  readonly treasuryHaircutPct: number;
  readonly daysToHold: number;
  readonly priceVolatilityPct: number;
}

export interface SellSimulationOutput {
  readonly netNowTzsM: number;
  readonly netHoldExpectedTzsM: number;
  readonly netHoldLowTzsM: number;
  readonly netHoldHighTzsM: number;
  readonly recommendation: 'sell-now' | 'hold' | 'split';
}

export interface CliffTracker {
  readonly daysPast: number;
  readonly usdReceivablesExposureUsd: number;
  readonly forcedConversionTzsM: number;
  readonly facilityNotificationStatus: 'sent' | 'pending' | 'overdue';
}

const GRAMMES_PER_TROY_OUNCE = 31.1035;

/**
 * Pure sell-vs-stockpile simulator. Lives next to the type because the
 * finance UI calls it client-side for the interactive slider; the
 * server runs the same formula for the report-writer.
 */
export function simulateSellVsHold(input: SellSimulationInput): SellSimulationOutput {
  const tzsPerG = (input.goldPriceAssumptionUsdOz / GRAMMES_PER_TROY_OUNCE) * input.tzsUsd;
  const grossNow = (tzsPerG * input.grammesAvailable) / 1_000_000;
  const haircut = 1 - input.treasuryHaircutPct / 100;
  const netNowTzsM = grossNow * haircut;
  const vol = input.priceVolatilityPct / 100;
  const netHoldExpectedTzsM = netNowTzsM * (1 + 0.004 * input.daysToHold);
  const netHoldLowTzsM = netHoldExpectedTzsM * (1 - vol);
  const netHoldHighTzsM = netHoldExpectedTzsM * (1 + vol);
  const recommendation: SellSimulationOutput['recommendation'] =
    netHoldExpectedTzsM > netNowTzsM * 1.02
      ? 'hold'
      : netHoldLowTzsM > netNowTzsM
        ? 'split'
        : 'sell-now';
  return {
    netNowTzsM,
    netHoldExpectedTzsM,
    netHoldLowTzsM,
    netHoldHighTzsM,
    recommendation,
  };
}
