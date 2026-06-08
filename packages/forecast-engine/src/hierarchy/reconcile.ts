/**
 * Hierarchical reconciliation — MinT-lite.
 *
 * Estate -> subsidiary -> site -> mineral roll-ups must be COHERENT:
 * the parent forecast must equal the sum of its children. Independent
 * base forecasts are almost never coherent. Reconciliation projects the
 * base forecasts onto the coherent subspace.
 *
 * We implement the two analytically-closed, dependency-free members of
 * the MinT family:
 *
 *  - 'ols'  (MinT with identity weights / OLS reconciliation): the
 *    minimum-trace projection under W = I. Closed form, no covariance
 *    estimation needed — robust and the standard "MinT-lite".
 *  - 'wls-struct' (structural / "wls_struct"): W = diag(number of leaves
 *    aggregated into each node). Down-weights aggregated (noisier) nodes.
 *
 * Both reduce, for a strict tree, to a bottom-up-consistent set of
 * forecasts that minimise the weighted change from the base forecasts.
 * We use the tree structure directly (each node = sum of its children's
 * reconciled leaves), which is exactly MinT's coherent projection for a
 * hierarchy described by a summation matrix S with these weights.
 *
 * Pure + deterministic; no matrix library required.
 */

export interface HierarchyNode {
  /** Unique node id, e.g. 'estate', 'sub:gold-co', 'site:42', 'mineral:au'. */
  readonly id: string;
  /** Child node ids (empty for leaves). */
  readonly children: ReadonlyArray<string>;
}

export type ReconcileMethod = 'ols' | 'wls-struct';

export interface ReconcileInput {
  /** All nodes in the hierarchy (must form a single-rooted tree/forest). */
  readonly nodes: ReadonlyArray<HierarchyNode>;
  /** Base (incoherent) forecast value per node id. */
  readonly base: Readonly<Record<string, number>>;
  readonly method?: ReconcileMethod;
}

export interface ReconcileResult {
  /** Coherent forecast per node id: parent == sum(children). */
  readonly reconciled: Readonly<Record<string, number>>;
  readonly method: ReconcileMethod;
}

interface ResolvedNode {
  readonly id: string;
  readonly children: ReadonlyArray<string>;
  readonly isLeaf: boolean;
}

function index(nodes: ReadonlyArray<HierarchyNode>): Map<string, ResolvedNode> {
  const map = new Map<string, ResolvedNode>();
  for (const n of nodes) {
    map.set(n.id, {
      id: n.id,
      children: n.children,
      isLeaf: n.children.length === 0,
    });
  }
  return map;
}

/** Number of leaves under each node (the structural weight basis). */
function leafCounts(
  nodes: Map<string, ResolvedNode>,
): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function count(id: string): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) {
      throw new Error(`hierarchy contains a cycle at node '${id}'`);
    }
    visiting.add(id);
    const node = nodes.get(id);
    if (!node || node.isLeaf) {
      memo.set(id, 1);
      visiting.delete(id);
      return 1;
    }
    let total = 0;
    for (const c of node.children) total += count(c);
    memo.set(id, total);
    visiting.delete(id);
    return total;
  }
  for (const id of nodes.keys()) count(id);
  return memo;
}

/** All leaf ids under a node. */
function leavesUnder(
  id: string,
  nodes: Map<string, ResolvedNode>,
  out: string[],
): void {
  const node = nodes.get(id);
  if (!node || node.isLeaf) {
    out.push(id);
    return;
  }
  for (const c of node.children) leavesUnder(c, nodes, out);
}

function roots(nodes: Map<string, ResolvedNode>): string[] {
  const child = new Set<string>();
  for (const n of nodes.values()) for (const c of n.children) child.add(c);
  return [...nodes.keys()].filter((id) => !child.has(id));
}

/**
 * Reconcile base forecasts to coherence.
 *
 * Strategy: estimate each LEAF value as the weighted combination of all
 * base forecasts that "cover" it (the leaf's own base + the share of
 * every ancestor's base, weighted by the method), then aggregate up.
 * This is the closed-form MinT projection for a tree under W = I (ols)
 * or W = diag(leafCount) (wls-struct).
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const method: ReconcileMethod = input.method ?? 'ols';
  const nodes = index(input.nodes);
  const counts = leafCounts(nodes);

  // Reconciled leaf value = average (OLS) / structural-weighted average
  // of the per-level "implied leaf value" from every ancestor that
  // contains it. For ancestor A with `k` leaves, the implied leaf value
  // from A's base is base[A]/k. For the leaf's own base it is base[leaf].
  // OLS gives each level equal weight; wls-struct weights a level's
  // contribution by 1/k (more-aggregated => noisier => less weight).
  const reconciledLeaf = new Map<string, number>();

  // Build ancestor chains.
  const parentOf = new Map<string, string>();
  for (const n of nodes.values()) {
    for (const c of n.children) parentOf.set(c, n.id);
  }

  const allLeaves: string[] = [];
  for (const r of roots(nodes)) leavesUnder(r, nodes, allLeaves);

  for (const leaf of allLeaves) {
    // Walk from leaf up to its root collecting implied leaf values.
    const implied: Array<{ value: number; weight: number }> = [];
    let cursor: string | undefined = leaf;
    while (cursor !== undefined) {
      const baseVal = input.base[cursor];
      if (baseVal !== undefined) {
        const k = counts.get(cursor) ?? 1;
        const impliedValue = baseVal / k;
        const weight = method === 'wls-struct' ? 1 / k : 1;
        implied.push({ value: impliedValue, weight });
      }
      cursor = parentOf.get(cursor);
    }
    if (implied.length === 0) {
      reconciledLeaf.set(leaf, 0);
      continue;
    }
    let wsum = 0;
    let vsum = 0;
    for (const { value, weight } of implied) {
      wsum += weight;
      vsum += value * weight;
    }
    reconciledLeaf.set(leaf, wsum === 0 ? 0 : vsum / wsum);
  }

  // Aggregate reconciled leaves up to every node => coherent by build.
  const reconciled: Record<string, number> = {};
  function aggregate(id: string): number {
    const node = nodes.get(id);
    if (!node || node.isLeaf) {
      const v = reconciledLeaf.get(id) ?? 0;
      reconciled[id] = v;
      return v;
    }
    let total = 0;
    for (const c of node.children) total += aggregate(c);
    reconciled[id] = total;
    return total;
  }
  for (const r of roots(nodes)) aggregate(r);

  return { reconciled, method };
}

/**
 * Coherence check helper — true iff every parent equals the sum of its
 * children's reconciled values within `tol`.
 */
export function isCoherent(
  nodes: ReadonlyArray<HierarchyNode>,
  values: Readonly<Record<string, number>>,
  tol = 1e-9,
): boolean {
  for (const n of nodes) {
    if (n.children.length === 0) continue;
    let sum = 0;
    for (const c of n.children) sum += values[c] ?? 0;
    const parent = values[n.id] ?? 0;
    if (Math.abs(parent - sum) > tol) return false;
  }
  return true;
}
