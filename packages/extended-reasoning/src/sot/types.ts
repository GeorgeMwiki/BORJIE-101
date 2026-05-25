/**
 * Skeleton-of-Thought (SoT) — Ning 2023 (arXiv:2307.15337).
 *
 * L1 deferred this because desktop latency isn't our bottleneck. But mobile
 * on 3G IS. J8's mobile streaming target was FMP < 1.5s on 3G — SoT delivers
 * that by emitting the skeleton (3-7 bullet points) within the time of a
 * single short LLM call, then expanding each point in parallel.
 *
 * Compared to a single-pass CoT that emits a 1500-token answer end-to-end,
 * SoT cuts time-to-first-meaningful-paint by 3-5× because:
 *
 *   - The "skeleton" call is a fast Haiku call returning ~80 tokens.
 *   - The N point-expansions run in parallel (wall-clock = max, not sum).
 *
 * The orchestration here exposes an event-emitting API so the J8 layer can
 * stream the skeleton to the client immediately and stream each point as it
 * completes — without re-implementing the orchestration logic in the
 * frontend.
 */

import type { ModelAdapter } from '../shared/types.js';

export interface SoTPoint {
  readonly index: number;
  readonly title: string;
  readonly content: string;
  /** Wall-clock ms from `runSoT` start to this point being ready. */
  readonly elapsedMs: number;
}

export interface RunSoTInput {
  readonly question: string;
  readonly skeletonModel: ModelAdapter;
  readonly pointModel: ModelAdapter;
  readonly synthesisModel?: ModelAdapter;
  /** Default 5. Hard min/max 1..12. */
  readonly maxBranches?: number;
  /**
   * Per-branch timeout. Default 4000ms. A point that times out is still
   * included in the result with `content: <timeout>` so the stitched answer
   * stays well-formed.
   */
  readonly branchTimeoutMs?: number;
  /**
   * Optional event sink. Called as work progresses — used by J8 to stream
   * partial state to the client over SSE.
   */
  readonly onEvent?: (event: SoTEvent) => void;
  /** Inject for testability — defaults to `performance.now`. */
  readonly nowMs?: () => number;
}

export type SoTEvent =
  | { readonly kind: 'skeleton-ready'; readonly titles: ReadonlyArray<string>; readonly fmpMs: number }
  | { readonly kind: 'point-ready'; readonly point: SoTPoint }
  | { readonly kind: 'synthesis-ready'; readonly text: string; readonly totalMs: number };

export interface RunSoTResult {
  readonly skeleton: ReadonlyArray<string>;
  readonly points: ReadonlyArray<SoTPoint>;
  /** Final stitched prose (uses synthesis model if provided, else simple join). */
  readonly text: string;
  /** ms from start until skeleton-ready — this is the FMP number J8 cares about. */
  readonly fmpMs: number;
  /** ms from start until last byte. */
  readonly totalMs: number;
}
