/**
 * Pearl back-door identification — pure TypeScript.
 *
 * Identifies the back-door adjustment set Z for the causal effect
 * X -> Y on a DAG G. Z is admissible iff:
 *
 *   (a) No node in Z is a descendant of X.
 *   (b) Z blocks every back-door path from X to Y.
 *
 * A back-door path is a path from X to Y that begins with an arrow
 * INTO X. Blocking means: every such path contains a non-collider in
 * Z, or a collider not in Z and not having a descendant in Z. We
 * implement the standard d-separation check via the moralised
 * ancestral graph trick: form Anc({X,Y,Z}), moralise, drop Z, run
 * connectivity from X to Y.
 *
 * For Mr. Mwikila the textbook regression test is Pearl's smoking ->
 * cancer with a genotype confounder (Causality, §3.3). The back-door
 * set must be {genotype}.
 *
 * Reference: Pearl, J. — Causality (2nd ed., 2009), Theorem 3.3.2.
 *
 * @module @borjie/causal-inference/identify/backdoor-criterion
 */

import {
  CausalInferenceError,
  type CausalGraph,
} from '../types.js';

export interface BackdoorResult {
  /** Admissible adjustment set; empty array if {} suffices. */
  readonly adjustmentSet: ReadonlyArray<string>;
  /** All variables along back-door paths. Useful for diagnostics. */
  readonly backdoorPathSupport: ReadonlyArray<string>;
}

/**
 * Find a minimal-cardinality admissible back-door adjustment set for
 * the effect `treatment -> outcome` on the DAG `graph`. Throws if no
 * such set exists.
 *
 * The search is exhaustive over subsets of (Anc({X,Y}) \ Desc(X) \ {X, Y}),
 * minimising |Z|. For Mr. Mwikila's mining DAGs (<= 20 nodes) the
 * cost is acceptable; for larger graphs a future revision can use
 * the polynomial-time Shpitser-VanderWeele algorithm.
 */
export function findBackdoorAdjustmentSet(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
): BackdoorResult {
  assertNodeExists(graph, treatment);
  assertNodeExists(graph, outcome);

  const descendantsOfX = descendants(graph, treatment);
  const ancestorsOfXY = union(
    ancestors(graph, treatment),
    ancestors(graph, outcome),
  );
  ancestorsOfXY.add(treatment);
  ancestorsOfXY.add(outcome);

  // Candidate adjustment vertices: ancestors of {X, Y}, excluding
  // descendants of X, excluding X and Y themselves.
  const candidates: string[] = [];
  for (const v of ancestorsOfXY) {
    if (v === treatment || v === outcome) continue;
    if (descendantsOfX.has(v)) continue;
    candidates.push(v);
  }

  // Try empty set first, then by increasing cardinality.
  for (let size = 0; size <= candidates.length; size += 1) {
    const subset = firstAdmissibleSubsetOfSize(
      graph,
      treatment,
      outcome,
      candidates,
      size,
    );
    if (subset !== null) {
      return Object.freeze({
        adjustmentSet: Object.freeze([...subset].sort()),
        backdoorPathSupport: Object.freeze(candidates.slice().sort()),
      });
    }
  }

  throw new CausalInferenceError(
    'BACKDOOR_NOT_IDENTIFIABLE',
    `no back-door adjustment set found for ${treatment} -> ${outcome}`,
  );
}

/**
 * Check whether a candidate Z is admissible for the back-door
 * criterion. Useful as a regression-test oracle.
 */
export function isAdmissibleBackdoorSet(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  adjustmentSet: ReadonlyArray<string>,
): boolean {
  assertNodeExists(graph, treatment);
  assertNodeExists(graph, outcome);
  const descX = descendants(graph, treatment);
  for (const z of adjustmentSet) {
    assertNodeExists(graph, z);
    if (z === treatment || z === outcome) return false;
    if (descX.has(z)) return false;
  }
  return blocksBackdoorPaths(graph, treatment, outcome, new Set(adjustmentSet));
}

// ---------------------------------------------------------------------------
// Internals — graph utilities and d-separation
// ---------------------------------------------------------------------------

function assertNodeExists(graph: CausalGraph, node: string): void {
  if (!graph.nodes.includes(node)) {
    throw new CausalInferenceError(
      'UNKNOWN_NODE',
      `node "${node}" is not in the graph`,
    );
  }
}

function descendants(graph: CausalGraph, node: string): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const e of graph.edges) {
      if (e.from === cur && !out.has(e.to)) {
        out.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return out;
}

function ancestors(graph: CausalGraph, node: string): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const e of graph.edges) {
      if (e.to === cur && !out.has(e.from)) {
        out.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return out;
}

function union<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>(a);
  for (const v of b) out.add(v);
  return out;
}

function firstAdmissibleSubsetOfSize(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  candidates: ReadonlyArray<string>,
  size: number,
): Set<string> | null {
  if (size === 0) {
    const empty = new Set<string>();
    if (blocksBackdoorPaths(graph, treatment, outcome, empty)) return empty;
    return null;
  }
  const idx: number[] = Array.from({ length: size }, (_, i) => i);
  while (true) {
    const subset = new Set<string>(idx.map((i) => candidates[i] as string));
    if (blocksBackdoorPaths(graph, treatment, outcome, subset)) return subset;
    // Advance combination indices lexicographically.
    let i = size - 1;
    while (i >= 0 && (idx[i] as number) === candidates.length - size + i) {
      i -= 1;
    }
    if (i < 0) return null;
    idx[i] = (idx[i] as number) + 1;
    for (let j = i + 1; j < size; j += 1) {
      idx[j] = (idx[j - 1] as number) + 1;
    }
  }
}

/**
 * d-separation check via the moralised ancestral graph trick:
 *
 *  1. Let A = Anc({X, Y, Z}).
 *  2. Build undirected graph G' on A: for every edge in G with both
 *     endpoints in A, add an undirected edge; for every "collider"
 *     node c in A with parents p1, p2 in G, add an undirected edge
 *     (p1, p2) (moralisation).
 *  3. Remove all nodes in Z.
 *  4. If X and Y remain connected in G' restricted to A \ Z, there
 *     is an open back-door path; Z does NOT block.
 *
 * We additionally restrict to *back-door* paths only by requiring the
 * first edge on the X-side to be incoming to X. Implementation: list
 * X's parents (incoming neighbours) as the seed of the BFS instead
 * of X itself; this skips paths leaving X via an outgoing edge.
 */
function blocksBackdoorPaths(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  z: ReadonlySet<string>,
): boolean {
  const seedSet = new Set<string>();
  for (const e of graph.edges) {
    if (e.to === treatment) seedSet.add(e.from);
  }
  if (seedSet.size === 0) return true; // no back-door paths exist
  // If Y is among the parents of X then X<-Y is a back-door path of
  // length 1 with no intermediate vertices — unblockable by Z.
  if (seedSet.has(outcome)) return false;

  // Ancestors of {X, Y, Z}.
  const anc = new Set<string>();
  for (const v of [treatment, outcome, ...z]) {
    anc.add(v);
    for (const a of ancestors(graph, v)) anc.add(a);
  }

  // Build undirected moralised graph over `anc`.
  const adj = new Map<string, Set<string>>();
  for (const v of anc) adj.set(v, new Set<string>());
  const addUndirected = (a: string, b: string): void => {
    if (a === b) return;
    if (!anc.has(a) || !anc.has(b)) return;
    (adj.get(a) as Set<string>).add(b);
    (adj.get(b) as Set<string>).add(a);
  };
  // Original edges -> undirected.
  for (const e of graph.edges) {
    addUndirected(e.from, e.to);
  }
  // Moralisation: connect co-parents of every node in `anc`.
  for (const v of anc) {
    const parents: string[] = [];
    for (const e of graph.edges) {
      if (e.to === v && anc.has(e.from)) parents.push(e.from);
    }
    for (let i = 0; i < parents.length; i += 1) {
      for (let j = i + 1; j < parents.length; j += 1) {
        addUndirected(parents[i] as string, parents[j] as string);
      }
    }
  }
  // Remove Z by treating Z nodes as not present.
  // BFS from seedSet to outcome.
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const seed of seedSet) {
    if (z.has(seed)) continue;
    if (!anc.has(seed)) continue;
    queue.push(seed);
    visited.add(seed);
  }
  // We must NOT pass through X itself (a back-door path begins with
  // an arrow INTO X and then traverses ancestors only).
  visited.add(treatment);
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === outcome) return false;
    const neighbours = adj.get(cur);
    if (neighbours === undefined) continue;
    for (const nb of neighbours) {
      if (visited.has(nb)) continue;
      if (z.has(nb)) continue;
      visited.add(nb);
      queue.push(nb);
    }
  }
  return true;
}
