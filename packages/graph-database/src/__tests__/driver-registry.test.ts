/**
 * driver-registry tests — verify priority / preference / health.
 */
import { describe, expect, it } from 'vitest';
import { createDriverRegistry } from '../driver-registry.js';
import { GraphDatabaseError, type GraphDriverPort } from '../types.js';
import { cypher } from '../query/cypher-builder.js';

function mockDriver(
  id: GraphDriverPort['id'],
  options: { readonly healthy?: boolean } = {},
): GraphDriverPort {
  return {
    id,
    async run(query) {
      return {
        driver: id,
        tenantId: query.tenantId,
        records: [],
        latencyMs: 1,
      };
    },
    async healthCheck() {
      return { ok: options.healthy ?? true, latencyMs: 1 };
    },
    async close() {
      // noop
    },
  };
}

describe('createDriverRegistry', () => {
  it('lists available drivers', () => {
    const registry = createDriverRegistry({
      drivers: {
        neo4j: mockDriver('neo4j'),
        falkordb: mockDriver('falkordb'),
      },
    });
    expect(registry.availableDrivers()).toEqual(['neo4j', 'falkordb']);
  });

  it('honours preferredDriver hint', async () => {
    const registry = createDriverRegistry({
      drivers: {
        neo4j: mockDriver('neo4j'),
        falkordb: mockDriver('falkordb'),
      },
    });
    const q = cypher()
      .tenant('tnt-1')
      .preferDriver('falkordb')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .return('m')
      .build();
    const result = await registry.run(q);
    expect(result.driver).toBe('falkordb');
  });

  it('falls back to priority order when no preference', async () => {
    const registry = createDriverRegistry({
      drivers: {
        falkordb: mockDriver('falkordb'),
        apache_age: mockDriver('apache_age'),
      },
    });
    const q = cypher()
      .tenant('tnt-1')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .return('m')
      .build();
    const plan = registry.plan(q);
    expect(plan.driver).toBe('falkordb');
  });

  it('throws when no drivers are registered', async () => {
    const registry = createDriverRegistry({ drivers: {} });
    const q = cypher()
      .tenant('tnt-1')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .return('m')
      .build();
    await expect(registry.run(q)).rejects.toThrow(GraphDatabaseError);
  });

  it('healthAll reports per-driver state including unregistered as null', async () => {
    const registry = createDriverRegistry({
      drivers: {
        neo4j: mockDriver('neo4j', { healthy: true }),
      },
    });
    const all = await registry.healthAll();
    expect(all.neo4j?.ok).toBe(true);
    expect(all.falkordb).toBeNull();
    expect(all.apache_age).toBeNull();
  });
});
