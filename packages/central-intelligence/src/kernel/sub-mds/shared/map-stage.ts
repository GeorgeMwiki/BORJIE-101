/**
 * MAP stage primitive — turns a flat event list into a ProcessGraph.
 *
 * Production wires the MCP process-intel server (mines real state
 * machines). This primitive is the in-process fallback: it counts
 * states by `state` payload key, builds adjacency edges by `(id, t)`
 * ordering, and reports SLA breaches when payload carries
 * `sla_breached: true`.
 *
 * Pure, deterministic, no I/O — safe in tests.
 */

import type {
  ObservedEvent,
  ProcessGraph,
  ProcessGraphEdge,
  ProcessGraphNode,
} from './sub-md-base.js';

export interface MapStageArgs {
  readonly events: ReadonlyArray<ObservedEvent>;
  /** Payload key that names the state. Defaults to 'state'. */
  readonly stateKey?: string;
  /** Payload key that groups events into a single case. Defaults
   *  to 'caseId'. */
  readonly caseKey?: string;
}

export function runMapStage(args: MapStageArgs): ProcessGraph {
  const stateKey = args.stateKey ?? 'state';
  const caseKey = args.caseKey ?? 'caseId';
  const nodeStats = new Map<string, { count: number; dwellSum: number; dwellSamples: number }>();
  const edgeStats = new Map<string, { count: number; transitionSum: number; transitionSamples: number }>();
  const breachByNode = new Map<string, number>();

  // Group by case
  const cases = new Map<string, ObservedEvent[]>();
  for (const evt of args.events) {
    const caseId = String(evt.payload[caseKey] ?? evt.id);
    const bucket = cases.get(caseId) ?? [];
    bucket.push(evt);
    cases.set(caseId, bucket);
  }

  for (const [, bucket] of cases) {
    const sorted = bucket.slice().sort((a, b) => a.occurredAtMs - b.occurredAtMs);
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      if (!current) continue;
      const state = String(current.payload[stateKey] ?? 'unknown');
      const ns = nodeStats.get(state) ?? { count: 0, dwellSum: 0, dwellSamples: 0 };
      ns.count += 1;
      nodeStats.set(state, ns);
      if (current.payload['sla_breached'] === true) {
        breachByNode.set(state, (breachByNode.get(state) ?? 0) + 1);
      }
      if (i + 1 < sorted.length) {
        const next = sorted[i + 1];
        if (!next) continue;
        const nextState = String(next.payload[stateKey] ?? 'unknown');
        const edgeKey = `${state}->${nextState}`;
        const es = edgeStats.get(edgeKey) ?? { count: 0, transitionSum: 0, transitionSamples: 0 };
        es.count += 1;
        const dt = next.occurredAtMs - current.occurredAtMs;
        if (dt >= 0) {
          es.transitionSum += dt;
          es.transitionSamples += 1;
        }
        edgeStats.set(edgeKey, es);
      }
    }
  }

  const nodes: ProcessGraphNode[] = [];
  for (const [id, s] of nodeStats) {
    const node: ProcessGraphNode = s.dwellSamples > 0
      ? { id, label: id, count: s.count, avgDwellMs: Math.round(s.dwellSum / s.dwellSamples) }
      : { id, label: id, count: s.count };
    nodes.push(node);
  }

  const edges: ProcessGraphEdge[] = [];
  for (const [key, s] of edgeStats) {
    const parts = key.split('->');
    const from = parts[0] ?? 'unknown';
    const to = parts[1] ?? 'unknown';
    const edge: ProcessGraphEdge = s.transitionSamples > 0
      ? {
          from,
          to,
          count: s.count,
          avgTransitionMs: Math.round(s.transitionSum / s.transitionSamples),
        }
      : { from, to, count: s.count };
    edges.push(edge);
  }

  const slaBreaches = Array.from(breachByNode.entries()).map(([nodeId, breachedCount]) => ({
    nodeId,
    breachedCount,
  }));

  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    slaBreaches: Object.freeze(slaBreaches),
    observationCount: args.events.length,
  });
}
