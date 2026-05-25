/**
 * temporal workflow scaffold tests — Phase B verifies SIGNATURES +
 * happy-path bodies + dispatcher wiring against a MockTemporalClient.
 * No real Temporal server is needed in CI.
 */
import { describe, it, expect } from 'vitest';
import {
  createMockTemporalClient,
  TEMPORAL_TASK_QUEUES,
  TEMPORAL_WORKFLOW_TYPES,
} from '../temporal-client.js';
import {
  EVICTION_STATUTORY_DAYS,
  evictionWorkflowId,
  startEvictionWorkflow,
  tenantEvictionWorkflowBody,
  type EvictionActivities,
} from '../eviction-workflow.js';
import {
  ownerPayoutWorkflowBody,
  ownerPayoutWorkflowId,
  startOwnerPayoutWorkflow,
  type OwnerPayoutActivities,
} from '../owner-payout-workflow.js';
import {
  kraMriFilingWorkflowBody,
  kraMriFilingWorkflowId,
  startKraMriFilingWorkflow,
  type KraMriFilingActivities,
} from '../kra-mri-filing-workflow.js';

describe('temporal — MockTemporalClient contract', () => {
  it('records start() with workflow type + task queue + args', async () => {
    const client = createMockTemporalClient();
    await client.start({
      workflowId: 'wf-1',
      workflowType: 'TestWorkflow',
      taskQueue: 'test-queue',
      args: [{ foo: 'bar' }],
    });
    expect(client.state.starts).toHaveLength(1);
    expect(client.state.starts[0]?.workflowType).toBe('TestWorkflow');
    expect(client.state.starts[0]?.taskQueue).toBe('test-queue');
  });
});

describe('eviction workflow', () => {
  it('starts the workflow with the canonical id, queue, and type', async () => {
    const client = createMockTemporalClient();
    const handle = await startEvictionWorkflow({
      client,
      input: {
        tenantId: 't1',
        leaseId: 'lse-1',
        breachKind: 'rent-arrears',
        initiatedByUserId: 'u1',
      },
    });
    expect(handle.workflowId).toBe(evictionWorkflowId('lse-1'));
    expect(client.state.starts[0]?.workflowType).toBe(
      TEMPORAL_WORKFLOW_TYPES.EVICTION,
    );
    expect(client.state.starts[0]?.taskQueue).toBe(
      TEMPORAL_TASK_QUEUES.EVICTION,
    );
  });

  it('walks issueNotice → wait → file → hearing → execute on happy path', async () => {
    const calls: string[] = [];
    const activities: EvictionActivities = {
      async issueNotice() {
        calls.push('issueNotice');
        return { noticeId: 'n1', issuedAt: '2026-01-01' };
      },
      async filePossessionClaim() {
        calls.push('filePossessionClaim');
        return { courtRef: 'c1', filedAt: '2026-03-02' };
      },
      async executeWritOfPossession() {
        calls.push('executeWritOfPossession');
        return { writRef: 'w1', outcome: 'executed' };
      },
    };
    const out = await tenantEvictionWorkflowBody(
      {
        tenantId: 't1',
        leaseId: 'lse-1',
        breachKind: 'rent-arrears',
        initiatedByUserId: 'u1',
      },
      {
        activities,
        sleep: async () => undefined,
        awaitHearingDate: async () => ({ hearingDate: '2026-04-05' }),
      },
    );
    expect(calls).toEqual([
      'issueNotice',
      'filePossessionClaim',
      'executeWritOfPossession',
    ]);
    expect(out.outcome).toBe('executed');
    expect(out.courtRef).toBe('c1');
    expect(out.writRef).toBe('w1');
  });

  it('exposes statutory notice periods per breach kind', () => {
    expect(EVICTION_STATUTORY_DAYS['rent-arrears']).toBe(60);
    expect(EVICTION_STATUTORY_DAYS['illegal-sublet']).toBe(30);
  });
});

describe('owner-payout workflow', () => {
  it('returns no-balance when net settlement is non-positive', async () => {
    const activities: OwnerPayoutActivities = {
      async computeSettlement() {
        return { gross: 0, net: 0, ledgerEntries: [] };
      },
      async reserveBalance() {
        throw new Error('should not reserve when balance is zero');
      },
      async initiateBankTransfer() {
        throw new Error('should not initiate');
      },
      async confirmTransfer() {
        throw new Error('should not confirm');
      },
    };
    const result = await ownerPayoutWorkflowBody(
      {
        tenantId: 't1',
        ownerId: 'o1',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        initiatedByUserId: 'u1',
        currency: 'TZS',
      },
      { activities, sleep: async () => undefined },
    );
    expect(result.outcome).toBe('no-balance');
    expect(result.transactionId).toBeNull();
  });

  it('threads the idempotency key into reserveBalance', async () => {
    let observedKey: string | null = null;
    const activities: OwnerPayoutActivities = {
      async computeSettlement() {
        return { gross: 1_000_000, net: 950_000, ledgerEntries: [] };
      },
      async reserveBalance(args) {
        observedKey = args.idempotencyKey;
        return { reservationId: 'r1' };
      },
      async initiateBankTransfer() {
        return { transactionId: 'tx-1', status: 'completed' };
      },
      async confirmTransfer() {
        return { status: 'completed' };
      },
    };
    const result = await ownerPayoutWorkflowBody(
      {
        tenantId: 't1',
        ownerId: 'o1',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        initiatedByUserId: 'u1',
        currency: 'TZS',
      },
      { activities, sleep: async () => undefined },
    );
    expect(observedKey).toBe('payout-o1-2026-04-30');
    expect(result.outcome).toBe('paid');
    expect(result.transactionId).toBe('tx-1');
  });

  it('starts the workflow with the (ownerId, periodEnd) id', async () => {
    const client = createMockTemporalClient();
    const handle = await startOwnerPayoutWorkflow({
      client,
      input: {
        tenantId: 't1',
        ownerId: 'o1',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        initiatedByUserId: 'u1',
        currency: 'TZS',
      },
    });
    expect(handle.workflowId).toBe(ownerPayoutWorkflowId('o1', '2026-04-30'));
    expect(client.state.starts[0]?.taskQueue).toBe(
      TEMPORAL_TASK_QUEUES.OWNER_PAYOUT,
    );
  });
});

describe('kra-mri-filing workflow', () => {
  it('archives the receipt and returns accepted on happy path', async () => {
    const archived: string[] = [];
    const activities: KraMriFilingActivities = {
      async computeMriReturn() {
        return {
          grossRent: 2_000_000,
          deductions: 200_000,
          taxDue: 180_000,
          payload: { tin: 'A12345' },
        };
      },
      async submitToKra() {
        return { submissionId: 'sub-1', status: 'accepted' };
      },
      async pollKraReceipt() {
        return {
          status: 'accepted',
          receiptRef: 'rcpt-1',
          rejectionReason: null,
        };
      },
      async archiveReceipt(args) {
        archived.push(args.receiptRef);
      },
    };
    // Pass receiptRef via poll because immediate-accept skips polling
    // (status was already 'accepted' on submit). We need to test the
    // poll path: switch submit to pending so the poll loop runs.
    const submitPending: KraMriFilingActivities = {
      ...activities,
      async submitToKra() {
        return { submissionId: 'sub-1', status: 'pending' };
      },
    };
    const result = await kraMriFilingWorkflowBody(
      {
        tenantId: 't1',
        period: '2026-04',
        initiatedByUserId: 'u1',
        entityTin: 'A12345',
      },
      {
        activities: submitPending,
        sleep: async () => undefined,
        maxPollAttempts: 4,
      },
    );
    expect(result.outcome).toBe('accepted');
    expect(result.receiptRef).toBe('rcpt-1');
    expect(archived).toEqual(['rcpt-1']);
  });

  it('retries up to maxRetries when KRA rejects', async () => {
    let submitCalls = 0;
    const activities: KraMriFilingActivities = {
      async computeMriReturn() {
        return {
          grossRent: 2_000_000,
          deductions: 200_000,
          taxDue: 180_000,
          payload: {},
        };
      },
      async submitToKra() {
        submitCalls += 1;
        return { submissionId: `sub-${submitCalls}`, status: 'rejected' };
      },
      async pollKraReceipt() {
        return {
          status: 'rejected',
          receiptRef: null,
          rejectionReason: 'bad-payload',
        };
      },
      async archiveReceipt() {
        throw new Error('archive should not be called on rejection');
      },
    };
    const result = await kraMriFilingWorkflowBody(
      {
        tenantId: 't1',
        period: '2026-04',
        initiatedByUserId: 'u1',
        entityTin: 'A12345',
      },
      {
        activities,
        sleep: async () => undefined,
        maxRetries: 2,
      },
    );
    expect(result.outcome).toBe('rejected-final');
    expect(submitCalls).toBe(2);
    expect(result.retries).toBe(2);
  });

  it('starts the workflow with (tenantId, period) id and KRA queue', async () => {
    const client = createMockTemporalClient();
    const handle = await startKraMriFilingWorkflow({
      client,
      input: {
        tenantId: 't1',
        period: '2026-04',
        initiatedByUserId: 'u1',
        entityTin: 'A12345',
      },
    });
    expect(handle.workflowId).toBe(kraMriFilingWorkflowId('t1', '2026-04'));
    expect(client.state.starts[0]?.taskQueue).toBe(
      TEMPORAL_TASK_QUEUES.KRA_MRI_FILING,
    );
    expect(client.state.starts[0]?.workflowType).toBe(
      TEMPORAL_WORKFLOW_TYPES.KRA_MRI_FILING,
    );
  });
});
