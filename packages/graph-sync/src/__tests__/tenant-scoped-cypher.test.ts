/**
 * Tests for the tenant-scoped Cypher helper. Covers:
 *   - runtime rejection of queries that omit $tenantId
 *   - rejection of empty / missing tenantId param
 *   - successful read/write delegation when scoped properly
 *   - cross-tenant-leak negative path (a query that would have leaked
 *     in the original Neo4jClient is refused here)
 *   - scopeNodePattern utility correctness
 */

import { describe, it, expect } from 'vitest';
import {
  assertCypherReferencesTenantId,
  createTenantScopedCypher,
  scopeNodePattern,
  TenantScopeViolation,
  type Neo4jReadClient,
  type Neo4jWriteClient,
} from '../client/tenant-scoped-cypher.js';

function fakeReader(): Neo4jReadClient & {
  calls: Array<{ cypher: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    async readQuery<T>(cypher: string, params?: Record<string, unknown>) {
      calls.push({ cypher, params: params ?? {} });
      return [] as T[];
    },
  };
}

function fakeWriter(): Neo4jWriteClient & {
  calls: Array<{ cypher: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    async writeQuery<T>(cypher: string, params?: Record<string, unknown>) {
      calls.push({ cypher, params: params ?? {} });
      return [] as T[];
    },
  };
}

describe('assertCypherReferencesTenantId', () => {
  it('accepts queries that reference $tenantId', () => {
    expect(() =>
      assertCypherReferencesTenantId(
        'MATCH (p:Property {_tenantId: $tenantId}) RETURN p',
      ),
    ).not.toThrow();
  });

  it('rejects queries that omit $tenantId', () => {
    expect(() =>
      assertCypherReferencesTenantId('MATCH (p:Property) RETURN p'),
    ).toThrow(TenantScopeViolation);
  });

  it('does NOT confuse a literal "tenantId" without $ with the param', () => {
    expect(() =>
      assertCypherReferencesTenantId('MATCH (p {tenantId: "abc"}) RETURN p'),
    ).toThrow(TenantScopeViolation);
  });
});

describe('createTenantScopedCypher — readScoped', () => {
  it('delegates to the underlying reader when query is scoped', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader });
    await client.readScoped<{ id: string }>(
      'MATCH (p:Property {_tenantId: $tenantId}) RETURN p._id AS id',
      { tenantId: 'tenant-1' },
    );
    expect(reader.calls.length).toBe(1);
    expect(reader.calls[0]!.params.tenantId).toBe('tenant-1');
  });

  it('rejects a query without $tenantId reference', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader });
    await expect(
      client.readScoped('MATCH (p:Property) RETURN p', { tenantId: 'tenant-1' }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
    expect(reader.calls.length).toBe(0);
  });

  it('rejects an empty tenantId param', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader });
    await expect(
      client.readScoped(
        'MATCH (p:Property {_tenantId: $tenantId}) RETURN p',
        { tenantId: '' },
      ),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
  });

  it('rejects a whitespace tenantId param', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader });
    await expect(
      client.readScoped(
        'MATCH (p:Property {_tenantId: $tenantId}) RETURN p',
        { tenantId: '   ' },
      ),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
  });

  it('passes extra caller-supplied params through to the reader', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader });
    await client.readScoped(
      'MATCH (p:Property {_tenantId: $tenantId, status: $status}) RETURN p',
      { tenantId: 'tenant-1', status: 'active' },
    );
    expect(reader.calls[0]!.params.status).toBe('active');
  });

  it('strict:false allows tenant-less queries but still requires tenantId param (defence in depth)', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader, strict: false });
    await expect(
      client.readScoped('MATCH (p:Property) RETURN p', { tenantId: 'tenant-1' }),
    ).resolves.toEqual([]);
    await expect(
      client.readScoped('MATCH (p:Property) RETURN p', {
        tenantId: '',
      }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
  });
});

describe('createTenantScopedCypher — writeScoped', () => {
  it('delegates to the underlying writer when query is scoped', async () => {
    const reader = fakeReader();
    const writer = fakeWriter();
    const client = createTenantScopedCypher({ reader, writer });
    await client.writeScoped(
      'MERGE (p:Property {_tenantId: $tenantId, _id: $id}) SET p.name = $name',
      { tenantId: 'tenant-1', id: 'p-1', name: 'Acme Block' },
    );
    expect(writer.calls.length).toBe(1);
  });

  it('rejects when no writer is configured', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader });
    await expect(
      client.writeScoped(
        'MERGE (p:Property {_tenantId: $tenantId})',
        { tenantId: 'tenant-1' },
      ),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
  });

  it('rejects unsafe writes that would cross tenants', async () => {
    const reader = fakeReader();
    const writer = fakeWriter();
    const client = createTenantScopedCypher({ reader, writer });
    await expect(
      client.writeScoped(
        'MATCH (p:Property) DETACH DELETE p',
        { tenantId: 'tenant-1' },
      ),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
    expect(writer.calls.length).toBe(0);
  });
});

describe('Cross-tenant leak prevention (regression for Gap D)', () => {
  it('refuses a query that forgot the tenant gate', async () => {
    const reader = fakeReader();
    const client = createTenantScopedCypher({ reader });
    // This is the EXACT footgun the helper exists to prevent:
    // a future tool author types `MATCH (n) WHERE n.id = $id` and
    // omits the tenant gate. The wrapper must refuse.
    await expect(
      client.readScoped(
        'MATCH (n) WHERE n._id = $id RETURN n',
        { tenantId: 'tenant-1', id: 'leaked' },
      ),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
    expect(reader.calls.length).toBe(0);
  });
});

describe('scopeNodePattern', () => {
  it('adds the tenant gate to a bag-less node pattern', () => {
    expect(scopeNodePattern('(p:Property)')).toBe('(p:Property {_tenantId: $tenantId})');
  });

  it('adds the tenant gate to a node pattern that already has a bag', () => {
    expect(scopeNodePattern('(p:Property {status: "active"})')).toBe(
      '(p:Property {_tenantId: $tenantId, status: "active"})',
    );
  });

  it('leaves an already-scoped pattern alone', () => {
    const already = '(p:Property {_tenantId: $tenantId})';
    expect(scopeNodePattern(already)).toBe(already);
  });

  it('returns non-node patterns unchanged', () => {
    expect(scopeNodePattern('-->')).toBe('-->');
  });
});
