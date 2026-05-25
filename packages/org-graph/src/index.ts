/**
 * @borjie/org-graph — Piece C MD executive brief graph layer.
 *
 * Public surface:
 *
 *   types     — TypeScript types + Zod schemas (EdgeType, OrgGraphEdge,
 *               OrgGraphNode, GraphHop, MaterializedPath).
 *   projector — `projectEvent(event, lookup)` → derives EdgeInsert /
 *               EdgeUpdate sets from outbox events (lease, manager,
 *               reports_to, subdivision, etc.).
 *   traverse  — `GraphTraversalPort` interface for Drizzle wiring +
 *               pure in-memory BFS helpers used by tests and cached
 *               retrieval paths.
 */

export {
  EDGE_TYPES,
  EdgeTypeSchema,
  OrgGraphEdgeSchema,
  OrgGraphNodeSchema,
  GraphHopSchema,
  MaterializedPathSchema,
} from './types.js';

export type {
  EdgeType,
  OrgGraphEdge,
  OrgGraphNode,
  GraphHop,
  MaterializedPath,
  EdgeInsert,
  EdgeUpdate,
  OutboxEvent,
} from './types.js';

export {
  projectEvent,
  projectEvents,
  type CurrentEdgeLookupPort,
  type ProjectionResult,
} from './projector.js';

export {
  buildTraversalCte,
  buildShortestPathCte,
  bfs,
  findAllReachableInMemory,
  findShortestPathInMemory,
  DEFAULT_MAX_HOPS,
  type GraphTraversalPort,
} from './traverse.js';
