/**
 * Relation repository — in-memory reference implementation of
 * `RelationRepositoryPort`. Production wires Drizzle at composition
 * root.
 */

import type {
  GraphEdge,
  Id,
  RelationRepositoryPort,
} from '../types.js';
import { edgeId } from '../graph/graph-builder.js';

interface RepoState {
  readonly byTenant: Map<string, Map<Id, GraphEdge>>;
}

function getOrCreate(state: RepoState, tenantId: string): Map<Id, GraphEdge> {
  const existing = state.byTenant.get(tenantId);
  if (existing !== undefined) return existing;
  const fresh = new Map<Id, GraphEdge>();
  state.byTenant.set(tenantId, fresh);
  return fresh;
}

export function createInMemoryRelationRepository(): RelationRepositoryPort {
  const state: RepoState = { byTenant: new Map() };
  return {
    async upsert({ tenantId, fromId, toId, relation }): Promise<GraphEdge> {
      const bucket = getOrCreate(state, tenantId);
      const id = edgeId(fromId, toId, relation.kind);
      const existing = bucket.get(id);
      const next: GraphEdge = {
        id,
        fromId,
        toId,
        kind: relation.kind,
        weight: existing !== undefined ? existing.weight + 1 : 1,
      };
      bucket.set(id, next);
      return next;
    },
    async list(tenantId): Promise<ReadonlyArray<GraphEdge>> {
      const bucket = state.byTenant.get(tenantId);
      if (bucket === undefined) return [];
      return Array.from(bucket.values());
    },
  };
}
