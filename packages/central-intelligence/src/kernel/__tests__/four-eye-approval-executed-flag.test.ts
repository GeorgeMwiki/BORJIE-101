/**
 * Four-eye approval gate — executed-flag one-shot consumption guard.
 *
 * Phase D D2 — security gap closure.
 *
 * Pinned behaviours:
 *   - propose() persists `executed: false`
 *   - markExecuted() on an approved record flips executed → true
 *   - second markExecuted() rejects with `already-executed`
 *   - markExecuted() before approval rejects with `not-approved`
 *   - markExecuted() on an unknown id rejects with `unknown action`
 *   - executed flag persists across DB reads (round-trip via store.get)
 *   - replay attempt is logged via deps.logger.warn
 *   - in-memory store handles legacy records lacking the executed field
 */

import { describe, it, expect } from 'vitest';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  type ApprovalPlan,
} from '../four-eye-approval.js';

const fixedClock = (start: number) => {
  let t = start;
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
};

const samplePlan = (): ApprovalPlan => ({
  tier: 'high',
  steps: ['Evict tenant 42 from unit U-12'],
  risks: ['Tenant counter-files in court within 14 days'],
  reversalPlan: 'Re-bind tenant 42 to unit U-12 via lease-restore tool',
});

const baseArgs = () => ({
  proposerUserId: 'u_alice',
  thoughtId: 'th_1',
  summary: 'Evict tenant 42',
  toolName: 'tenant.evict',
  payload: { tenantId: 't_42', unitId: 'U-12' },
  stakes: 'high' as const,
  plan: samplePlan(),
});

async function approveAction(
  gate: ReturnType<typeof createApprovalGate>,
  actionId: string,
): Promise<void> {
  // The default policy requires 2 approvers from the 'admin' group.
  await gate.sign({
    actionId,
    approverUserId: 'u_bob',
    verdict: 'approve',
  });
  await gate.sign({
    actionId,
    approverUserId: 'u_carol',
    verdict: 'approve',
  });
}

describe('approval-gate executed-flag (Phase D D2)', () => {
  it('propose() persists executed: false on new records', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r = await gate.propose(baseArgs());
    expect(r.executed).toBe(false);
  });

  it('markExecuted() flips executed → true on an approved record', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseArgs());
    await approveAction(gate, r0.action.id);
    const after = await gate.markExecuted(r0.action.id);
    expect(after.executed).toBe(true);
    expect(after.status).toBe('approved');
  });

  it('second markExecuted() rejects with already-executed', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseArgs());
    await approveAction(gate, r0.action.id);
    await gate.markExecuted(r0.action.id);
    await expect(gate.markExecuted(r0.action.id)).rejects.toThrow(
      /already-executed/,
    );
  });

  it('markExecuted() on a pending action rejects with not-approved', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseArgs());
    await expect(gate.markExecuted(r0.action.id)).rejects.toThrow(
      /not-approved/,
    );
  });

  it('markExecuted() on a one-eye action rejects with not-approved', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseArgs());
    await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_bob',
      verdict: 'approve',
    });
    await expect(gate.markExecuted(r0.action.id)).rejects.toThrow(
      /not-approved/,
    );
  });

  it('markExecuted() on an unknown id rejects with unknown action', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    await expect(gate.markExecuted('does-not-exist')).rejects.toThrow(
      /unknown action/,
    );
  });

  it('executed flag persists across store reads (round-trip)', async () => {
    const store = createInMemoryApprovalStore();
    const gate = createApprovalGate({ store });
    const r0 = await gate.propose(baseArgs());
    await approveAction(gate, r0.action.id);
    await gate.markExecuted(r0.action.id);
    // Fresh read via store directly + via gate.get().
    const direct = await store.get(r0.action.id);
    expect(direct?.executed).toBe(true);
    const viaGate = await gate.get(r0.action.id);
    expect(viaGate?.executed).toBe(true);
  });

  it('replay attempt is logged via deps.logger.warn', async () => {
    const warnings: { obj: object; msg: string }[] = [];
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      logger: {
        warn: (obj, msg) => warnings.push({ obj, msg }),
      },
    });
    const r0 = await gate.propose(baseArgs());
    await approveAction(gate, r0.action.id);
    await gate.markExecuted(r0.action.id);
    await expect(gate.markExecuted(r0.action.id)).rejects.toThrow();
    expect(
      warnings.some((w) => w.msg.includes('already-executed replay attempt')),
    ).toBe(true);
  });

  it('handles legacy records lacking executed field via ensureExecutedField', async () => {
    const store = createInMemoryApprovalStore();
    // Construct a record WITHOUT executed (simulating a pre-D2 row).
    const legacyAction = {
      id: 'legacy_1',
      proposerUserId: 'u_alice',
      thoughtId: 'th_1',
      summary: 'legacy',
      toolName: 'tenant.evict',
      payload: {},
      stakes: 'high' as const,
      tenantId: null,
      proposedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      policy: {
        minTotalApprovers: 1,
        roleGroups: [{ name: 'admin', minApprovers: 1 }],
        maxStaleMinutes: 1440,
        recallWindowMinutes: 0,
        reAuthRequired: false,
        reAuthMaxAgeSeconds: 300,
        allowProposerSignature: false,
      },
      plan: samplePlan(),
    };
    // Cast to any to bypass the executed field on legacy rows.
    await store.put({
      action: legacyAction as unknown as any,
      status: 'approved',
      signatures: [
        {
          approverUserId: 'u_bob',
          roleGroup: 'admin',
          verdict: 'approve',
          comment: null,
          signedAt: new Date().toISOString(),
        },
      ],
    } as unknown as any);
    const gate = createApprovalGate({ store });
    const after = await gate.markExecuted('legacy_1');
    expect(after.executed).toBe(true);
  });

  it('markExecuted() on an expired action rejects with not-approved', async () => {
    const clk = fixedClock(1_000_000);
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock: clk.now,
      defaultTtlMs: 60_000,
    });
    const r0 = await gate.propose(baseArgs());
    await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_bob',
      verdict: 'approve',
    });
    // Advance past TTL — action goes from one-eye to expired.
    clk.advance(120_000);
    await expect(gate.markExecuted(r0.action.id)).rejects.toThrow(
      /not-approved/,
    );
  });
});
