/**
 * Routing-override port — abstraction over the storage backend.
 *
 * The composition root binds either:
 *   - the in-memory adapter (`InMemoryOverrideAdapter`) for tests +
 *     standalone bootstrap, OR
 *   - a Drizzle-backed adapter (NOT YET IMPLEMENTED — follow-up task)
 *     that reads from a `llm_routing_overrides` table.
 *
 * The repository (`RoutingOverrideRepository`) wraps the adapter with
 * an in-memory LRU cache and invalidation on writes so the resolver
 * hot path can stay synchronous.
 */

import type { ModelFamily } from '../dynamic-registry/baselines.js';
import type { RoutingOverrideEntry } from './schema.js';

export interface RoutingOverride {
  readonly family: ModelFamily;
  readonly reason: string;
}

/**
 * Storage-backend port. Adapters MUST be:
 *   - Async on all I/O methods (the repository caches sync access).
 *   - Tenant-scoped (RLS at the DB layer; adapter accepts tenantId).
 *   - Eventual: writes might not be visible to reads in the same
 *     millisecond on a multi-replica DB. The repository handles
 *     cache invalidation explicitly.
 */
export interface OverridePort {
  /** Load all overrides for a tenant. */
  listForTenant(tenantId: string): Promise<ReadonlyArray<RoutingOverrideEntry>>;
  /** Insert or update an override. */
  upsert(entry: RoutingOverrideEntry): Promise<void>;
  /** Delete an override; returns true iff one existed. */
  delete(tenantId: string, taskCategory: string): Promise<boolean>;
}
