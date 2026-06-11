/**
 * Body-schema reader — bridges `@borjie/system-graph` (the MD's LIVE,
 * DERIVED body schema) to the kernel's `BodySchemaReader` port + the
 * `query_body_schema()` introspection tool.
 *
 * This is the wiring that KILLS the static `BRAIN_MODULES` list: the
 * kernel injects a reader built here, and `renderSelfAwarenessBlock`
 * renders the organ-map summary from the actual route table / screen
 * registries / package exports / DB schemas / MCP tools / capability
 * registry instead of a hand-written inventory.
 *
 * MemGPT paging: only the COMPRESSED organ-map summary is rendered into
 * core context (`renderSelfAwarenessBlock`). The FULL graph is paged in on
 * demand via `queryBodySchemaTool()` — the kernel's `query_body_schema()`
 * tool — so the resident prompt stays small while the body stays large.
 *
 * The graph is supplied via a thunk so it can be refreshed on
 * listChanged invalidation (deploy/migration/flag-flip) without rebuilding
 * the reader: the composition root swaps the held graph and the next turn
 * reads the new revision.
 *
 * See Docs/research/MD_AS_BODY_ARCHITECTURE.md §bodyModel RENDERING.
 */

import {
  summariseOrganMap,
  renderOrganMapBlock,
  describeBody,
  queryBodySchema,
  blastRadius,
  type SystemGraph,
  type BodySchemaQuery,
  type BodySchemaPage,
} from '@borjie/system-graph';
import type {
  BodySchemaReader,
  BodySchemaSnapshot,
} from '../self-awareness.js';

/**
 * Source of the latest derived graph. A thunk so the composition root can
 * hot-swap the graph on listChanged without re-wiring the kernel. Returns
 * `null` before the first derivation has run.
 */
export type SystemGraphSource = () => SystemGraph | null;

/**
 * Build a `BodySchemaReader` from a system-graph source. The reader
 * recomputes the organ-map summary on each call (cheap — a single linear
 * pass) so it always reflects the latest held graph.
 */
export function createBodySchemaReader(source: SystemGraphSource): BodySchemaReader {
  return (): BodySchemaSnapshot | null => {
    const graph = source();
    if (!graph) return null;
    const summary = summariseOrganMap(graph);
    return {
      inventoryBlock: renderOrganMapBlock(summary),
      description: describeBody(summary),
      revision: graph.revision,
    };
  };
}

/**
 * Convenience: build a reader from a static graph snapshot (tests +
 * single-shot derivations that don't need hot-swap).
 */
export function bodySchemaReaderFromGraph(graph: SystemGraph): BodySchemaReader {
  return createBodySchemaReader(() => graph);
}

/**
 * The `query_body_schema()` introspection tool — the MemGPT page-in
 * primitive. Filters + pages the full body schema on demand so the MD can
 * fetch the exact organ (surface / capability / data table) it needs
 * without holding the whole graph in core context.
 *
 * Returns `null` when no body schema has been derived yet.
 */
export function queryBodySchemaTool(
  source: SystemGraphSource,
  query: BodySchemaQuery = {},
): BodySchemaPage | null {
  const graph = source();
  if (!graph) return null;
  return queryBodySchema(graph, query);
}

/**
 * Injured-limb blast radius — what depends on a degraded organ. The MD
 * uses this to route around an injured limb and flag the dependents.
 *
 * Returns `null` when no body schema has been derived yet.
 */
export function bodyBlastRadiusTool(
  source: SystemGraphSource,
  nodeId: string,
  maxDepth?: number,
): ReadonlyArray<string> | null {
  const graph = source();
  if (!graph) return null;
  return blastRadius(graph, nodeId, maxDepth);
}
