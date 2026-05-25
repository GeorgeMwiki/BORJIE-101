/**
 * In-memory narrative store.
 */

import type { NarrativeArc, NarrativeStore, TenantId } from '../types.js';

export function createInMemoryNarrativeStore(): NarrativeStore {
  const arcs = new Map<string, NarrativeArc>();

  return {
    async upsertArc(arc: NarrativeArc): Promise<NarrativeArc> {
      arcs.set(arc.id, arc);
      return arc;
    },

    async listArcsForTenant(
      tenantId: TenantId,
      limit = 25,
    ): Promise<ReadonlyArray<NarrativeArc>> {
      const filtered = Array.from(arcs.values())
        .filter((a) => a.tenantId === tenantId)
        .sort(
          (a, b) =>
            Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
        )
        .slice(0, limit);
      return filtered;
    },
  };
}
