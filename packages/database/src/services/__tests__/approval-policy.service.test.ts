/**
 * Approval policy service — unit tests.
 *
 * Mocks the Drizzle DatabaseClient with a small chainable stub that returns
 * pre-staged rows OR throws. We assert:
 *
 *   1. Per-tenant row wins over platform default.
 *   2. Platform default falls through when no per-tenant row exists.
 *   3. Baseline returned when neither row exists.
 *   4. DB error on tenant lookup → baseline (defensive degrade).
 *   5. Empty actionType → baseline (defensive guard).
 *   6. validateRoleGroups via upsert — sum mismatch is rejected.
 *   7. Duplicate role-group name is rejected.
 *   8. roleGroups payload from DB with wrong shape is filtered to []
 *      (defensive: malformed JSONB never breaks the resolver).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createApprovalPolicyService,
  defaultBaseline,
  type ResolvedApprovalPolicy,
} from '../approval-policy.service.js';
import type { DatabaseClient } from '../../client.js';

interface QueuedResponse {
  readonly rows?: ReadonlyArray<unknown>;
  readonly error?: Error;
}

interface StubDb {
  client: DatabaseClient;
  responses: QueuedResponse[];
  insertCalls: ReadonlyArray<unknown>[];
}

function makeStubDb(): StubDb {
  const state: StubDb = {
    client: null as unknown as DatabaseClient,
    responses: [],
    insertCalls: [],
  };

  const makeSelectChain = (): unknown => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        const next = state.responses.shift() ?? { rows: [] };
        if (next.error) {
          if (reject) return reject(next.error);
          throw next.error;
        }
        return resolve(next.rows ?? []);
      },
      catch: () => chain,
      finally: () => chain,
    };
    return chain;
  };

  const makeInsertChain = (values: unknown): unknown => {
    state.insertCalls.push([values]);
    const chain: Record<string, unknown> = {
      values: (v: unknown) => {
        state.insertCalls.push([v]);
        return chain;
      },
      onConflictDoUpdate: () => Promise.resolve(),
      returning: () => Promise.resolve([{ id: 'inserted' }]),
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
    };
    return chain;
  };

  const makeDeleteChain = (): unknown => {
    const chain: Record<string, unknown> = {
      where: () => chain,
      returning: () => Promise.resolve([{ id: 'deleted' }]),
    };
    return chain;
  };

  state.client = {
    select: () => makeSelectChain(),
    insert: () => ({
      values: (v: unknown) => makeInsertChain(v),
    }),
    delete: () => makeDeleteChain(),
  } as unknown as DatabaseClient;

  return state;
}

describe('createApprovalPolicyService.resolve', () => {
  let stub: StubDb;
  let errorSpy = vi.spyOn(console, 'error');

  beforeEach(() => {
    stub = makeStubDb();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns per-tenant row when present (does not query platform default)', async () => {
    stub.responses = [
      {
        rows: [
          {
            tenantId: 't1',
            actionType: 'eviction.propose',
            minTotalApprovers: 3,
            roleGroups: [
              { name: 'compliance', minApprovers: 1 },
              { name: 'ops', minApprovers: 1 },
              { name: 'owner-relations', minApprovers: 1 },
            ],
            maxStaleMinutes: 720,
            recallWindowMinutes: 30,
            reAuthRequired: true,
            reAuthMaxAgeSeconds: 180,
            allowProposerSignature: false,
          },
        ],
      },
    ];
    const svc = createApprovalPolicyService(stub.client);
    const policy = await svc.resolve({ tenantId: 't1', actionType: 'eviction.propose' });
    expect(policy.source).toBe('tenant');
    expect(policy.minTotalApprovers).toBe(3);
    expect(policy.roleGroups).toHaveLength(3);
    expect(policy.maxStaleMinutes).toBe(720);
    expect(policy.recallWindowMinutes).toBe(30);
    expect(policy.reAuthRequired).toBe(true);
  });

  it('falls back to platform default when no per-tenant row exists', async () => {
    stub.responses = [
      { rows: [] }, // tenant lookup miss
      {
        rows: [
          {
            tenantId: null,
            actionType: 'eviction.propose',
            minTotalApprovers: 2,
            roleGroups: [
              { name: 'compliance', minApprovers: 1 },
              { name: 'ops', minApprovers: 1 },
            ],
            maxStaleMinutes: 1440,
            recallWindowMinutes: 0,
            reAuthRequired: false,
            reAuthMaxAgeSeconds: 300,
            allowProposerSignature: false,
          },
        ],
      },
    ];
    const svc = createApprovalPolicyService(stub.client);
    const policy = await svc.resolve({ tenantId: 't1', actionType: 'eviction.propose' });
    expect(policy.source).toBe('platform-default');
    expect(policy.minTotalApprovers).toBe(2);
    expect(policy.roleGroups.map((g) => g.name)).toEqual(['compliance', 'ops']);
  });

  it('falls back to baseline when neither row exists', async () => {
    stub.responses = [{ rows: [] }, { rows: [] }];
    const svc = createApprovalPolicyService(stub.client);
    const policy = await svc.resolve({
      tenantId: 't1',
      actionType: 'owner_payout.disburse',
    });
    expect(policy.source).toBe('baseline');
    expect(policy.minTotalApprovers).toBe(2);
    expect(policy.roleGroups).toEqual([{ name: 'admin', minApprovers: 2 }]);
    expect(policy.allowProposerSignature).toBe(false);
  });

  it('degrades to baseline when tenant lookup throws (DB error)', async () => {
    stub.responses = [{ error: new Error('boom') }];
    const svc = createApprovalPolicyService(stub.client);
    const policy = await svc.resolve({
      tenantId: 't1',
      actionType: 'eviction.propose',
    });
    expect(policy.source).toBe('baseline');
  });

  it('returns baseline for empty actionType (defensive guard)', async () => {
    const svc = createApprovalPolicyService(stub.client);
    const policy = await svc.resolve({ tenantId: 't1', actionType: '' });
    expect(policy.source).toBe('baseline');
    expect(stub.responses).toHaveLength(0); // no DB calls were attempted
  });

  it('filters malformed roleGroups payload to an empty array (defensive)', async () => {
    stub.responses = [
      {
        rows: [
          {
            tenantId: 't1',
            actionType: 'kra.file_mri_return',
            minTotalApprovers: 2,
            roleGroups: 'not-an-array',
            maxStaleMinutes: 1440,
            recallWindowMinutes: 0,
            reAuthRequired: false,
            reAuthMaxAgeSeconds: 300,
            allowProposerSignature: false,
          },
        ],
      },
    ];
    const svc = createApprovalPolicyService(stub.client);
    const policy = await svc.resolve({
      tenantId: 't1',
      actionType: 'kra.file_mri_return',
    });
    expect(policy.roleGroups).toEqual([]);
  });
});

describe('createApprovalPolicyService.upsert validation', () => {
  let stub: StubDb;

  beforeEach(() => {
    stub = makeStubDb();
  });

  it('rejects when sum(roleGroups.minApprovers) !== minTotalApprovers', async () => {
    const svc = createApprovalPolicyService(stub.client);
    await expect(
      svc.upsert({
        tenantId: 't1',
        actionType: 'eviction.propose',
        minTotalApprovers: 3,
        roleGroups: [
          { name: 'compliance', minApprovers: 1 },
          { name: 'ops', minApprovers: 1 },
        ],
      }),
    ).rejects.toThrow(/must equal minTotalApprovers/);
  });

  it('rejects duplicate role-group names', async () => {
    const svc = createApprovalPolicyService(stub.client);
    await expect(
      svc.upsert({
        tenantId: 't1',
        actionType: 'eviction.propose',
        minTotalApprovers: 2,
        roleGroups: [
          { name: 'compliance', minApprovers: 1 },
          { name: 'compliance', minApprovers: 1 },
        ],
      }),
    ).rejects.toThrow(/duplicate roleGroup\.name/);
  });

  it('accepts a valid policy and returns the resolved shape', async () => {
    const svc = createApprovalPolicyService(stub.client);
    const out: ResolvedApprovalPolicy = await svc.upsert({
      tenantId: 't1',
      actionType: 'eviction.propose',
      minTotalApprovers: 2,
      roleGroups: [
        { name: 'property-manager', minApprovers: 1 },
        { name: 'owner-relations', minApprovers: 1 },
      ],
      maxStaleMinutes: 480,
      recallWindowMinutes: 15,
      reAuthRequired: true,
      reAuthMaxAgeSeconds: 120,
      allowProposerSignature: false,
      notes: 'TZ rentals — property-manager + owner-relations quorum',
    });
    expect(out.source).toBe('tenant');
    expect(out.minTotalApprovers).toBe(2);
    expect(out.reAuthRequired).toBe(true);
    expect(out.maxStaleMinutes).toBe(480);
    expect(out.recallWindowMinutes).toBe(15);
  });

  it('rejects an empty roleGroups array', async () => {
    const svc = createApprovalPolicyService(stub.client);
    await expect(
      svc.upsert({
        tenantId: null,
        actionType: 'kra.file_mri_return',
        minTotalApprovers: 1,
        roleGroups: [],
      }),
    ).rejects.toThrow(/non-empty array/);
  });
});

describe('defaultBaseline', () => {
  it('returns 2 admins, 24h TTL, no recall, no re-auth, no proposer signature', () => {
    const b = defaultBaseline('any.action');
    expect(b.minTotalApprovers).toBe(2);
    expect(b.roleGroups).toEqual([{ name: 'admin', minApprovers: 2 }]);
    expect(b.maxStaleMinutes).toBe(1440);
    expect(b.recallWindowMinutes).toBe(0);
    expect(b.reAuthRequired).toBe(false);
    expect(b.allowProposerSignature).toBe(false);
    expect(b.source).toBe('baseline');
  });
});
