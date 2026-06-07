/**
 * Pure projections from the live estate API shapes into the
 * engine-agnostic `@borjie/graph-viz` payloads.
 *
 * Kept separate from the React component so the projection logic is
 * unit-testable and immutable (no mutation; new objects only).
 *
 *   - `entityTreeToGraph` flattens the estate-entity tree into a
 *     directed org graph (parent → child edges) for the graph-viz
 *     AdaptiveRenderer `shape: 'graph'` block.
 *   - `capitalMovementsToRoyaltyFlows` maps capital movements into the
 *     `RoyaltyFlow` shape consumed by graph-viz's `RoyaltyFlowSankey`.
 */

import type {
  EstateEntityTreeNode,
  EstateCapitalMovementRow,
} from '@/lib/queries/estate';

// graph-viz GraphNode / GraphEdge mirrored locally (peer-typed at the
// component boundary; re-declared here so this pure module needs no
// React / graph-viz import).
export interface OrgGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface OrgGraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly directed: true;
}

export interface OrgGraph {
  readonly nodes: ReadonlyArray<OrgGraphNode>;
  readonly edges: ReadonlyArray<OrgGraphEdge>;
}

/**
 * Flatten the estate-entity tree into a directed graph. Each entity is
 * a node; each parent→child link is a directed "owns" edge. Walks the
 * tree iteratively (no recursion-depth surprise on deep holdings).
 */
export function entityTreeToGraph(
  tree: ReadonlyArray<EstateEntityTreeNode>,
): OrgGraph {
  const nodes: OrgGraphNode[] = [];
  const edges: OrgGraphEdge[] = [];
  const stack: Array<{ node: EstateEntityTreeNode; parentId: string | null }> =
    tree.map((node) => ({ node, parentId: null }));

  while (stack.length > 0) {
    const { node, parentId } = stack.pop()!;
    const entity = node.entity;
    nodes.push({
      id: entity.id,
      label: entity.name,
      kind: `status-${entity.status}`,
      data: {
        kind: entity.kind,
        status: entity.status,
        ownershipPct: entity.ownershipPct,
      },
    });
    if (parentId) {
      edges.push({
        id: `${parentId}->${entity.id}`,
        source: parentId,
        target: entity.id,
        label: `${entity.ownershipPct}%`,
        directed: true,
      });
    }
    for (const child of node.children) {
      stack.push({ node: child, parentId: entity.id });
    }
  }
  return { nodes, edges };
}

export interface RoyaltyFlowLike {
  readonly source: string;
  readonly target: string;
  readonly amount: number;
  readonly currency: string;
}

/**
 * Map estate capital movements into `RoyaltyFlow`-shaped flows for the
 * Sankey. We resolve entity ids to display names via the provided
 * lookup, skip movements missing an endpoint, and parse the decimal
 * `amount` string defensively (the API returns numeric strings).
 */
export function capitalMovementsToRoyaltyFlows(
  movements: ReadonlyArray<EstateCapitalMovementRow>,
  nameById: ReadonlyMap<string, string>,
): ReadonlyArray<RoyaltyFlowLike> {
  const flows: RoyaltyFlowLike[] = [];
  for (const m of movements) {
    if (!m.fromEntityId || !m.toEntityId) continue;
    const amount = Number(m.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    flows.push({
      source: nameById.get(m.fromEntityId) ?? m.fromEntityId,
      target: nameById.get(m.toEntityId) ?? m.toEntityId,
      amount,
      currency: m.currency,
    });
  }
  return flows;
}

/** Build an id→name lookup from a flattened org graph. */
export function nameLookupFromGraph(
  graph: OrgGraph,
): ReadonlyMap<string, string> {
  return new Map(graph.nodes.map((n) => [n.id, n.label] as const));
}
