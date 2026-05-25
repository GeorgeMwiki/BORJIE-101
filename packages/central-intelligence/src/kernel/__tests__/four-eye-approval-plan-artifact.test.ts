/**
 * Four-eye approval gate — plan-artifact emission.
 *
 * Phase D D2 — agency-grade observability uplift.
 *
 * Pinned behaviours:
 *   - propose() with a valid plan persists it on the action
 *   - propose() without a plan synthesizes a minimal default from
 *     summary + stakes (backwards compat with pre-D2 callers)
 *   - propose() emits a `brain.approval.plan_proposed` event with
 *     {actionId, tenantId, toolName, plan, summary, proposedAt}
 *   - explicit malformed plans are rejected with `plan-required`:
 *       · null tier
 *       · empty steps
 *       · non-array risks
 *       · non-string reversalPlan
 *   - event-sink failures are swallowed (best-effort fanout)
 *   - approver UI can read the plan from action.plan
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  type ApprovalEventSink,
  type ApprovalPlan,
} from '../four-eye-approval.js';

const samplePlan = (): ApprovalPlan => ({
  tier: 'high',
  steps: ['Disburse 450,000 KES to owner #88', 'Notify tenant of payout'],
  risks: ['Bank rejection if account dormant'],
  reversalPlan: 'Clawback via reverse-wire if outcome is wrong tenant',
});

const baseArgs = (overrides: Partial<{ plan?: ApprovalPlan | undefined }> = {}) => ({
  proposerUserId: 'u_alice',
  thoughtId: 'th_1',
  summary: 'Disburse owner payout #88',
  toolName: 'owner.payout',
  payload: { ownerId: 'o_88', amount: 450_000 },
  stakes: 'high' as const,
  tenantId: 't_tenant_1',
  ...overrides,
});

describe('approval-gate plan-artifact (Phase D D2)', () => {
  it('persists a provided plan on action.plan', async () => {
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const r = await gate.propose({ ...baseArgs(), plan: samplePlan() });
    expect(r.action.plan).toBeDefined();
    expect(r.action.plan.tier).toBe('high');
    expect(r.action.plan.steps).toHaveLength(2);
    expect(r.action.plan.reversalPlan).toMatch(/clawback/i);
  });

  it('synthesizes a default plan from summary + stakes when omitted', async () => {
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    // Bypass the plan field deliberately — legacy callers.
    const r = await gate.propose(baseArgs());
    expect(r.action.plan).toBeDefined();
    expect(r.action.plan.tier).toBe('high');
    expect(r.action.plan.steps).toHaveLength(1);
    expect(r.action.plan.steps[0]).toContain('Disburse');
    expect(r.action.plan.risks).toEqual([]);
    expect(r.action.plan.reversalPlan).toBe('');
  });

  it('emits brain.approval.plan_proposed event with the full plan', async () => {
    const events: Parameters<ApprovalEventSink['publish']>[0][] = [];
    const sink: ApprovalEventSink = {
      publish(e) {
        events.push(e);
      },
    };
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      eventSink: sink,
    });
    const r = await gate.propose({ ...baseArgs(), plan: samplePlan() });
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.type).toBe('brain.approval.plan_proposed');
    expect(event.actionId).toBe(r.action.id);
    expect(event.tenantId).toBe('t_tenant_1');
    expect(event.toolName).toBe('owner.payout');
    expect(event.plan.steps).toHaveLength(2);
    expect(event.summary).toBe('Disburse owner payout #88');
  });

  it('approver UI can read action.plan from a persisted record', async () => {
    const store = createInMemoryApprovalStore();
    const gate = createApprovalGate({ store });
    const r0 = await gate.propose({ ...baseArgs(), plan: samplePlan() });
    const fresh = await gate.get(r0.action.id);
    expect(fresh?.action.plan.tier).toBe('high');
    expect(fresh?.action.plan.steps[0]).toMatch(/Disburse/);
  });

  it('rejects an explicitly null plan with plan-required', async () => {
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gate.propose({ ...baseArgs(), plan: null as any }),
    ).rejects.toThrow(/plan-required/);
  });

  it('rejects an empty steps array with plan-required', async () => {
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const badPlan = { ...samplePlan(), steps: [] };
    await expect(
      gate.propose({ ...baseArgs(), plan: badPlan }),
    ).rejects.toThrow(/plan-required/);
  });

  it('rejects a non-array risks with plan-required', async () => {
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const badPlan = { ...samplePlan(), risks: 'not-an-array' as unknown as readonly string[] };
    await expect(
      gate.propose({ ...baseArgs(), plan: badPlan }),
    ).rejects.toThrow(/plan-required/);
  });

  it('rejects a missing reversalPlan with plan-required', async () => {
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const badPlan = { ...samplePlan(), reversalPlan: undefined as unknown as string };
    await expect(
      gate.propose({ ...baseArgs(), plan: badPlan }),
    ).rejects.toThrow(/plan-required/);
  });

  it('rejects an invalid tier with plan-required', async () => {
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const badPlan = { ...samplePlan(), tier: 'low' as unknown as 'medium' };
    await expect(
      gate.propose({ ...baseArgs(), plan: badPlan }),
    ).rejects.toThrow(/plan-required/);
  });

  it('swallows event-sink failures (best-effort fanout)', async () => {
    const sink: ApprovalEventSink = {
      publish() {
        throw new Error('redis-down');
      },
    };
    const warnings: { obj: object; msg: string }[] = [];
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      eventSink: sink,
      logger: { warn: (obj, msg) => warnings.push({ obj, msg }) },
    });
    // Propose must still succeed.
    const r = await gate.propose({ ...baseArgs(), plan: samplePlan() });
    expect(r.action.id).toBeDefined();
    // The publish failure should be logged.
    expect(
      warnings.some((w) =>
        w.msg.includes('plan_proposed event publish failed'),
      ),
    ).toBe(true);
  });

  it('event includes proposedAt ISO timestamp matching action.proposedAt', async () => {
    const events: Parameters<ApprovalEventSink['publish']>[0][] = [];
    const sink: ApprovalEventSink = {
      publish(e) {
        events.push(e);
      },
    };
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      eventSink: sink,
    });
    const r = await gate.propose({ ...baseArgs(), plan: samplePlan() });
    expect(events[0].proposedAt).toBe(r.action.proposedAt);
  });
});
