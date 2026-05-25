/**
 * Graph-of-Thoughts (GoT) — Besta 2023 (arXiv:2308.09687).
 *
 * Thoughts are DAG vertices; edges express data dependencies. Unlike ToT
 * (a tree), GoT permits aggregation (merge two parents) and refinement
 * loops, which is exactly what BORJIE portfolio reasoning needs:
 *
 *   Q: "Across my 12 properties in Dar/Arusha/Mwanza, which should I
 *       refinance given current Bank of Tanzania rates?"
 *
 *   per-property:        market-data-DSM   market-data-ARU   market-data-MWZ
 *                              |                  |                  |
 *                          finance-DSM        finance-ARU         finance-MWZ
 *                                  \                |               /
 *                                   merge(cross-property comparison)
 *                                              |
 *                                       regulatory-overlay (TZ)
 *                                              |
 *                                       refinance-ranking
 */

import type { JsonValue } from '../shared/types.js';

/** Primitive operations that produce or transform thoughts. */
export type GoTPrimitiveOp = 'generate' | 'refine' | 'merge' | 'split';

export interface GoTNode {
  readonly id: string;
  /** Producing op — `generate` for root inputs. */
  readonly op: GoTPrimitiveOp;
  /** Free-form content; can be string or any JSON-safe shape. */
  readonly content: JsonValue;
  /** Self-rated quality 0..1. Higher = preferred for downstream selection. */
  readonly score: number;
  /** Soft labels (e.g. `property:12B`, `jurisdiction:TZ-DSM`) — used by merge. */
  readonly labels: ReadonlyArray<string>;
}

export interface GoTEdge {
  readonly from: string;
  readonly to: string;
  /**
   * Edge kind:
   *   - `data`: `to` consumes the content of `from`
   *   - `refines`: `to` is a refined version of `from`
   *   - `merges`: `to` is the aggregation of multiple `from` nodes
   */
  readonly kind: 'data' | 'refines' | 'merges';
}

export interface GoTGraph {
  readonly nodes: ReadonlyArray<GoTNode>;
  readonly edges: ReadonlyArray<GoTEdge>;
}

/**
 * Op plans the caller provides to drive the graph. Each entry is a single
 * application of a primitive to specific input node ids.
 */
export type GoTOp =
  | { readonly kind: 'generate'; readonly id: string; readonly prompt: string; readonly labels?: ReadonlyArray<string> }
  | { readonly kind: 'refine'; readonly id: string; readonly from: string; readonly prompt: string; readonly labels?: ReadonlyArray<string> }
  | { readonly kind: 'merge'; readonly id: string; readonly from: ReadonlyArray<string>; readonly prompt: string; readonly labels?: ReadonlyArray<string> }
  | { readonly kind: 'split'; readonly fromId: string; readonly intoIds: ReadonlyArray<string>; readonly prompt: string; readonly labels?: ReadonlyArray<string> };

export interface RunGoTInput {
  readonly question: string;
  readonly ops: ReadonlyArray<GoTOp>;
  /**
   * Optional final reducer — produced after all ops complete. Common pattern
   * is `{ kind: 'merge', from: <top-scored leaves>, ... }`.
   */
  readonly finalReducer?: GoTOp;
}

export interface GoTResult {
  readonly graph: GoTGraph;
  /** Topo-sorted op evaluation order — empty if no ops. */
  readonly evaluationOrder: ReadonlyArray<string>;
  /** id of the final node produced by `finalReducer`, if provided. */
  readonly finalNodeId?: string;
  /** Convenience pointer to the highest-scoring node in the whole graph. */
  readonly bestNodeId: string;
}
