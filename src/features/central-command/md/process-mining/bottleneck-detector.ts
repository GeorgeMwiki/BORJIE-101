/**
 * Bottleneck detector — analyses a mined `ProcessMapGraph` and surfaces:
 *
 *   - wait_time      : edges whose wait p95 is >= 2× the median edge wait
 *   - rework_loop    : nodes that appear inside a self-loop or short cycle
 *   - parallel_gap   : nodes with multiple inbound edges of high variance
 *   - low_throughput : nodes whose occurrences are < 10% of the start node
 *   - high_variance  : nodes whose p95 dwell / mean dwell ratio is >= 4×
 *
 * Each bottleneck carries severity in (0, 1] used to prioritise the
 * redesigner's attention.
 *
 * Pure function, deterministic, no IO. Caller wraps this in a junior.
 *
 * @module features/central-command/md/process-mining/bottleneck-detector
 */

import type { Bottleneck, ProcessMapGraph, ProcessMapMetrics } from "./types";

export interface DetectInput {
  readonly graph: ProcessMapGraph;
  readonly metrics: ProcessMapMetrics;
}

export function detectBottlenecks(
  input: DetectInput,
): ReadonlyArray<Bottleneck> {
  const { graph, metrics } = input;
  if (graph.nodes.length === 0) return [];

  const found: Bottleneck[] = [];

  // 1. Wait-time bottlenecks on edges.
  const edgeMedianWaits = graph.edges
    .map((e) => e.waitMs.median)
    .filter((w) => w > 0)
    .sort((a, b) => a - b);
  const medianEdgeWait =
    edgeMedianWaits[Math.floor(edgeMedianWaits.length / 2)] ?? 0;
  if (medianEdgeWait > 0) {
    for (const edge of graph.edges) {
      if (edge.waitMs.p95 >= 2 * medianEdgeWait && edge.waitMs.p95 > 60_000) {
        const severity = Math.min(1, edge.waitMs.p95 / (medianEdgeWait * 4));
        found.push(
          Object.freeze({
            kind: "wait_time",
            anchor: { edge: { from: edge.from, to: edge.to } },
            severity: Number(severity.toFixed(3)),
            explanation: `Wait between "${edge.from}" and "${edge.to}" hits p95 ${msToHuman(edge.waitMs.p95)} — ${roundX(edge.waitMs.p95 / medianEdgeWait)}× the org-wide median edge wait.`,
            evidence: {
              p95Ms: edge.waitMs.p95,
              medianMs: edge.waitMs.median,
              orgMedianMs: medianEdgeWait,
              frequency: edge.frequency,
            },
          }),
        );
      }
    }
  }

  // 2. Rework / cycles.
  for (const edge of graph.edges) {
    if (edge.from === edge.to && edge.frequency >= 2) {
      found.push(
        Object.freeze({
          kind: "rework_loop",
          anchor: { node: edge.from },
          severity: Math.min(1, edge.frequency / 20),
          explanation: `Activity "${edge.from}" self-repeats ${edge.frequency} times across the window — likely rework or a stuck step.`,
          evidence: { selfLoopCount: edge.frequency },
        }),
      );
    }
  }
  // Detect 2-cycles (A → B → A) — same node revisited.
  // C-1: edge keys use the NUL separator (U+0000), which the
  // processEventSchema blocks from activity labels — no caller can
  // inject a fake edge by crafting an `activity = "X SEP Y"`.
  const SEP = "\u0000";
  const edgeMap = new Map<string, number>();
  for (const e of graph.edges)
    edgeMap.set(`${e.from}${SEP}${e.to}`, e.frequency);
  for (const e of graph.edges) {
    const back = edgeMap.get(`${e.to}${SEP}${e.from}`);
    if (back && e.from < e.to && back >= 2 && e.frequency >= 2) {
      found.push(
        Object.freeze({
          kind: "rework_loop",
          anchor: { node: e.from },
          severity: Math.min(1, (back + e.frequency) / 30),
          explanation: `Bouncing between "${e.from}" and "${e.to}" (${e.frequency} forward, ${back} backward) suggests rework / handoff churn.`,
          evidence: { forwardCount: e.frequency, backwardCount: back },
        }),
      );
    }
  }

  // 3. Parallel gaps — multiple inbound edges to one node with high
  //    variance in wait time.
  const inboundByNode = new Map<
    string,
    Array<{ from: string; meanMs: number; freq: number }>
  >();
  for (const edge of graph.edges) {
    const arr = inboundByNode.get(edge.to);
    const entry = {
      from: edge.from,
      meanMs: edge.waitMs.mean,
      freq: edge.frequency,
    };
    if (arr) arr.push(entry);
    else inboundByNode.set(edge.to, [entry]);
  }
  for (const [to, inbound] of inboundByNode) {
    if (inbound.length < 2) continue;
    const means = inbound.map((i) => i.meanMs).filter((m) => m > 0);
    if (means.length < 2) continue;
    const max = Math.max(...means);
    const min = Math.min(...means);
    if (min > 0 && max / min >= 3) {
      found.push(
        Object.freeze({
          kind: "parallel_gap",
          anchor: { node: to },
          severity: Math.min(1, max / min / 8),
          explanation: `"${to}" has parallel inbound paths with ${roundX(max / min)}× wait variance — slow branches are blocking the fast ones.`,
          evidence: {
            maxWaitMs: max,
            minWaitMs: min,
            inboundCount: inbound.length,
          },
        }),
      );
    }
  }

  // 4. Low throughput — nodes touched by <10% of cases (vs the dominant
  //    start activity). Useful for spotting dropped variants.
  const totalCases = metrics.traceCount;
  if (totalCases >= 10) {
    for (const node of graph.nodes) {
      const share = node.occurrences / totalCases;
      if (share < 0.1 && node.occurrences >= 1) {
        found.push(
          Object.freeze({
            kind: "low_throughput",
            anchor: { node: node.activity },
            severity: 1 - share,
            explanation: `"${node.activity}" appears in only ${(share * 100).toFixed(1)}% of cases — either a niche path or a dropped step.`,
            evidence: { occurrences: node.occurrences, totalCases },
          }),
        );
      }
    }
  }

  // 5. High dwell variance.
  for (const node of graph.nodes) {
    if (node.durationMs.mean === 0) continue;
    if (node.durationMs.p95 / Math.max(1, node.durationMs.mean) >= 4) {
      found.push(
        Object.freeze({
          kind: "high_variance",
          anchor: { node: node.activity },
          severity: Math.min(
            1,
            node.durationMs.p95 / Math.max(1, node.durationMs.mean) / 10,
          ),
          explanation: `Dwell at "${node.activity}" is highly variable: mean ${msToHuman(node.durationMs.mean)} vs p95 ${msToHuman(node.durationMs.p95)} (${roundX(node.durationMs.p95 / Math.max(1, node.durationMs.mean))}× spread).`,
          evidence: {
            meanMs: node.durationMs.mean,
            p95Ms: node.durationMs.p95,
          },
        }),
      );
    }
  }

  // Sort by severity desc and freeze.
  return Object.freeze(found.sort((a, b) => b.severity - a.severity));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msToHuman(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function roundX(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return n >= 10 ? `${Math.round(n)}` : n.toFixed(1);
}
