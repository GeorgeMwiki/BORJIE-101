/**
 * Disruption detector — surfaces active logistics / regulatory /
 * weather / geopolitics disruptions for a tenant.
 *
 * Reads from a `DisruptionSignalSourcePort` (caller wires real feeds
 * in production) and emits validated alerts to an `AlertSinkPort`.
 * `@borjie/proactive-intel` and `@borjie/anomaly-detection` would
 * normally compose the alert envelopes — we keep the wiring point
 * behind a Port so unit tests stay deterministic.
 *
 * LATER(wire): @borjie/proactive-intel.compose for chat-first delivery
 * + @borjie/anomaly-detection detectors for statistical triggers.
 * See KI-DEBT-001.
 */

import {
  disruptionAlertSchema,
  TenantPermissionError,
  type DisruptionAlert,
  type RegulatoryContextTag,
} from './types.js';
import {
  type AlertSinkPort,
  type DisruptionSignalSourcePort,
  type Logger,
  type TelemetryPort,
  type TenantPermissionPort,
  NOOP_LOGGER,
  NOOP_TELEMETRY,
} from './ports.js';

export interface DisruptionDetectorDeps {
  readonly signalSource: DisruptionSignalSourcePort;
  readonly alertSink: AlertSinkPort;
  readonly tenantPermission: TenantPermissionPort;
  readonly logger?: Logger;
  readonly telemetry?: TelemetryPort;
}

export interface DisruptionDetector {
  getActive(tenantId: string): Promise<ReadonlyArray<DisruptionAlert>>;
}

const REGULATORY_TAG_BY_KIND: Readonly<
  Record<DisruptionAlert['kind'], ReadonlyArray<RegulatoryContextTag>>
> = {
  logistics: ['OSHA-TZ'],
  regulatory: ['TMAA', 'TRA-ROYALTY'],
  weather: ['OSHA-TZ'],
  geopolitics: ['BOT-FX'],
};

export function createDisruptionDetector(
  deps: DisruptionDetectorDeps,
): DisruptionDetector {
  const logger = deps.logger ?? NOOP_LOGGER;
  const telemetry = deps.telemetry ?? NOOP_TELEMETRY;
  return {
    async getActive(tenantId) {
      await assertTenantAllowed(tenantId, deps.tenantPermission);
      const raw = await deps.signalSource.pending(tenantId);
      const filtered = raw.filter((a) => a.tenantId === tenantId);
      logger.info('market-intel.disruption.scan', {
        tenantId,
        candidates: raw.length,
        keptForTenant: filtered.length,
      });
      const out: DisruptionAlert[] = [];
      for (const alert of filtered) {
        const enriched = enrich(alert);
        const validated = disruptionAlertSchema.parse(enriched);
        await deps.alertSink.emit(validated);
        out.push(validated);
        telemetry.count('market_intel.disruption.emit', {
          kind: validated.kind,
          severity: validated.severity,
        });
      }
      logger.info('market-intel.disruption.done', {
        tenantId,
        emitted: out.length,
      });
      return out;
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

function enrich(alert: DisruptionAlert): DisruptionAlert {
  const base = REGULATORY_TAG_BY_KIND[alert.kind] ?? [];
  const merged = mergeTags(alert.regulatoryTags, base);
  return { ...alert, regulatoryTags: merged };
}

function mergeTags(
  a: ReadonlyArray<RegulatoryContextTag>,
  b: ReadonlyArray<RegulatoryContextTag>,
): Array<RegulatoryContextTag> {
  const seen = new Set<RegulatoryContextTag>();
  for (const t of a) seen.add(t);
  for (const t of b) seen.add(t);
  return Array.from(seen);
}

// ─── Convenience constructor for tests / dev ────────────────────

export function createFixtureSignalSource(
  alerts: ReadonlyArray<DisruptionAlert>,
): DisruptionSignalSourcePort {
  return {
    async pending(tenantId) {
      return alerts.filter((a) => a.tenantId === tenantId);
    },
  };
}
