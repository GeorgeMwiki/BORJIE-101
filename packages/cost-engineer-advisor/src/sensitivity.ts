/**
 * Sensitivity helpers — extracted from cost-engineer.ts to keep that
 * file under the per-file size budget.
 */

import type {
  CostAnalyzeInput,
  OpexBucket,
  Pnl,
  Sensitivity,
  SensitivityRow,
  UnitEconomics,
} from './types.js';

const SENSITIVITY_STEPS_PERCENT: ReadonlyArray<number> = [-20, -10, -5, 0, 5, 10, 20];

export function computeSensitivity(input: CostAnalyzeInput): Sensitivity {
  const priceSensitivity: SensitivityRow[] = SENSITIVITY_STEPS_PERCENT.map(
    (delta) => sensitivityForPrice(input, delta),
  );
  const fuelSensitivity: SensitivityRow[] = SENSITIVITY_STEPS_PERCENT.map(
    (delta) => sensitivityForFuel(input, delta),
  );
  return { priceSensitivity, fuelSensitivity };
}

function sensitivityForPrice(
  input: CostAnalyzeInput,
  deltaPercent: number,
): SensitivityRow {
  const mutated: CostAnalyzeInput = {
    ...input,
    period: {
      ...input.period,
      averageRealisedPricePerTonne:
        input.period.averageRealisedPricePerTonne * (1 + deltaPercent / 100),
    },
  };
  const a = computeShallow(mutated);
  return {
    deltaPercent,
    ebitda: a.pnl.ebitda,
    marginPerTonne: a.unit.marginPerTonne,
  };
}

function sensitivityForFuel(
  input: CostAnalyzeInput,
  deltaPercent: number,
): SensitivityRow {
  const mutated: CostAnalyzeInput = {
    ...input,
    opexBuckets: input.opexBuckets.map((b) =>
      isFuelBucket(b) ? { ...b, amount: b.amount * (1 + deltaPercent / 100) } : b,
    ),
  };
  const a = computeShallow(mutated);
  return {
    deltaPercent,
    ebitda: a.pnl.ebitda,
    marginPerTonne: a.unit.marginPerTonne,
  };
}

function isFuelBucket(b: OpexBucket): boolean {
  return /fuel|diesel|petrol|energy/i.test(b.label);
}

function computeShallow(input: CostAnalyzeInput): {
  pnl: Pnl;
  unit: UnitEconomics;
} {
  const revenue = input.period.tonnesSold * input.period.averageRealisedPricePerTonne;
  const royalty = revenue * input.cogs.royaltyRate;
  const treatment = input.period.tonnesSold * input.cogs.treatmentChargesPerTonne;
  const cogs = royalty + treatment;
  const opexTotal = input.opexBuckets.reduce((sum, b) => sum + b.amount, 0);
  const ebitda = revenue - cogs - opexTotal;
  const depreciation = input.capexAmortisationForPeriod;
  const ebit = ebitda - depreciation;
  const netMarginPercent = revenue === 0 ? 0 : ebit / revenue;
  const pnl: Pnl = {
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    opexTotal,
    ebitda,
    depreciation,
    ebit,
    netMarginPercent,
    lines: [],
  };
  const unit = unitEconomicsFor(input, pnl);
  return { pnl, unit };
}

function unitEconomicsFor(input: CostAnalyzeInput, pnl: Pnl): UnitEconomics {
  const t = input.period.tonnesProduced;
  if (t === 0) {
    return {
      costPerTonne: 0,
      cashCostPerTonne: 0,
      allInSustainingCostPerTonne: 0,
      marginPerTonne: 0,
      breakEvenPricePerTonne: 0,
    };
  }
  const cashCost = pnl.opexTotal + pnl.cogs;
  const aisc = cashCost + pnl.depreciation;
  return {
    costPerTonne: cashCost / t,
    cashCostPerTonne: cashCost / t,
    allInSustainingCostPerTonne: aisc / t,
    marginPerTonne: input.period.averageRealisedPricePerTonne - aisc / t,
    breakEvenPricePerTonne: aisc / t,
  };
}
