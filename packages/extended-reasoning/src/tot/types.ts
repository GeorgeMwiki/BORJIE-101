/**
 * raw Tree-of-Thoughts (ToT) — Yao 2023 (arXiv:2305.10601).
 *
 * The L1 audit said "use Self-Discover instead". That advice holds when the
 * task structure is unknown and must be discovered. But BORJIE has many
 * decision points where the structure is **FIXED**: eviction-decision tree,
 * vendor-selection tree, KRA-filing-route tree, tenant-screening tree.
 *
 * For these, raw ToT with a pre-built tree is strictly faster than
 * Self-Discover — we skip the discovery cost and walk a known graph.
 */

import type { JsonValue } from '../shared/types.js';

/** A node in a fixed decision tree. */
export interface ToTNode {
  readonly id: string;
  readonly question: string;
  /** Outcome: when this branch is reached, this is the recommended action. */
  readonly outcome?: string;
  /** Edges, evaluated in order; first matching edge wins. */
  readonly edges?: ReadonlyArray<ToTEdge>;
}

export interface ToTEdge {
  readonly label: string;
  /**
   * Predicate evaluated against the runtime context. The decision tree
   * structure stays fixed; only the predicates change per-tenant/per-case.
   */
  readonly when: (ctx: ToTContext) => boolean;
  readonly toNodeId: string;
}

export interface ToTContext {
  readonly facts: { readonly [key: string]: JsonValue };
}

export interface DecisionTree {
  readonly id: string;
  readonly rootNodeId: string;
  readonly nodes: { readonly [id: string]: ToTNode };
}

/**
 * Search strategy. BFS guarantees shortest-path to outcome; DFS does
 * depth-first. For fixed trees BFS is the right default — the tree is
 * shallow, and we want to surface every reachable outcome.
 */
export type SearchStrategy = 'bfs' | 'dfs';

/** Generic branching/evaluation functions for free-form ToT runs. */
export type BranchingFn = (
  ctx: ToTContext,
  parentThought: string,
  depth: number,
) => ReadonlyArray<string>;

export type EvaluationFn = (
  ctx: ToTContext,
  thought: string,
  depth: number,
) => number;

export interface RunToTInput {
  readonly rootThought: string;
  readonly branchingFn: BranchingFn;
  readonly evaluationFn: EvaluationFn;
  readonly search: SearchStrategy;
  readonly maxDepth: number;
  readonly maxBranches: number;
  readonly ctx: ToTContext;
}

export interface RunToTTreeInput {
  readonly tree: DecisionTree;
  readonly ctx: ToTContext;
  /** Optional. Default 'bfs'. */
  readonly search?: SearchStrategy;
  /** Safety: cap on visited nodes to defend against malformed trees. */
  readonly maxVisits?: number;
}

export interface ToTPathStep {
  readonly nodeId: string;
  readonly question: string;
  readonly edgeLabel?: string;
}

export interface RunToTTreeResult {
  readonly outcome: string;
  readonly path: ReadonlyArray<ToTPathStep>;
  readonly visited: number;
}

export interface RunToTResult {
  readonly bestThought: string;
  readonly bestScore: number;
  readonly explored: number;
}
