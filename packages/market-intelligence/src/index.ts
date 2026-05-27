/**
 * `@borjie/market-intelligence` — public surface.
 *
 * Tanzania mining market intelligence:
 *   - track gold / copper / tanzanite spot prices
 *   - 90-day demand forecasts with p5/p50/p95 bands + drivers
 *   - active disruption alerts (logistics / regulatory / weather /
 *     geopolitics)
 *   - buy / sell / hold signals with causal reasoning
 *
 * Wraps existing Borjie packages (mining-commodity-intelligence,
 * forecasting-engine, proactive-intel, anomaly-detection,
 * causal-inference, fx-treasury-advisor, observability, ocsf-emitter)
 * behind Ports so unit tests never touch network.
 *
 * Persona: Mr. Mwikila. Brand: Borjie.
 *
 * @module @borjie/market-intelligence
 */

import {
  commoditySchema,
  forecastInputSchema,
  UnknownCommodityError,
  type Commodity,
  type CommodityPrice,
  type DemandForecast,
  type DisruptionAlert,
  type ForecastInput,
  type SellSignal,
} from './types.js';
import {
  ALLOW_ALL_TENANT_PERMISSION,
  EMPTY_DISRUPTION_SOURCE,
  NOOP_LOGGER,
  NOOP_TELEMETRY,
  STATIC_FX_PROVIDER,
  createInMemoryAlertSink,
  type AlertSinkPort,
  type DisruptionSignalSourcePort,
  type FxProviderPort,
  type Logger,
  type PriceProviderPort,
  type TelemetryPort,
  type TenantPermissionPort,
} from './ports.js';
import { createCommodityTracker } from './commodity-tracker.js';
import { createDemandForecaster } from './demand-forecaster.js';
import { createDisruptionDetector } from './disruption-detector.js';
import { createSellSignalGenerator } from './sell-signals.js';

// ─── Re-exports ───────────────────────────────────────────────────

export * from './types.js';
export {
  NOOP_LOGGER,
  NOOP_TELEMETRY,
  STATIC_FX_PROVIDER,
  ALLOW_ALL_TENANT_PERMISSION,
  EMPTY_DISRUPTION_SOURCE,
  DEFAULT_USD_TZS_RATE,
  createInMemoryAlertSink,
  type AlertSinkPort,
  type DisruptionSignalSourcePort,
  type FxProviderPort,
  type Logger,
  type PriceProviderPort,
  type TelemetryPort,
  type TenantPermissionPort,
  type InMemoryAlertSink,
} from './ports.js';
export {
  createCommodityTracker,
  createInMemoryPriceProvider,
  type CommodityTracker,
  type CommodityTrackerDeps,
  type FixturePriceMap,
} from './commodity-tracker.js';
export {
  createDemandForecaster,
  type DemandForecaster,
  type DemandForecasterDeps,
} from './demand-forecaster.js';
export {
  createDisruptionDetector,
  createFixtureSignalSource,
  type DisruptionDetector,
  type DisruptionDetectorDeps,
} from './disruption-detector.js';
export {
  createSellSignalGenerator,
  type SellSignalGenerator,
  type SellSignalGeneratorDeps,
  type SellSignalInputs,
} from './sell-signals.js';

// ─── Factory ──────────────────────────────────────────────────────

export interface MarketIntelligenceDeps {
  readonly priceProvider: PriceProviderPort;
  readonly fxProvider?: FxProviderPort;
  readonly tenantPermission?: TenantPermissionPort;
  readonly disruptionSource?: DisruptionSignalSourcePort;
  readonly alertSink?: AlertSinkPort;
  readonly logger?: Logger;
  readonly telemetry?: TelemetryPort;
  /** Clock for deterministic outputs. */
  readonly now?: () => Date;
}

export interface MarketIntelligence {
  trackCommodity(commodity: Commodity, tenantId: string): Promise<CommodityPrice>;
  forecast90Day(input: ForecastInput): Promise<DemandForecast>;
  getDisruptionAlerts(tenantId: string): Promise<ReadonlyArray<DisruptionAlert>>;
  getSellSignals(
    tenantId: string,
    commodity: Commodity,
  ): Promise<ReadonlyArray<SellSignal>>;
}

export function createMarketIntelligence(
  deps: MarketIntelligenceDeps,
): MarketIntelligence {
  const fxProvider = deps.fxProvider ?? STATIC_FX_PROVIDER;
  const tenantPermission = deps.tenantPermission ?? ALLOW_ALL_TENANT_PERMISSION;
  const disruptionSource = deps.disruptionSource ?? EMPTY_DISRUPTION_SOURCE;
  const alertSink = deps.alertSink ?? createInMemoryAlertSink();
  const logger = deps.logger ?? NOOP_LOGGER;
  const telemetry = deps.telemetry ?? NOOP_TELEMETRY;
  const now = deps.now ?? (() => new Date());

  const tracker = createCommodityTracker({
    priceProvider: deps.priceProvider,
    fxProvider,
    tenantPermission,
    logger,
    telemetry,
  });
  const forecaster = createDemandForecaster({
    tenantPermission,
    logger,
    telemetry,
    now,
  });
  const detector = createDisruptionDetector({
    signalSource: disruptionSource,
    alertSink,
    tenantPermission,
    logger,
    telemetry,
  });
  const signaler = createSellSignalGenerator({
    tenantPermission,
    logger,
    telemetry,
    now,
  });

  return {
    async trackCommodity(commodity, tenantId) {
      assertCommodity(commodity);
      return tracker.track(commodity, tenantId);
    },

    async forecast90Day(rawInput) {
      // Pre-validate so we surface UnknownCommodityError before the
      // forecaster's schema rejects with a generic Zod issue.
      const parsed = forecastInputSchema.safeParse(rawInput);
      if (parsed.success) assertCommodity(parsed.data.commodity);
      return forecaster.forecast90Day(rawInput);
    },

    async getDisruptionAlerts(tenantId) {
      return detector.getActive(tenantId);
    },

    async getSellSignals(tenantId, commodity) {
      assertCommodity(commodity);
      const latest = await tracker.track(commodity, tenantId);
      const history = buildHistoryFromLatest(latest, now());
      const forecast = await forecaster.forecast90Day({
        commodity,
        tenantId,
        history,
        horizonDays: 90,
        driverHints: [],
      });
      const disruptions = await detector.getActive(tenantId);
      const tenantDisruptions = disruptions.filter(
        (d) => d.commodity === commodity,
      );
      return signaler.generate({
        tenantId,
        commodity,
        latest,
        forecast,
        disruptions: tenantDisruptions,
      });
    },
  };
}

function assertCommodity(commodity: string): asserts commodity is Commodity {
  const parsed = commoditySchema.safeParse(commodity);
  if (!parsed.success) throw new UnknownCommodityError(String(commodity));
}

/**
 * When the caller only has a single price tick available, synthesize
 * a minimal two-point history so the forecaster has the lookback it
 * needs. Real production wiring should supply richer history.
 */
function buildHistoryFromLatest(
  latest: CommodityPrice,
  origin: Date,
): Array<{ asOfISO: string; price: number }> {
  const oneDayMs = 86_400_000;
  const prior = new Date(
    new Date(latest.asOfISO).getTime() - oneDayMs,
  ).toISOString();
  void origin; // origin reserved for future windowing.
  return [
    { asOfISO: prior, price: latest.price },
    { asOfISO: latest.asOfISO, price: latest.price },
  ];
}
