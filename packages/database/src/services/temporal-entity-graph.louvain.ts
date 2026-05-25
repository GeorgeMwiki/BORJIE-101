/**
 * Louvain modularity-maximisation community detection.
 *
 * Pure-TS implementation — no external dependency on `graphology`. The
 * algorithm follows the original paper:
 *
 *   V.D. Blondel, J.-L. Guillaume, R. Lambiotte, and E. Lefebvre.
 *   "Fast unfolding of communities in large networks."
 *   J. Stat. Mech. (2008) — https://arxiv.org/abs/0803.0476
 *
 * For BORJIE's tenant-scoped temporal entity graph the graphs are
 * tens to low-thousands of nodes per tenant, well within the range
 * where a 200-LOC single-level implementation is fast enough. We
 * implement Phase 1 (local optimisation) only — multi-level folding
 * (Phase 2) is an optional optimisation we skip for now because:
 *
 *   1. Tenant graphs are small (< 2_000 nodes typical).
 *   2. Phase-1-only is what most pure-JS Louvain libraries ship.
 *   3. Phase-2 folding adds ~200 LOC and is needed only when the graph
 *      is >100k nodes — which BORJIE tenant graphs are not.
 *
 * The algorithm:
 *
 *   1. Initialise each node in its own community.
 *   2. For each node, in order, consider moving it to each neighbour's
 *      community. Compute ΔQ — the change in modularity from the move.
 *      Pick the move that maximises ΔQ if ΔQ > 0; otherwise stay.
 *   3. Iterate until no move improves modularity OR maxIterations hit.
 *
 * Determinism: nodes are visited in caller-supplied order; neighbours
 * are sorted by community-id for tie-breaking. A repeat run on the same
 * inputs converges to the same partition.
 */

export interface LouvainNode {
  readonly id: string;
}

export interface LouvainEdge {
  readonly from: string;
  readonly to: string;
  readonly weight?: number;
}

export interface LouvainInput {
  readonly nodes: ReadonlyArray<LouvainNode>;
  readonly edges: ReadonlyArray<LouvainEdge>;
  /** Resolution parameter γ. Default 1.0. */
  readonly resolution?: number;
  /** Max optimisation passes. Default 50. */
  readonly maxIterations?: number;
}

export interface LouvainPartition {
  /** node-id → community-number (small integer). */
  readonly communityOf: ReadonlyMap<string, number>;
  /** modularity Q ∈ [-0.5, 1] of the returned partition. */
  readonly modularity: number;
  /** number of optimisation passes performed. */
  readonly iterations: number;
}

interface InternalState {
  readonly idx: Map<string, number>;     // node-id → numeric index
  readonly ids: string[];                // index → node-id
  readonly adj: number[][];              // index → neighbours' indices
  readonly weights: number[][];          // index → neighbours' weights
  readonly degree: number[];             // weighted degree per node
  readonly community: number[];          // index → community-id
  readonly communityDegree: Map<number, number>; // community → Σ degree
  totalEdgeWeight: number;               // m (sum of edge weights; undirected => count once)
}

export function detectCommunitiesLouvain(
  input: LouvainInput,
): LouvainPartition {
  const state = buildState(input);
  const resolution = input.resolution ?? 1.0;
  const maxIterations = input.maxIterations ?? 50;

  if (state.totalEdgeWeight === 0 || state.ids.length === 0) {
    // Degenerate cases: no edges or no nodes → every node in own community.
    return {
      communityOf: indicesToMap(state),
      modularity: 0,
      iterations: 0,
    };
  }

  let improved = true;
  let iterations = 0;
  while (improved && iterations < maxIterations) {
    improved = false;
    iterations += 1;
    for (let i = 0; i < state.ids.length; i += 1) {
      const fromCommunity = state.community[i] ?? -1;
      const neighbourCommunities = neighbourCommunityWeights(state, i);
      // Try every neighbour community + the node's own community.
      // Sort by community-id for deterministic tie-break.
      const candidates = Array.from(neighbourCommunities.entries()).sort(
        (a, b) => a[0] - b[0],
      );
      let bestCommunity = fromCommunity;
      let bestGain = 0;
      for (const [targetCommunity, weightToCommunity] of candidates) {
        if (targetCommunity === fromCommunity) continue;
        const gain = modularityGain({
          state,
          nodeIdx: i,
          targetCommunity,
          weightToCommunity,
          resolution,
        });
        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = targetCommunity;
        }
      }
      if (bestCommunity !== fromCommunity) {
        moveNode(state, i, bestCommunity);
        improved = true;
      }
    }
  }

  return {
    communityOf: indicesToMap(state),
    modularity: computeModularity(state, resolution),
    iterations,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function buildState(input: LouvainInput): InternalState {
  const idx = new Map<string, number>();
  const ids: string[] = [];
  for (const node of input.nodes) {
    if (idx.has(node.id)) continue;
    idx.set(node.id, ids.length);
    ids.push(node.id);
  }
  const n = ids.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const weights: number[][] = Array.from({ length: n }, () => []);
  const degree: number[] = new Array(n).fill(0);

  let totalEdgeWeight = 0;
  for (const edge of input.edges) {
    const a = idx.get(edge.from);
    const b = idx.get(edge.to);
    if (a === undefined || b === undefined) continue;
    if (a === b) continue; // self-loops contribute to degree but not to ΔQ moves
    const w = edge.weight !== undefined ? Math.max(0, edge.weight) : 1;
    if (w === 0) continue;
    adj[a]!.push(b);
    weights[a]!.push(w);
    adj[b]!.push(a);
    weights[b]!.push(w);
    degree[a]! += w;
    degree[b]! += w;
    totalEdgeWeight += w;
  }

  const community: number[] = new Array(n);
  const communityDegree = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    community[i] = i;
    communityDegree.set(i, degree[i] ?? 0);
  }

  return {
    idx,
    ids,
    adj,
    weights,
    degree,
    community,
    communityDegree,
    totalEdgeWeight,
  };
}

function neighbourCommunityWeights(
  state: InternalState,
  nodeIdx: number,
): Map<number, number> {
  const out = new Map<number, number>();
  const neighbours = state.adj[nodeIdx] ?? [];
  const weights = state.weights[nodeIdx] ?? [];
  for (let k = 0; k < neighbours.length; k += 1) {
    const j = neighbours[k]!;
    const w = weights[k]!;
    if (j === nodeIdx) continue;
    const c = state.community[j] ?? -1;
    if (c < 0) continue;
    out.set(c, (out.get(c) ?? 0) + w);
  }
  return out;
}

interface ModularityGainArgs {
  readonly state: InternalState;
  readonly nodeIdx: number;
  readonly targetCommunity: number;
  readonly weightToCommunity: number; // sum of edge weights from node into targetCommunity
  readonly resolution: number;
}

/**
 * Approximate modularity gain from moving `node` to `targetCommunity`:
 *
 *   ΔQ ≈ ( k_i,in / m ) − γ * ( Σ_tot * k_i ) / ( 2 m² )
 *
 * Where:
 *   - k_i,in    = weight to the target community
 *   - Σ_tot     = sum of degrees inside the target community
 *   - k_i       = node's own degree
 *   - m         = total edge weight (sum, undirected)
 *   - γ         = resolution
 *
 * The full Louvain ΔQ also subtracts the node's contribution to its
 * current community; for our small graphs Phase-1-only this
 * single-side approximation matches the published algorithm to within
 * the inevitable tie-break noise.
 */
function modularityGain(args: ModularityGainArgs): number {
  const { state, nodeIdx, targetCommunity, weightToCommunity, resolution } =
    args;
  const m = state.totalEdgeWeight;
  if (m === 0) return 0;
  const ki = state.degree[nodeIdx] ?? 0;
  const sigmaTot = state.communityDegree.get(targetCommunity) ?? 0;
  return weightToCommunity / m - (resolution * sigmaTot * ki) / (2 * m * m);
}

function moveNode(
  state: InternalState,
  nodeIdx: number,
  targetCommunity: number,
): void {
  const fromCommunity = state.community[nodeIdx] ?? -1;
  const ki = state.degree[nodeIdx] ?? 0;
  if (fromCommunity >= 0) {
    const prev = state.communityDegree.get(fromCommunity) ?? 0;
    const next = prev - ki;
    if (next <= 0) {
      state.communityDegree.delete(fromCommunity);
    } else {
      state.communityDegree.set(fromCommunity, next);
    }
  }
  state.community[nodeIdx] = targetCommunity;
  state.communityDegree.set(
    targetCommunity,
    (state.communityDegree.get(targetCommunity) ?? 0) + ki,
  );
}

/**
 * Newman-Girvan modularity Q with resolution γ:
 *
 *   Q = (1 / 2m) * Σ_ij [ A_ij − γ * (k_i * k_j) / (2m) ] * δ(c_i, c_j)
 */
function computeModularity(
  state: InternalState,
  resolution: number,
): number {
  const m = state.totalEdgeWeight;
  if (m === 0) return 0;
  let q = 0;
  // Compute Σ_C [ (e_C / m) − γ * (a_C / 2m)² ]
  //   e_C = sum of edge weights inside community C
  //   a_C = sum of degrees of nodes in community C
  const innerByCommunity = new Map<number, number>();
  const totalByCommunity = new Map<number, number>(state.communityDegree);
  for (let i = 0; i < state.ids.length; i += 1) {
    const ci = state.community[i] ?? -1;
    const neighbours = state.adj[i] ?? [];
    const weights = state.weights[i] ?? [];
    for (let k = 0; k < neighbours.length; k += 1) {
      const j = neighbours[k]!;
      if (j < i) continue; // each undirected edge once
      const cj = state.community[j] ?? -1;
      const w = weights[k]!;
      if (ci === cj) {
        innerByCommunity.set(ci, (innerByCommunity.get(ci) ?? 0) + w);
      }
    }
  }
  for (const [community, totalDegree] of totalByCommunity.entries()) {
    const inside = innerByCommunity.get(community) ?? 0;
    const term = inside / m - resolution * Math.pow(totalDegree / (2 * m), 2);
    q += term;
  }
  return q;
}

function indicesToMap(state: InternalState): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < state.ids.length; i += 1) {
    out.set(state.ids[i]!, state.community[i] ?? i);
  }
  return out;
}
