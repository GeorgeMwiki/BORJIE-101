/**
 * SubleaseService tests — happy path + isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SubleaseService,
  SubleaseError,
  type SubleaseRequestRepository,
  type TenantGroupRepository,
} from './sublease-service.js';
import type {
  SubleaseRequest,
  SubleaseRequestId,
} from './sublease-request.js';
import type { TenantGroup } from './tenant-group.js';
import type { CustomerId, LeaseId } from '../index.js';
import type { TenantId, UserId } from '@borjie/domain-models';

const TENANT = 'tenant_1' as TenantId;
const ACTOR = 'u_actor' as UserId;
const PRIMARY = 'cust_primary' as CustomerId;
const SUBTENANT = 'cust_sub' as CustomerId;
const LEASE = 'lease_1' as LeaseId;

function makeRepos(): {
  requestRepo: SubleaseRequestRepository & { store: Map<string, SubleaseRequest> };
  groupRepo: TenantGroupRepository & { store: Map<string, TenantGroup> };
} {
  const reqStore = new Map<string, SubleaseRequest>();
  const grpStore = new Map<string, TenantGroup>();

  return {
    requestRepo: {
      store: reqStore,
      async findById(id) {
        return reqStore.get(id) ?? null;
      },
      async findByLease(leaseId) {
        return [...reqStore.values()].filter((r) => r.parentLeaseId === leaseId);
      },
      async create(e) {
        reqStore.set(e.id, e);
        return e;
      },
      async update(e) {
        reqStore.set(e.id, e);
        return e;
      },
    },
    groupRepo: {
      store: grpStore,
      async findByPrimaryLease(leaseId) {
        return [...grpStore.values()].find((g) => g.primaryLeaseId === leaseId) ?? null;
      },
      async create(g) {
        grpStore.set(g.id, g);
        return g;
      },
      async update(g) {
        grpStore.set(g.id, g);
        return g;
      },
    },
  };
}

describe('SubleaseService', () => {
  let repos: ReturnType<typeof makeRepos>;
  let service: SubleaseService;

  beforeEach(() => {
    repos = makeRepos();
    service = new SubleaseService(repos.requestRepo, repos.groupRepo);
  });

  it('submit creates a pending request', async () => {
    const res = await service.submit(
      TENANT,
      {
        parentLeaseId: LEASE,
        requestedBy: PRIMARY,
        subtenantCandidateId: SUBTENANT,
        reason: 'Traveling for 6 months',
      },
      ACTOR
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('pending');
    expect(res.data.rentResponsibility).toBe('primary_tenant');
  });

  it('submit rejects missing parentLeaseId', async () => {
    const res = await service.submit(
      TENANT,
      { parentLeaseId: '' as LeaseId, requestedBy: PRIMARY },
      ACTOR
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(SubleaseError.INVALID_INPUT);
  });

  it('approve creates a tenant group with primary + subtenant', async () => {
    const submitted = await service.submit(
      TENANT,
      { parentLeaseId: LEASE, requestedBy: PRIMARY, subtenantCandidateId: SUBTENANT },
      ACTOR
    );
    if (!submitted.success) throw new Error('setup');

    const approved = await service.approve(submitted.data.id, TENANT, {}, ACTOR);
    expect(approved.success).toBe(true);
    if (!approved.success) return;
    expect(approved.data.request.status).toBe('approved');
    expect(approved.data.group.members).toHaveLength(2);
    expect(approved.data.group.members[0].role).toBe('primary');
    expect(approved.data.group.members[1].role).toBe('subtenant');
  });

  it('revoke archives the subtenant member (never deletes)', async () => {
    const submitted = await service.submit(
      TENANT,
      { parentLeaseId: LEASE, requestedBy: PRIMARY, subtenantCandidateId: SUBTENANT },
      ACTOR
    );
    if (!submitted.success) throw new Error('setup');
    const approved = await service.approve(submitted.data.id, TENANT, {}, ACTOR);
    if (!approved.success) throw new Error('setup');

    const revoked = await service.revoke(
      submitted.data.id,
      TENANT,
      { reason: 'Breach of agreement' },
      ACTOR
    );
    expect(revoked.success).toBe(true);
    if (!revoked.success) return;
    expect(revoked.data.status).toBe('revoked');

    const group = await repos.groupRepo.findByPrimaryLease(LEASE, TENANT);
    expect(group).not.toBeNull();
    expect(group!.members).toHaveLength(2);
    const archived = group!.members.find((m) => m.role === 'subtenant');
    expect(archived?.archivedAt).toBeDefined();
  });

  it('revoke requires a reason', async () => {
    const submitted = await service.submit(
      TENANT,
      { parentLeaseId: LEASE, requestedBy: PRIMARY, subtenantCandidateId: SUBTENANT },
      ACTOR
    );
    if (!submitted.success) throw new Error('setup');
    await service.approve(submitted.data.id, TENANT, {}, ACTOR);

    const res = await service.revoke(submitted.data.id, TENANT, { reason: '' }, ACTOR);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(SubleaseError.INVALID_INPUT);
  });

  it('rejects approving a revoked request (illegal transition)', async () => {
    const submitted = await service.submit(
      TENANT,
      { parentLeaseId: LEASE, requestedBy: PRIMARY, subtenantCandidateId: SUBTENANT },
      ACTOR
    );
    if (!submitted.success) throw new Error('setup');
    await service.approve(submitted.data.id, TENANT, {}, ACTOR);
    await service.revoke(submitted.data.id, TENANT, { reason: 'x' }, ACTOR);

    const res = await service.approve(submitted.data.id, TENANT, {}, ACTOR);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(SubleaseError.ILLEGAL_STATUS);
  });

  it('isolation: review on unknown id returns REQUEST_NOT_FOUND', async () => {
    const res = await service.review(
      'subreq_nope' as SubleaseRequestId,
      TENANT,
      {},
      ACTOR
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(SubleaseError.REQUEST_NOT_FOUND);
  });
});
