/**
 * kra-erits-filing-workflow — Temporal workflow for monthly batch KRA
 * eRITS (Electronic Rental Income Tax Submission) filing.
 *
 * Phase D D10 — Third of six East-Africa PropTech moats.
 *
 * eRITS is the Kenyan Revenue Authority's electronic surface for
 * monthly rental income tax returns under the Finance Act 2024
 * (§13(2A)). Each Kenyan property owner with rental income >= KES
 * 288,000/year MUST submit a monthly return — the platform files on
 * their behalf when the owner has opted into the managed-filing
 * service.
 *
 * Why a NEW workflow alongside `kra-mri-filing-workflow`? The TZ MRI
 * (Monthly Rental Income) flow is a SINGLE-ENTITY filing — one tenant,
 * one return, one TIN. The KE eRITS surface is BATCH — the platform
 * aggregates every owner under the platform-managed banner and
 * submits a single multi-record batch per period. The compensating
 * actions on batch rejection are different: eRITS rejects either the
 * WHOLE batch or per-record, so the workflow must support partial
 * retry while preserving accepted records.
 *
 * Workflow steps:
 *
 *   1. computeBatch(period) — aggregate every opted-in Kenyan owner's
 *      rental income for the month, build the eRITS XML batch.
 *   2. submitBatch(xml, idempotencyKey) — POST to KRA eRITS endpoint.
 *   3. WAIT for batch receipt — eRITS confirms within 24h; workflow
 *      polls hourly.
 *   4. partitionResults() — split the receipt into accepted records
 *      and rejected records.
 *   5. archive(accepted) + retry(rejected, attempt+1) — accepted
 *      records hash-chain into the sovereign-action ledger;
 *      rejected records spawn a per-record retry up to maxRetries.
 *   6. Compensation: if a record stays rejected after retries it
 *      escalates to a human operator (the owner's account is flagged
 *      as `eRITS-non-compliant` so the rent-flow can pause future
 *      auto-disbursement until the owner uploads supporting docs).
 *
 * Phase B/C parity: the workflow exposes the same `start / signal /
 * query` surface as the other temporal workflows so the composition
 * root binds it identically. Activities are placeholder — Phase D2
 * real-API integration tasks wire the KRA eRITS gateway.
 */

import {
  type TemporalClientLike,
} from './temporal-client.js';

/** Stable task-queue + workflow-type for KRA eRITS. */
export const KRA_ERITS_TASK_QUEUE = 'borjie-kra-erits-filing';
export const KRA_ERITS_WORKFLOW_TYPE = 'KraEritsFilingWorkflow';

export interface KraEritsOwnerRecord {
  readonly ownerId: string;
  /** Kenyan KRA PIN — 11 chars, starts with A and ends with a digit. */
  readonly kraPin: string;
  /** Rental income for the period, in KES cents. */
  readonly rentalAmountCents: number;
  /** Allowable deductible expenses, in KES cents. */
  readonly deductibleCents: number;
}

export interface KraEritsFilingWorkflowInput {
  readonly tenantId: string;
  /** Filing period — `YYYY-MM`. */
  readonly period: string;
  readonly initiatedByUserId: string;
  readonly owners: ReadonlyArray<KraEritsOwnerRecord>;
}

export interface KraEritsBatchResult {
  readonly tenantId: string;
  readonly period: string;
  readonly outcome: 'batch-accepted' | 'partial' | 'rejected-final' | 'manual-escalation';
  readonly acceptedOwnerIds: ReadonlyArray<string>;
  readonly rejectedOwnerIds: ReadonlyArray<string>;
  readonly batchReceiptRef: string | null;
  readonly retries: number;
}

export interface KraEritsFilingActivities {
  computeBatch(args: {
    tenantId: string;
    period: string;
    owners: ReadonlyArray<KraEritsOwnerRecord>;
  }): Promise<{ batchXml: string; batchFingerprint: string }>;

  submitBatch(args: {
    batchXml: string;
    idempotencyKey: string;
  }): Promise<{ submissionId: string; status: 'pending' | 'accepted' | 'rejected' | 'partial' }>;

  pollBatchReceipt(args: {
    submissionId: string;
  }): Promise<{
    status: 'pending' | 'accepted' | 'rejected' | 'partial';
    receiptRef: string | null;
    acceptedOwnerIds: ReadonlyArray<string>;
    rejectedOwnerIds: ReadonlyArray<string>;
  }>;

  archiveBatchReceipt(args: {
    tenantId: string;
    period: string;
    submissionId: string;
    receiptRef: string;
    acceptedOwnerIds: ReadonlyArray<string>;
  }): Promise<void>;

  flagOwnersNonCompliant(args: {
    tenantId: string;
    period: string;
    ownerIds: ReadonlyArray<string>;
  }): Promise<void>;
}

export interface KraEritsFilingWorkflowDeps {
  readonly activities: KraEritsFilingActivities;
  readonly sleep: (ms: number) => Promise<void>;
  /** Max polls before parking. Default 24 (≈24 hr at 60-min poll). */
  readonly maxPollAttempts?: number;
  /** Max compensation retries on rejection. Default 3. */
  readonly maxRetries?: number;
  /** Poll cadence in ms. Default 60 min. */
  readonly pollIntervalMs?: number;
}

export async function kraEritsFilingWorkflowBody(
  input: KraEritsFilingWorkflowInput,
  deps: KraEritsFilingWorkflowDeps,
): Promise<KraEritsBatchResult> {
  if (input.owners.length === 0) {
    return {
      tenantId: input.tenantId,
      period: input.period,
      outcome: 'batch-accepted',
      acceptedOwnerIds: [],
      rejectedOwnerIds: [],
      batchReceiptRef: null,
      retries: 0,
    };
  }
  const maxRetries = Math.max(1, deps.maxRetries ?? 3);
  const maxPolls = Math.max(1, deps.maxPollAttempts ?? 24);
  const pollInterval = Math.max(60_000, deps.pollIntervalMs ?? 60 * 60 * 1000);
  let retries = 0;
  let remainingOwners: ReadonlyArray<KraEritsOwnerRecord> = input.owners;
  const cumulativeAccepted: string[] = [];

  for (; retries < maxRetries; retries += 1) {
    const batch = await deps.activities.computeBatch({
      tenantId: input.tenantId,
      period: input.period,
      owners: remainingOwners,
    });
    const idempotencyKey = `kra-erits-${input.tenantId}-${input.period}-${retries}-${batch.batchFingerprint}`;
    const submission = await deps.activities.submitBatch({
      batchXml: batch.batchXml,
      idempotencyKey,
    });
    let status = submission.status;
    let receiptRef: string | null = null;
    let acceptedOwnerIds: ReadonlyArray<string> = [];
    let rejectedOwnerIds: ReadonlyArray<string> = [];
    // KRA gateway may return accepted/partial synchronously on submit
    // (small batch / warm connector). In that case we still need to
    // fetch the receipt-ref + per-owner breakdown via pollBatchReceipt.
    // Do NOT poll on rejected (it's terminal and gives no extra info)
    // or pending (handled by the poll-while-pending loop below).
    if (status === 'accepted' || status === 'partial') {
      const poll = await deps.activities.pollBatchReceipt({
        submissionId: submission.submissionId,
      });
      status = poll.status;
      receiptRef = poll.receiptRef;
      acceptedOwnerIds = poll.acceptedOwnerIds;
      rejectedOwnerIds = poll.rejectedOwnerIds;
    }
    for (let i = 0; i < maxPolls && status === 'pending'; i += 1) {
      await deps.sleep(pollInterval);
      const poll = await deps.activities.pollBatchReceipt({
        submissionId: submission.submissionId,
      });
      status = poll.status;
      receiptRef = poll.receiptRef;
      acceptedOwnerIds = poll.acceptedOwnerIds;
      rejectedOwnerIds = poll.rejectedOwnerIds;
    }

    if (status === 'pending') {
      return {
        tenantId: input.tenantId,
        period: input.period,
        outcome: 'manual-escalation',
        acceptedOwnerIds: cumulativeAccepted,
        rejectedOwnerIds: remainingOwners.map((o) => o.ownerId),
        batchReceiptRef: null,
        retries,
      };
    }

    if (status === 'accepted' && receiptRef) {
      const allAccepted = remainingOwners.map((o) => o.ownerId);
      cumulativeAccepted.push(...allAccepted);
      await deps.activities.archiveBatchReceipt({
        tenantId: input.tenantId,
        period: input.period,
        submissionId: submission.submissionId,
        receiptRef,
        acceptedOwnerIds: cumulativeAccepted,
      });
      return {
        tenantId: input.tenantId,
        period: input.period,
        outcome: 'batch-accepted',
        acceptedOwnerIds: cumulativeAccepted,
        rejectedOwnerIds: [],
        batchReceiptRef: receiptRef,
        retries,
      };
    }

    if (status === 'partial' && receiptRef) {
      cumulativeAccepted.push(...acceptedOwnerIds);
      await deps.activities.archiveBatchReceipt({
        tenantId: input.tenantId,
        period: input.period,
        submissionId: submission.submissionId,
        receiptRef,
        acceptedOwnerIds,
      });
      remainingOwners = remainingOwners.filter((o) =>
        rejectedOwnerIds.includes(o.ownerId),
      );
      if (remainingOwners.length === 0) {
        return {
          tenantId: input.tenantId,
          period: input.period,
          outcome: 'batch-accepted',
          acceptedOwnerIds: cumulativeAccepted,
          rejectedOwnerIds: [],
          batchReceiptRef: receiptRef,
          retries,
        };
      }
      // Fall through to retry loop with the rejected subset.
      continue;
    }

    // status === 'rejected' — full retry (no records accepted yet)
  }

  // Exhausted retries — flag owners non-compliant.
  const finalRejected = remainingOwners.map((o) => o.ownerId);
  if (finalRejected.length > 0) {
    await deps.activities.flagOwnersNonCompliant({
      tenantId: input.tenantId,
      period: input.period,
      ownerIds: finalRejected,
    });
  }
  return {
    tenantId: input.tenantId,
    period: input.period,
    outcome: cumulativeAccepted.length > 0 ? 'partial' : 'rejected-final',
    acceptedOwnerIds: cumulativeAccepted,
    rejectedOwnerIds: finalRejected,
    batchReceiptRef: null,
    retries,
  };
}

export interface StartKraEritsFilingWorkflowArgs {
  readonly client: TemporalClientLike;
  readonly input: KraEritsFilingWorkflowInput;
}

export function kraEritsFilingWorkflowId(tenantId: string, period: string): string {
  return `kra-erits-${tenantId}-${period}`;
}

export async function startKraEritsFilingWorkflow(
  args: StartKraEritsFilingWorkflowArgs,
): Promise<{ workflowId: string; runId: string }> {
  const handle = await args.client.start({
    workflowId: kraEritsFilingWorkflowId(
      args.input.tenantId,
      args.input.period,
    ),
    workflowType: KRA_ERITS_WORKFLOW_TYPE,
    taskQueue: KRA_ERITS_TASK_QUEUE,
    args: [args.input],
  });
  return { workflowId: handle.workflowId, runId: handle.runId };
}
