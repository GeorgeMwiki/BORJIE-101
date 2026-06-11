/**
 * @borjie/system-graph — health enrichment (proprioception).
 *
 * A pure overlay pass: given an already-derived graph and a set of
 * observed health readings (keyed by node id), return a NEW graph with
 * health attached. Morphology is untouched — only the `health` field of
 * matching nodes changes, and the revision is recomputed so listChanged
 * fires when a limb's health flips (a degraded route is a body change the
 * MD must repage).
 *
 * Health is OBSERVED (OTel/Sentry 5xx-rate, capability-catalogue
 * competence/calibration), never self-reported. This module just merges;
 * the readings come from the observation walkers in consolidation-worker.
 *
 * Immutable: returns a new graph, never mutates the input.
 */

import { computeRevision } from './builder.js';
import type { NodeHealth, SystemGraph, SystemNode } from './types.js';

export interface HealthReading {
  readonly nodeId: string;
  readonly health: NodeHealth;
}

/**
 * Attach observed health to matching nodes, returning a new graph with a
 * recomputed revision. Readings for unknown node ids are ignored (a
 * reading without an organ is prediction error, not a fact).
 */
export function attachHealth(
  graph: SystemGraph,
  readings: ReadonlyArray<HealthReading>,
): SystemGraph {
  if (readings.length === 0) return graph;
  const byId = new Map<string, NodeHealth>();
  for (const r of readings) byId.set(r.nodeId, r.health);

  const nodes: SystemNode[] = graph.nodes.map((n) => {
    const h = byId.get(n.id);
    return h ? { ...n, health: h } : n;
  });

  return {
    ...graph,
    nodes,
    revision: computeRevision(nodes, graph.edges),
  };
}
