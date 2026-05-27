/**
 * Pearl front-door identification — pure TypeScript.
 *
 * A set of variables M satisfies the front-door criterion relative to
 * an ordered pair (X, Y) iff:
 *
 *   (i)   M intercepts every directed path from X to Y.
 *   (ii)  There is no unblocked back-door path from X to M.
 *   (iii) Every back-door path from M to Y is blocked by X.
 *
 * If such an M exists, P(Y | do(X)) is identifiable even when X and Y
 * share unobserved confounders. The textbook example is smoking ->
 * tar -> cancer with an unobserved genotype confounder between
 * smoking and cancer; the front-door mediator is {tar}.
 *
 * Reference: Pearl, J. — Causality (2nd ed., 2009), Theorem 3.3.4.
 *
 * @module @borjie/causal-inference/identify/frontdoor-criterion
 */

import {
  CausalInferenceError,
  type CausalGraph,
} from '../types.js';

export interface FrontdoorResult {
  /** Mediator set M satisfying the criterion. */
  readonly mediatorSet: ReadonlyArray<string>;
}

export function findFrontdoorMediatorSet(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
): FrontdoorResult {
  assertNodeExists(graph, treatment);
  assertNodeExists(graph, outcome);

  // Candidates: descendants of X that are ancestors of Y, excluding X and Y.
  const descX = descendants(graph, treatment);
  const ancY = ancestors(graph, outcome);
  const candidates: string[] = [];
  for (const v of graph.nodes) {
    if (v === treatment || v === outcome) continue;
    if (descX.has(v) && ancY.has(v)) candidates.push(v);
  }

  // Try singletons first, then larger sets.
  for (let size = 1; size <= candidates.length; size += 1) {
    const subset = firstFrontdoorSubsetOfSize(
      graph,
      treatment,
      outcome,
      candidates,
      size,
    );
    if (subset !== null) {
      return Object.freeze({
        mediatorSet: Object.freeze([...subset].sort()),
      });
    }
  }

  throw new CausalInferenceError(
    'FRONTDOOR_NOT_IDENTIFIABLE',
    `no front-door mediator set found for ${treatment} -> ${outcome}`,
  );
}

export function isFrontdoorMediatorSet(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  mediator: ReadonlyArray<string>,
): boolean {
  assertNodeExists(graph, treatment);
  assertNodeExists(graph, outcome);
  for (const m of mediator) assertNodeExists(graph, m);
  const M = new Set<string>(mediator);
  if (M.has(treatment) || M.has(outcome)) return false;
  return (
    interceptsAllDirectedPaths(graph, treatment, outcome, M) &&
    noUnblockedBackdoorFromXtoM(graph, treatment, M) &&
    allBackdoorMtoYBlockedByX(graph, treatment, outcome, M)
  );
}

// ---------------------------------------------------------------------------
// Internals
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

function firstFrontdoorSubsetOfSize(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  candidates: ReadonlyArray<string>,
  size: number,
): Set<string> | null {
  if (size === 0) return null;
  if (size > candidates.length) return null;
  const idx: number[] = Array.from({ length: size }, (_, i) => i);
  while (true) {
    const subset = new Set<string>(idx.map((i) => candidates[i] as string));
    if (
      interceptsAllDirectedPaths(graph, treatment, outcome, subset) &&
      noUnblockedBackdoorFromXtoM(graph, treatment, subset) &&
      allBackdoorMtoYBlockedByX(graph, treatment, outcome, subset)
    ) {
      return subset;
    }
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
 * Every directed path X -> ... -> Y passes through at least one node
 * of M. Equivalent: removing M disconnects X from Y in the directed
 * subgraph.
 */
function interceptsAllDirectedPaths(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  m: ReadonlySet<string>,
): boolean {
  if (m.has(treatment) || m.has(outcome)) return false;
  const visited = new Set<string>();
  const stack: string[] = [treatment];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (cur === outcome) return false;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (m.has(cur) && cur !== treatment) continue;
    for (const e of graph.edges) {
      if (e.from === cur && !visited.has(e.to)) stack.push(e.to);
    }
  }
  return true;
}

/**
 * Property (ii): there is no unblocked back-door path from X to any
 * member of M. A back-door path from X starts with an arrow into X.
 * Conditioning set for blocking is empty (criterion is stated with
 * the empty adjustment set).
 */
function noUnblockedBackdoorFromXtoM(
  graph: CausalGraph,
  treatment: string,
  m: ReadonlySet<string>,
): boolean {
  for (const target of m) {
    if (hasUnblockedBackdoorPath(graph, treatment, target, new Set<string>())) {
      return false;
    }
  }
  return true;
}

/**
 * Property (iii): every back-door path from any member of M to Y is
 * blocked by X.
 */
function allBackdoorMtoYBlockedByX(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  m: ReadonlySet<string>,
): boolean {
  for (const start of m) {
    if (
      hasUnblockedBackdoorPath(
        graph,
        start,
        outcome,
        new Set<string>([treatment]),
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true if there exists an unblocked back-door path from
 * `from` to `to` given conditioning set `z`. Uses the moralised
 * ancestral graph d-separation check; restricting to back-door means
 * we seed the BFS at the parents of `from` (incoming neighbours).
 */
function hasUnblockedBackdoorPath(
  graph: CausalGraph,
  from: string,
  to: string,
  z: ReadonlySet<string>,
): boolean {
  const seeds: string[] = [];
  for (const e of graph.edges) {
    if (e.to === from && !z.has(e.from)) seeds.push(e.from);
  }
  if (seeds.length === 0) return false;
  if (seeds.includes(to)) return true;
  const anc = new Set<string>();
  const toAncestor = (v: string): void => {
    if (anc.has(v)) return;
    anc.add(v);
    for (const e of graph.edges) {
      if (e.to === v) toAncestor(e.from);
    }
  };
  toAncestor(from);
  toAncestor(to);
  for (const v of z) toAncestor(v);
  const adj = new Map<string, Set<string>>();
  for (const v of anc) adj.set(v, new Set<string>());
  const addU = (a: string, b: string): void => {
    if (a === b) return;
    if (!anc.has(a) || !anc.has(b)) return;
    (adj.get(a) as Set<string>).add(b);
    (adj.get(b) as Set<string>).add(a);
  };
  for (const e of graph.edges) addU(e.from, e.to);
  for (const v of anc) {
    const parents: string[] = [];
    for (const e of graph.edges) {
      if (e.to === v && anc.has(e.from)) parents.push(e.from);
    }
    for (let i = 0; i < parents.length; i += 1) {
      for (let j = i + 1; j < parents.length; j += 1) {
        addU(parents[i] as string, parents[j] as string);
      }
    }
  }
  const visited = new Set<string>([from]);
  const queue: string[] = [];
  for (const s of seeds) {
    if (!anc.has(s)) continue;
    queue.push(s);
    visited.add(s);
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === to) return true;
    const nbs = adj.get(cur);
    if (nbs === undefined) continue;
    for (const nb of nbs) {
      if (visited.has(nb)) continue;
      if (z.has(nb)) continue;
      visited.add(nb);
      queue.push(nb);
    }
  }
  return false;
}
