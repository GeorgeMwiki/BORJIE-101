import { describe, it, expect } from 'vitest';
import { createTestHarness } from './test-helpers.js';
import { DEFAULT_THRESHOLDS, defaultApprovalPolicy, nextPendingLevel } from '../index.js';

describe('approval engine — chain resolution', () => {
  it('selects the single-level tier for small amounts', async () => {
    const h = createTestHarness();
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'requisition',
      subjectId: 'req_1',
      amount: 5_000,
      currency: 'USD',
      category: 'all',
    });
    expect(chain.steps).toHaveLength(1);
    expect(chain.steps[0].level).toBe('department');
    expect(chain.status).toBe('in_flight');
  });

  it('selects multi-level chain for high-value spend', async () => {
    const h = createTestHarness();
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'po',
      subjectId: 'po_1',
      amount: 500_000,
      currency: 'USD',
      category: 'all',
    });
    expect(chain.steps.map((s) => s.level)).toEqual(['department', 'finance', 'executive']);
  });

  it('selects board-level for very-large spend', async () => {
    const h = createTestHarness();
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'po',
      subjectId: 'po_huge',
      amount: 2_000_000,
      currency: 'USD',
      category: 'all',
    });
    expect(chain.steps.map((s) => s.level)).toContain('board');
  });

  it('respects a tenant-specific policy when configured', async () => {
    const h = createTestHarness();
    await h.dataPort.upsertApprovalPolicy({
      tenantId: 'tnt-1',
      category: 'all',
      thresholds: [
        {
          minAmount: 0,
          maxAmount: null,
          currency: 'KES',
          requiredLevels: ['department'],
        },
      ],
    });
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'requisition',
      subjectId: 'r',
      amount: 1_000_000,
      currency: 'KES',
      category: 'all',
    });
    expect(chain.steps).toHaveLength(1);
  });

  it('throws when no threshold matches', async () => {
    const h = createTestHarness();
    await expect(
      h.platform.approvalEngine.resolveChain({
        tenantId: 'tnt-1',
        subjectKind: 'po',
        subjectId: 'po',
        amount: 5_000,
        currency: 'EUR', // no matching tier (default thresholds use USD)
        category: 'all',
      }),
    ).rejects.toThrow();
  });
});

describe('approval engine — decisions advance the chain', () => {
  it('flips chain to approved after every level signs off', async () => {
    const h = createTestHarness();
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'po',
      subjectId: 'p1',
      amount: 100_000,
      currency: 'USD',
      category: 'all',
    });
    const step1 = await h.platform.approvalEngine.decide({
      chainId: chain.id,
      level: 'department',
      decision: 'approved',
      assignee: 'u1',
    });
    expect(step1.status).toBe('in_flight');
    expect(nextPendingLevel(step1)).toBe('finance');
    const step2 = await h.platform.approvalEngine.decide({
      chainId: chain.id,
      level: 'finance',
      decision: 'approved',
      assignee: 'u2',
    });
    expect(step2.status).toBe('approved');
    expect(step2.resolvedAt).not.toBeNull();
  });

  it('flips chain to rejected on first rejection', async () => {
    const h = createTestHarness();
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'po',
      subjectId: 'p1',
      amount: 100_000,
      currency: 'USD',
      category: 'all',
    });
    const rej = await h.platform.approvalEngine.decide({
      chainId: chain.id,
      level: 'department',
      decision: 'rejected',
      assignee: 'u1',
    });
    expect(rej.status).toBe('rejected');
  });

  it('blocks out-of-order approvals', async () => {
    const h = createTestHarness();
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'po',
      subjectId: 'p1',
      amount: 100_000,
      currency: 'USD',
      category: 'all',
    });
    await expect(
      h.platform.approvalEngine.decide({
        chainId: chain.id,
        level: 'finance',
        decision: 'approved',
        assignee: 'u2',
      }),
    ).rejects.toThrow(/earlier levels are still pending/);
  });

  it('refuses double decisions on a resolved chain', async () => {
    const h = createTestHarness();
    const chain = await h.platform.approvalEngine.resolveChain({
      tenantId: 'tnt-1',
      subjectKind: 'po',
      subjectId: 'p1',
      amount: 5_000,
      currency: 'USD',
      category: 'all',
    });
    await h.platform.approvalEngine.decide({
      chainId: chain.id,
      level: 'department',
      decision: 'approved',
      assignee: 'u1',
    });
    await expect(
      h.platform.approvalEngine.decide({
        chainId: chain.id,
        level: 'department',
        decision: 'approved',
        assignee: 'u1',
      }),
    ).rejects.toThrow(/already approved/);
  });

  it('throws when chain id is unknown', async () => {
    const h = createTestHarness();
    await expect(
      h.platform.approvalEngine.decide({
        chainId: 'apc_unknown' as never,
        level: 'department',
        decision: 'approved',
        assignee: 'u',
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('approval engine — defaults', () => {
  it('default thresholds cover four tiers', () => {
    expect(DEFAULT_THRESHOLDS).toHaveLength(4);
  });

  it('defaultApprovalPolicy returns the wired thresholds', () => {
    const p = defaultApprovalPolicy('tnt-1');
    expect(p.thresholds).toBe(DEFAULT_THRESHOLDS);
  });
});
