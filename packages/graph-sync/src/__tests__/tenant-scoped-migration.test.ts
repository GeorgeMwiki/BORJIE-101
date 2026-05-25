/**
 * Tests for the Wave-K tenant-scoped Cypher migration. Covers the
 * type-level + runtime guarantees on `Neo4jClient.readQuery`,
 * `Neo4jClient.writeQuery`, `Neo4jClient.runSchemaQuery`, the
 * `applyConstraintsAndIndexes` adapter path, and the homogenous-tenant
 * batch guard on `GraphSyncEngine`.
 *
 * All tests stub Neo4j at the session boundary so we never open a real
 * Bolt connection. The Driver is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Driver mock ─────────────────────────────────────────────────────────────
// neo4j-driver is mocked workspace-wide so the constructor path inside
// `Neo4jClient` doesn't try to dial a real Bolt endpoint. Each test
// captures the cypher passed through `session.run` so we can assert the
// tenant gate is in the wire-format query.

interface RunCall {
  cypher: string;
  params?: Record<string, unknown> | undefined;
}

const runCalls: RunCall[] = [];

vi.mock('neo4j-driver', () => {
  const sessionFactory = () => ({
    run: vi.fn(async (cypher: string, params?: Record<string, unknown>) => {
      runCalls.push({ cypher, params });
      return { records: [] as Array<{ toObject(): unknown }> };
    }),
    close: vi.fn(async () => undefined),
    executeWrite: vi.fn(),
    executeRead: vi.fn(),
  });

  const driver = {
    verifyConnectivity: vi.fn(async () => undefined),
    getServerInfo: vi.fn(async () => ({ protocolVersion: 5 })),
    session: vi.fn(() => sessionFactory()),
    close: vi.fn(async () => undefined),
  };

  return {
    default: {
      driver: vi.fn(() => driver),
      auth: { basic: vi.fn(() => ({})) },
      session: { READ: 'READ', WRITE: 'WRITE' },
    },
  };
});

// Imports must happen AFTER the mock above so the driver constructor
// resolves to our stub.
import {
  Neo4jClient,
  TenantScopeViolation,
  assertCypherReferencesTenantId,
  scopeNodePattern,
  applyConstraintsAndIndexes,
  type TenantScopedParams,
} from '../index.js';
import { GraphSyncEngine } from '../sync/graph-sync-engine.js';

function freshClient(): Neo4jClient {
  return new Neo4jClient({ uri: 'bolt://localhost:7687', password: 'borjie_graph_dev' });
}

beforeEach(() => {
  runCalls.length = 0;
});

// ─────────────────────────────────────────────────────────────────────
// Neo4jClient.readQuery — type-level + runtime tenant guard
// ─────────────────────────────────────────────────────────────────────

describe('Neo4jClient.readQuery — tenant guard', () => {
  it('accepts a well-scoped query and forwards params to session.run', async () => {
    const client = freshClient();
    await client.readQuery('MATCH (p:Property {_tenantId: $tenantId}) RETURN p', {
      tenantId: 'tenant-1',
    });
    expect(runCalls.length).toBe(1);
    expect(runCalls[0]!.cypher).toContain('$tenantId');
    expect(runCalls[0]!.params).toEqual({ tenantId: 'tenant-1' });
  });

  it('runtime-rejects params without tenantId BEFORE opening session', async () => {
    const client = freshClient();
    // @ts-expect-error — TenantScopedParams compile-time guard requires tenantId
    await expect(client.readQuery('MATCH (p:Property {_tenantId: $tenantId}) RETURN p', {})).rejects.toBeInstanceOf(
      TenantScopeViolation,
    );
    expect(runCalls.length).toBe(0);
  });

  it('runtime-rejects empty tenantId', async () => {
    const client = freshClient();
    await expect(
      client.readQuery('MATCH (p:Property {_tenantId: $tenantId}) RETURN p', { tenantId: '' }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
    expect(runCalls.length).toBe(0);
  });

  it('runtime-rejects Cypher missing $tenantId', async () => {
    const client = freshClient();
    await expect(
      client.readQuery('MATCH (p:Property) RETURN p', { tenantId: 'tenant-1' }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
    expect(runCalls.length).toBe(0);
  });

  it('passes extra caller-supplied params through to session.run', async () => {
    const client = freshClient();
    const params: TenantScopedParams<{ status: string }> = {
      tenantId: 'tenant-1',
      status: 'active',
    };
    await client.readQuery(
      'MATCH (p:Property {_tenantId: $tenantId, status: $status}) RETURN p',
      params,
    );
    expect(runCalls[0]!.params).toEqual({ tenantId: 'tenant-1', status: 'active' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Neo4jClient.writeQuery — same guard rails
// ─────────────────────────────────────────────────────────────────────

describe('Neo4jClient.writeQuery — tenant guard', () => {
  it('accepts a well-scoped MERGE', async () => {
    const client = freshClient();
    await client.writeQuery(
      'MERGE (p:Property {_tenantId: $tenantId, _id: $id}) SET p.name = $name',
      { tenantId: 'tenant-1', id: 'p-1', name: 'Acme' },
    );
    expect(runCalls.length).toBe(1);
    expect(runCalls[0]!.cypher).toContain('$tenantId');
  });

  it('runtime-rejects writes without $tenantId in the Cypher', async () => {
    const client = freshClient();
    await expect(
      client.writeQuery('MATCH (p:Property) DETACH DELETE p', { tenantId: 'tenant-1' }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
    expect(runCalls.length).toBe(0);
  });

  it('runtime-rejects writes with empty tenantId param', async () => {
    const client = freshClient();
    await expect(
      client.writeQuery(
        'MERGE (p:Property {_tenantId: $tenantId, _id: $id})',
        { tenantId: '   ', id: 'p-1' },
      ),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Neo4jClient.runSchemaQuery — admin bypass
// ─────────────────────────────────────────────────────────────────────

describe('Neo4jClient.runSchemaQuery — schema bypass', () => {
  it('allows CREATE CONSTRAINT without tenantId', async () => {
    const client = freshClient();
    await client.runSchemaQuery(
      'CREATE CONSTRAINT uniq_property_tenant_id IF NOT EXISTS FOR (n:Property) REQUIRE (n._tenantId, n._id) IS UNIQUE',
    );
    expect(runCalls.length).toBe(1);
    expect(runCalls[0]!.cypher).toContain('CREATE CONSTRAINT');
  });

  it('allows CREATE INDEX without tenantId', async () => {
    const client = freshClient();
    await client.runSchemaQuery(
      'CREATE INDEX idx_unit_tenant IF NOT EXISTS FOR (n:Unit) ON (n._tenantId)',
    );
    expect(runCalls.length).toBe(1);
    expect(runCalls[0]!.cypher).toContain('CREATE INDEX');
  });

  it('does NOT pass params (params arity must stay 1+optional-db)', async () => {
    const client = freshClient();
    await client.runSchemaQuery('SHOW INDEXES');
    expect(runCalls[0]!.params).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyConstraintsAndIndexes — every DDL routes through runSchemaQuery
// ─────────────────────────────────────────────────────────────────────

describe('applyConstraintsAndIndexes — routes through runSchemaQuery', () => {
  it('emits CREATE CONSTRAINT, CREATE INDEX, and CREATE FULLTEXT INDEX cyphers', async () => {
    const client = freshClient();
    const result = await applyConstraintsAndIndexes(client);

    expect(result.constraintsCreated).toBeGreaterThan(0);
    expect(result.indexesCreated).toBeGreaterThan(0);
    expect(result.fulltextIndexesCreated).toBeGreaterThan(0);

    const constraintCalls = runCalls.filter(c => c.cypher.includes('CREATE CONSTRAINT'));
    const indexCalls = runCalls.filter(c => /CREATE INDEX/.test(c.cypher));
    const ftCalls = runCalls.filter(c => /CREATE FULLTEXT INDEX/.test(c.cypher));

    expect(constraintCalls.length).toBe(result.constraintsCreated);
    expect(indexCalls.length).toBe(result.indexesCreated);
    expect(ftCalls.length).toBe(result.fulltextIndexesCreated);
  });

  it('never passes a $tenantId param on any schema DDL', async () => {
    const client = freshClient();
    await applyConstraintsAndIndexes(client);
    for (const call of runCalls) {
      // session.run was invoked with no params object
      expect(call.params).toBeUndefined();
    }
  });

  it('emits a CONSTRAINT that includes the tenant predicate in the schema', async () => {
    const client = freshClient();
    await applyConstraintsAndIndexes(client);
    const propertyConstraint = runCalls.find(
      c => /CREATE CONSTRAINT uniq_property/.test(c.cypher),
    );
    expect(propertyConstraint).toBeDefined();
    expect(propertyConstraint!.cypher).toContain('n._tenantId');
    expect(propertyConstraint!.cypher).toContain('n._id');
  });
});

// ─────────────────────────────────────────────────────────────────────
// GraphSyncEngine — batch operations carry a top-level tenant gate
// ─────────────────────────────────────────────────────────────────────

describe('GraphSyncEngine — batch operations include $tenantId predicate', () => {
  it('batchUpsertNodes emits Cypher with $tenantId AND passes top-level tenantId', async () => {
    const client = freshClient();
    const engine = new GraphSyncEngine(client);
    await engine.batchUpsertNodes('Property', [
      { label: 'Property', id: 'p-1', tenantId: 'tenant-1', properties: { name: 'A' } },
      { label: 'Property', id: 'p-2', tenantId: 'tenant-1', properties: { name: 'B' } },
    ]);
    expect(runCalls.length).toBe(1);
    expect(runCalls[0]!.cypher).toContain('$tenantId');
    expect(runCalls[0]!.cypher).toContain('node.tenantId = $tenantId');
    expect(runCalls[0]!.params).toMatchObject({ tenantId: 'tenant-1' });
  });

  it('batchUpsertNodes refuses heterogeneous tenants', async () => {
    const client = freshClient();
    const engine = new GraphSyncEngine(client);
    await expect(
      engine.batchUpsertNodes('Property', [
        { label: 'Property', id: 'p-1', tenantId: 'tenant-1', properties: {} },
        { label: 'Property', id: 'p-2', tenantId: 'tenant-2', properties: {} },
      ]),
    ).rejects.toThrow(/heterogeneous tenantId/);
    expect(runCalls.length).toBe(0);
  });

  it('batchUpsertRelationships emits Cypher with $tenantId predicate', async () => {
    const client = freshClient();
    const engine = new GraphSyncEngine(client);
    await engine.batchUpsertRelationships('Property', 'Unit', 'HAS_UNIT', [
      {
        fromLabel: 'Property',
        fromId: 'p-1',
        toLabel: 'Unit',
        toId: 'u-1',
        type: 'HAS_UNIT',
        tenantId: 'tenant-1',
      },
    ]);
    expect(runCalls[0]!.cypher).toContain('$tenantId');
    expect(runCalls[0]!.cypher).toContain('rel.tenantId = $tenantId');
    expect(runCalls[0]!.params).toMatchObject({ tenantId: 'tenant-1' });
  });

  it('batchUpsertRelationships refuses heterogeneous tenants', async () => {
    const client = freshClient();
    const engine = new GraphSyncEngine(client);
    await expect(
      engine.batchUpsertRelationships('Property', 'Unit', 'HAS_UNIT', [
        {
          fromLabel: 'Property',
          fromId: 'p-1',
          toLabel: 'Unit',
          toId: 'u-1',
          type: 'HAS_UNIT',
          tenantId: 'tenant-1',
        },
        {
          fromLabel: 'Property',
          fromId: 'p-2',
          toLabel: 'Unit',
          toId: 'u-2',
          type: 'HAS_UNIT',
          tenantId: 'tenant-2',
        },
      ]),
    ).rejects.toThrow(/heterogeneous tenantId/);
    expect(runCalls.length).toBe(0);
  });

  it('upsertNode (single) carries $tenantId in its MERGE clause', async () => {
    const client = freshClient();
    const engine = new GraphSyncEngine(client);
    await engine.upsertNode({
      label: 'Property',
      id: 'p-1',
      tenantId: 'tenant-1',
      properties: { name: 'Acme' },
    });
    expect(runCalls[0]!.cypher).toContain('$tenantId');
    expect(runCalls[0]!.params).toMatchObject({ tenantId: 'tenant-1' });
  });

  it('removeNode carries $tenantId in its MATCH clause', async () => {
    const client = freshClient();
    const engine = new GraphSyncEngine(client);
    await engine.removeNode('Property', 'tenant-1', 'p-1');
    expect(runCalls[0]!.cypher).toContain('$tenantId');
    expect(runCalls[0]!.params).toMatchObject({ tenantId: 'tenant-1' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Barrel re-exports — public surface includes the helper primitives
// ─────────────────────────────────────────────────────────────────────

describe('Barrel re-exports', () => {
  it('re-exports assertCypherReferencesTenantId from the public surface', () => {
    expect(typeof assertCypherReferencesTenantId).toBe('function');
    expect(() => assertCypherReferencesTenantId('MATCH (n) RETURN n')).toThrow(TenantScopeViolation);
  });

  it('re-exports scopeNodePattern from the public surface', () => {
    expect(scopeNodePattern('(p:Property)')).toBe('(p:Property {_tenantId: $tenantId})');
  });

  it('re-exports TenantScopeViolation as a value', () => {
    expect(typeof TenantScopeViolation).toBe('function');
    const err = new TenantScopeViolation('test');
    expect(err.code).toBe('TENANT_SCOPE_VIOLATION');
  });
});
