/**
 * Flow-keyed autonomy tests (migration 0308 / `flow_autonomy_prefs`).
 *
 * Proves the per-flow `auto | gated` posture seam:
 *   1. PURE predicate — isFlowAuto resolves AUTO only for confirmed+auto.
 *   2. In-memory repository — creation-time pending confirmation is recorded
 *      idempotently; setPosture confirms + stamps promotion.
 *   3. ENGINE — additive semantics:
 *        a. Engine WITHOUT the seam behaves exactly as before (photo_add
 *           auto-commits).
 *        b. Engine WITH the seam: a flow is GATED by default — the same
 *           photo_add flow now BLOCKS at in_approval, not auto-commit.
 *        c. Once the flow posture is set AUTO (confirmed), the SAME flow
 *           auto-commits without per-run approval.
 *        d. RAIL-GATE ALWAYS WINS: a definition that hard-requires human
 *           approval (parcel_edit) stays GATED even with posture=AUTO —
 *           the seam can only ADD gating, never remove a rail.
 */

import { describe, expect, it } from 'vitest';
import { createTestHarness } from './helpers.js';
import {
  createInMemoryFlowAutonomyRepository,
  isFlowAuto,
  type FlowAutonomyPref,
} from '../index.js';

const T = 'tenant-1';

// ─────────────────────────────────────────────────────────────────────────
// (1) Pure predicate
// ─────────────────────────────────────────────────────────────────────────

describe('isFlowAuto', () => {
  const base: FlowAutonomyPref = {
    tenantId: T,
    flowId: 'f1',
    posture: 'gated',
    confirmationState: 'pending',
    riskCeiling: null,
    amountThreshold: null,
    createdBy: 'u1',
    promotedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  it('GATED default → not auto', () => {
    expect(isFlowAuto(base)).toBe(false);
  });

  it('null pref (no row) → not auto (fail-safe)', () => {
    expect(isFlowAuto(null)).toBe(false);
  });

  it('auto but still pending → not auto', () => {
    expect(isFlowAuto({ ...base, posture: 'auto' })).toBe(false);
  });

  it('auto + confirmed → auto', () => {
    expect(
      isFlowAuto({ ...base, posture: 'auto', confirmationState: 'confirmed' }),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (2) In-memory repository
// ─────────────────────────────────────────────────────────────────────────

describe('in-memory FlowAutonomyRepository', () => {
  it('records a pending GATED row on flow creation', async () => {
    const repo = createInMemoryFlowAutonomyRepository();
    const pref = await repo.recordFlowCreation({
      tenantId: T,
      flowId: 'f1',
      createdBy: 'u1',
    });
    expect(pref.posture).toBe('gated');
    expect(pref.confirmationState).toBe('pending');
    expect(pref.promotedAt).toBeNull();
    const pending = await repo.listPending(T);
    expect(pending).toHaveLength(1);
  });

  it('recordFlowCreation is idempotent — never resets an answered confirmation', async () => {
    const repo = createInMemoryFlowAutonomyRepository();
    await repo.recordFlowCreation({ tenantId: T, flowId: 'f1', createdBy: 'u1' });
    await repo.setPosture({
      tenantId: T,
      flowId: 'f1',
      posture: 'auto',
      actorUserId: 'owner',
    });
    // A second creation (e.g. a later run of the same flow) must NOT
    // reset the confirmed AUTO posture back to pending/gated.
    const after = await repo.recordFlowCreation({
      tenantId: T,
      flowId: 'f1',
      createdBy: 'u2',
    });
    expect(after.posture).toBe('auto');
    expect(after.confirmationState).toBe('confirmed');
    expect(await repo.listPending(T)).toHaveLength(0);
  });

  it('setPosture(auto) confirms + stamps promotedAt; setPosture(gated) clears it', async () => {
    const repo = createInMemoryFlowAutonomyRepository();
    await repo.recordFlowCreation({ tenantId: T, flowId: 'f1', createdBy: 'u1' });
    const auto = await repo.setPosture({
      tenantId: T,
      flowId: 'f1',
      posture: 'auto',
      actorUserId: 'owner',
      riskCeiling: 'mutate',
      amountThreshold: 50_000,
    });
    expect(auto.posture).toBe('auto');
    expect(auto.confirmationState).toBe('confirmed');
    expect(auto.promotedAt).not.toBeNull();
    expect(auto.riskCeiling).toBe('mutate');
    expect(auto.amountThreshold).toBe(50_000);

    const gated = await repo.setPosture({
      tenantId: T,
      flowId: 'f1',
      posture: 'gated',
      actorUserId: 'owner',
    });
    expect(gated.posture).toBe('gated');
    expect(gated.promotedAt).toBeNull();
    // unchanged fields are preserved
    expect(gated.riskCeiling).toBe('mutate');
  });

  it('list / get are tenant-scoped', async () => {
    const repo = createInMemoryFlowAutonomyRepository();
    await repo.recordFlowCreation({ tenantId: T, flowId: 'f1', createdBy: 'u1' });
    await repo.recordFlowCreation({
      tenantId: 'tenant-2',
      flowId: 'f2',
      createdBy: 'u9',
    });
    expect(await repo.list(T)).toHaveLength(1);
    expect(await repo.get(T, 'f2')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (3) Engine integration
// ─────────────────────────────────────────────────────────────────────────

async function drivePhotoAdd(h: ReturnType<typeof createTestHarness>) {
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
  await h.engine.proposeChange({
    runId: run.id,
    actorUserId: 'worker',
    targetEntity: 'parcel:p1:photos',
    before: {},
    after: { url: 's3://.../1.jpg' },
  });
  return h.engine.submitForReview({ runId: run.id, actorUserId: 'worker' });
}

describe('engine — flow-keyed autonomy', () => {
  it('(a) WITHOUT the seam: photo_add auto-commits (unchanged behavior)', async () => {
    const h = createTestHarness();
    expect(h.flowAutonomy).toBeNull();
    const result = await drivePhotoAdd(h);
    expect(result.state).toBe('committed');
  });

  it('(b) WITH the seam: a flow is GATED by default — photo_add blocks at in_approval', async () => {
    const h = createTestHarness({ withFlowAutonomy: true });
    expect(h.flowAutonomy).not.toBeNull();
    const result = await drivePhotoAdd(h);
    // Default GATED → no auto-commit; held for approval.
    expect(result.state).toBe('in_approval');
    // The creation-time pending confirmation was recorded.
    const pending = await h.flowAutonomy!.listPending(T);
    expect(pending.map((p) => p.flowId)).toContain('photo_add_v1');
  });

  it('(c) WITH the seam + posture AUTO: the same flow auto-commits', async () => {
    const h = createTestHarness({ withFlowAutonomy: true });
    await h.flowAutonomy!.setPosture({
      tenantId: T,
      flowId: 'photo_add_v1',
      posture: 'auto',
      actorUserId: 'owner',
    });
    const result = await drivePhotoAdd(h);
    expect(result.state).toBe('committed');
    expect(result.approvalDecision?.approverRole).toBe('SYSTEM');
  });

  it('(d) RAIL-GATE ALWAYS WINS: a hard-approval flow stays GATED even with posture=AUTO', async () => {
    const h = createTestHarness({ withFlowAutonomy: true });
    await h.grantUser({
      userId: 'worker',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['metadata_edit'],
    });
    // Even if the owner sets parcel_edit AUTO, the definition hard-requires
    // human approval — the rail wins; the seam cannot remove it.
    await h.flowAutonomy!.setPosture({
      tenantId: T,
      flowId: 'parcel_edit_v1',
      posture: 'auto',
      actorUserId: 'owner',
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
    expect(reviewing.state).not.toBe('committed');
  });
});
