/**
 * `telemetry-repository.ts` — minimal port for the
 * `ephemeral_dashboard_telemetry` table.
 *
 * No I/O coupling. The interface is what the storage adapter implements
 * (a Drizzle-backed adapter lives outside this package). The in-memory
 * implementation here is the test seam — production callers wire the
 * real repository in via dependency injection.
 *
 * Pure data structures. All inserts and updates return frozen rows.
 */
import type { EphemeralDashboardTelemetryRow } from '../types.js';

export interface TelemetryRepository {
  readonly insert: (
    input: TelemetryInsertInput,
  ) => Promise<EphemeralDashboardTelemetryRow>;
  readonly markClosed: (
    rowId: string,
    closed_at_iso: string,
  ) => Promise<EphemeralDashboardTelemetryRow | null>;
  readonly bumpReuse: (
    recipeHash: string,
    distinctUserDelta: number,
  ) => Promise<number>;
  readonly markPromoted: (
    rowId: string,
    promotion_recipe_id: string,
  ) => Promise<EphemeralDashboardTelemetryRow | null>;
}

export interface TelemetryInsertInput {
  readonly id: string;
  readonly tenant_id: string;
  readonly function_id: string;
  readonly manifest_version: number;
  readonly generated_recipe_hash: string;
  readonly user_id: string;
  readonly session_id: string;
  readonly scope_kind: string;
  readonly scope_id: string;
  readonly user_context_hash: string;
  readonly generated_at: string;
  readonly audit_hash: string;
}

/**
 * In-memory adapter — test seam + a working composition for unit tests.
 * Production wires the Drizzle adapter (lives in
 * `services/dynamic-ui-runtime` once Phase 2 ships).
 */
export function createInMemoryTelemetryRepository(): TelemetryRepository {
  const rows = new Map<string, EphemeralDashboardTelemetryRow>();

  return {
    async insert(input) {
      const row: EphemeralDashboardTelemetryRow = {
        id: input.id,
        tenant_id: input.tenant_id,
        function_id: input.function_id,
        manifest_version: input.manifest_version,
        generated_recipe_hash: input.generated_recipe_hash,
        user_id: input.user_id,
        session_id: input.session_id,
        scope_kind: input.scope_kind,
        scope_id: input.scope_id,
        user_context_hash: input.user_context_hash,
        generated_at: input.generated_at,
        closed_at: null,
        reuse_count_for_this_pattern: 0,
        distinct_user_count_for_pattern: 0,
        was_promoted: false,
        promotion_recipe_id: null,
        audit_hash: input.audit_hash,
      };
      rows.set(row.id, row);
      return row;
    },
    async markClosed(rowId, closed_at_iso) {
      const existing = rows.get(rowId);
      if (!existing) return null;
      const updated: EphemeralDashboardTelemetryRow = {
        ...existing,
        closed_at: closed_at_iso,
      };
      rows.set(rowId, updated);
      return updated;
    },
    async bumpReuse(recipeHash, distinctUserDelta) {
      let maxCount = 0;
      for (const [id, row] of rows.entries()) {
        if (row.generated_recipe_hash === recipeHash) {
          const next: EphemeralDashboardTelemetryRow = {
            ...row,
            reuse_count_for_this_pattern: row.reuse_count_for_this_pattern + 1,
            distinct_user_count_for_pattern:
              row.distinct_user_count_for_pattern + distinctUserDelta,
          };
          rows.set(id, next);
          maxCount = Math.max(maxCount, next.reuse_count_for_this_pattern);
        }
      }
      return maxCount;
    },
    async markPromoted(rowId, promotion_recipe_id) {
      const existing = rows.get(rowId);
      if (!existing) return null;
      const updated: EphemeralDashboardTelemetryRow = {
        ...existing,
        was_promoted: true,
        promotion_recipe_id,
      };
      rows.set(rowId, updated);
      return updated;
    },
  };
}
