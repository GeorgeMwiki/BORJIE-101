/**
 * Ports + in-memory defaults for `@borjie/market-intelligence`.
 *
 * Every external dependency (price feed, FX, alert sink, telemetry,
 * tenant permission check) is expressed as a Port so callers can wire
 * real adapters in production and pass deterministic fakes in tests.
 *
 * NEVER call real network from this package — adapters live in the
 * caller's composition root.
 */

import type {
  Commodity,
  CommodityPrice,
  DisruptionAlert,
} from './types.js';

// ─── Logger ──────────────────────────────────────────────────────

export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// ─── Price provider ──────────────────────────────────────────────
// Returns the latest commodity price snapshot. Caller wires:
//   gold      -> LBMA AM/PM fix adapter (LATER(wire): @borjie/mining-commodity-intelligence.createKitcoAdapter — see KI-DEBT-001)
//   copper    -> LME 3-month adapter + regional spread adapter
//   tanzanite -> Block C/D production-report adapter

export interface PriceProviderPort {
  fetchLatest(
    commodity: Commodity,
    tenantId: string,
  ): Promise<CommodityPrice>;
}

// ─── FX provider ─────────────────────────────────────────────────
// Resolves USD/TZS for the gold-to-TZS conversion.
// LATER(wire): @borjie/fx-treasury-advisor.FxRateFeedPort.getRates(['USD/TZS']) — see KI-DEBT-001.

export interface FxProviderPort {
  /** Returns the multiplier `1 USD = N TZS`. */
  usdToTzs(asOfISO: string): Promise<number>;
}

export const DEFAULT_USD_TZS_RATE = 2_580;

export const STATIC_FX_PROVIDER: FxProviderPort = {
  async usdToTzs() {
    return DEFAULT_USD_TZS_RATE;
  },
};

// ─── Tenant permission ───────────────────────────────────────────
// Resolves whether a tenant can read market intel. Default policy:
// allow any non-empty tenantId. In production, swap for an RBAC port
// (LATER(wire): @borjie/authz-policy — see KI-DEBT-001).

export interface TenantPermissionPort {
  canAccess(tenantId: string): Promise<boolean>;
}

export const ALLOW_ALL_TENANT_PERMISSION: TenantPermissionPort = {
  async canAccess(tenantId: string) {
    return tenantId.length > 0;
  },
};

// ─── Alert sink ──────────────────────────────────────────────────
// Where disruption alerts are emitted. In production this is wired to
// `@borjie/proactive-intel` recommendation composer + the platform
// notification adapter (chat → WhatsApp → email digest fallback).
// LATER(wire): @borjie/proactive-intel.compose + notification adapter — see KI-DEBT-001.

export interface AlertSinkPort {
  emit(alert: DisruptionAlert): Promise<void>;
}

export interface InMemoryAlertSink extends AlertSinkPort {
  /** Read-only view of all alerts ever emitted. Test-only. */
  readonly emitted: ReadonlyArray<DisruptionAlert>;
}

export function createInMemoryAlertSink(): InMemoryAlertSink {
  const emitted: DisruptionAlert[] = [];
  return {
    async emit(alert) {
      emitted.push(alert);
    },
    get emitted() {
      return emitted;
    },
  };
}

// ─── Disruption signal source ────────────────────────────────────
// Inbound feed of raw disruption inputs (logistics, regulatory,
// weather, geopolitics). The detector consumes these. In production
// the caller wires this to RSS, gov feeds, weather APIs, etc.

export interface DisruptionSignalSourcePort {
  pending(tenantId: string): Promise<ReadonlyArray<DisruptionAlert>>;
}

export const EMPTY_DISRUPTION_SOURCE: DisruptionSignalSourcePort = {
  async pending() {
    return [];
  },
};

// ─── Telemetry ───────────────────────────────────────────────────
// Optional metrics counter. LATER(wire): @borjie/observability.PlatformMetrics
// + @borjie/ocsf-emitter.emitEvent for SIEM ingestion — see KI-DEBT-001.

export interface TelemetryPort {
  count(name: string, attrs?: Record<string, string | number>): void;
}

export const NOOP_TELEMETRY: TelemetryPort = {
  count: () => undefined,
};
