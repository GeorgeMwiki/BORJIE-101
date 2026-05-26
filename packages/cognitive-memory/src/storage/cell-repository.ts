/**
 * Cell repository — reference in-memory implementation (Wave 18W).
 *
 * Production wiring uses the Drizzle-backed Postgres implementation
 * configured against `cognitive_memory_cells` (see migration 0027).
 * This in-memory variant keeps the package usable in tests and in
 * service-worker contexts that don't need durability.
 *
 * The Postgres impl lives in `services/consolidation-worker` and in
 * the host-app data layer — added in a follow-up retrofit wave.
 */

import {
  CognitiveMemoryError,
  type CellRepository,
  type CognitiveMemoryCell,
  type MemoryKind,
  type MemoryScope,
  type MemoryStatus,
} from '../types.js';

/**
 * Cosine similarity between two equal-length vectors. Returns 0 when
 * either vector is zero-length. Used by the in-memory store for
 * search; the Postgres impl uses pgvector's `<=>` operator instead.
 */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let mag_a = 0;
  let mag_b = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    mag_a += av * av;
    mag_b += bv * bv;
  }
  if (mag_a === 0 || mag_b === 0) {
    return 0;
  }
  return dot / (Math.sqrt(mag_a) * Math.sqrt(mag_b));
}

export function createInMemoryCellRepository(
  initial: ReadonlyArray<CognitiveMemoryCell> = [],
): CellRepository {
  // Internal mutable map indexed by id; reads return frozen copies.
  const store: Map<string, CognitiveMemoryCell> = new Map();
  for (const cell of initial) {
    store.set(cell.id, cell);
  }

  function isMatchingScope(cell: CognitiveMemoryCell, scope_id: MemoryScope): boolean {
    if (scope_id === 'tenant_root') {
      // root scope sees everything in the tenant
      return true;
    }
    // child scope sees own + tenant_root (per spec §5)
    return cell.scope_id === scope_id || cell.scope_id === 'tenant_root';
  }

  return {
    async insert(cell: CognitiveMemoryCell): Promise<CognitiveMemoryCell> {
      if (store.has(cell.id)) {
        throw new CognitiveMemoryError(
          'cell_repo.duplicate_id',
          `cell ${cell.id} already exists`,
        );
      }
      store.set(cell.id, cell);
      return cell;
    },

    async read(id: string, tenantId: string): Promise<CognitiveMemoryCell | null> {
      const cell = store.get(id);
      if (cell === undefined || cell.tenant_id !== tenantId) {
        return null;
      }
      return cell;
    },

    async update(
      id: string,
      tenantId: string,
      patch: Partial<
        Pick<
          CognitiveMemoryCell,
          | 'reinforced_by_specialisations'
          | 'reinforced_in_turn_ids'
          | 'evidence_citations'
          | 'confidence_score'
          | 'access_count'
          | 'last_accessed_at'
          | 'promoted_at'
          | 'decayed_at'
          | 'promotion_status'
          | 'contradicting_cell_id'
          | 'audit_hash'
        >
      >,
    ): Promise<CognitiveMemoryCell | null> {
      const cell = store.get(id);
      if (cell === undefined || cell.tenant_id !== tenantId) {
        return null;
      }
      const updated: CognitiveMemoryCell = {
        ...cell,
        ...patch,
      };
      store.set(id, updated);
      return updated;
    },

    async searchByEmbedding(
      tenantId: string,
      scopeId: MemoryScope,
      embedding: ReadonlyArray<number>,
      opts: {
        readonly limit: number;
        readonly kinds?: ReadonlyArray<MemoryKind>;
        readonly statuses?: ReadonlyArray<MemoryStatus>;
      },
    ): Promise<ReadonlyArray<{ readonly cell: CognitiveMemoryCell; readonly similarity: number }>> {
      const kinds_set = opts.kinds !== undefined ? new Set<MemoryKind>(opts.kinds) : null;
      const statuses_set =
        opts.statuses !== undefined ? new Set<MemoryStatus>(opts.statuses) : null;
      const matches: Array<{ readonly cell: CognitiveMemoryCell; readonly similarity: number }> =
        [];
      for (const cell of store.values()) {
        if (cell.tenant_id !== tenantId) {
          continue;
        }
        if (!isMatchingScope(cell, scopeId)) {
          continue;
        }
        if (kinds_set !== null && !kinds_set.has(cell.kind)) {
          continue;
        }
        if (statuses_set !== null && !statuses_set.has(cell.promotion_status)) {
          continue;
        }
        const sim = cosineSimilarity(cell.content.embedding, embedding);
        matches.push({ cell, similarity: sim });
      }
      matches.sort((a, b) => b.similarity - a.similarity);
      return matches.slice(0, opts.limit);
    },
  };
}
