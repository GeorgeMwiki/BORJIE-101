/**
 * kra-mri-filing-workflow — Temporal workflow for KRA Monthly Rental
 * Income (MRI) tax filing.
 *
 * Why Temporal here? The TZ revenue authority (KRA/TRA equivalent for
 * MRI returns) requires a tamper-evident audit chain for every
 * submission. Temporal's workflow history IS that chain: replay any
 * past filing and the entire sequence of decisions reconstructs
 * deterministically.
 *
 * Workflow:
 *
 *   1. computeMriReturn(tenantId, period) — aggregate gross rent,
 *      subtract allowable deductions, compute the 10% MRI tax.
 *   2. submitToKra(payload, idempotencyKey) — POST to KRA endpoint
 *      with a fingerprint key (so retries de-dupe at the gateway).
 *   3. WAIT for KRA receipt — KRA confirms async; the workflow
 *      polls every 30 min until terminal status.
 *   4. archiveReceipt(receiptRef) — writes the KRA receipt to our
 *      sovereign-action-ledger for audit.
 *   5. Compensation: on `rejected`, the workflow can re-attempt
 *      with corrected data (signal-driven) up to 3 times before
 *      escalating to a human operator.
 *
 * Phase B: signatures + body + dispatcher. Phase C wires the real
 * KRA gateway activity.
 */

import {
  type TemporalClientLike,
  TEMPORAL_TASK_QUEUES,
  TEMPORAL_WORKFLOW_TYPES,
} from './temporal-client.js';

export interface KraMriFilingWorkflowInput {
  readonly tenantId: string;
  /** Filing period — `YYYY-MM`. KRA expects monthly submissions. */
  readonly period: string;
  readonly initiatedByUserId: string;
  /** Tax ID for the filing entity (TIN). */
  readonly entityTin: string;
}

export interface KraMriFilingWorkflowResult {
  readonly tenantId: string;
  readonly period: string;
  readonly outcome: 'accepted' | 'rejected-final' | 'manual-escalation';
  readonly receiptRef: string | null;
  readonly grossRent: number;
  readonly taxDue: number;
  readonly retries: number;
}

export interface KraMriFilingActivities {
  computeMriReturn(args: {
    tenantId: string;
    period: string;
    entityTin: string;
  }): Promise<{ grossRent: number; deductions: number; taxDue: number; payload: Record<string, unknown> }>;

  submitToKra(args: {
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ submissionId: string; status: 'pending' | 'accepted' | 'rejected' }>;

  pollKraReceipt(args: {
    submissionId: string;
  }): Promise<{ status: 'pending' | 'accepted' | 'rejected'; receiptRef: string | null; rejectionReason: string | null }>;

  archiveReceipt(args: {
    tenantId: string;
    submissionId: string;
    receiptRef: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface KraMriFilingWorkflowDeps {
  readonly activities: KraMriFilingActivities;
  readonly sleep: (ms: number) => Promise<void>;
  /** Max polls before parking the workflow. Default 48 (≈ 24 hr at
   *  30-min poll). */
  readonly maxPollAttempts?: number;
  /** Max compensation retries on rejection. Default 3. */
  readonly maxRetries?: number;
}

export async function kraMriFilingWorkflowBody(
  input: KraMriFilingWorkflowInput,
  deps: KraMriFilingWorkflowDeps,
): Promise<KraMriFilingWorkflowResult> {
  const maxRetries = Math.max(1, deps.maxRetries ?? 3);
  const maxPolls = Math.max(1, deps.maxPollAttempts ?? 48);
  let retries = 0;
  const calc = await deps.activities.computeMriReturn({
    tenantId: input.tenantId,
    period: input.period,
    entityTin: input.entityTin,
  });

  for (; retries < maxRetries; retries += 1) {
    const idempotencyKey = `kra-mri-${input.tenantId}-${input.period}-${retries}`;
    const submission = await deps.activities.submitToKra({
      payload: calc.payload,
      idempotencyKey,
    });
    let status = submission.status;
    let receiptRef: string | null = null;
    for (let i = 0; i < maxPolls && status === 'pending'; i += 1) {
      await deps.sleep(30 * 60 * 1000);
      const poll = await deps.activities.pollKraReceipt({
        submissionId: submission.submissionId,
      });
      status = poll.status;
      receiptRef = poll.receiptRef;
    }
    if (status === 'accepted' && receiptRef) {
      await deps.activities.archiveReceipt({
        tenantId: input.tenantId,
        submissionId: submission.submissionId,
        receiptRef,
        payload: calc.payload,
      });
      return {
        tenantId: input.tenantId,
        period: input.period,
        outcome: 'accepted',
        receiptRef,
        grossRent: calc.grossRent,
        taxDue: calc.taxDue,
        retries,
      };
    }
    if (status === 'pending') {
      // Exhausted polls — escalate to operator.
      return {
        tenantId: input.tenantId,
        period: input.period,
        outcome: 'manual-escalation',
        receiptRef: null,
        grossRent: calc.grossRent,
        taxDue: calc.taxDue,
        retries,
      };
    }
    // status === 'rejected' — fall through to retry loop
  }
  return {
    tenantId: input.tenantId,
    period: input.period,
    outcome: 'rejected-final',
    receiptRef: null,
    grossRent: calc.grossRent,
    taxDue: calc.taxDue,
    retries,
  };
}

export interface StartKraMriFilingWorkflowArgs {
  readonly client: TemporalClientLike;
  readonly input: KraMriFilingWorkflowInput;
}

export function kraMriFilingWorkflowId(tenantId: string, period: string): string {
  return `kra-mri-${tenantId}-${period}`;
}

export async function startKraMriFilingWorkflow(
  args: StartKraMriFilingWorkflowArgs,
): Promise<{ workflowId: string; runId: string }> {
  const handle = await args.client.start({
    workflowId: kraMriFilingWorkflowId(
      args.input.tenantId,
      args.input.period,
    ),
    workflowType: TEMPORAL_WORKFLOW_TYPES.KRA_MRI_FILING,
    taskQueue: TEMPORAL_TASK_QUEUES.KRA_MRI_FILING,
    args: [args.input],
  });
  return { workflowId: handle.workflowId, runId: handle.runId };
}
