/**
 * Approval-router tests — the router consumes
 * `tenants.settings.elasticConfig.approvalThresholds` (per P14).
 *
 * Each test passes the thresholds as a literal so the test serves as
 * documentation of how the router interprets them.
 */

import { describe, expect, it } from 'vitest';
import {
  createInMemoryApprovalRouter,
  type WorkflowDefinition,
  type WorkflowRun,
} from '../index.js';

function fakeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return Object.freeze({
    id: 'run',
    tenantId: 't1',
    definitionId: 'new_lease_v1',
    kind: 'new_lease' as WorkflowRun['kind'],
    scope: 'lease',
    scopeRef: 'l1',
    initiatedByUserId: 'worker',
    assignedReviewerUserId: null,
    assignedApproverUserId: null,
    state: 'in_review' as WorkflowRun['state'],
    input: {},
    proposedChange: null,
    reviewDecision: null,
    approvalDecision: null,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    committedAt: null,
    ...overrides,
  });
}

const LEASE_DEF: WorkflowDefinition = Object.freeze({
  id: 'new_lease_v1',
  kind: 'new_lease',
  version: 1,
  name: 'lease',
  description: '',
  requiredCapability: 'lease_draft',
  aiReviewRequired: true,
  humanApprovalRequired: true,
  autoCommitOnApproval: true,
  elasticPolicyKey: 'lease_exception',
});

describe('approval router — definition flags', () => {
  it('humanApprovalRequired=false short-circuits to NONE', async () => {
    const r = createInMemoryApprovalRouter({
      readThresholds: async () => null,
    });
    const decision = await r.route({
      tenantId: 't1',
      run: fakeRun(),
      definition: { ...LEASE_DEF, humanApprovalRequired: false },
    });
    expect(decision.humanApprovalRequired).toBe(false);
    expect(decision.approverRole).toBe('NONE');
  });

  it('elasticPolicyKey=null falls back to assignment / default role', async () => {
    const r = createInMemoryApprovalRouter({
      readThresholds: async () => null,
      defaultApproverRole: 'OPS_LEAD',
    });
    const decision = await r.route({
      tenantId: 't1',
      run: fakeRun({ assignedApproverUserId: 'user-123' }),
      definition: { ...LEASE_DEF, elasticPolicyKey: null },
    });
    expect(decision.approverRole).toBe('OPS_LEAD');
    expect(decision.approverUserId).toBe('user-123');
  });
});

describe('approval router — TRC threshold semantics', () => {
  const TRC_THRESHOLDS = {
    bareland_dg_threshold_tzs: 500_000,
    developed_dg_threshold_tzs: 500_000,
    low_threshold_skip_dg: true,
  };

  it('amount <= 500K + low_threshold_skip_dg=true → ESTATE_MANAGER', async () => {
    const r = createInMemoryApprovalRouter({
      readThresholds: async () => TRC_THRESHOLDS,
    });
    const decision = await r.route({
      tenantId: 't1',
      run: fakeRun({ input: { amountMinor: 400_000, assetType: 'developed' } }),
      definition: LEASE_DEF,
    });
    expect(decision.approverRole).toBe('ESTATE_MANAGER');
    expect(decision.rationale).toContain('below_dg_threshold');
  });

  it('amount > 500K + bareland → DIRECTOR_GENERAL', async () => {
    const r = createInMemoryApprovalRouter({
      readThresholds: async () => TRC_THRESHOLDS,
    });
    const decision = await r.route({
      tenantId: 't1',
      run: fakeRun({
        input: { amountMinor: 800_000, assetType: 'bareland' },
      }),
      definition: LEASE_DEF,
    });
    expect(decision.approverRole).toBe('DIRECTOR_GENERAL');
    expect(decision.rationale).toContain('bareland');
  });

  it('amount > 500K + developed → DIRECTOR_GENERAL', async () => {
    const r = createInMemoryApprovalRouter({
      readThresholds: async () => TRC_THRESHOLDS,
    });
    const decision = await r.route({
      tenantId: 't1',
      run: fakeRun({
        input: { amountMinor: 1_000_000, assetType: 'developed' },
      }),
      definition: LEASE_DEF,
    });
    expect(decision.approverRole).toBe('DIRECTOR_GENERAL');
    expect(decision.rationale).toContain('developed');
  });

  it('no thresholds configured → fallback estate manager', async () => {
    const r = createInMemoryApprovalRouter({
      readThresholds: async () => null,
    });
    const decision = await r.route({
      tenantId: 't1',
      run: fakeRun({ input: { amountMinor: 5_000_000 } }),
      definition: LEASE_DEF,
    });
    expect(decision.approverRole).toBe('ESTATE_MANAGER');
  });
});
