/**
 * In-memory `SlotsRepository` adapter.
 *
 * Cross-surface state bus (MD-as-Body capstone). Pure-memory adapter
 * for tests + dev. `merge` is the CRDT join — never a blind overwrite —
 * so concurrent cross-surface writes converge. Production wires Drizzle
 * with the same contract.
 *
 * Tenant isolation is enforced by composite key `${tenantId}::${slotId}`.
 */

import {
  type Slot,
  type SlotKind,
  type SlotsRepository,
  type SlotSurface,
} from '../types.js';
import { mergeSlot } from '../slots/slot-crdt.js';

export function createInMemorySlotsRepository(): SlotsRepository {
  const rows = new Map<string, Slot>();
  // Projection provenance per slot: ordered list of surfaces.
  const projections = new Map<string, SlotSurface[]>();

  function key(tenantId: string, slotId: string): string {
    return `${tenantId}::${slotId}`;
  }

  return {
    async get(tenantId, slotId) {
      return rows.get(key(tenantId, slotId)) ?? null;
    },

    async merge(incoming: Slot): Promise<Slot> {
      const k = key(incoming.tenantId, incoming.slotId);
      const existing = rows.get(k);
      const converged =
        existing === undefined ? incoming : mergeSlot(existing, incoming);
      rows.set(k, converged);
      return converged;
    },

    async list(tenantId, filter) {
      const out: Slot[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (filter?.slotKind !== undefined && row.slotKind !== filter.slotKind) {
          continue;
        }
        out.push(row);
      }
      // Stable, deterministic ordering by slotId.
      return out.slice().sort((a, b) => (a.slotId < b.slotId ? -1 : 1));
    },

    async recordProjection(tenantId, slotId, surface) {
      const k = key(tenantId, slotId);
      const chain = projections.get(k) ?? [];
      // Idempotent: don't append a surface that is already the tail.
      if (chain[chain.length - 1] !== surface) {
        const next = [...chain, surface];
        projections.set(k, next);
        return Object.freeze(next.slice());
      }
      return Object.freeze(chain.slice());
    },

    async projectionsOf(tenantId, slotId) {
      const chain = projections.get(key(tenantId, slotId)) ?? [];
      return Object.freeze(chain.slice());
    },
  };
}

/** Re-export for callers that want the kind enumeration alongside. */
export type { SlotKind };
