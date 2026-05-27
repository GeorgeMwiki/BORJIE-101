/**
 * tenant-scoped-query tests — verifies wrapping + the assertion guard.
 */
import { describe, expect, it } from 'vitest';
import {
  assertTenantScopedQuery,
  wrapTenantScopedQuery,
} from '../query/tenant-scoped-query.js';
import { GraphDatabaseError, type CypherQuery } from '../types.js';

describe('wrapTenantScopedQuery', () => {
  it('accepts a properly tenant-scoped cypher', () => {
    const q = wrapTenantScopedQuery({
      cypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      tenantId: 'tnt-1',
      params: { lim: 5 },
      readOnly: true,
    });
    expect(q.tenantId).toBe('tnt-1');
    expect(q.params['tenantId']).toBe('tnt-1');
    expect(q.params['lim']).toBe(5);
    expect(q.tenantScoped).toBe(true);
  });

  it('REJECTS cypher missing $tenantId reference', () => {
    expect(() =>
      wrapTenantScopedQuery({
        cypher: 'MATCH (m:Mine) RETURN m',
        tenantId: 'tnt-1',
      }),
    ).toThrow(GraphDatabaseError);
  });

  it('REJECTS node pattern without tenantId predicate or WHERE filter', () => {
    expect(() =>
      wrapTenantScopedQuery({
        // $tenantId appears as a free-floating param reference but no node
        // pattern actually carries the predicate.
        cypher: 'MATCH (m:Mine) WHERE m.id = $tenantId RETURN m',
        tenantId: 'tnt-1',
      }),
    ).toThrow(/tenantId filter/);
  });

  it('accepts node pattern when WHERE var.tenantId = $tenantId clause is present', () => {
    const q = wrapTenantScopedQuery({
      cypher:
        'MATCH (m:Mine) WHERE m.tenantId = $tenantId RETURN m',
      tenantId: 'tnt-1',
    });
    expect(q.cypher).toContain('m.tenantId = $tenantId');
  });

  it('rejects empty tenantId / cypher', () => {
    expect(() =>
      wrapTenantScopedQuery({ cypher: '', tenantId: 'tnt-1' }),
    ).toThrow(GraphDatabaseError);
    expect(() =>
      wrapTenantScopedQuery({
        cypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
        tenantId: '',
      }),
    ).toThrow(GraphDatabaseError);
  });

  it('rejects cypher with no labelled node patterns at all', () => {
    expect(() =>
      wrapTenantScopedQuery({
        cypher: 'RETURN $tenantId',
        tenantId: 'tnt-1',
      }),
    ).toThrow(/no labelled node patterns/);
  });
});

describe('assertTenantScopedQuery', () => {
  it('throws when tenantScoped flag is missing', () => {
    const bad = {
      cypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: { tenantId: 'tnt-1' },
      tenantId: 'tnt-1',
      tenantScoped: false as unknown as true,
      readOnly: true,
    } as CypherQuery;
    expect(() => assertTenantScopedQuery(bad)).toThrow(GraphDatabaseError);
  });

  it('throws when params.tenantId missing', () => {
    const bad: CypherQuery = {
      cypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: {},
      tenantId: 'tnt-1',
      tenantScoped: true,
      readOnly: true,
    };
    expect(() => assertTenantScopedQuery(bad)).toThrow(GraphDatabaseError);
  });

  it('passes a properly scoped query', () => {
    const good: CypherQuery = {
      cypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: { tenantId: 'tnt-1' },
      tenantId: 'tnt-1',
      tenantScoped: true,
      readOnly: true,
    };
    expect(() => assertTenantScopedQuery(good)).not.toThrow();
  });
});
