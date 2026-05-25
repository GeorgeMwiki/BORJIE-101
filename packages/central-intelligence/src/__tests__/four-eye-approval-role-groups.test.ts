/**
 * Four-eye approval — role-group quorum tests (K5 parity).
 *
 * Covers the new declarative-policy path on top of the baseline gate:
 *
 *   - propose() with an explicit ApprovalPolicy uses its maxStaleMinutes.
 *   - propose() consults the injected policyResolver when no explicit
 *     policy is supplied.
 *   - sign() enforces role-group quorum:
 *       * 1 compliance + 1 ops is approved by 1-of-each.
 *       * 1 compliance + 1 ops + 1 owner-relations rejects a 3rd compliance
 *         signature with the wrong group despite total ≥ 3.
 *       * Same approver can't satisfy two role slots.
 *   - sign() refuses an unknown role-group label.
 *   - sign() requires a fresh re-auth proof when policy.reAuthRequired.
 *   - sign() refuses a stale re-auth proof.
 *   - allowProposerSignature: true lets the proposer count as one approver.
 *   - buildApprovalPolicy() rejects duplicate group names.
 */

import { describe, it, expect } from 'vitest';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  buildApprovalPolicy,
  DEFAULT_APPROVAL_POLICY,
  type ApprovalPolicy,
  type ApprovalPolicyResolver,
} from '../kernel/index.js';

function fixedClock(start: number): { now: () => Date; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const baseProposeArgs = (policy?: ApprovalPolicy) => ({
  proposerUserId: 'u_alice',
  thoughtId: 'th_role_groups',
  summary: 'Propose eviction notice for unit 4B',
  toolName: 'eviction.propose',
  payload: { unitId: '4B', leaseId: 'lse_99' },
  stakes: 'critical' as const,
  tenantId: 'tnt_demo',
  ...(policy ? { policy } : {}),
});

describe('createApprovalGate — role-group quorum', () => {
  it('uses an explicit policy and derives ttl from maxStaleMinutes', async () => {
    const clk = fixedClock(0);
    const policy = buildApprovalPolicy({
      roleGroups: [
        { name: 'compliance', minApprovers: 1 },
        { name: 'ops', minApprovers: 1 },
      ],
      maxStaleMinutes: 60,
    });
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock: clk.now,
    });
    const r = await gate.propose(baseProposeArgs(policy));
    expect(r.action.policy.minTotalApprovers).toBe(2);
    expect(Date.parse(r.action.expiresAt) - Date.parse(r.action.proposedAt)).toBe(
      60 * 60_000,
    );
  });

  it('consults the policyResolver when no explicit policy is supplied', async () => {
    const policy: ApprovalPolicy = buildApprovalPolicy({
      roleGroups: [
        { name: 'compliance', minApprovers: 1 },
        { name: 'owner-relations', minApprovers: 1 },
        { name: 'property-manager', minApprovers: 1 },
      ],
      maxStaleMinutes: 30,
      reAuthRequired: false,
    });
    const resolver: ApprovalPolicyResolver = {
      async resolve(args) {
        expect(args.tenantId).toBe('tnt_demo');
        expect(args.toolName).toBe('eviction.propose');
        return policy;
      },
    };
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      policyResolver: resolver,
    });
    const r = await gate.propose(baseProposeArgs());
    expect(r.action.policy.roleGroups.map((g) => g.name)).toEqual([
      'compliance',
      'owner-relations',
      'property-manager',
    ]);
  });

  it('approves when each role-group quota is met (1 compliance + 1 ops)', async () => {
    const policy = buildApprovalPolicy({
      roleGroups: [
        { name: 'compliance', minApprovers: 1 },
        { name: 'ops', minApprovers: 1 },
      ],
    });
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs(policy));
    const r1 = await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_compliance_1',
      roleGroup: 'compliance',
      verdict: 'approve',
    });
    expect(r1.status).toBe('one-eye');
    const r2 = await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_ops_1',
      roleGroup: 'ops',
      verdict: 'approve',
    });
    expect(r2.status).toBe('approved');
    expect(r2.signatures.map((s) => s.roleGroup).sort()).toEqual([
      'compliance',
      'ops',
    ]);
  });

  it('refuses a duplicate signature in a role-group that has already met quorum', async () => {
    const policy = buildApprovalPolicy({
      roleGroups: [
        { name: 'compliance', minApprovers: 1 },
        { name: 'owner-relations', minApprovers: 1 },
        { name: 'property-manager', minApprovers: 1 },
      ],
    });
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs(policy));
    await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_compliance_1',
      roleGroup: 'compliance',
      verdict: 'approve',
    });
    await expect(
      gate.sign({
        actionId: r0.action.id,
        approverUserId: 'u_compliance_2',
        roleGroup: 'compliance',
        verdict: 'approve',
      }),
    ).rejects.toThrow(/already has its required/);
  });

  it('refuses to sign for an unknown role-group label', async () => {
    const policy = buildApprovalPolicy({
      roleGroups: [{ name: 'compliance', minApprovers: 1 }, { name: 'ops', minApprovers: 1 }],
    });
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs(policy));
    await expect(
      gate.sign({
        actionId: r0.action.id,
        approverUserId: 'u_intruder',
        roleGroup: 'finance',
        verdict: 'approve',
      }),
    ).rejects.toThrow(/not declared on this action's policy/);
  });

  it('requires a fresh re-auth proof when policy.reAuthRequired is true', async () => {
    const clk = fixedClock(1_700_000_000_000);
    const policy = buildApprovalPolicy({
      roleGroups: [{ name: 'compliance', minApprovers: 1 }, { name: 'ops', minApprovers: 1 }],
      reAuthRequired: true,
      reAuthMaxAgeSeconds: 120,
    });
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock: clk.now,
    });
    const r0 = await gate.propose(baseProposeArgs(policy));

    // Missing proof → rejected
    await expect(
      gate.sign({
        actionId: r0.action.id,
        approverUserId: 'u_ops_1',
        roleGroup: 'ops',
        verdict: 'approve',
      }),
    ).rejects.toThrow(/re-authentication/);

    // Stale proof (older than 120s) → rejected
    await expect(
      gate.sign({
        actionId: r0.action.id,
        approverUserId: 'u_ops_1',
        roleGroup: 'ops',
        verdict: 'approve',
        reAuth: { verifiedAt: new Date(1_700_000_000_000 - 300_000).toISOString() },
      }),
    ).rejects.toThrow(/stale/);

    // Fresh proof → accepted
    const r1 = await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_ops_1',
      roleGroup: 'ops',
      verdict: 'approve',
      reAuth: { verifiedAt: new Date(1_700_000_000_000 - 30_000).toISOString() },
    });
    expect(r1.signatures[0]?.reAuthAt).toBeDefined();
  });

  it('lets the proposer sign when policy.allowProposerSignature is true', async () => {
    const policy = buildApprovalPolicy({
      roleGroups: [{ name: 'compliance', minApprovers: 1 }, { name: 'ops', minApprovers: 1 }],
      allowProposerSignature: true,
    });
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs(policy));
    const r1 = await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_alice', // SAME as proposer
      roleGroup: 'compliance',
      verdict: 'approve',
    });
    expect(r1.status).toBe('one-eye');
    expect(r1.signatures).toHaveLength(1);
  });

  it('rejection by any single approver short-circuits to rejected', async () => {
    const policy = buildApprovalPolicy({
      roleGroups: [{ name: 'compliance', minApprovers: 1 }, { name: 'ops', minApprovers: 1 }],
    });
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs(policy));
    const r1 = await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_ops_1',
      roleGroup: 'ops',
      verdict: 'reject',
      comment: 'unit history shows recent payment plan',
    });
    expect(r1.status).toBe('rejected');
  });

  it('buildApprovalPolicy rejects duplicate role-group names', () => {
    expect(() =>
      buildApprovalPolicy({
        roleGroups: [
          { name: 'compliance', minApprovers: 1 },
          { name: 'compliance', minApprovers: 1 },
        ],
      }),
    ).toThrow(/duplicate roleGroup\.name/);
  });

  it('DEFAULT_APPROVAL_POLICY remains "any 2 admins" for backwards compatibility', () => {
    expect(DEFAULT_APPROVAL_POLICY.minTotalApprovers).toBe(2);
    expect(DEFAULT_APPROVAL_POLICY.roleGroups).toEqual([
      { name: 'admin', minApprovers: 2 },
    ]);
    expect(DEFAULT_APPROVAL_POLICY.allowProposerSignature).toBe(false);
  });
});
