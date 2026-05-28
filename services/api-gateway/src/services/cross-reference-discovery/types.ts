/**
 * Cross-Reference Discovery — shared types.
 *
 * The discoverer is a small, pure module: given `(tenantId, kind, id)`
 * it returns the typed graph edges from joining the source row against
 * its peers. The entity-indexer-worker calls it on every upsert so
 * `entity_cross_references` stays in sync with the live schema.
 *
 * Edges are immutable value objects — callers should never mutate the
 * returned arrays (per the immutability rule in coding-style.md).
 */

// Mirror the EntityCrossRefRelationship literal union directly so we
// avoid the namespace-as-type indirection that `@borjie/database`
// triggers under TS strict mode for some consumers.
export type EntityCrossRefRelationship =
  | 'parent'
  | 'child'
  | 'related'
  | 'duplicate'
  | 'depends_on'
  | 'supersedes';

/** A discovered edge — always tenant-scoped. */
export interface DiscoveredEdge {
  readonly tenantId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly relationship: EntityCrossRefRelationship;
  /** 0..1; FK-derived edges = 1.0, similarity suggestions < 1.0. */
  readonly confidence: number;
  /** Pure-function name that produced this edge. */
  readonly derivationSource: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Minimal DB port — only `execute` is needed for the discoverer.
 *  Keeping it tiny so the worker can swap the real Drizzle client for
 *  an in-memory stub in tests. */
export interface DiscovererDb {
  execute(query: unknown): Promise<unknown>;
}

/** Discoverer signature — one per entity_kind. */
export type Discoverer = (
  db: DiscovererDb,
  args: { readonly tenantId: string; readonly sourceId: string },
) => Promise<ReadonlyArray<DiscoveredEdge>>;
