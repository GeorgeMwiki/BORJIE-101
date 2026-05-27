/**
 * graph-run-repository tests — verify insert + chain + lookup.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryGraphRunRepository } from '../repositories/graph-run-repository.js';
import { GraphDatabaseError } from '../types.js';
import { GENESIS_HASH } from '@borjie/audit-hash-chain';

describe('createInMemoryGraphRunRepository', () => {
  it('inserts a row, hash-chained against GENESIS for the first row', async () => {
    const repo = createInMemoryGraphRunRepository({
      now: () => new Date('2026-05-27T00:00:00Z'),
    });
    const row = await repo.insert({
      tenantId: 'tnt-1',
      driver: 'neo4j',
      queryCypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: { tenantId: 'tnt-1' },
      latencyMs: 12,
    });
    expect(row.tenantId).toBe('tnt-1');
    expect(row.prevHash).toBe(GENESIS_HASH);
    expect(row.auditHash.length).toBeGreaterThan(0);
    expect(row.auditHash).not.toBe(GENESIS_HASH);
  });

  it('chains hashes across rows in the same tenant', async () => {
    const repo = createInMemoryGraphRunRepository();
    const r1 = await repo.insert({
      tenantId: 'tnt-1',
      driver: 'neo4j',
      queryCypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: { tenantId: 'tnt-1' },
      latencyMs: 10,
    });
    const r2 = await repo.insert({
      tenantId: 'tnt-1',
      driver: 'falkordb',
      queryCypher: 'MATCH (w:Worker {tenantId: $tenantId}) RETURN w',
      params: { tenantId: 'tnt-1' },
      latencyMs: 4,
    });
    expect(r2.prevHash).toBe(r1.auditHash);
  });

  it('keeps chains isolated per tenant', async () => {
    const repo = createInMemoryGraphRunRepository();
    const r1 = await repo.insert({
      tenantId: 'tnt-1',
      driver: 'neo4j',
      queryCypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: { tenantId: 'tnt-1' },
      latencyMs: 10,
    });
    const r2 = await repo.insert({
      tenantId: 'tnt-2',
      driver: 'neo4j',
      queryCypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: { tenantId: 'tnt-2' },
      latencyMs: 10,
    });
    expect(r2.prevHash).toBe(GENESIS_HASH);
    expect(r1.auditHash).not.toBe(r2.auditHash);
  });

  it('findByTenant returns rows newest-first with optional limit', async () => {
    const repo = createInMemoryGraphRunRepository();
    for (let i = 0; i < 3; i += 1) {
      await repo.insert({
        tenantId: 'tnt-1',
        driver: 'neo4j',
        queryCypher: `MATCH (m:Mine {tenantId: $tenantId, n: ${String(i)}}) RETURN m`,
        params: { tenantId: 'tnt-1' },
        latencyMs: i,
      });
    }
    const all = await repo.findByTenant('tnt-1');
    expect(all).toHaveLength(3);
    const top1 = await repo.findByTenant('tnt-1', { limit: 1 });
    expect(top1).toHaveLength(1);
  });

  it('findByAuditHash retrieves the row', async () => {
    const repo = createInMemoryGraphRunRepository();
    const r = await repo.insert({
      tenantId: 'tnt-1',
      driver: 'neo4j',
      queryCypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
      params: { tenantId: 'tnt-1' },
      latencyMs: 1,
    });
    const looked = await repo.findByAuditHash(r.auditHash);
    expect(looked?.id).toBe(r.id);
    expect(await repo.findByAuditHash('non-existent')).toBeNull();
  });

  it('rejects bad inputs', async () => {
    const repo = createInMemoryGraphRunRepository();
    await expect(
      repo.insert({
        tenantId: '',
        driver: 'neo4j',
        queryCypher: 'x',
        params: {},
        latencyMs: 0,
      }),
    ).rejects.toThrow(GraphDatabaseError);
    await expect(
      repo.insert({
        tenantId: 'tnt-1',
        driver: 'neo4j',
        queryCypher: '',
        params: {},
        latencyMs: 0,
      }),
    ).rejects.toThrow(GraphDatabaseError);
    await expect(
      repo.insert({
        tenantId: 'tnt-1',
        driver: 'neo4j',
        queryCypher: 'MATCH (m:Mine {tenantId: $tenantId}) RETURN m',
        params: {},
        latencyMs: -1,
      }),
    ).rejects.toThrow(GraphDatabaseError);
  });
});
