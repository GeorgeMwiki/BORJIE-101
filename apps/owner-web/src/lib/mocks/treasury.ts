/**
 * Treasury / FX mocks (O-W-17).
 *
 * 30-day FX & gold price series for sparklines, a sell-vs-stockpile
 * simulator and the 27-Mar-2026 BoT cliff tracker. The cliff date has
 * passed by 8 weeks as of the current cockpit "today" (25-May-2026)
 * so the cliff banner is in remediation mode.
 */

export interface FxTick {
  readonly day: number;
  readonly tzsUsd: number;
  readonly goldUsdOz: number;
}

export const FX_HISTORY: ReadonlyArray<FxTick> = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  tzsUsd: 2530 + Math.round(Math.sin(i / 4) * 28 + i * 1.4),
  goldUsdOz: 2300 + Math.round(Math.cos(i / 5) * 38 + i * 2.1),
}));

export const CLIFF_DATE = '2026-03-27';

export function daysSinceCliff(today: Date = new Date('2026-05-25')): number {
  const cliff = new Date(CLIFF_DATE);
  return Math.round((today.getTime() - cliff.getTime()) / (1000 * 60 * 60 * 24));
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

export function simulateSellVsHold(input: SellSimulationInput): SellSimulationOutput {
  const tzsPerG = (input.goldPriceAssumptionUsdOz / 31.1035) * input.tzsUsd;
  const grossNow = (tzsPerG * input.grammesAvailable) / 1_000_000;
  const haircut = (1 - input.treasuryHaircutPct / 100);
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

export interface CliffTracker {
  readonly daysPast: number;
  readonly usdReceivablesExposureUsd: number;
  readonly forcedConversionTzsM: number;
  readonly facilityNotificationStatus: 'sent' | 'pending' | 'overdue';
}

export const CLIFF_TRACKER: CliffTracker = {
  daysPast: daysSinceCliff(),
  usdReceivablesExposureUsd: 184_500,
  forcedConversionTzsM: 476.9,
  facilityNotificationStatus: 'overdue',
};
