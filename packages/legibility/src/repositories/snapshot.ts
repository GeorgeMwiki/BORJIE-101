/**
 * In-memory `LegibilitySnapshotRepository`.
 *
 * Wave M6. Pure-memory adapter for tests + dev. The database package
 * wires the real Drizzle adapter against `legibility_snapshots` from
 * migration 0037.
 */

import type {
  LegibilitySnapshot,
  LegibilitySnapshotRepository,
} from '../types.js';

export function createInMemorySnapshotRepository(): LegibilitySnapshotRepository {
  const rows = new Map<string, LegibilitySnapshot>();
  const latestByScope = new Map<string, string>(); // tenant|scope -> id

  function scopeKey(tenantId: string, scopeId: string): string {
    return `${tenantId}|${scopeId}`;
  }

  return {
    async insert(snapshot: LegibilitySnapshot): Promise<LegibilitySnapshot> {
      const frozen = Object.freeze({ ...snapshot });
      rows.set(frozen.id, frozen);
      const k = scopeKey(frozen.tenantId, frozen.scopeId);
      const prevId = latestByScope.get(k);
      const prev = prevId === undefined ? null : (rows.get(prevId) ?? null);
      if (prev === null || prev.snapshotAt.getTime() <= frozen.snapshotAt.getTime()) {
        latestByScope.set(k, frozen.id);
      }
      return frozen;
    },

    async latestForScope(
      tenantId: string,
      scopeId: string,
    ): Promise<LegibilitySnapshot | null> {
      const id = latestByScope.get(scopeKey(tenantId, scopeId));
      if (id === undefined) return null;
      return rows.get(id) ?? null;
    },

    async listSince(
      tenantId: string,
      since: Date,
    ): Promise<ReadonlyArray<LegibilitySnapshot>> {
      const matches: LegibilitySnapshot[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId && row.snapshotAt.getTime() >= since.getTime()) {
          matches.push(row);
        }
      }
      matches.sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());
      return matches;
    },
  };
}
