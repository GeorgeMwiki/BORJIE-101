/**
 * Tests for PostgresSubleaseRepository + PostgresTenantGroupRepository.
 *
 * Uses an in-memory drizzle fake (predicate-based matcher via vi.mock).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresSubleaseRepository } from './postgres-sublease-repository.js';
import { PostgresTenantGroupRepository } from './postgres-tenant-group-repository.js';
import type { SubleaseRequest } from './sublease-request.js';
import { asSubleaseRequestId } from './sublease-request.js';
import type { TenantGroup, TenantGroupMember } from './tenant-group.js';
import { asTenantGroupId } from './tenant-group.js';
import type {
  TenantId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';
import type { LeaseId, CustomerId } from '../index.js';

type Row = Record<string, unknown>;

vi.mock('drizzle-orm', () => ({
  and: (...parts: any[]) => (row: Row) =>
    parts.every((p) => (p ? p(row) : true)),
  eq: (col: any, val: unknown) => (row: Row) => row[col.name] === val,
  inArray: (col: any, vals: unknown[]) => (row: Row) =>
    vals.includes(row[col.name]),
}));

vi.mock('./sublease.schema.js', () => {
  const col = (name: string) => ({ name });
  return {
    subleaseRequests: {
      id: col('id'),
      tenantId: col('tenantId'),
      parentLeaseId: col('parentLeaseId'),
      status: col('status'),
    },
    tenantGroups: {
      id: col('id'),
      tenantId: col('tenantId'),
      primaryLeaseId: col('primaryLeaseId'),
    },
  };
});

function makeFakeDb() {
  const rows: Row[] = [];
  const toPred = (p: any) => (typeof p === 'function' ? p : () => true);
  return {
    rows,
    select: () => {
      let predicate: (r: Row) => boolean = () => true;
      let limit = Infinity;
      const chain: any = {
        from: () => chain,
        where: (p: any) => ((predicate = toPred(p)), chain),
        limit: (n: number) => ((limit = n), chain),
        then: (resolve: (r: Row[]) => void) =>
          resolve(rows.filter(predicate).slice(0, limit)),
      };
      return chain;
    },
    insert: (_t: unknown) => ({
      values(v: Row) {
        rows.push({ ...v });
      },
    }),
    update: (_t: unknown) => {
      let patch: Row = {};
      const chain: any = {
        set: (p: Row) => ((patch = p), chain),
        where: (p: any) => {
          const pred = toPred(p);
          for (const row of rows) if (pred(row)) Object.assign(row, patch);
          return Promise.resolve();
        },
      };
      return chain;
    },
  };
}

const TENANT = 'tenant_1' as TenantId;
const ACTOR = 'u_1' as UserId;
const LEASE = 'lease_1' as LeaseId;
const CUSTOMER = 'cust_1' as CustomerId;

function makeRequest(id: string, overrides: Partial<SubleaseRequest> = {}): SubleaseRequest {
  const now = new Date().toISOString() as ISOTimestamp;
  return {
    id: asSubleaseRequestId(id),
    tenantId: TENANT,
    parentLeaseId: LEASE,
    requestedBy: CUSTOMER,
    rentResponsibility: 'primary_tenant',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    ...overrides,
  };
}

function makeGroup(id: string, members: TenantGroupMember[] = []): TenantGroup {
  const now = new Date().toISOString() as ISOTimestamp;
  return {
    id: asTenantGroupId(id),
    tenantId: TENANT,
    primaryLeaseId: LEASE,
    members,
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  };
}

describe('PostgresSubleaseRepository', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let repo: PostgresSubleaseRepository;

  beforeEach(() => {
    db = makeFakeDb();
    repo = new PostgresSubleaseRepository(db as any);
  });

  it('create + findById round-trip', async () => {
    const req = makeRequest('r1');
    await repo.create(req);
    const found = await repo.findById(req.id, TENANT);
    expect(found?.id).toBe('r1');
  });

  it('findByLease scopes to tenant + lease', async () => {
    await repo.create(makeRequest('a'));
    await repo.create(makeRequest('b', { parentLeaseId: 'other' as LeaseId }));
    const list = await repo.findByLease(LEASE, TENANT);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('listPending only returns pending rows', async () => {
    await repo.create(makeRequest('p', { status: 'pending' }));
    await repo.create(makeRequest('ap', { status: 'approved' }));
    const pending = await repo.listPending(TENANT);
    expect(pending.map((r) => r.id)).toEqual(['p']);
  });

  it('updateStatus mutates status', async () => {
    const req = makeRequest('u');
    await repo.create(req);
    await repo.updateStatus(req.id, TENANT, 'approved', ACTOR);
    const found = await repo.findById(req.id, TENANT);
    expect(found?.status).toBe('approved');
  });
});

describe('PostgresTenantGroupRepository', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let repo: PostgresTenantGroupRepository;

  beforeEach(() => {
    db = makeFakeDb();
    repo = new PostgresTenantGroupRepository(db as any);
  });

  it('create + findByPrimaryLease', async () => {
    const group = makeGroup('g1', [
      {
        customerId: CUSTOMER,
        role: 'primary',
        addedAt: new Date().toISOString() as ISOTimestamp,
      },
    ]);
    await repo.create(group);
    const found = await repo.findByPrimaryLease(LEASE, TENANT);
    expect(found?.id).toBe('g1');
    expect(found?.members).toHaveLength(1);
  });

  it('addMember appends (never deletes existing)', async () => {
    const group = makeGroup('g2', [
      {
        customerId: CUSTOMER,
        role: 'primary',
        addedAt: new Date().toISOString() as ISOTimestamp,
      },
    ]);
    await repo.create(group);
    const updated = await repo.addMember(
      group.id,
      TENANT,
      {
        customerId: 'cust_2' as CustomerId,
        role: 'subtenant',
        addedAt: new Date().toISOString() as ISOTimestamp,
      },
      ACTOR
    );
    expect(updated?.members).toHaveLength(2);
  });

  it('archiveMember sets archivedAt without deleting', async () => {
    const now = new Date().toISOString() as ISOTimestamp;
    const group = makeGroup('g3', [
      { customerId: CUSTOMER, role: 'primary', addedAt: now },
      { customerId: 'sub_1' as CustomerId, role: 'subtenant', addedAt: now },
    ]);
    await repo.create(group);
    const updated = await repo.archiveMember(
      group.id,
      TENANT,
      'sub_1' as CustomerId,
      'subtenant',
      ACTOR
    );
    expect(updated?.members).toHaveLength(2);
    const archived = updated?.members.find((m) => m.customerId === 'sub_1');
    expect(archived?.archivedAt).toBeDefined();
  });
});
