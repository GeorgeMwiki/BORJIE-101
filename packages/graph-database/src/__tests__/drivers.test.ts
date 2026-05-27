/**
 * Driver tests — exercise Neo4j / FalkorDB / Apache AGE through MOCK
 * fetcher ports. The mocks are CLEARLY LABELLED below; they exercise
 * the driver port surface only — no fake DB engines are claimed.
 */
import { describe, expect, it } from 'vitest';
import {
  createNeo4jDriver,
  type Neo4jSessionFetcher,
} from '../drivers/neo4j-driver.js';
import {
  createFalkorDriver,
  type FalkorGraphFetcher,
} from '../drivers/falkordb-driver.js';
import {
  createApacheAgeDriver,
  wrapCypherForAge,
  type PgQueryFetcher,
} from '../drivers/apache-age-driver.js';
import { cypher } from '../query/cypher-builder.js';
import { GraphDatabaseError } from '../types.js';

// ---------------------------------------------------------------------------
// MOCK Neo4jSessionFetcher — exercises driver port only
// ---------------------------------------------------------------------------
function mockNeo4jFetcher(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Neo4jSessionFetcher {
  let closeCalled = false;
  return {
    async run(cypherText, params) {
      const keys = rows.length > 0 ? Object.keys(rows[0] ?? {}) : ['ok'];
      return {
        records: rows.map((r) => ({
          keys,
          get: (k: string) => r[k],
          _seen: { cypherText, params },
        })) as ReadonlyArray<{
          readonly keys: ReadonlyArray<string>;
          readonly get: (k: string) => unknown;
        }>,
      };
    },
    async close() {
      closeCalled = true;
    },
    async verifyConnectivity() {
      if (closeCalled) throw new Error('session already closed');
    },
  };
}

// ---------------------------------------------------------------------------
// MOCK FalkorGraphFetcher
// ---------------------------------------------------------------------------
function mockFalkorFetcher(
  header: ReadonlyArray<string>,
  data: ReadonlyArray<ReadonlyArray<unknown>>,
): FalkorGraphFetcher {
  return {
    async query() {
      return { header, data };
    },
    async close() {
      // noop
    },
    async ping() {
      return 'PONG';
    },
  };
}

// ---------------------------------------------------------------------------
// MOCK PgQueryFetcher — exercises AGE wrapper
// ---------------------------------------------------------------------------
function mockPgFetcher(
  fields: ReadonlyArray<{ readonly name: string }>,
  rows: ReadonlyArray<Record<string, unknown>>,
): PgQueryFetcher {
  return {
    async query() {
      return { fields, rows };
    },
    async end() {
      // noop
    },
  };
}

describe('createNeo4jDriver', () => {
  it('runs a tenant-scoped query and shapes the result', async () => {
    const driver = createNeo4jDriver({
      fetcher: mockNeo4jFetcher([{ id: 'm-1' }, { id: 'm-2' }]),
      now: () => 1000,
    });
    const q = cypher()
      .tenant('tnt-1')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .return('m.id AS id')
      .build();
    const result = await driver.run(q);
    expect(result.driver).toBe('neo4j');
    expect(result.tenantId).toBe('tnt-1');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.fields).toEqual(['id']);
    expect(result.records[0]?.values).toEqual(['m-1']);
  });

  it('REJECTS a non-tenant-scoped query', async () => {
    const driver = createNeo4jDriver({
      fetcher: mockNeo4jFetcher([]),
    });
    await expect(
      driver.run({
        cypher: 'MATCH (m:Mine) RETURN m',
        params: {},
        tenantId: 'tnt-1',
        tenantScoped: false as unknown as true,
        readOnly: true,
      }),
    ).rejects.toThrow(GraphDatabaseError);
  });

  it('healthCheck returns ok when verifyConnectivity passes', async () => {
    const driver = createNeo4jDriver({
      fetcher: mockNeo4jFetcher([]),
    });
    const hc = await driver.healthCheck();
    expect(hc.ok).toBe(true);
  });

  it('throws driver_unavailable without fetcher', () => {
    expect(() =>
      createNeo4jDriver({ fetcher: undefined as unknown as Neo4jSessionFetcher }),
    ).toThrow(GraphDatabaseError);
  });
});

describe('createFalkorDriver', () => {
  it('runs and reshapes header+data into records', async () => {
    const driver = createFalkorDriver({
      fetcher: mockFalkorFetcher(['buyerId', 'mineId'], [
        ['b-1', 'm-1'],
        ['b-2', 'm-2'],
      ]),
      now: () => 0,
    });
    const q = cypher()
      .tenant('tnt-1')
      .match({ variable: 'b', labels: ['Buyer'], properties: {} })
      .return('b.id AS buyerId')
      .build();
    const result = await driver.run(q);
    expect(result.driver).toBe('falkordb');
    expect(result.records[0]?.fields).toEqual(['buyerId', 'mineId']);
    expect(result.records[1]?.values).toEqual(['b-2', 'm-2']);
  });

  it('healthCheck returns ok on PONG', async () => {
    const driver = createFalkorDriver({
      fetcher: mockFalkorFetcher([], []),
    });
    expect((await driver.healthCheck()).ok).toBe(true);
  });
});

describe('createApacheAgeDriver', () => {
  it('runs cypher via the AGE envelope and reshapes rows', async () => {
    const driver = createApacheAgeDriver({
      fetcher: mockPgFetcher(
        [{ name: 'result' }],
        [{ result: { id: 'm-1' } }, { result: { id: 'm-2' } }],
      ),
      graphName: 'borjie_graph',
    });
    const q = cypher()
      .tenant('tnt-1')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .return('m')
      .build();
    const result = await driver.run(q);
    expect(result.driver).toBe('apache_age');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.fields).toEqual(['result']);
  });

  it('wrapCypherForAge produces a SELECT cypher(...) envelope', () => {
    const q = cypher()
      .tenant('tnt-1')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .return('m')
      .build();
    const wrapped = wrapCypherForAge('borjie_graph', q);
    expect(wrapped.sql).toContain("cypher('borjie_graph'");
    expect(wrapped.sql).toContain('$1::jsonb');
    expect(wrapped.sql).toContain('MATCH (m:Mine');
    expect(wrapped.values).toHaveLength(1);
    // values[0] is JSON params blob — parse it
    const parsed = JSON.parse(wrapped.values[0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed['tenantId']).toBe('tnt-1');
  });

  it('healthCheck pings via SELECT 1', async () => {
    const driver = createApacheAgeDriver({
      fetcher: mockPgFetcher([{ name: 'ok' }], [{ ok: 1 }]),
    });
    expect((await driver.healthCheck()).ok).toBe(true);
  });
});
