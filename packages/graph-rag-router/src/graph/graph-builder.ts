/**
 * Graph builder — accumulate `ExtractedEntity` + `ExtractedRelation`
 * into an immutable `KnowledgeGraph`.
 *
 * Every call returns a NEW graph; the input is never mutated.
 * Entity IDs are produced deterministically from the canonicalised
 * name (sha256-hex prefix) so two builds over the same input produce
 * identical IDs — this is the property the sleep-pass relies on to
 * detect "unchanged communities".
 */

import { createHash } from 'node:crypto';
import type {
  ExtractedEntity,
  ExtractedRelation,
  GraphEdge,
  GraphNode,
  Id,
  KnowledgeGraph,
} from '../types.js';

/** Stable id derived from a canonicalised name. */
export function entityIdFromName(name: string): Id {
  const norm = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(`entity:${norm}`).digest('hex').slice(0, 32);
}

/** Stable id for a `(from, to, kind)` edge. */
export function edgeId(fromId: Id, toId: Id, kind: string): Id {
  return createHash('sha256')
    .update(`edge:${fromId}->${toId}:${kind.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

export interface BuildGraphArgs {
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly relations: ReadonlyArray<ExtractedRelation>;
  /** Optional seed graph — new entities accumulate on top of it. */
  readonly seed?: KnowledgeGraph;
}

/**
 * Build a `KnowledgeGraph` from a flat batch of extracted entities +
 * relations. Pure / immutable.
 */
export function buildGraph(args: BuildGraphArgs): KnowledgeGraph {
  const nodesById = new Map<Id, GraphNode>();
  const edgesById = new Map<Id, GraphEdge>();
  if (args.seed !== undefined) {
    for (const n of args.seed.nodes) nodesById.set(n.id, n);
    for (const e of args.seed.edges) edgesById.set(e.id, e);
  }
  for (const e of args.entities) {
    const id = entityIdFromName(e.name);
    const existing = nodesById.get(id);
    if (existing === undefined) {
      nodesById.set(id, {
        id,
        name: e.name,
        type: e.type,
        description: e.description,
      });
    } else if (e.description.length > existing.description.length) {
      nodesById.set(id, { ...existing, description: e.description });
    }
  }
  for (const r of args.relations) {
    const fromId = entityIdFromName(r.from);
    const toId = entityIdFromName(r.to);
    if (!nodesById.has(fromId) || !nodesById.has(toId)) continue;
    const id = edgeId(fromId, toId, r.kind);
    const existing = edgesById.get(id);
    if (existing === undefined) {
      edgesById.set(id, { id, fromId, toId, kind: r.kind, weight: 1 });
    } else {
      edgesById.set(id, { ...existing, weight: existing.weight + 1 });
    }
  }
  return {
    nodes: Array.from(nodesById.values()),
    edges: Array.from(edgesById.values()),
  };
}
