/**
 * Junior repository (Wave 18V-DYNAMIC).
 *
 * Storage-agnostic interface for the dynamic spawning pipeline. The
 * production wiring binds this to Drizzle + `junior_personas` /
 * `junior_turn_feedback` tables; tests use the in-memory implementation
 * exported below.
 *
 * Immutable updates only — every mutation returns a new record.
 */

import type {
  PersistedJuniorRecord,
  JuniorLifecycleStatus,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────

export interface JuniorRepository {
  /** Insert a freshly-created record. */
  insert(record: PersistedJuniorRecord): Promise<void>;

  /** Fetch one record by id. Returns null when absent. */
  findById(id: string): Promise<PersistedJuniorRecord | null>;

  /**
   * List every junior visible to the caller — seeds + the caller's
   * tenant-scoped spawned + tenant-authored juniors.
   */
  listVisibleForTenant(tenant_id: string): Promise<ReadonlyArray<PersistedJuniorRecord>>;

  /** Replace the lifecycle status. Returns the new immutable record. */
  setLifecycleStatus(
    id: string,
    status: JuniorLifecycleStatus,
    at: Date,
  ): Promise<PersistedJuniorRecord | null>;

  /** Bump usage_count and last_used_at atomically. */
  recordUsage(id: string, at: Date): Promise<PersistedJuniorRecord | null>;

  /** Replace avg_satisfaction. */
  updateSatisfaction(id: string, avg: number): Promise<PersistedJuniorRecord | null>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory implementation (tests + dev)
// ─────────────────────────────────────────────────────────────────────

/**
 * Create an in-memory repository keyed by `id`. The Map is private to
 * the closure — callers can only mutate through the returned API.
 *
 * All mutations create new records (no in-place mutation) so the
 * shape stays immutable. The Map itself is internal — we replace
 * entries by overwrite.
 */
export function createInMemoryJuniorRepository(
  seed?: ReadonlyArray<PersistedJuniorRecord>,
): JuniorRepository {
  const store = new Map<string, PersistedJuniorRecord>();
  for (const record of seed ?? []) {
    store.set(record.id, record);
  }

  return {
    async insert(record) {
      if (store.has(record.id)) {
        throw new Error(`junior with id '${record.id}' already exists`);
      }
      store.set(record.id, record);
    },

    async findById(id) {
      return store.get(id) ?? null;
    },

    async listVisibleForTenant(tenant_id) {
      return [...store.values()].filter(
        (record) =>
          record.provenance === 'seed' || record.tenant_id === tenant_id,
      );
    },

    async setLifecycleStatus(id, status, at) {
      const existing = store.get(id);
      if (!existing) return null;
      const next: PersistedJuniorRecord = {
        ...existing,
        lifecycle_status: status,
        promoted_at:
          status === 'live' || status === 'locked'
            ? at
            : existing.promoted_at,
        locked_at: status === 'locked' ? at : existing.locked_at,
        deprecated_at:
          status === 'deprecated' ? at : existing.deprecated_at,
      };
      store.set(id, next);
      return next;
    },

    async recordUsage(id, at) {
      const existing = store.get(id);
      if (!existing) return null;
      const next: PersistedJuniorRecord = {
        ...existing,
        usage_count: existing.usage_count + 1,
        last_used_at: at,
      };
      store.set(id, next);
      return next;
    },

    async updateSatisfaction(id, avg) {
      const existing = store.get(id);
      if (!existing) return null;
      const next: PersistedJuniorRecord = {
        ...existing,
        avg_satisfaction: avg,
      };
      store.set(id, next);
      return next;
    },
  };
}
