/**
 * DecisionTrace persistence port.
 *
 * Hexagonal port the trace recorder writes through. Production wires a
 * Postgres-backed adapter (one row per finalised trace + JSONB column
 * for branches/inputs/output). Dev / tests use the in-memory adapter
 * exported below.
 *
 * Adapters MUST be append-only — a finalised trace is an immutable
 * audit record. Callers who need to redact PII before persisting should
 * do so in their own wrapping adapter before delegating to the
 * underlying store.
 *
 * @module packages/observability/src/decision-trace/persistence-port
 */

import type { DecisionTraceFinalised } from './types.js';

/**
 * Port: any backend capable of storing + retrieving finalised
 * DecisionTrace snapshots.
 */
export interface DecisionTraceStore {
  /**
   * Persist a finalised trace. Idempotent on `traceId` — writing the
   * same `traceId` twice MUST be a no-op rather than throwing, so a
   * retry of the brain pipeline does not corrupt the audit log.
   */
  save(trace: DecisionTraceFinalised): Promise<void>;
  /**
   * Read a trace back by id. Returns `null` when the id is unknown —
   * callers must NOT throw on missing traces (the auditor UI is a
   * read-only consumer and a 404 is its valid response).
   */
  load(traceId: string): Promise<DecisionTraceFinalised | null>;
  /** Optional — used by tests to wipe the store. */
  clear?(): Promise<void>;
}

/**
 * Default in-memory adapter. Suitable for dev + tests. NOT durable —
 * traces are lost on process restart.
 */
export class MemoryDecisionTraceStore implements DecisionTraceStore {
  private readonly traces: Map<string, DecisionTraceFinalised> = new Map();

  async save(trace: DecisionTraceFinalised): Promise<void> {
    // Idempotent: ignore second write for the same id.
    if (this.traces.has(trace.traceId)) return;
    this.traces.set(trace.traceId, trace);
  }

  async load(traceId: string): Promise<DecisionTraceFinalised | null> {
    return this.traces.get(traceId) ?? null;
  }

  async clear(): Promise<void> {
    this.traces.clear();
  }

  /** Test-only: count of stored traces. */
  size(): number {
    return this.traces.size;
  }
}

/**
 * Singleton convenience instance — the default store used by `replay`
 * and the recorder when no adapter is passed in. Production code paths
 * SHOULD inject their own Postgres-backed adapter at startup via
 * {@link setDefaultDecisionTraceStore} so traces survive restarts.
 */
let defaultStore: DecisionTraceStore = new MemoryDecisionTraceStore();

/** Replace the default store. Returns the previous instance. */
export function setDefaultDecisionTraceStore(
  store: DecisionTraceStore,
): DecisionTraceStore {
  const previous = defaultStore;
  defaultStore = store;
  return previous;
}

/** Read the current default store. */
export function getDefaultDecisionTraceStore(): DecisionTraceStore {
  return defaultStore;
}

/**
 * Test seam — reinstate a fresh in-memory adapter. Internal use only.
 */
export function _resetDefaultDecisionTraceStoreForTests(): void {
  defaultStore = new MemoryDecisionTraceStore();
}
