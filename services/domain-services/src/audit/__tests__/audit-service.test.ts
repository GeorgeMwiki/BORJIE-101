/**
 * AuditService — log/query/export/retention.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from '../audit-service.js';
import type { AuditRepository } from '../audit-repository.interface.js';
import type {
  AuditEntry,
  AuditQuery,
  PaginatedAuditResult,
  RetentionPolicy,
} from '../types.js';
import { clearAuditContext, setAuditContext } from '../audit-context.js';

function makeRepo(): AuditRepository {
  const policies = new Map<string, RetentionPolicy>();
  return {
    create: vi.fn(async (entry) => ({
      id: 'log_1',
      timestamp: '2026-05-08T00:00:00Z',
      ...entry,
    })) as AuditRepository['create'],
    findMany: vi.fn(async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      hasMore: false,
    })),
    findEntityHistory: vi.fn(async () => []),
    findUserActivity: vi.fn(async () => []),
    search: vi.fn(async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      hasMore: false,
    })),
    getStats: vi.fn(async () => ({
      totalActions: 0,
      actionsByType: {} as never,
      uniqueUsers: 0,
      uniqueEntities: 0,
    })),
    deleteOlderThan: vi.fn(async () => 7),
    getRetentionPolicy: vi.fn(async (tid) => policies.get(tid) ?? null),
    setRetentionPolicy: vi.fn(async (p) => {
      policies.set(p.tenantId, p);
      return p;
    }),
  };
}

beforeEach(() => clearAuditContext());

describe('AuditService.logAudit', () => {
  it('records an entry with action + entity info', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo);

    await svc.logAudit('tnt_a', 'create', 'Lease', 'lease_1', 'usr_1');

    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.tenantId).toBe('tnt_a');
    expect(arg.action).toBe('create');
    expect(arg.entityType).toBe('Lease');
    expect(arg.entityId).toBe('lease_1');
    expect(arg.userId).toBe('usr_1');
    expect(arg.changes).toEqual([]);
    expect(arg.metadata).toEqual({});
  });

  it('falls back to context for userId when not provided', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo);
    setAuditContext({ userId: 'ctx_user', ipAddress: '1.2.3.4' });

    await svc.logAudit('tnt_a', 'login', 'User', null);

    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.userId).toBe('ctx_user');
    expect(arg.ipAddress).toBe('1.2.3.4');
  });

  it('preserves explicit userId over context', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo);
    setAuditContext({ userId: 'ctx' });

    await svc.logAudit('tnt_a', 'update', 'Tenant', 't1', 'explicit');

    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.userId).toBe('explicit');
  });
});

describe('AuditService.exportAuditLog', () => {
  function makeRepoWithEntries(items: AuditEntry[]): AuditRepository {
    const repo = makeRepo();
    repo.findMany = vi.fn(async (q: AuditQuery): Promise<PaginatedAuditResult> => ({
      items,
      total: items.length,
      limit: q.limit,
      offset: q.offset,
      hasMore: false,
    }));
    return repo;
  }

  const sample: AuditEntry = {
    id: 'log_1',
    tenantId: 'tnt_a',
    action: 'create',
    entityType: 'Lease',
    entityId: 'lease_1',
    userId: 'u1',
    userEmail: 'u@x.com',
    ipAddress: '1.2.3.4',
    userAgent: 'agent/1',
    changes: [{ field: 'rent', oldValue: 100, newValue: 200 }],
    timestamp: '2026-05-08T00:00:00Z',
    metadata: { reason: 'renewal' },
  };

  it('exports JSON with items + total + exportedAt', async () => {
    const repo = makeRepoWithEntries([sample]);
    const svc = new AuditService(repo);

    const out = await svc.exportAuditLog('tnt_a', { tenantId: 'tnt_a' }, 'json');
    const parsed = JSON.parse(out);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].id).toBe('log_1');
    expect(parsed.total).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('exports CSV with header row + escaped values', async () => {
    const withQuotes: AuditEntry = {
      ...sample,
      userEmail: 'name "with" quotes@x.com',
    };
    const repo = makeRepoWithEntries([withQuotes]);
    const svc = new AuditService(repo);

    const csv = await svc.exportAuditLog('tnt_a', { tenantId: 'tnt_a' }, 'csv');
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('"id"');
    expect(lines[0]).toContain('"tenantId"');
    expect(lines[0]).toContain('"timestamp"');
    // Quotes inside fields are doubled per CSV standard
    expect(lines[1]).toContain('""with""');
  });

  it('defaults limit to 10000 for export', async () => {
    const repo = makeRepoWithEntries([]);
    const svc = new AuditService(repo);
    await svc.exportAuditLog('tnt_a', { tenantId: 'tnt_a' }, 'json');
    const arg = (repo.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.limit).toBe(10000);
    expect(arg.offset).toBe(0);
  });
});

describe('AuditService.purgeOldRecords', () => {
  it('returns 0 when no retention policy is set', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo);
    const count = await svc.purgeOldRecords('tnt_a');
    expect(count).toBe(0);
  });

  it('deletes records older than retention cutoff', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo);
    await svc.configureRetention('tnt_a', 30);

    const count = await svc.purgeOldRecords('tnt_a');
    expect(count).toBe(7);
    expect(repo.deleteOlderThan).toHaveBeenCalled();
    const cutoff = (repo.deleteOlderThan as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    // Cutoff timestamp should be in the past
    expect(new Date(cutoff).getTime()).toBeLessThan(Date.now());
  });
});

describe('AuditService.configureRetention', () => {
  it('stores retention policy with tenantId + days + updatedAt', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo);
    await svc.configureRetention('tnt_a', 90);

    const arg = (repo.setRetentionPolicy as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as RetentionPolicy;
    expect(arg.tenantId).toBe('tnt_a');
    expect(arg.retentionDays).toBe(90);
    expect(typeof arg.updatedAt).toBe('string');
  });
});
