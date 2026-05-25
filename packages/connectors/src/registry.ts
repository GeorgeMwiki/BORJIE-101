/**
 * Connector Registry — central in-memory directory of every external
 * integration Borjie speaks to. Mirrors LITFIN's
 * `src/core/connectors/connector-registry.ts`, scoped to property
 * management (Mpesa B2C, GePG, KRA MRI, RERA registry, OpenSearch
 * indexer, etc.).
 *
 * Closes Gap C from `.planning/parity-litfin/09-tools-connectors-kg.md`.
 *
 * The registry is a pure factory — caller owns lifecycle. It exposes a
 * `register / get / list / setHealth / setStatus / unregister` surface
 * over a `connectorId → ConnectorEntry` map, where each entry holds:
 *
 *   - the live `BaseConnector` instance
 *   - the latest `ConnectorHealth` snapshot
 *   - the per-connector `ConnectorPolicy` (retry / rate-limit / backup)
 *
 * The registry deliberately does NOT call any connector. Dispatch lives
 * in `orchestrator.ts`. Periodic health-pings live in
 * `health-scheduler.ts`. Single-responsibility kept.
 */

import type { BaseConnector, CircuitHealth } from './base-connector.js';

// ---------- Public types ----------

/**
 * Property-management connector kinds — one slot per known integration.
 * `custom` is the catch-all for tenants that ship private connectors via
 * a compliance plugin. Used for grouping / metrics, not for behaviour.
 */
export type ConnectorKind =
  | 'mpesa-b2c'
  | 'gepg'
  | 'kra-mri'
  | 'rera-registry'
  | 'opensearch-indexer'
  | 'custom';

/**
 * Health snapshot — combines the circuit-breaker state from the
 * `BaseConnector.health()` call with the last scheduler ping result.
 * `status` is the rolled-up traffic-light for dashboards / `/api/health`.
 */
export interface ConnectorHealth {
  readonly circuit: CircuitHealth;
  readonly status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  readonly lastCheckedAt: string | null;
  readonly lastError: string | null;
  /** Optional latency observed on the last health probe in ms. */
  readonly probeLatencyMs: number | null;
}

/**
 * Policy knobs the orchestrator consults BEFORE delegating to the
 * connector itself. Note these are SEPARATE from the connector's own
 * rate-limit / retry config: those govern transport. These govern
 * dispatch.
 */
export interface ConnectorPolicy {
  /**
   * Max retry attempts the orchestrator will try on retryable outcomes
   * (transport / 5xx / circuit-open) BEFORE falling over to backup.
   * Default 2.
   */
  readonly maxRetryAttempts?: number;
  /** Initial delay in ms before the first orchestrator retry. Default 200. */
  readonly retryInitialDelayMs?: number;
  /** Backup connector id to fall over to when primary stays open. */
  readonly backupConnectorId?: string;
  /** Hard ceiling on a single dispatch (including retries) in ms. */
  readonly dispatchTimeoutMs?: number;
}

export interface HealthProbe {
  /**
   * Lightweight liveness check. Should return quickly. Throwing or a
   * non-true return value is treated as `unhealthy`.
   */
  (): Promise<boolean>;
}

export interface RegisterConnectorInput {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly displayName: string;
  readonly connector: BaseConnector;
  readonly policy?: ConnectorPolicy;
  readonly healthProbe?: HealthProbe;
}

export interface ConnectorEntry {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly displayName: string;
  readonly connector: BaseConnector;
  readonly policy: ConnectorPolicy;
  readonly health: ConnectorHealth;
  readonly healthProbe: HealthProbe | null;
  readonly registeredAt: string;
}

export interface ConnectorRegistry {
  register(input: RegisterConnectorInput): ConnectorEntry;
  unregister(id: string): boolean;
  get(id: string): ConnectorEntry | null;
  list(): ReadonlyArray<ConnectorEntry>;
  /** Replace the cached health snapshot for a registered connector. */
  setHealth(id: string, health: ConnectorHealth): void;
  /** Convenience: roll up `BaseConnector.health()` into the cache. */
  refreshCircuit(id: string): ConnectorHealth | null;
  /** Test helper — clear the registry. */
  clear(): void;
}

// ---------- Defaults ----------

const DEFAULT_POLICY: Required<Pick<
  ConnectorPolicy,
  'maxRetryAttempts' | 'retryInitialDelayMs' | 'dispatchTimeoutMs'
>> = Object.freeze({
  maxRetryAttempts: 2,
  retryInitialDelayMs: 200,
  dispatchTimeoutMs: 15_000,
});

const INITIAL_HEALTH: ConnectorHealth = Object.freeze({
  circuit: Object.freeze({ state: 'closed', errorCount: 0, lastErrorAt: null }),
  status: 'unknown',
  lastCheckedAt: null,
  lastError: null,
  probeLatencyMs: null,
});

// ---------- Helpers ----------

function freezeEntry(entry: ConnectorEntry): ConnectorEntry {
  return Object.freeze({
    ...entry,
    policy: Object.freeze({ ...entry.policy }),
    health: Object.freeze({
      ...entry.health,
      circuit: Object.freeze({ ...entry.health.circuit }),
    }),
  });
}

function nowIso(clock: () => number): string {
  return new Date(clock()).toISOString();
}

function statusFromCircuit(circuit: CircuitHealth): ConnectorHealth['status'] {
  if (circuit.state === 'open') return 'unhealthy';
  if (circuit.state === 'half-open') return 'degraded';
  if (circuit.errorCount > 0) return 'degraded';
  return 'healthy';
}

// ---------- Factory ----------

export interface ConnectorRegistryDeps {
  readonly clock?: () => number;
}

export function createConnectorRegistry(
  deps: ConnectorRegistryDeps = {},
): ConnectorRegistry {
  const clock = deps.clock ?? Date.now;
  // Internal mutable map; never exposed.
  const entries = new Map<string, ConnectorEntry>();

  function register(input: RegisterConnectorInput): ConnectorEntry {
    if (!input.id || input.id.trim().length === 0) {
      throw new Error('ConnectorRegistry.register: id is required');
    }
    if (entries.has(input.id)) {
      throw new Error(
        `ConnectorRegistry.register: connector id "${input.id}" already registered`,
      );
    }
    const policy: ConnectorPolicy = {
      ...DEFAULT_POLICY,
      ...(input.policy ?? {}),
    };
    const entry: ConnectorEntry = freezeEntry({
      id: input.id,
      kind: input.kind,
      displayName: input.displayName,
      connector: input.connector,
      policy,
      health: INITIAL_HEALTH,
      healthProbe: input.healthProbe ?? null,
      registeredAt: nowIso(clock),
    });
    entries.set(input.id, entry);
    return entry;
  }

  function unregister(id: string): boolean {
    return entries.delete(id);
  }

  function get(id: string): ConnectorEntry | null {
    return entries.get(id) ?? null;
  }

  function list(): ReadonlyArray<ConnectorEntry> {
    return Object.freeze(Array.from(entries.values()));
  }

  function setHealth(id: string, health: ConnectorHealth): void {
    const current = entries.get(id);
    if (!current) return;
    const next = freezeEntry({ ...current, health });
    entries.set(id, next);
  }

  function refreshCircuit(id: string): ConnectorHealth | null {
    const current = entries.get(id);
    if (!current) return null;
    const circuit = current.connector.health();
    const status = statusFromCircuit(circuit);
    const next: ConnectorHealth = {
      circuit,
      status,
      lastCheckedAt: current.health.lastCheckedAt,
      lastError: current.health.lastError,
      probeLatencyMs: current.health.probeLatencyMs,
    };
    setHealth(id, next);
    return next;
  }

  function clear(): void {
    entries.clear();
  }

  return {
    register,
    unregister,
    get,
    list,
    setHealth,
    refreshCircuit,
    clear,
  };
}
