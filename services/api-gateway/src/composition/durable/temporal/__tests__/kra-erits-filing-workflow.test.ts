/**
 * Unit tests for kraEritsFilingWorkflowBody — verifies batch / partial /
 * rejected / pending / retry semantics without booting a Temporal
 * server.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  kraEritsFilingWorkflowBody,
  kraEritsFilingWorkflowId,
  startKraEritsFilingWorkflow,
  type KraEritsFilingActivities,
  type KraEritsFilingWorkflowInput,
  KRA_ERITS_TASK_QUEUE,
  KRA_ERITS_WORKFLOW_TYPE,
} from '../kra-erits-filing-workflow.js';
import { createMockTemporalClient } from '../temporal-client.js';

const OWNERS = [
  { ownerId: 'o-1', kraPin: 'A123456789B', rentalAmountCents: 50_000_00, deductibleCents: 5_000_00 },
  { ownerId: 'o-2', kraPin: 'A234567890C', rentalAmountCents: 80_000_00, deductibleCents: 8_000_00 },
];

const BASE_INPUT: KraEritsFilingWorkflowInput = {
  tenantId: 't-alpha',
  period: '2026-04',
  initiatedByUserId: 'admin-user-1',
  owners: OWNERS,
};

function activities(
  overrides: Partial<KraEritsFilingActivities> = {},
): {
  spy: KraEritsFilingActivities;
  archived: Array<{ acceptedOwnerIds: ReadonlyArray<string> }>;
  flagged: Array<{ ownerIds: ReadonlyArray<string> }>;
} {
  const archived: Array<{ acceptedOwnerIds: ReadonlyArray<string> }> = [];
  const flagged: Array<{ ownerIds: ReadonlyArray<string> }> = [];
  const spy: KraEritsFilingActivities = {
    computeBatch: vi.fn(async (args) => ({
      batchXml: `<batch period="${args.period}" count="${args.owners.length}"/>`,
      batchFingerprint: `fp-${args.owners.length}`,
    })),
    submitBatch: vi.fn(async () => ({
      submissionId: 'sub-1',
      status: 'accepted',
    })),
    pollBatchReceipt: vi.fn(async () => ({
      status: 'accepted',
      receiptRef: 'rcpt-1',
      acceptedOwnerIds: OWNERS.map((o) => o.ownerId),
      rejectedOwnerIds: [],
    })),
    archiveBatchReceipt: vi.fn(async (args) => {
      archived.push({ acceptedOwnerIds: args.acceptedOwnerIds });
    }),
    flagOwnersNonCompliant: vi.fn(async (args) => {
      flagged.push({ ownerIds: args.ownerIds });
    }),
    ...overrides,
  };
  return { spy, archived, flagged };
}

describe('kraEritsFilingWorkflowBody', () => {
  it('happy path — full batch accepted on first attempt', async () => {
    const { spy, archived } = activities();
    const result = await kraEritsFilingWorkflowBody(BASE_INPUT, {
      activities: spy,
      sleep: vi.fn(),
    });
    expect(result.outcome).toBe('batch-accepted');
    expect(result.acceptedOwnerIds).toEqual(['o-1', 'o-2']);
    expect(result.rejectedOwnerIds).toEqual([]);
    expect(archived).toHaveLength(1);
    expect(result.retries).toBe(0);
  });

  it('empty owners list short-circuits to accepted', async () => {
    const { spy } = activities();
    const result = await kraEritsFilingWorkflowBody(
      { ...BASE_INPUT, owners: [] },
      { activities: spy, sleep: vi.fn() },
    );
    expect(result.outcome).toBe('batch-accepted');
    expect(spy.computeBatch).not.toHaveBeenCalled();
  });

  it('partial result archives accepted + retries rejected', async () => {
    let call = 0;
    const { spy, archived } = activities({
      submitBatch: vi.fn(async () => ({
        submissionId: `sub-${++call}`,
        status: call === 1 ? 'partial' : 'accepted',
      })),
      pollBatchReceipt: vi.fn(async () => ({
        status: 'pending',
        receiptRef: null,
        acceptedOwnerIds: [],
        rejectedOwnerIds: [],
      })),
    });
    // submitBatch returns final status directly; poll is irrelevant.
    const result = await kraEritsFilingWorkflowBody(BASE_INPUT, {
      activities: {
        ...spy,
        submitBatch: vi.fn(async () => ({
          submissionId: `sub-${++call}`,
          status: call === 1 ? 'partial' : 'accepted',
        })),
        pollBatchReceipt: vi.fn(async () => ({
          status: call === 1 ? 'partial' : 'accepted',
          receiptRef: 'rcpt-x',
          acceptedOwnerIds: call === 1 ? ['o-1'] : ['o-2'],
          rejectedOwnerIds: call === 1 ? ['o-2'] : [],
        })),
      },
      sleep: vi.fn(),
    });
    expect(result.outcome).toBe('batch-accepted');
    expect(result.acceptedOwnerIds).toContain('o-1');
    expect(result.acceptedOwnerIds).toContain('o-2');
    expect(archived.length).toBeGreaterThanOrEqual(1);
  });

  it('all rejected → flagOwnersNonCompliant after retries', async () => {
    const { spy, flagged } = activities({
      submitBatch: vi.fn(async () => ({
        submissionId: 'sub-r',
        status: 'rejected',
      })),
    });
    const result = await kraEritsFilingWorkflowBody(BASE_INPUT, {
      activities: spy,
      sleep: vi.fn(),
      maxRetries: 2,
    });
    expect(result.outcome).toBe('rejected-final');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.ownerIds).toEqual(['o-1', 'o-2']);
    expect(result.retries).toBe(2);
  });

  it('pending forever escalates to manual after maxPolls', async () => {
    const { spy } = activities({
      submitBatch: vi.fn(async () => ({
        submissionId: 'sub-p',
        status: 'pending',
      })),
      pollBatchReceipt: vi.fn(async () => ({
        status: 'pending',
        receiptRef: null,
        acceptedOwnerIds: [],
        rejectedOwnerIds: [],
      })),
    });
    const result = await kraEritsFilingWorkflowBody(BASE_INPUT, {
      activities: spy,
      sleep: vi.fn(),
      maxPollAttempts: 1,
    });
    expect(result.outcome).toBe('manual-escalation');
    expect(result.rejectedOwnerIds).toEqual(['o-1', 'o-2']);
  });

  it('idempotency-key includes retry index so retries de-dupe per attempt', async () => {
    const submitSpy = vi.fn(async () => ({
      submissionId: 'sub-i',
      status: 'rejected' as const,
    }));
    const { spy } = activities({ submitBatch: submitSpy });
    await kraEritsFilingWorkflowBody(BASE_INPUT, {
      activities: spy,
      sleep: vi.fn(),
      maxRetries: 3,
    });
    expect(submitSpy).toHaveBeenCalledTimes(3);
    const keys = submitSpy.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(3); // all unique
  });
});

describe('kraEritsFilingWorkflowId + startKraEritsFilingWorkflow', () => {
  it('workflow id is stable per tenant + period', () => {
    expect(kraEritsFilingWorkflowId('t-alpha', '2026-04')).toBe(
      'kra-erits-t-alpha-2026-04',
    );
  });

  it('startKraEritsFilingWorkflow dispatches to mock client', async () => {
    const client = createMockTemporalClient();
    const { workflowId, runId } = await startKraEritsFilingWorkflow({
      client,
      input: BASE_INPUT,
    });
    expect(workflowId).toBe('kra-erits-t-alpha-2026-04');
    expect(runId).toMatch(/^mock-run-/);
    expect(client.state.starts).toHaveLength(1);
    expect(client.state.starts[0]!.workflowType).toBe(KRA_ERITS_WORKFLOW_TYPE);
    expect(client.state.starts[0]!.taskQueue).toBe(KRA_ERITS_TASK_QUEUE);
  });
});
