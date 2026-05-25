/**
 * TenantGraph — a lightweight projection over Letta/Zep memory.
 *
 * This package does not depend on those packages directly (it would
 * pull the entire memory stack into simulation runs). Instead we
 * model the read-only adjacency we need: which tenants share a
 * property, which units feed which cashflow stream, and the simple
 * "neighbour reliability" signal used by retention curves.
 */

import type { TenantNode, UnitNode } from '../types.js';

export interface TenantGraphNode {
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId: string;
  readonly neighbourTenantIds: ReadonlyArray<string>;
}

export class TenantGraph {
  private readonly nodes: ReadonlyMap<string, TenantGraphNode>;

  constructor(nodes: ReadonlyMap<string, TenantGraphNode>) {
    this.nodes = nodes;
  }

  static build(
    tenants: ReadonlyArray<TenantNode>,
    units: ReadonlyArray<UnitNode>,
  ): TenantGraph {
    const unitToProperty = new Map<string, string>();
    units.forEach((u) => unitToProperty.set(u.unitId, u.propertyId));

    const byProperty = new Map<string, string[]>();
    tenants.forEach((t) => {
      const prop = unitToProperty.get(t.unitId) ?? '__unknown__';
      const bucket = byProperty.get(prop) ?? [];
      byProperty.set(prop, [...bucket, t.tenantId]);
    });

    const map = new Map<string, TenantGraphNode>();
    tenants.forEach((t) => {
      const prop = unitToProperty.get(t.unitId) ?? '__unknown__';
      const cohort = byProperty.get(prop) ?? [];
      map.set(t.tenantId, {
        tenantId: t.tenantId,
        unitId: t.unitId,
        propertyId: prop,
        neighbourTenantIds: cohort.filter((x) => x !== t.tenantId),
      });
    });
    return new TenantGraph(map);
  }

  node(tenantId: string): TenantGraphNode | undefined {
    return this.nodes.get(tenantId);
  }

  size(): number {
    return this.nodes.size;
  }

  neighboursOf(tenantId: string): ReadonlyArray<string> {
    return this.nodes.get(tenantId)?.neighbourTenantIds ?? [];
  }
}
