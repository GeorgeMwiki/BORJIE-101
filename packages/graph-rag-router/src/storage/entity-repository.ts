/**
 * Entity repository — in-memory reference implementation of
 * `EntityRepositoryPort`. Production wires a Drizzle adapter at the
 * composition root.
 *
 * No mutation: every method returns a new immutable view. The
 * internal `Map` is private to the closure.
 */

import type {
  EntityRepositoryPort,
  ExtractedEntity,
  GraphNode,
} from '../types.js';
import { entityIdFromName } from '../graph/graph-builder.js';

interface RepoState {
  readonly byTenant: Map<string, Map<string, GraphNode>>;
}

function getOrCreate(state: RepoState, tenantId: string): Map<string, GraphNode> {
  const existing = state.byTenant.get(tenantId);
  if (existing !== undefined) return existing;
  const fresh = new Map<string, GraphNode>();
  state.byTenant.set(tenantId, fresh);
  return fresh;
}

export function createInMemoryEntityRepository(): EntityRepositoryPort {
  const state: RepoState = { byTenant: new Map() };
  return {
    async upsert({ tenantId, entity }): Promise<GraphNode> {
      const bucket = getOrCreate(state, tenantId);
      const id = entityIdFromName(entity.name);
      const existing = bucket.get(id);
      const next: GraphNode = {
        id,
        name: entity.name,
        type: entity.type,
        description:
          existing !== undefined &&
          existing.description.length > entity.description.length
            ? existing.description
            : entity.description,
      };
      bucket.set(id, next);
      return next;
    },
    async list(tenantId): Promise<ReadonlyArray<GraphNode>> {
      const bucket = state.byTenant.get(tenantId);
      if (bucket === undefined) return [];
      return Array.from(bucket.values());
    },
  };
}

/** Test helper — bulk-load a tenant's entities up front. */
export function seedInMemoryEntities(
  repo: EntityRepositoryPort,
  tenantId: string,
  entities: ReadonlyArray<ExtractedEntity>,
): Promise<ReadonlyArray<GraphNode>> {
  return Promise.all(entities.map((entity) => repo.upsert({ tenantId, entity })));
}
