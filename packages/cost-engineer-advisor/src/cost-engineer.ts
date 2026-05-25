/**
 * Cost-engineer advisor — pure analytic core. Computes a P&L, unit
 * economics, and sensitivity tables; then derives recommendations
 * with explicit evidence references.
 *
 * No I/O here. The factory accepts ports for LMBM read/write, brain
 * narration, and a structured logger.
 */

import {
  costAnalyzeInputSchema,
  recommendationContextSchema,
  type CostAnalyzeInput,
  type CostAnalysis,
  type EvidenceRef,
  type Pnl,
  type PnlLine,
  type Recommendation,
  type RecommendationContext,
  type UnitEconomics,
} from './types.js';
import { computeSensitivity } from './sensitivity.js';
import {
  NOOP_LOGGER,
  type BrainPort,
  type LmbmReadPort,
  type LmbmWritePort,
  type Logger,
} from './ports.js';

export interface CostEngineerAdvisorDeps {
  readonly read?: LmbmReadPort;
  readonly write?: LmbmWritePort;
  readonly brain?: BrainPort;
  readonly logger?: Logger;
}

export interface CostEngineerAdvisor {
  analyze(input: CostAnalyzeInput): Promise<CostAnalysis>;
  recommend(context: RecommendationContext): Promise<ReadonlyArray<Recommendation>>;
}

export function createCostEngineerAdvisor(
  deps: CostEngineerAdvisorDeps = {},
): CostEngineerAdvisor {
  const logger = deps.logger ?? NOOP_LOGGER;
  return {
    async analyze(rawInput) {
      const input = costAnalyzeInputSchema.parse(rawInput);
      logger.info('cost-engineer.analyze.start', {
        period: input.period.periodLabel,
        currency: input.currency,
      });
      const analysis = computeAnalysis(input);
      logger.info('cost-engineer.analyze.done', {
        ebitda: analysis.pnl.ebitda,
        costPerTonne: analysis.unit.costPerTonne,
      });
      return analysis;
    },
    async recommend(rawContext) {
      const context = recommendationContextSchema.parse(rawContext);
      const recs = deriveRecommendations(context);
      logger.info('cost-engineer.recommend.done', { count: recs.length });
      return recs;
    },
  };
}

// ─── Pure analytics ───────────────────────────────────────────────

export function computeAnalysis(input: CostAnalyzeInput): CostAnalysis {
  const revenue = input.period.tonnesSold * input.period.averageRealisedPricePerTonne;
  const royalty = revenue * input.cogs.royaltyRate;
  const treatment =
    input.period.tonnesSold * input.cogs.treatmentChargesPerTonne;
  const cogs = royalty + treatment;
  const opexTotal = input.opexBuckets.reduce((sum, b) => sum + b.amount, 0);
  const grossProfit = revenue - cogs;
  const ebitda = grossProfit - opexTotal;
  const depreciation = input.capexAmortisationForPeriod;
  const ebit = ebitda - depreciation;
  const netMarginPercent = revenue === 0 ? 0 : ebit / revenue;

  const lines: PnlLine[] = [
    pnlLine('Revenue', revenue, revenue),
    pnlLine('Royalty', -royalty, revenue),
    pnlLine('Treatment charges', -treatment, revenue),
    pnlLine('Gross profit', grossProfit, revenue),
    ...input.opexBuckets.map((b) => pnlLine(`Opex: ${b.label}`, -b.amount, revenue)),
    pnlLine('EBITDA', ebitda, revenue),
    pnlLine('Depreciation', -depreciation, revenue),
    pnlLine('EBIT', ebit, revenue),
  ];

  const pnl: Pnl = {
    revenue,
    cogs,
    grossProfit,
    opexTotal,
    ebitda,
    depreciation,
    ebit,
    netMarginPercent,
    lines,
  };

  const unit = computeUnitEconomics(input, pnl);
  const sensitivity = computeSensitivity(input);

  return {
    period: input.period,
    currency: input.currency,
    pnl,
    unit,
    sensitivity,
    computedAtISO: new Date().toISOString(),
  };
}

function pnlLine(label: string, amount: number, revenue: number): PnlLine {
  return {
    label,
    amount,
    percentOfRevenue: revenue === 0 ? 0 : amount / revenue,
  };
}

function computeUnitEconomics(input: CostAnalyzeInput, pnl: Pnl): UnitEconomics {
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

// ─── Recommendations ──────────────────────────────────────────────

export function deriveRecommendations(
  context: RecommendationContext,
): ReadonlyArray<Recommendation> {
  const out: Recommendation[] = [];
  const { analysis, benchmarks } = context;

  // R1: fuel-share blow-out
  const fuelBucket = findFuelBucket(analysis);
  if (fuelBucket && analysis.pnl.opexTotal > 0) {
    const share = fuelBucket.amount / analysis.pnl.opexTotal;
    if (share > benchmarks.maxFuelShareOfOpex) {
      out.push({
        id: 'fuel-share-high',
        title: `Fuel cost share ${(share * 100).toFixed(1)}% exceeds benchmark ${(benchmarks.maxFuelShareOfOpex * 100).toFixed(0)}%`,
        rationale:
          'Fuel-share spike usually signals poor haul-route dispatch, ' +
          'idling, or upstream price-shock pass-through. Drill into ' +
          'fleet telematics + supplier pricing.',
        severity: 'high',
        evidence: [
          evidence('opex-bucket', `opex.${fuelBucket.label}`),
          evidence('pnl-line', 'opex.total'),
        ],
      });
    }
  }

  // R2: margin floor breach
  if (analysis.pnl.netMarginPercent < benchmarks.minNetMarginPercent) {
    out.push({
      id: 'margin-below-floor',
      title: `Net margin ${(analysis.pnl.netMarginPercent * 100).toFixed(1)}% below floor ${(benchmarks.minNetMarginPercent * 100).toFixed(0)}%`,
      rationale:
        'Net margin under floor — model in fx-treasury sell-vs-stockpile ' +
        'before next shipment and request a capex-pause review.',
      severity: 'critical',
      evidence: [evidence('pnl-line', 'pnl.netMarginPercent')],
    });
  }

  // R3: cost-per-tonne ceiling breach
  if (
    benchmarks.maxCostPerTonneTZS !== undefined &&
    analysis.unit.costPerTonne > benchmarks.maxCostPerTonneTZS
  ) {
    out.push({
      id: 'cost-per-tonne-ceiling',
      title: `Cost per tonne ${analysis.unit.costPerTonne.toFixed(0)} above ceiling ${benchmarks.maxCostPerTonneTZS.toFixed(0)}`,
      rationale:
        'Unit-cost ceiling breach — flag for cost-engineering review and ' +
        'cross-check ore-grade trend with geology-advisor.',
      severity: 'high',
      evidence: [evidence('period', `period.${analysis.period.periodLabel}`)],
    });
  }

  return out;
}

function findFuelBucket(analysis: CostAnalysis): { label: string; amount: number } | null {
  const fuelLine = analysis.pnl.lines.find(
    (l) => /opex:.*(fuel|diesel|energy)/i.test(l.label),
  );
  if (!fuelLine) return null;
  return { label: fuelLine.label.replace(/^opex:\s*/i, ''), amount: -fuelLine.amount };
}

function evidence(kind: EvidenceRef['kind'], pointer: string): EvidenceRef {
  return { id: `${kind}:${pointer}`, kind, pointer };
}
