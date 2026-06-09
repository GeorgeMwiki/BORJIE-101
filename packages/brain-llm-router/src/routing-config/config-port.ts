/**
 * routing-config/config-port.ts — storage-backend port + sync reader
 * injection for the hot path.
 *
 * Two access shapes, mirroring the kill-switch + routing-override patterns
 * already proven in this package:
 *
 *   1. `RoutingConfigPort` — ASYNC port the composition root binds to a
 *      Drizzle adapter (gateway) or the in-memory adapter (tests). Used by a
 *      background warmer.
 *
 *   2. `setRoutingConfigReader()` — a SYNC reader injected into the hot path
 *      so `resolveRoutingConfig()` can stay synchronous (no await on the
 *      brain-call critical path). The composition root wires a reader backed
 *      by a cached, RLS-scoped read; tests inject a stub.
 *
 * FAIL-SAFE: the sync reader MUST NOT throw. If it does, the resolver
 * swallows the error and falls back to the static ladder. The reader returns
 * `null`/`undefined` to mean "no admin config — use the default".
 */

import type { ConfigScope, LlmRoutingConfig } from './config-model.js';

/**
 * Async storage port. Adapters MUST be tenant-scoped (RLS at the DB layer)
 * and may be eventual (writes not instantly visible). The warmer publishes
 * into the sync reader's cache.
 */
export interface RoutingConfigPort {
  /** Read the routing config for a scope, or null when none is set. */
  readForScope(scope: ConfigScope): Promise<LlmRoutingConfig | null>;
  /** Upsert the routing config for a scope. */
  upsertForScope(scope: ConfigScope, config: LlmRoutingConfig): Promise<void>;
}

/**
 * Sync hot-path reader. Returns the admin config for the most-specific scope
 * available, or null/undefined when none is set. MUST be cheap + non-throwing.
 */
export type RoutingConfigReader = (
  scope: ConfigScope,
) => LlmRoutingConfig | null | undefined;

let injectedReader: RoutingConfigReader | null = null;

/**
 * Register a synchronous routing-config reader. The composition root wires a
 * reader that consults a cached, RLS-scoped config table; tests inject a
 * stub. When unset, `resolveRoutingConfig()` always returns the static
 * fallback (today's behaviour) — so an unwired deployment is identical to
 * pre-config behaviour by construction.
 */
export function setRoutingConfigReader(reader: RoutingConfigReader): void {
  injectedReader = reader;
}

export function resetRoutingConfigReader(): void {
  injectedReader = null;
}

/**
 * Read the injected reader for a scope, swallowing any throw. INTERNAL —
 * used by the resolver. Returns null on absent reader, null result, or any
 * error (fail-safe).
 */
export function readInjected(
  scope: ConfigScope,
): LlmRoutingConfig | null {
  if (!injectedReader) return null;
  try {
    return injectedReader(scope) ?? null;
  } catch {
    // FAIL-SAFE: a throwing reader must never break a turn.
    return null;
  }
}
