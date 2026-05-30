/**
 * Conformance checker — measures how well a set of traces fits a
 * target `ProcessMapGraph`. Used by the verifier-junior to decide
 * whether a candidate automation is producing canary runs that
 * actually look like the historical process.
 *
 * Algorithm (simplified token replay):
 *   - For each case's activity sequence, walk through the target
 *     graph's edges. Each edge present in the target counts as a
 *     "matched move"; each transition NOT in the target counts as a
 *     "misaligned move".
 *   - Bonus for starting at one of the graph's startActivities and
 *     ending at one of its endActivities (each worth one matched
 *     move). Penalty for starting / ending elsewhere.
 *   - fitness = matched / (matched + misaligned).
 *
 * This is intentionally lightweight — full alignment-based fitness
 * (Adriansyah 2014) is overkill for the canary use case. The
 * checker also reports the divergences so the verifier can show the
 * operator which steps drift.
 *
 * Pure, hermetic.
 *
 * @module features/central-command/md/process-mining/conformance-checker
 */

import type { ProcessMapGraph } from "./types";

export interface ConformanceTrace {
  readonly caseId: string;
  readonly sequence: ReadonlyArray<string>;
}

export interface TraceConformance {
  readonly caseId: string;
  /** 0..1; 1.0 = every move matched. */
  readonly fitness: number;
  readonly matchedMoves: number;
  readonly misalignedMoves: number;
  /** Activity pairs that fired in the trace but aren't in the target. */
  readonly missingEdges: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
  }>;
}

export interface ConformanceReport {
  /** Aggregate fitness across all traces (0..1). */
  readonly aggregateFitness: number;
  readonly perTrace: ReadonlyArray<TraceConformance>;
  /** Activities the trace introduced that the target doesn't know. */
  readonly unknownActivities: ReadonlyArray<string>;
}

export function checkConformance(
  graph: ProcessMapGraph,
  traces: ReadonlyArray<ConformanceTrace>,
): ConformanceReport {
  if (graph.nodes.length === 0 || traces.length === 0) {
    return Object.freeze({
      aggregateFitness: 0,
      perTrace: [],
      unknownActivities: [],
    });
  }
  const allowedEdges = new Set<string>();
  for (const e of graph.edges) allowedEdges.add(`${e.from}→${e.to}`);
  const known = new Set<string>();
  for (const n of graph.nodes) known.add(n.activity);
  const starts = new Set<string>(graph.startActivities);
  const ends = new Set<string>(graph.endActivities);

  const perTrace: TraceConformance[] = [];
  const unknown = new Set<string>();
  let aggMatched = 0;
  let aggMisaligned = 0;

  for (const t of traces) {
    if (t.sequence.length === 0) {
      perTrace.push(
        Object.freeze({
          caseId: t.caseId,
          fitness: 0,
          matchedMoves: 0,
          misalignedMoves: 0,
          missingEdges: [],
        }),
      );
      continue;
    }
    for (const a of t.sequence) if (!known.has(a)) unknown.add(a);

    let matched = 0;
    let misaligned = 0;
    const missing: Array<{ from: string; to: string }> = [];

    // Start bonus / penalty.
    if (starts.size === 0 || starts.has(t.sequence[0]!)) matched += 1;
    else misaligned += 1;
    // End bonus / penalty.
    const tail = t.sequence[t.sequence.length - 1]!;
    if (ends.size === 0 || ends.has(tail)) matched += 1;
    else misaligned += 1;

    for (let i = 0; i < t.sequence.length - 1; i += 1) {
      const from = t.sequence[i]!;
      const to = t.sequence[i + 1]!;
      if (allowedEdges.has(`${from}→${to}`)) matched += 1;
      else {
        misaligned += 1;
        missing.push({ from, to });
      }
    }
    const total = matched + misaligned;
    const fitness = total === 0 ? 0 : matched / total;
    perTrace.push(
      Object.freeze({
        caseId: t.caseId,
        fitness: Number(fitness.toFixed(3)),
        matchedMoves: matched,
        misalignedMoves: misaligned,
        missingEdges: Object.freeze(missing),
      }),
    );
    aggMatched += matched;
    aggMisaligned += misaligned;
  }

  const aggregate =
    aggMatched + aggMisaligned === 0
      ? 0
      : aggMatched / (aggMatched + aggMisaligned);

  return Object.freeze({
    aggregateFitness: Number(aggregate.toFixed(3)),
    perTrace: Object.freeze(perTrace),
    unknownActivities: Object.freeze([...unknown].sort()),
  });
}
