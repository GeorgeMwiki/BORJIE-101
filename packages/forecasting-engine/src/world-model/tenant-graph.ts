/**
 * CounterpartyGraph — a lightweight projection over Letta/Zep memory.
 *
 * This package does not depend on those packages directly (it would
 * pull the entire memory stack into simulation runs). Instead we
 * model the read-only adjacency we need: which counterparties share a
 * site, which units feed which cashflow stream, and the simple
 * "neighbour reliability" signal used by retention curves.
 *
 * NOTE: the file is still named `tenant-graph.ts` and the public
 * exports carry `CounterpartyGraph` (canonical) plus deprecated
 * `TenantGraph` aliases for any in-flight importer; semantics are
 * mining (buyer / off-taker counterparties on a site).
 */

import type { CounterpartyNode, UnitNode } from '../types.js';

export interface CounterpartyGraphNode {
  readonly counterpartyId: string;
  readonly unitId: string;
  readonly siteId: string;
  readonly neighbourCounterpartyIds: ReadonlyArray<string>;
}

/** @deprecated Use {@link CounterpartyGraphNode}. */
export type TenantGraphNode = CounterpartyGraphNode;

export class CounterpartyGraph {
  private readonly nodes: ReadonlyMap<string, CounterpartyGraphNode>;

  constructor(nodes: ReadonlyMap<string, CounterpartyGraphNode>) {
    this.nodes = nodes;
  }

  static build(
    counterparties: ReadonlyArray<CounterpartyNode>,
    units: ReadonlyArray<UnitNode>,
  ): CounterpartyGraph {
    const unitToSite = new Map<string, string>();
    units.forEach((u) => unitToSite.set(u.unitId, u.siteId));

    const bySite = new Map<string, string[]>();
    counterparties.forEach((c) => {
      const site = unitToSite.get(c.unitId) ?? '__unknown__';
      const bucket = bySite.get(site) ?? [];
      bySite.set(site, [...bucket, c.counterpartyId]);
    });

    const map = new Map<string, CounterpartyGraphNode>();
    counterparties.forEach((c) => {
      const site = unitToSite.get(c.unitId) ?? '__unknown__';
      const cohort = bySite.get(site) ?? [];
      map.set(c.counterpartyId, {
        counterpartyId: c.counterpartyId,
        unitId: c.unitId,
        siteId: site,
        neighbourCounterpartyIds: cohort.filter((x) => x !== c.counterpartyId),
      });
    });
    return new CounterpartyGraph(map);
  }

  node(counterpartyId: string): CounterpartyGraphNode | undefined {
    return this.nodes.get(counterpartyId);
  }

  size(): number {
    return this.nodes.size;
  }

  neighboursOf(counterpartyId: string): ReadonlyArray<string> {
    return this.nodes.get(counterpartyId)?.neighbourCounterpartyIds ?? [];
  }
}

/** @deprecated Use {@link CounterpartyGraph}. */
export const TenantGraph = CounterpartyGraph;
