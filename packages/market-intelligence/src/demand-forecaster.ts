/**
 * 90-day demand forecaster.
 *
 * Pure-TS time-series forecaster producing p5 / p50 / p95 prediction
 * bands plus a plain-language driver narrative. In production the
 * caller should wire `@borjie/forecasting-engine` and
 * `@borjie/forecasting` (conformal intervals) — those packages export
 * Holt-Winters and Naive-Seasonal forecasters with calibrated
 * intervals. For dev + unit tests we keep a small, deterministic
 * implementation here.
 *
 * LATER(wire): replace `forecastBaseline` with
 *   @borjie/forecasting.createHoltWintersForecaster
 *   + @borjie/forecasting.wrapWithConformalIntervals. See KI-DEBT-001.
 */

import {
  demandForecastSchema,
  forecastInputSchema,
  ForecastUnavailableError,
  TenantPermissionError,
  type Commodity,
  type DemandForecast,
  type ForecastInput,
  type ForecastPoint,
  type RegulatoryContextTag,
} from './types.js';
import {
  type Logger,
  type TelemetryPort,
  type TenantPermissionPort,
  NOOP_LOGGER,
  NOOP_TELEMETRY,
} from './ports.js';

export interface DemandForecasterDeps {
  readonly tenantPermission: TenantPermissionPort;
  readonly logger?: Logger;
  readonly telemetry?: TelemetryPort;
  /** Clock for deterministic tests. */
  readonly now?: () => Date;
}

export interface DemandForecaster {
  forecast90Day(input: ForecastInput): Promise<DemandForecast>;
}

const MAX_HORIZON = 90;
const DEFAULT_TAGS: Array<RegulatoryContextTag> = ['OSHA-TZ', 'TMAA'];

export function createDemandForecaster(
  deps: DemandForecasterDeps,
): DemandForecaster {
  const logger = deps.logger ?? NOOP_LOGGER;
  const telemetry = deps.telemetry ?? NOOP_TELEMETRY;
  const now = deps.now ?? (() => new Date());

  return {
    async forecast90Day(rawInput) {
      const input = forecastInputSchema.parse(rawInput);
      await assertTenantAllowed(input.tenantId, deps.tenantPermission);
      const horizon = Math.min(input.horizonDays, MAX_HORIZON);
      if (input.history.length < 2) {
        throw new ForecastUnavailableError(
          'history requires at least two observations',
        );
      }
      logger.info('market-intel.forecast.start', {
        commodity: input.commodity,
        tenantId: input.tenantId,
        horizon,
      });
      const baseline = forecastBaseline(input);
      const points = expandHorizon(baseline, horizon, now());
      const drivers = driverNarrative(input.commodity, baseline, input.driverHints);
      const confidence = coverageEstimate(input.history.length);
      const out: DemandForecast = {
        commodity: input.commodity,
        tenantId: input.tenantId,
        horizonDays: horizon,
        points: [...points],
        drivers: [...drivers],
        confidence,
        computedAtISO: now().toISOString(),
        regulatoryTags: [...DEFAULT_TAGS],
      };
      const validated = demandForecastSchema.parse(out);
      telemetry.count('market_intel.forecast', {
        commodity: input.commodity,
        horizon,
      });
      logger.info('market-intel.forecast.done', {
        commodity: input.commodity,
        confidence,
      });
      return validated;
    },
  };
}

async function assertTenantAllowed(
  tenantId: string,
  port: TenantPermissionPort,
): Promise<void> {
  const ok = await port.canAccess(tenantId);
  if (!ok) throw new TenantPermissionError(tenantId);
}

// ─── Baseline maths ──────────────────────────────────────────────

interface BaselineModel {
  readonly intercept: number;
  readonly slopePerDay: number;
  readonly residualStd: number;
  readonly lastPrice: number;
}

function forecastBaseline(input: ForecastInput): BaselineModel {
  const sorted = [...input.history].sort((a, b) =>
    a.asOfISO < b.asOfISO ? -1 : 1,
  );
  const baseTime = new Date(sorted[0]!.asOfISO).getTime();
  const xs: number[] = sorted.map(
    (h) => (new Date(h.asOfISO).getTime() - baseTime) / 86_400_000,
  );
  const ys: number[] = sorted.map((h) => h.price);
  const { intercept, slope } = linearRegression(xs, ys);
  const residualStd = stdResidual(xs, ys, intercept, slope);
  return {
    intercept,
    slopePerDay: slope,
    residualStd,
    lastPrice: ys[ys.length - 1]!,
  };
}

function linearRegression(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
): { intercept: number; slope: number } {
  const n = xs.length;
  if (n === 0) return { intercept: 0, slope: 0 };
  const meanX = sum(xs) / n;
  const meanY = sum(ys) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    num += dx * (ys[i]! - meanY);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  return { intercept: meanY - slope * meanX, slope };
}

function stdResidual(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
  intercept: number,
  slope: number,
): number {
  const n = xs.length;
  if (n < 2) return 0;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const fit = intercept + slope * xs[i]!;
    const r = ys[i]! - fit;
    acc += r * r;
  }
  const variance = acc / Math.max(1, n - 1);
  // Floor at 1% of last observation so bands never collapse to zero.
  const floor = Math.abs(ys[ys.length - 1]!) * 0.01;
  return Math.max(Math.sqrt(variance), floor);
}

function sum(arr: ReadonlyArray<number>): number {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}

// ─── Horizon expansion + band construction ───────────────────────

const Z_P5 = 1.6448536269514722; // inverse standard normal at 0.95
const ROOT_TWO_PI = Math.sqrt(2 * Math.PI);

function expandHorizon(
  m: BaselineModel,
  horizonDays: number,
  origin: Date,
): ReadonlyArray<ForecastPoint> {
  const out: ForecastPoint[] = [];
  for (let d = 1; d <= horizonDays; d += 1) {
    const projected = m.lastPrice + m.slopePerDay * d;
    // Widening band: residual std grows with sqrt(horizon-step) so
    // long-horizon points carry more uncertainty.
    const width = m.residualStd * Math.sqrt(d) * (1 + d / (horizonDays * ROOT_TWO_PI));
    const date = new Date(origin.getTime() + d * 86_400_000);
    out.push({
      dayOffset: d,
      asOfISO: date.toISOString(),
      p5: projected - Z_P5 * width,
      p50: projected,
      p95: projected + Z_P5 * width,
    });
  }
  return out;
}

// ─── Narrative + confidence ──────────────────────────────────────

function driverNarrative(
  commodity: Commodity,
  m: BaselineModel,
  hints: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const direction = m.slopePerDay > 0 ? 'upward' : m.slopePerDay < 0 ? 'downward' : 'flat';
  const drivers: string[] = [];
  drivers.push(
    `Linear trend over fit window is ${direction} (slope ${m.slopePerDay.toFixed(4)}/day).`,
  );
  drivers.push(commodityNarrative(commodity));
  for (const h of hints) drivers.push(`Caller hint: ${h}`);
  return drivers;
}

function commodityNarrative(commodity: Commodity): string {
  switch (commodity) {
    case 'gold':
      return 'Gold demand anchored to LBMA fix + USD/TZS basis; safe-haven flows lift p95 when geopolitical risk rises.';
    case 'copper':
      return 'Copper demand tracks LME 3-month and Mwadui/Mbeya regional spread; China refinery cadence drives p5.';
    case 'tanzanite':
      return 'Tanzanite demand tied to Block C/D production volumes out of Karatu/Mererani and luxury-retail seasonality.';
  }
}

function coverageEstimate(historyLen: number): number {
  // More history → tighter calibration. Cap at 0.95.
  const raw = 0.55 + Math.min(historyLen, 90) / 200;
  return Math.min(0.95, raw);
}
