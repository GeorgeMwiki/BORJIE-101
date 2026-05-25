/**
 * FX-treasury advisor — pure cash-runway, FX exposure, and
 * sell-vs-stockpile decision logic with the 27-Mar USD-cliff
 * remediation playbook.
 */

import {
  treasuryInputSchema,
  treasuryRecommendationContextSchema,
  type CurrencyCode,
  type EvidenceRef,
  type ExposureRow,
  type FxExposure,
  type FxRate,
  type RunwayPoint,
  type RunwayProjection,
  type Stockpile,
  type TreasuryAnalysis,
  type TreasuryInput,
  type TreasuryRecommendation,
  type TreasuryRecommendationContext,
} from './types.js';
import { NOOP_LOGGER, type Logger } from './ports.js';

export interface FxTreasuryAdvisorDeps {
  readonly logger?: Logger;
}

export interface FxTreasuryAdvisor {
  analyze(input: TreasuryInput): Promise<TreasuryAnalysis>;
  recommend(
    context: TreasuryRecommendationContext,
  ): Promise<ReadonlyArray<TreasuryRecommendation>>;
}

export function createFxTreasuryAdvisor(
  deps: FxTreasuryAdvisorDeps = {},
): FxTreasuryAdvisor {
  const logger = deps.logger ?? NOOP_LOGGER;
  return {
    async analyze(rawInput) {
      const input = treasuryInputSchema.parse(rawInput);
      logger.info('fx-treasury.analyze.start', {
        base: input.baseCurrency,
        horizonDays: input.horizonDays,
      });
      const runway = projectRunway(input);
      const exposure = computeExposure(input);
      const analysis: TreasuryAnalysis = {
        runway,
        exposure,
        computedAtISO: new Date().toISOString(),
      };
      logger.info('fx-treasury.analyze.done', {
        zeroCrossingISO: runway.zeroCrossingISO,
        minBalance: runway.minBalanceBase,
      });
      return analysis;
    },
    async recommend(rawContext) {
      const context = treasuryRecommendationContextSchema.parse(rawContext);
      const recs = deriveRecommendations(context);
      logger.info('fx-treasury.recommend.done', { count: recs.length });
      return recs;
    },
  };
}

// ─── Runway ───────────────────────────────────────────────────────

export function projectRunway(input: TreasuryInput): RunwayProjection {
  const startingBase = sumInBase(input.balances, input.baseCurrency, input.fxRates);
  const points: RunwayPoint[] = [];
  let cumulative = startingBase;
  const start = new Date();
  let zeroCrossingISO: string | null = null;
  let minBalance = startingBase;

  for (let dayIdx = 0; dayIdx < input.horizonDays; dayIdx++) {
    const day = new Date(start.getTime() + dayIdx * 24 * 60 * 60 * 1000);
    const dayISO = day.toISOString().slice(0, 10);
    const flowsToday = input.cashflows.filter((c) => c.dueISO.startsWith(dayISO));
    let netFlow = 0;
    for (const f of flowsToday) {
      const inBase = convertToBase(
        { amount: f.amount, currency: f.currency },
        input.baseCurrency,
        input.fxRates,
      );
      netFlow += f.direction === 'in' ? inBase : -inBase;
    }
    cumulative += netFlow;
    if (cumulative < minBalance) minBalance = cumulative;
    if (zeroCrossingISO === null && cumulative <= 0) {
      zeroCrossingISO = dayISO;
    }
    points.push({ dateISO: dayISO, balanceBase: cumulative, netFlowBase: netFlow });
  }

  return {
    baseCurrency: input.baseCurrency,
    horizonDays: input.horizonDays,
    points,
    zeroCrossingISO,
    minBalanceBase: minBalance,
  };
}

// ─── Exposure ─────────────────────────────────────────────────────

export function computeExposure(input: TreasuryInput): FxExposure {
  const byCurrency = new Map<CurrencyCode, number>();
  for (const b of input.balances) {
    byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + b.balance);
  }
  for (const f of input.cashflows) {
    const sign = f.direction === 'in' ? 1 : -1;
    byCurrency.set(
      f.currency,
      (byCurrency.get(f.currency) ?? 0) + sign * f.amount,
    );
  }
  const rows: ExposureRow[] = [];
  for (const [currency, netPosition] of byCurrency.entries()) {
    rows.push({
      currency,
      netPosition,
      netPositionBase: convertToBase(
        { amount: netPosition, currency },
        input.baseCurrency,
        input.fxRates,
      ),
    });
  }
  return { baseCurrency: input.baseCurrency, rows };
}

// ─── Recommendations ──────────────────────────────────────────────

export function deriveRecommendations(
  context: TreasuryRecommendationContext,
): ReadonlyArray<TreasuryRecommendation> {
  const out: TreasuryRecommendation[] = [];
  const { analysis, input, policy } = context;

  // R1: runway floor breach
  const daysRunway = countPositiveBalanceDays(analysis.runway);
  if (daysRunway < policy.minRunwayDays) {
    out.push({
      id: 'runway-below-floor',
      kind: 'sell-stockpile',
      title: `Runway ${daysRunway}d below floor ${policy.minRunwayDays}d`,
      rationale:
        'Projected cash exhaustion before policy floor. Consider partial ' +
        'stockpile liquidation and/or capex deferral. Confirm with ' +
        'capacity-expansion-advisor before drawing on credit lines.',
      severity: 'critical',
      evidence: [evidence('runway-point', `runway.points[zero]`)],
    });
  }

  // R2: single-currency concentration risk
  const totalAbsBase = analysis.exposure.rows.reduce(
    (s, r) => s + Math.abs(r.netPositionBase),
    0,
  );
  if (totalAbsBase > 0) {
    for (const row of analysis.exposure.rows) {
      const ratio = Math.abs(row.netPositionBase) / totalAbsBase;
      if (ratio > policy.maxSingleCurrencyExposureRatio) {
        out.push({
          id: `concentration-${row.currency}`,
          kind: 'partial-fx-hedge',
          title: `${row.currency} exposure ${(ratio * 100).toFixed(0)}% > policy ${(policy.maxSingleCurrencyExposureRatio * 100).toFixed(0)}%`,
          rationale:
            `${row.currency} concentration over policy limit. Recommend ` +
            'a partial forward hedge or rebalance via the BoT gold window.',
          severity: 'high',
          evidence: [evidence('exposure-row', `exposure.${row.currency}`)],
        });
      }
    }
  }

  // R3: 27-Mar USD cliff remediation
  const cliffISO = input.usdCliffDateISO ?? defaultUsdCliffISO();
  const usdOutflowsAtCliff = input.cashflows.filter(
    (c) =>
      c.currency === 'USD' &&
      c.direction === 'out' &&
      Math.abs(daysBetween(c.dueISO, cliffISO)) <= 3,
  );
  const usdNeed = usdOutflowsAtCliff.reduce((s, c) => s + c.amount, 0);
  const usdAvailable = input.balances
    .filter((b) => b.currency === 'USD')
    .reduce((s, b) => s + b.balance, 0);
  if (usdNeed > usdAvailable) {
    const gap = usdNeed - usdAvailable;
    const sellRec = recommendStockpileSellForGap(input.stockpiles, gap);
    out.push({
      id: 'usd-cliff-27mar',
      kind: 'usd-cliff-remediation',
      title: `USD cliff gap ${gap.toFixed(0)} USD on/around ${cliffISO}`,
      rationale:
        'Cluster of USD outflows around the 27-Mar window exceeds the USD ' +
        'cash buffer. Playbook: (a) accelerate receivable from largest ' +
        'off-take counterparty, (b) sell ' +
        `${sellRec.tonnes.toFixed(1)}t from stockpile ${sellRec.stockpileId ?? 'n/a'}, ` +
        '(c) convert TZS via BoT gold window if shortfall remains.',
      severity: 'critical',
      estimatedImpact: { amount: gap, currency: 'USD' },
      evidence: usdOutflowsAtCliff.map((c) =>
        evidence('cashflow', `cashflow.${c.id}`),
      ),
    });
  }

  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────

function evidence(kind: EvidenceRef['kind'], pointer: string): EvidenceRef {
  return { id: `${kind}:${pointer}`, kind, pointer };
}

function defaultUsdCliffISO(): string {
  const now = new Date();
  const year =
    now.getMonth() > 2 || (now.getMonth() === 2 && now.getDate() > 27)
      ? now.getFullYear() + 1
      : now.getFullYear();
  return `${year}-03-27`;
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function countPositiveBalanceDays(runway: RunwayProjection): number {
  let count = 0;
  for (const p of runway.points) {
    if (p.balanceBase > 0) count++;
    else break;
  }
  return count;
}

function recommendStockpileSellForGap(
  stockpiles: ReadonlyArray<Stockpile>,
  gapUsd: number,
): { stockpileId: string | null; tonnes: number } {
  // Greedy: pick the oldest stockpile and sell enough to close the gap.
  const sorted = [...stockpiles].sort((a, b) => b.ageDays - a.ageDays);
  for (const s of sorted) {
    if (s.estimatedSpotPricePerTonne > 0) {
      const tonnes = Math.min(s.tonnes, gapUsd / s.estimatedSpotPricePerTonne);
      return { stockpileId: s.id, tonnes };
    }
  }
  return { stockpileId: null, tonnes: 0 };
}

function sumInBase(
  balances: ReadonlyArray<{ balance: number; currency: CurrencyCode }>,
  base: CurrencyCode,
  rates: ReadonlyArray<FxRate>,
): number {
  let total = 0;
  for (const b of balances) {
    total += convertToBase({ amount: b.balance, currency: b.currency }, base, rates);
  }
  return total;
}

function convertToBase(
  money: { amount: number; currency: CurrencyCode },
  base: CurrencyCode,
  rates: ReadonlyArray<FxRate>,
): number {
  if (money.currency === base) return money.amount;
  const direct = rates.find((r) => r.pair === `${money.currency}/${base}`);
  if (direct) return money.amount * direct.rate;
  const inverse = rates.find((r) => r.pair === `${base}/${money.currency}`);
  if (inverse && inverse.rate !== 0) return money.amount / inverse.rate;
  // No rate available — return raw amount so downstream rule still fires
  // a warning rather than silently dropping the row.
  return money.amount;
}
