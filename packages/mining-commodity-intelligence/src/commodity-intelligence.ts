/**
 * Commodity-intelligence advisor — derives trend windows + price-band
 * recommendations from a list of price histories supplied by adapter
 * ports (LME, Kitco, or any other compatible source).
 */

import {
  intelInputSchema,
  intelRecommendationContextSchema,
  type EvidenceRef,
  type IntelInput,
  type IntelRecommendation,
  type IntelRecommendationContext,
  type IntelSnapshot,
  type PriceTick,
  type TrendWindow,
} from './types.js';
import { NOOP_LOGGER, type Logger } from './ports.js';

export interface CommodityIntelligenceDeps {
  readonly logger?: Logger;
}

export interface CommodityIntelligence {
  analyze(input: IntelInput): Promise<IntelSnapshot>;
  recommend(
    context: IntelRecommendationContext,
  ): Promise<ReadonlyArray<IntelRecommendation>>;
}

const WINDOW_LABELS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '1d', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function createCommodityIntelligence(
  deps: CommodityIntelligenceDeps = {},
): CommodityIntelligence {
  const logger = deps.logger ?? NOOP_LOGGER;
  return {
    async analyze(rawInput) {
      const input = intelInputSchema.parse(rawInput);
      logger.info('commodity-intel.analyze.start', {
        commodity: input.commodity,
        sources: input.histories.length,
      });
      const merged = mergeHistories(input);
      const snapshot = buildSnapshot(input, merged);
      logger.info('commodity-intel.analyze.done', {
        latest: snapshot.latestPrice,
        windows: snapshot.windows.length,
      });
      return snapshot;
    },
    async recommend(rawContext) {
      const context = intelRecommendationContextSchema.parse(rawContext);
      const recs = deriveRecommendations(context);
      logger.info('commodity-intel.recommend.done', { count: recs.length });
      return recs;
    },
  };
}

function mergeHistories(input: IntelInput): ReadonlyArray<PriceTick> {
  const ticks: PriceTick[] = [];
  for (const h of input.histories) {
    for (const t of h.ticks) ticks.push(t);
  }
  return [...ticks].sort((a, b) => (a.asOfISO < b.asOfISO ? -1 : 1));
}

function buildSnapshot(
  input: IntelInput,
  ticks: ReadonlyArray<PriceTick>,
): IntelSnapshot {
  const last = ticks[ticks.length - 1];
  const latestPrice = last?.pricePerTonne ?? 0;
  const windows: TrendWindow[] = [];
  if (last) {
    for (const w of WINDOW_LABELS) {
      const endTime = new Date(last.asOfISO).getTime();
      const startTime = endTime - w.days * 24 * 60 * 60 * 1000;
      const startTick = findClosestTick(ticks, new Date(startTime).toISOString());
      if (!startTick) continue;
      const change = startTick.pricePerTonne === 0
        ? 0
        : ((last.pricePerTonne - startTick.pricePerTonne) / startTick.pricePerTonne) * 100;
      windows.push({
        label: w.label,
        spanDays: w.days,
        startPrice: startTick.pricePerTonne,
        endPrice: last.pricePerTonne,
        percentChange: change,
        direction: change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat',
      });
    }
  }
  const sources = Array.from(new Set(ticks.map((t) => t.source)));
  return {
    commodity: input.commodity,
    baseCurrency: input.baseCurrency,
    latestPrice,
    windows,
    sources,
    computedAtISO: new Date().toISOString(),
  };
}

function findClosestTick(
  ticks: ReadonlyArray<PriceTick>,
  isoTarget: string,
): PriceTick | null {
  let closest: PriceTick | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  const target = new Date(isoTarget).getTime();
  for (const t of ticks) {
    const diff = Math.abs(new Date(t.asOfISO).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = t;
    }
  }
  return closest;
}

// ─── Recommendations ──────────────────────────────────────────────

export function deriveRecommendations(
  context: IntelRecommendationContext,
): ReadonlyArray<IntelRecommendation> {
  const { snapshot, policy } = context;
  const out: IntelRecommendation[] = [];
  for (const w of snapshot.windows) {
    if (w.percentChange >= policy.lockOnUpswingPercent) {
      out.push({
        id: `lock-${w.label}`,
        kind: 'lock-offtake-price',
        title: `${snapshot.commodity} up ${w.percentChange.toFixed(1)}% over ${w.label}`,
        rationale:
          'Upswing exceeds policy threshold — consider locking forward ' +
          'off-take pricing while the market is favourable.',
        severity: 'medium',
        evidence: [evidence('trend-window', `window.${w.label}`)],
      });
    } else if (w.percentChange <= policy.delaySaleOnDownswingPercent) {
      out.push({
        id: `delay-${w.label}`,
        kind: 'delay-sale',
        title: `${snapshot.commodity} down ${w.percentChange.toFixed(1)}% over ${w.label}`,
        rationale:
          'Sustained downswing — defer non-urgent sales and re-check ' +
          'cash-runway with fx-treasury-advisor.',
        severity: 'medium',
        evidence: [evidence('trend-window', `window.${w.label}`)],
      });
    }
  }
  return out;
}

function evidence(kind: EvidenceRef['kind'], pointer: string): EvidenceRef {
  return { id: `${kind}:${pointer}`, kind, pointer };
}
