/**
 * A2b-2 wire #5 — atomic CAS on `markExecuted`.
 *
 * Two concurrent executors firing `markExecuted` on the same approved
 * action MUST see exactly one success + one `already-executed` error.
 * The pre-A2b-2 implementation read-then-wrote (TOCTOU) and let both
 * concurrent callers win.
 */
import { describe, it, expect } from 'vitest';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  type ApprovalRecord,
  type ApprovalStatus,
} from '../four-eye-approval.js';

function makeApprovedRecord(id: string): ApprovalRecord {
  const now = new Date();
  return {
    action: {
      id,
      proposerUserId: 'u_proposer',
      thoughtId: 'th_1',
      summary: 'test action',
      toolName: 'tool.evict_tenant',
      payload: {},
      stakes: 'critical',
      proposedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      tenantId: 't_demo',
      policy: {
        minTotalApprovers: 2,
        roleGroups: [{ name: 'admin', minApprovers: 2 }],
        maxStaleMinutes: 60,
        recallWindowMinutes: 0,
        reAuthRequired: false,
        reAuthMaxAgeSeconds: 300,
        allowProposerSignature: false,
      },
      plan: {
        tier: 'critical',
        steps: ['execute eviction'],
        risks: [],
        reversalPlan: '',
      },
    },
    status: 'approved' as ApprovalStatus,
    signatures: [],
    executed: false,
  };
}

describe('A2b-2 wire #5 — atomic CAS markExecuted', () => {
  it('exactly one of two concurrent markExecuted calls succeeds', async () => {
    const store = createInMemoryApprovalStore();
    const id = 'act-1';
    await store.put(makeApprovedRecord(id));
    const gate = createApprovalGate({ store });

    const r1 = gate.markExecuted(id);
    const r2 = gate.markExecuted(id);
    const settled = await Promise.allSettled([r1, r2]);
    const succeeded = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s) => s.status === 'rejected');
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    const reason = (failed[0] as PromiseRejectedResult).reason;
    expect((reason as Error).message).toMatch(/already-executed/);
  });

  it('once executed, a subsequent markExecuted throws already-executed', async () => {
    const store = createInMemoryApprovalStore();
    const id = 'act-2';
    await store.put(makeApprovedRecord(id));
    const gate = createApprovalGate({ store });
    await gate.markExecuted(id);
    await expect(gate.markExecuted(id)).rejects.toThrow(/already-executed/);
  });
});
