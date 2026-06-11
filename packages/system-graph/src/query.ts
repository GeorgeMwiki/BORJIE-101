/**
 * @borjie/system-graph — query + MemGPT paging.
 *
 * The body schema is hundreds of nodes. We keep a COMPRESSED organ-map
 * summary resident in core context and page in detail on demand (MemGPT).
 *
 *   - `summariseOrganMap`  — the resident summary: layer-0/1/2 counts +
 *     injured-limb roll-up. Small, always in core context.
 *   - `queryBodySchema`    — the paging primitive behind the kernel's
 *     `query_body_schema()` tool: filter by kind / layer / id / health,
 *     bounded page size.
 *   - `blastRadius`        — injured-limb traversal: what depends on a
 *     degraded node (so the MD routes around it / flags it).
 *
 * All pure over a `SystemGraph`. No FS, no DB, no LLM.
 */

import type {
  NodeKind,
  SystemEdge,
  SystemGraph,
  SystemNode,
} from './types.js';
import { BODY_LAYERS } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Organ-map summary — the resident compressed self-model.
// ─────────────────────────────────────────────────────────────────────

export interface OrganMapSummary {
  readonly revision: string;
  readonly derivedAt: string;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly countsByKind: Readonly<Record<NodeKind, number>>;
  /** Node ids the MD should route around / flag (degraded or injured). */
  readonly injuredLimbs: ReadonlyArray<string>;
}

const ALL_KINDS = Object.keys(BODY_LAYERS) as NodeKind[];

function emptyCounts(): Record<NodeKind, number> {
  const out = {} as Record<NodeKind, number>;
  for (const k of ALL_KINDS) out[k] = 0;
  return out;
}

function isInjured(node: SystemNode): boolean {
  return node.health?.state === 'injured' || node.health?.state === 'degraded';
}

export function summariseOrganMap(graph: SystemGraph): OrganMapSummary {
  const countsByKind = emptyCounts();
  const injuredLimbs: string[] = [];
  for (const node of graph.nodes) {
    countsByKind[node.kind] += 1;
    if (isInjured(node)) injuredLimbs.push(node.id);
  }
  return {
    revision: graph.revision,
    derivedAt: graph.derivedAt,
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    countsByKind,
    injuredLimbs,
  };
}

// ─────────────────────────────────────────────────────────────────────
// query_body_schema() — bounded, filtered paging into the full graph.
// ─────────────────────────────────────────────────────────────────────

export interface BodySchemaQuery {
  readonly kind?: NodeKind;
  readonly layer?: number;
  /** Substring match against id or label (case-insensitive). */
  readonly search?: string;
  /** Only return nodes the MD should route around. */
  readonly injuredOnly?: boolean;
  /** Bounded page size; clamped to [1, 200], default 50. */
  readonly limit?: number;
  /** Page offset; clamped to >= 0. */
  readonly offset?: number;
}

export interface BodySchemaPage {
  readonly revision: string;
  readonly nodes: ReadonlyArray<SystemNode>;
  /** Total matches before paging (so callers can request more). */
  readonly totalMatches: number;
  readonly limit: number;
  readonly offset: number;
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 50;
  return Math.min(Math.max(Math.floor(raw), 1), 200);
}

function clampOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

function matches(node: SystemNode, q: BodySchemaQuery): boolean {
  if (q.kind && node.kind !== q.kind) return false;
  if (q.layer !== undefined && node.layer !== q.layer) return false;
  if (q.injuredOnly && !isInjured(node)) return false;
  if (q.search) {
    const needle = q.search.toLowerCase();
    const hay = `${node.id} ${node.label}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function queryBodySchema(
  graph: SystemGraph,
  query: BodySchemaQuery = {},
): BodySchemaPage {
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  const all = graph.nodes.filter((n) => matches(n, query));
  // Stable order: layer asc, then id asc.
  const sorted = [...all].sort((a, b) =>
    a.layer !== b.layer ? a.layer - b.layer : a.id.localeCompare(b.id),
  );
  return {
    revision: graph.revision,
    nodes: sorted.slice(offset, offset + limit),
    totalMatches: sorted.length,
    limit,
    offset,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Injured-limb blast radius — what depends on a degraded organ.
//
// Walks `depends_on` / `flows_data_to` / `renders_on` edges in REVERSE
// (dependents) up to a bounded depth, so the MD can answer "if offtake-
// settlement is injured, which surfaces/capabilities are affected".
// ─────────────────────────────────────────────────────────────────────

const DEPENDENCY_EDGES = new Set<SystemEdge['edgeType']>([
  'depends_on',
  'flows_data_to',
  'renders_on',
  'serves',
  'exposes',
]);

export const DEFAULT_BLAST_DEPTH = 3;
export const MAX_BLAST_DEPTH = 6;

export function blastRadius(
  graph: SystemGraph,
  nodeId: string,
  maxDepth: number = DEFAULT_BLAST_DEPTH,
): ReadonlyArray<string> {
  const depth = Math.min(Math.max(Math.floor(maxDepth), 1), MAX_BLAST_DEPTH);
  // Reverse adjacency: dst -> [src] for dependency-class edges.
  const dependents = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!DEPENDENCY_EDGES.has(e.edgeType)) continue;
    const list = dependents.get(e.dstId) ?? [];
    list.push(e.srcId);
    dependents.set(e.dstId, list);
  }
  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  for (let d = 0; d < depth; d += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const src of dependents.get(id) ?? []) {
        if (!seen.has(src)) {
          seen.add(src);
          next.push(src);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  seen.delete(nodeId);
  return [...seen].sort();
}
