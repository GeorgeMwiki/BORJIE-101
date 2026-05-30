/**
 * Process miner — builds a directly-follows graph (DFG) + variant
 * clustering from an event stream.
 *
 * Algorithm (deterministic, hermetic, no LLM):
 *   1. Group events by (processKey, caseId). Sort each case by
 *      occurredAt ascending.
 *   2. For each case, walk the sequence of activities and:
 *        - increment node occurrence counters
 *        - increment "from \u0000 to" edge counters
 *        - record wait time (occurredAt[i+1] - occurredAt[i])
 *   3. Cluster cases into distinct variants by activity sequence.
 *   4. Aggregate metrics: mean / median / p95 for node dwell time +
 *      edge wait time + case duration.
 *
 * Dwell time = how long a case sits at an activity before the next
 * one fires (best proxy without explicit end-of-activity events).
 *
 * Mean / median / p95 use a numerically stable accumulator (sort once
 * per node per call). The miner caps the input at 500k events to
 * keep memory bounded — caller pages through windows.
 *
 * @module features/central-command/md/process-mining/process-miner
 */

import type {
  ProcessEdge,
  ProcessEventRecord,
  ProcessMapGraph,
  ProcessMapMetrics,
  ProcessNode,
  ProcessVariant,
} from "./types";

const MAX_EVENTS = 500_000;
/** M-1: cap per-case to bound RAM on adversarial single-case input
 *  (500k events sharing one caseId produces a multi-MB Map key). */
const MAX_EVENTS_PER_CASE = 5_000;
/** C-1: edge-key separator. The processEventSchema's EDGE_KEY_SAFE_RE
 *  blocks this byte from activity labels, so no caller can inject a
 *  forged edge by crafting "A<SEP>evil". */
const EDGE_KEY_SEP = "\u0000";

export interface MineInput {
  /** Events ALREADY scoped to (org, processKey). Order doesn't matter
   *  — the miner sorts per case. */
  readonly events: ReadonlyArray<ProcessEventRecord>;
  /** Minimum number of cases a variant must contain to be reported
   *  separately. Below this it folds into "long tail". */
  readonly minVariantSupport?: number;
  /** Cap on distinct variants returned (the long-tail folds into the
   *  graph but not the variants list). */
  readonly maxVariants?: number;
}

export interface MineResult {
  readonly graph: ProcessMapGraph;
  readonly metrics: ProcessMapMetrics;
}

export function mineProcess(input: MineInput): MineResult {
  if (input.events.length === 0) {
    return Object.freeze({
      graph: Object.freeze({
        nodes: [],
        edges: [],
        variants: [],
        startActivities: [],
        endActivities: [],
      }),
      metrics: Object.freeze({
        traceCount: 0,
        distinctVariants: 0,
        meanCaseDurationMs: 0,
        medianCaseDurationMs: 0,
        p95CaseDurationMs: 0,
        commonVariantShare: 0,
        reworkRate: 0,
      }),
    });
  }
  const events =
    input.events.length > MAX_EVENTS
      ? input.events.slice(0, MAX_EVENTS)
      : input.events;
  const minVariantSupport = Math.max(1, input.minVariantSupport ?? 2);
  const maxVariants = Math.max(1, input.maxVariants ?? 16);

  // 1. Group by case + sort each case by occurredAt.
  const cases = new Map<string, ProcessEventRecord[]>();
  for (const e of events) {
    const list = cases.get(e.caseId);
    if (list) list.push(e);
    else cases.set(e.caseId, [e]);
  }
  for (const list of cases.values()) {
    list.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  }

  // 2. Build node + edge counters.
  const nodeDwellMs = new Map<string, number[]>();
  const nodeOccurrences = new Map<string, number>();
  const edgeFrequency = new Map<string, number>();
  const edgeWaitMs = new Map<string, number[]>();
  const variantSeqByCase = new Map<string, string[]>();
  const startCounts = new Map<string, number>();
  const endCounts = new Map<string, number>();
  const caseDurations: number[] = [];
  let reworkCases = 0;

  for (const [caseId, evRaw] of cases) {
    if (evRaw.length === 0) continue;
    // M-1: cap per-case events so an adversarial single-case 500k
    // payload can't produce a multi-MB variant key.
    const ev =
      evRaw.length > MAX_EVENTS_PER_CASE
        ? evRaw.slice(0, MAX_EVENTS_PER_CASE)
        : evRaw;
    const seq = ev.map((e) => e.activity);
    variantSeqByCase.set(caseId, seq);
    // Activity multiset for rework detection.
    const counts = new Map<string, number>();
    for (const a of seq) counts.set(a, (counts.get(a) ?? 0) + 1);
    if ([...counts.values()].some((c) => c > 1)) reworkCases += 1;

    startCounts.set(seq[0]!, (startCounts.get(seq[0]!) ?? 0) + 1);
    endCounts.set(
      seq[seq.length - 1]!,
      (endCounts.get(seq[seq.length - 1]!) ?? 0) + 1,
    );

    const caseStart = new Date(ev[0]!.occurredAt).getTime();
    const caseEnd = new Date(ev[ev.length - 1]!.occurredAt).getTime();
    caseDurations.push(Math.max(0, caseEnd - caseStart));

    for (let i = 0; i < ev.length; i += 1) {
      const a = ev[i]!.activity;
      nodeOccurrences.set(a, (nodeOccurrences.get(a) ?? 0) + 1);
      if (i < ev.length - 1) {
        const next = ev[i + 1]!.activity;
        const edgeKey = `${a}${EDGE_KEY_SEP}${next}`;
        edgeFrequency.set(edgeKey, (edgeFrequency.get(edgeKey) ?? 0) + 1);
        const wait =
          new Date(ev[i + 1]!.occurredAt).getTime() -
          new Date(ev[i]!.occurredAt).getTime();
        const arr = edgeWaitMs.get(edgeKey);
        if (arr) arr.push(Math.max(0, wait));
        else edgeWaitMs.set(edgeKey, [Math.max(0, wait)]);
        // Dwell at the "from" node ≈ wait until next event fires.
        const dwellArr = nodeDwellMs.get(a);
        if (dwellArr) dwellArr.push(Math.max(0, wait));
        else nodeDwellMs.set(a, [Math.max(0, wait)]);
      }
    }
  }

  // 3. Compose nodes + edges.
  const nodes: ProcessNode[] = [];
  for (const [activity, occ] of nodeOccurrences) {
    const dwells = nodeDwellMs.get(activity) ?? [];
    nodes.push(
      Object.freeze({
        activity,
        occurrences: occ,
        durationMs: stats(dwells),
      }),
    );
  }
  nodes.sort((a, b) => b.occurrences - a.occurrences);

  const edges: ProcessEdge[] = [];
  for (const [edgeKey, freq] of edgeFrequency) {
    const [from, to] = edgeKey.split(EDGE_KEY_SEP) as [string, string];
    edges.push(
      Object.freeze({
        from,
        to,
        frequency: freq,
        waitMs: stats(edgeWaitMs.get(edgeKey) ?? []),
      }),
    );
  }
  edges.sort((a, b) => b.frequency - a.frequency);

  // 4. Variant clustering by sequence-equality.
  const variantCount = new Map<string, { seq: string[]; cases: string[] }>();
  for (const [caseId, seq] of variantSeqByCase) {
    const key = seq.join(EDGE_KEY_SEP);
    const slot = variantCount.get(key);
    if (slot) slot.cases.push(caseId);
    else variantCount.set(key, { seq, cases: [caseId] });
  }
  const allVariants: Array<{
    id: string;
    sequence: string[];
    cases: string[];
    meanDurationMs: number;
  }> = [];
  for (const v of variantCount.values()) {
    const durations: number[] = [];
    for (const cId of v.cases) {
      const ev = cases.get(cId);
      if (!ev || ev.length < 2) continue;
      durations.push(
        new Date(ev[ev.length - 1]!.occurredAt).getTime() -
          new Date(ev[0]!.occurredAt).getTime(),
      );
    }
    allVariants.push({
      id: variantHash(v.seq),
      sequence: v.seq,
      cases: v.cases,
      meanDurationMs:
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0,
    });
  }
  allVariants.sort((a, b) => b.cases.length - a.cases.length);
  const reportableVariants = allVariants
    .filter((v) => v.cases.length >= minVariantSupport)
    .slice(0, maxVariants);

  // 5. Start / end activities (≥10% of cases ranks).
  const totalCases = cases.size;
  const startActivities = sortedTopByShare(startCounts, totalCases, 0.1);
  const endActivities = sortedTopByShare(endCounts, totalCases, 0.1);

  // 6. Metrics.
  const cs = stats(caseDurations);
  const commonVariantShare =
    totalCases > 0 ? (allVariants[0]?.cases.length ?? 0) / totalCases : 0;
  const reworkRate = totalCases > 0 ? reworkCases / totalCases : 0;

  const graph: ProcessMapGraph = Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    variants: Object.freeze(
      reportableVariants.map(
        (v): ProcessVariant =>
          Object.freeze({
            id: v.id,
            sequence: Object.freeze([...v.sequence]),
            caseCount: v.cases.length,
            meanDurationMs: Math.round(v.meanDurationMs),
          }),
      ),
    ),
    startActivities: Object.freeze(startActivities),
    endActivities: Object.freeze(endActivities),
  });
  const metrics: ProcessMapMetrics = Object.freeze({
    traceCount: totalCases,
    distinctVariants: allVariants.length,
    meanCaseDurationMs: cs.mean,
    medianCaseDurationMs: cs.median,
    p95CaseDurationMs: cs.p95,
    commonVariantShare: Number(commonVariantShare.toFixed(3)),
    reworkRate: Number(reworkRate.toFixed(3)),
  });
  return Object.freeze({ graph, metrics });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stats(xs: ReadonlyArray<number>): {
  mean: number;
  median: number;
  p95: number;
} {
  if (xs.length === 0) return { mean: 0, median: 0, p95: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = Math.round(sum / sorted.length);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return { mean, median: Math.round(median), p95: Math.round(p95) };
}

function sortedTopByShare(
  counts: Map<string, number>,
  total: number,
  shareThreshold: number,
): string[] {
  if (total === 0) return [];
  const minCount = Math.ceil(total * shareThreshold);
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

/** Stable, short id for a variant sequence — first 16 hex chars of a
 *  djb2-ish hash, prefixed with `v_`. Pure function. */
function variantHash(seq: ReadonlyArray<string>): string {
  let h = 5381;
  for (const a of seq) {
    for (let i = 0; i < a.length; i += 1) {
      h = ((h << 5) + h + a.charCodeAt(i)) | 0;
    }
    h = ((h << 5) + h + 47) | 0; // separator
  }
  const u = h >>> 0;
  return `v_${u.toString(16).padStart(8, "0")}`;
}
