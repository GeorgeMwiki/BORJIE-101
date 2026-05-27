/**
 * Sell-signal generator — combines a forecast (from the demand
 * forecaster) with an active-disruption snapshot (from the disruption
 * detector) and the latest price tick to produce a buy / sell / hold
 * recommendation with bulleted causal reasoning.
 *
 * The reasoning is intentionally explainable — `@borjie/causal-inference`
 * would normally provide a back-door-adjusted treatment effect, but
 * for the offline default we use simple deterministic rules:
 *
 *   - p50 forecast trend rises strongly + low disruption => BUY
 *   - p50 forecast trend falls strongly + active high-sev disruption => SELL
 *   - bands wide + mixed signals => HOLD
 *
 * TODO(wire): @borjie/causal-inference.fuelPriceImpact /
 *   royaltyRateImpact to attribute causality from the active-disruption
 *   set to forecasted demand moves.
 */

import {
  sellSignalSchema,
  TenantPermissionError,
  type Commodity,
  type CommodityPrice,
  type DemandForecast,
  type DisruptionAlert,
  type RegulatoryContextTag,
  type SellSignal,
  type SellSignalAction,
} from './types.js';
import {
  type Logger,
  type TelemetryPort,
  type TenantPermissionPort,
  NOOP_LOGGER,
  NOOP_TELEMETRY,
} from './ports.js';

export interface SellSignalGeneratorDeps {
  readonly tenantPermission: TenantPermissionPort;
  readonly logger?: Logger;
  readonly telemetry?: TelemetryPort;
  readonly now?: () => Date;
}

export interface SellSignalInputs {
  readonly tenantId: string;
  readonly commodity: Commodity;
  readonly latest: CommodityPrice;
  readonly forecast: DemandForecast;
  readonly disruptions: ReadonlyArray<DisruptionAlert>;
}

export interface SellSignalGenerator {
  generate(inputs: SellSignalInputs): Promise<ReadonlyArray<SellSignal>>;
}

const DEFAULT_TAGS: Array<RegulatoryContextTag> = ['OSHA-TZ', 'TMAA'];

export function createSellSignalGenerator(
  deps: SellSignalGeneratorDeps,
): SellSignalGenerator {
  const logger = deps.logger ?? NOOP_LOGGER;
  const telemetry = deps.telemetry ?? NOOP_TELEMETRY;
  const now = deps.now ?? (() => new Date());
  return {
    async generate(inputs) {
      await assertTenantAllowed(inputs.tenantId, deps.tenantPermission);
      if (inputs.forecast.tenantId !== inputs.tenantId) {
        throw new TenantPermissionError(
          inputs.tenantId,
          'Forecast tenant mismatch — refusing to cross tenant boundary.',
        );
      }
      if (inputs.latest.tenantId !== inputs.tenantId) {
        throw new TenantPermissionError(
          inputs.tenantId,
          'Price tenant mismatch — refusing to cross tenant boundary.',
        );
      }
      const evaluation = evaluate(inputs);
      const signal: SellSignal = {
        id: `signal-${inputs.tenantId}-${inputs.commodity}-${now().getTime()}`,
        tenantId: inputs.tenantId,
        commodity: inputs.commodity,
        action: evaluation.action,
        confidence: evaluation.confidence,
        reasoning: [...evaluation.reasoning],
        horizonDays: inputs.forecast.horizonDays,
        computedAtISO: now().toISOString(),
        regulatoryTags: [...DEFAULT_TAGS],
      };
      const validated = sellSignalSchema.parse(signal);
      logger.info('market-intel.signal.done', {
        commodity: inputs.commodity,
        action: validated.action,
        confidence: validated.confidence,
      });
      telemetry.count('market_intel.signal', {
        commodity: inputs.commodity,
        action: validated.action,
      });
      return [validated];
    },
  };
}

async function assertTenantAllowed(
  tenantId: string,
  port: TenantPermissionPort,
): Promise<void> {
  if (tenantId.length === 0) throw new TenantPermissionError(tenantId);
  const ok = await port.canAccess(tenantId);
  if (!ok) throw new TenantPermissionError(tenantId);
}

// ─── Evaluation ──────────────────────────────────────────────────

interface Evaluation {
  readonly action: SellSignalAction;
  readonly confidence: number;
  readonly reasoning: ReadonlyArray<string>;
}

function evaluate(inputs: SellSignalInputs): Evaluation {
  const first = inputs.forecast.points[0];
  const last = inputs.forecast.points[inputs.forecast.points.length - 1];
  if (!first || !last) {
    return {
      action: 'hold',
      confidence: 0,
      reasoning: ['No forecast points available — defaulting to hold.'],
    };
  }
  const trend = (last.p50 - first.p50) / Math.max(Math.abs(first.p50), 1);
  const bandWidth = (last.p95 - last.p5) / Math.max(Math.abs(last.p50), 1);
  const hasHighSeverityDisruption = inputs.disruptions.some(
    (d) => d.severity === 'high' || d.severity === 'critical',
  );
  const reasoning: string[] = [];
  reasoning.push(
    `Median forecast trend over horizon: ${(trend * 100).toFixed(2)}%.`,
  );
  reasoning.push(
    `Final-point band width (p95-p5)/|p50|: ${(bandWidth * 100).toFixed(2)}%.`,
  );
  reasoning.push(
    `Active high/critical disruptions: ${hasHighSeverityDisruption ? 'yes' : 'no'}.`,
  );
  reasoning.push(
    `Latest spot price: ${inputs.latest.price} ${inputs.latest.currency}.`,
  );

  let action: SellSignalAction = 'hold';
  let confidence = 0.4;

  if (trend > 0.03 && !hasHighSeverityDisruption) {
    action = 'buy';
    confidence = Math.min(0.9, 0.55 + Math.abs(trend) * 2);
    reasoning.push(
      'Forecast median rises >3% with no high-severity disruption — buy bias.',
    );
  } else if (trend < -0.03 && hasHighSeverityDisruption) {
    action = 'sell';
    confidence = Math.min(0.92, 0.6 + Math.abs(trend) * 2);
    reasoning.push(
      'Forecast median falls >3% and high-severity disruption active — sell bias.',
    );
  } else if (bandWidth > 0.25) {
    action = 'hold';
    confidence = 0.5;
    reasoning.push('Bands too wide for high-conviction call — hold.');
  } else if (trend < -0.03) {
    action = 'sell';
    confidence = Math.min(0.7, 0.45 + Math.abs(trend) * 1.5);
    reasoning.push('Forecast median falls >3% — soft sell bias.');
  } else if (trend > 0.03) {
    action = 'buy';
    confidence = Math.min(0.7, 0.45 + Math.abs(trend) * 1.5);
    reasoning.push('Forecast median rises >3% — soft buy bias.');
  } else {
    reasoning.push('No strong directional signal — hold.');
  }

  // Confidence dampened by forecast confidence calibration.
  const damped = confidence * (0.5 + 0.5 * inputs.forecast.confidence);
  return {
    action,
    confidence: clamp01(damped),
    reasoning,
  };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
