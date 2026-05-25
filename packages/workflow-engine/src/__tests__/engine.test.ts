/**
 * Engine state-machine tests — covers happy paths + every guarded
 * transition + scope denial.
 */

import { describe, expect, it } from 'vitest';
import { createTestHarness } from './helpers.js';

const T = 'tenant-1';

describe('engine — happy paths', () => {
  it('photo_add: open → in_progress → in_review → auto-approve → committed', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['photo_add'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    expect(run.state).toBe('open');
    const proposed = await h.engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1:photos',
      before: {},
      after: { url: 's3://.../1.jpg', size: 12345 },
    });
    expect(proposed.state).toBe('in_progress');
    expect(proposed.proposedChange?.fieldDiffs).toHaveLength(2);
    const committed = await h.engine.submitForReview({
      runId: run.id,
      actorUserId: 'worker',
    });
    // photo_add has humanApprovalRequired=false + autoCommitOnApproval=true
    expect(committed.state).toBe('committed');
    expect(committed.approvalDecision?.approverRole).toBe('SYSTEM');
  });

  it('parcel_edit: requires human approval after AI approve', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['metadata_edit'],
    });
    await h.grantUser({
      userId: 'approver',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['approve_change'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'parcel_edit_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await h.engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1',
      before: { areaSqm: 100 },
      after: { areaSqm: 110 },
    });
    const reviewing = await h.engine.submitForReview({
      runId: run.id,
      actorUserId: 'worker',
    });
    expect(reviewing.state).toBe('in_approval');
    expect(reviewing.reviewDecision?.verdict).toBe('approve');
    const approved = await h.engine.approve({
      runId: run.id,
      approverUserId: 'approver',
      approverRole: 'ESTATE_MANAGER',
      rationale: 'looks good',
    });
    expect(approved.state).toBe('committed');
  });

  it('AI reject bounces back to in_progress for worker to revise', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['metadata_edit'],
    });
    h.reviewer.queue('request_changes', {
      rationale: 'area changed by >10%',
      redLines: ['recheck survey'],
      coachingHints: ['attach survey doc'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'parcel_edit_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await h.engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1',
      before: { areaSqm: 100 },
      after: { areaSqm: 200 },
    });
    const result = await h.engine.submitForReview({
      runId: run.id,
      actorUserId: 'worker',
    });
    expect(result.state).toBe('in_progress');
    expect(result.reviewDecision?.verdict).toBe('request_changes');
  });
});

describe('engine — scope denials', () => {
  it('denies startRun when worker lacks the required capability', async () => {
    const h = createTestHarness();
    await expect(
      h.engine.startRun({
        tenantId: T,
        definitionId: 'photo_add_v1',
        scope: 'parcel',
        scopeRef: 'p1',
        initiatedByUserId: 'no-grant-user',
      }),
    ).rejects.toThrow(/scope_denied/);
  });

  it('denies approve when approver lacks approve_change capability', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['metadata_edit'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'parcel_edit_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await h.engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1',
      before: {},
      after: { x: 1 },
    });
    await h.engine.submitForReview({
      runId: run.id,
      actorUserId: 'worker',
    });
    await expect(
      h.engine.approve({
        runId: run.id,
        approverUserId: 'random',
        approverRole: 'ESTATE_MANAGER',
        rationale: 'no',
      }),
    ).rejects.toThrow(/scope_denied/);
  });
});

describe('engine — guarded transitions', () => {
  it('refuses proposeChange from a non-initiator', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['photo_add'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await expect(
      h.engine.proposeChange({
        runId: run.id,
        actorUserId: 'other-user',
        targetEntity: 'parcel:p1:photos',
        before: {},
        after: { x: 1 },
      }),
    ).rejects.toThrow(/proposer_must_be_initiator/);
  });

  it('refuses submitForReview without a proposed change', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['photo_add'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await expect(
      h.engine.submitForReview({ runId: run.id, actorUserId: 'worker' }),
    ).rejects.toThrow(/cannot_submit_in_state:open/);
  });

  it('refuses approve when run is not in_approval', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['photo_add'],
    });
    await h.grantUser({
      userId: 'approver',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['approve_change'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await expect(
      h.engine.approve({
        runId: run.id,
        approverUserId: 'approver',
        approverRole: 'ESTATE_MANAGER',
        rationale: 'x',
      }),
    ).rejects.toThrow(/cannot_approve_in_state/);
  });

  it('refuses cancel from non-initiator', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['photo_add'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await expect(
      h.engine.cancel({ runId: run.id, actorUserId: 'other' }),
    ).rejects.toThrow(/only_initiator_can_cancel/);
  });

  it('cancel succeeds for initiator', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['photo_add'],
    });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    const cancelled = await h.engine.cancel({
      runId: run.id,
      actorUserId: 'worker',
      reason: 'mistake',
    });
    expect(cancelled.state).toBe('cancelled');
  });
});

describe('engine — queues', () => {
  it('myQueue lists runs initiated by the user', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1', 'p2'],
      capabilities: ['photo_add'],
    });
    await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await h.engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p2',
      initiatedByUserId: 'worker',
    });
    const q = await h.engine.myQueue(T, 'worker');
    expect(q).toHaveLength(2);
  });

  it('reviewQueue and approvalQueue surface in-flight runs', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['metadata_edit'],
    });
    h.reviewer.queue('request_changes', { rationale: 'incomplete' });
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'parcel_edit_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await h.engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1',
      before: {},
      after: { x: 1 },
    });
    await h.engine.submitForReview({
      runId: run.id,
      actorUserId: 'worker',
    });
    // request_changes bounces to in_progress, not in_review
    const rq = await h.engine.reviewQueue(T);
    expect(rq).toEqual([]);

    // Now happy path → in_approval
    const r2 = await h.engine.startRun({
      tenantId: T,
      definitionId: 'parcel_edit_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    await h.engine.proposeChange({
      runId: r2.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1',
      before: {},
      after: { x: 2 },
    });
    await h.engine.submitForReview({
      runId: r2.id,
      actorUserId: 'worker',
    });
    const aq = await h.engine.approvalQueue(T);
    expect(aq.map((r) => r.id)).toContain(r2.id);
  });
});

describe('engine — coach', () => {
  it('returns the reviewer hint', async () => {
    const h = createTestHarness();
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['metadata_edit'],
    });
    h.reviewer.setCoachHint('use units in metric');
    const run = await h.engine.startRun({
      tenantId: T,
      definitionId: 'parcel_edit_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    const hint = await h.engine.coach({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1',
      before: {},
      after: { areaSqm: 100 },
    });
    expect(hint?.hint).toBe('use units in metric');
  });
});
