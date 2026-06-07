/**
 * estate-graph — pure projection unit tests.
 *
 * Proves the live estate API shapes project correctly into the
 * `@borjie/graph-viz` payloads (genuine compute over real-shaped data):
 *   - the entity tree flattens into a directed parent→child org graph;
 *   - capital movements map into RoyaltyFlow-shaped Sankey flows, with
 *     missing endpoints / non-positive amounts skipped and ids resolved
 *     to display names.
 */

import { describe, it, expect } from 'vitest';
import {
  entityTreeToGraph,
  capitalMovementsToRoyaltyFlows,
  nameLookupFromGraph,
} from '../estate-graph';
import type {
  EstateEntityTreeNode,
  EstateCapitalMovementRow,
} from '@/lib/queries/estate';

function entity(
  id: string,
  name: string,
  overrides: Partial<EstateEntityTreeNode['entity']> = {},
): EstateEntityTreeNode['entity'] {
  return {
    id,
    estateGroupId: 'g1',
    name,
    kind: 'subsidiary',
    brelaNo: null,
    tin: null,
    ownershipPct: '100',
    parentEntityId: null,
    status: 'active',
    foundedAt: null,
    divestedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('entityTreeToGraph', () => {
  it('flattens a nested tree into nodes + directed parent→child edges', () => {
    const tree: ReadonlyArray<EstateEntityTreeNode> = [
      {
        entity: entity('holding', 'Mwikila Holdings'),
        children: [
          {
            entity: entity('mine', 'North Mine Ltd', { ownershipPct: '80' }),
            children: [],
          },
          {
            entity: entity('transport', 'Haul Co', { ownershipPct: '51' }),
            children: [],
          },
        ],
      },
    ];
    const graph = entityTreeToGraph(tree);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      'holding',
      'mine',
      'transport',
    ]);
    // Two edges, both directed, from the holding to each child.
    expect(graph.edges.length).toBe(2);
    for (const e of graph.edges) {
      expect(e.source).toBe('holding');
      expect(e.directed).toBe(true);
    }
    const mineEdge = graph.edges.find((e) => e.target === 'mine');
    expect(mineEdge?.label).toBe('80%');
  });

  it('returns an empty graph for an empty tree', () => {
    const graph = entityTreeToGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

describe('capitalMovementsToRoyaltyFlows', () => {
  const nameById = new Map([
    ['holding', 'Mwikila Holdings'],
    ['mine', 'North Mine Ltd'],
  ]);

  function movement(
    overrides: Partial<EstateCapitalMovementRow>,
  ): EstateCapitalMovementRow {
    return {
      id: 'm1',
      fromEntityId: 'holding',
      toEntityId: 'mine',
      kind: 'capital_injection',
      amount: '5000000',
      currency: 'TZS',
      happenedAt: '2026-02-01T00:00:00Z',
      narrative: null,
      ...overrides,
    };
  }

  it('maps valid movements to royalty flows with names resolved', () => {
    const flows = capitalMovementsToRoyaltyFlows([movement({})], nameById);
    expect(flows).toEqual([
      {
        source: 'Mwikila Holdings',
        target: 'North Mine Ltd',
        amount: 5_000_000,
        currency: 'TZS',
      },
    ]);
  });

  it('skips movements missing an endpoint or with non-positive amount', () => {
    const flows = capitalMovementsToRoyaltyFlows(
      [
        movement({ fromEntityId: null }),
        movement({ id: 'm2', amount: '0' }),
        movement({ id: 'm3', amount: 'not-a-number' }),
      ],
      nameById,
    );
    expect(flows).toEqual([]);
  });

  it('falls back to the raw id when no display name is known', () => {
    const flows = capitalMovementsToRoyaltyFlows(
      [movement({ toEntityId: 'unknown_entity' })],
      nameById,
    );
    expect(flows[0]?.target).toBe('unknown_entity');
  });
});

describe('nameLookupFromGraph', () => {
  it('builds an id→label map from graph nodes', () => {
    const graph = entityTreeToGraph([
      { entity: entity('a', 'Alpha'), children: [] },
    ]);
    const lookup = nameLookupFromGraph(graph);
    expect(lookup.get('a')).toBe('Alpha');
  });
});
