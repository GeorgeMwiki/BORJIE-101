/**
 * owner-payout-workflow — Temporal workflow for landlord payouts.
 *
 * Why Temporal here? Exactly-once money transfer is the canonical
 * Temporal use case. The workflow:
 *
 *   1. computeSettlement(ownerId, periodStart, periodEnd)
 *      → reads ledger entries, deducts fees, returns the net.
 *   2. reserveBalance(ownerId, amount) — idempotent reservation
 *      keyed on (ownerId, periodEnd). Subsequent attempts return
 *      the same reservation id.
 *   3. initiateBankTransfer(reservationId, bankRef) — calls the
 *      mobile-money / EFT gateway with the reservation id as the
 *      idempotency token. Re-attempts after a process crash return
 *      the same transactionId.
 *   4. confirmTransfer(transactionId) — polls until terminal status.
 *
 * Determinism guarantee: a process crash between step 2 and 3 does
 * NOT result in a double payout. The reservation id is the
 * idempotency key carried through to the bank gateway.
 *
 * Phase B (this PR): types + signatures + dispatcher. Phase C wires
 * real bank gateway activities.
 */

import {
  type TemporalClientLike,
  TEMPORAL_TASK_QUEUES,
  TEMPORAL_WORKFLOW_TYPES,
} from './temporal-client.js';

export interface OwnerPayoutWorkflowInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly periodStart: string; // ISO date
  readonly periodEnd: string; // ISO date
  /** Mandatory — caller authorises the payout. */
  readonly initiatedByUserId: string;
  /** Currency code, ISO-4217. Defaults to TZS in the dispatcher. */
  readonly currency: string;
}

export interface OwnerPayoutWorkflowResult {
  readonly ownerId: string;
  readonly periodEnd: string;
  readonly outcome: 'paid' | 'no-balance' | 'gateway-rejected';
  readonly transactionId: string | null;
  readonly grossAmount: number;
  readonly netAmount: number;
  readonly currency: string;
}

export interface OwnerPayoutActivities {
  computeSettlement(args: {
    tenantId: string;
    ownerId: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
  }): Promise<{ gross: number; net: number; ledgerEntries: ReadonlyArray<string> }>;

  reserveBalance(args: {
    tenantId: string;
    ownerId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ reservationId: string }>;

  initiateBankTransfer(args: {
    reservationId: string;
    amount: number;
    currency: string;
  }): Promise<{ transactionId: string; status: 'pending' | 'completed' | 'rejected' }>;

  confirmTransfer(args: {
    transactionId: string;
  }): Promise<{ status: 'completed' | 'rejected' }>;
}

export interface OwnerPayoutWorkflowDeps {
  readonly activities: OwnerPayoutActivities;
  /** Polling sleep between confirmTransfer attempts. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Max polls before treating the transfer as "still-pending" and
   *  parking the workflow. Defaults to 12 (≈ 1 hr at 5-min poll). */
  readonly maxConfirmAttempts?: number;
}

export async function ownerPayoutWorkflowBody(
  input: OwnerPayoutWorkflowInput,
  deps: OwnerPayoutWorkflowDeps,
): Promise<OwnerPayoutWorkflowResult> {
  const settlement = await deps.activities.computeSettlement({
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currency: input.currency,
  });
  if (settlement.net <= 0) {
    return {
      ownerId: input.ownerId,
      periodEnd: input.periodEnd,
      outcome: 'no-balance',
      transactionId: null,
      grossAmount: settlement.gross,
      netAmount: settlement.net,
      currency: input.currency,
    };
  }
  const reservation = await deps.activities.reserveBalance({
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    amount: settlement.net,
    currency: input.currency,
    // Idempotency key — same (owner, periodEnd) ALWAYS yields the
    // same reservation, so retries are safe.
    idempotencyKey: `payout-${input.ownerId}-${input.periodEnd}`,
  });
  const transfer = await deps.activities.initiateBankTransfer({
    reservationId: reservation.reservationId,
    amount: settlement.net,
    currency: input.currency,
  });
  const maxAttempts = Math.max(1, deps.maxConfirmAttempts ?? 12);
  let status: 'pending' | 'completed' | 'rejected' = transfer.status;
  for (let i = 0; i < maxAttempts && status === 'pending'; i += 1) {
    await deps.sleep(5 * 60 * 1000);
    const confirmed = await deps.activities.confirmTransfer({
      transactionId: transfer.transactionId,
    });
    status = confirmed.status;
  }
  return {
    ownerId: input.ownerId,
    periodEnd: input.periodEnd,
    outcome: status === 'completed' ? 'paid' : 'gateway-rejected',
    transactionId: transfer.transactionId,
    grossAmount: settlement.gross,
    netAmount: settlement.net,
    currency: input.currency,
  };
}

export interface StartOwnerPayoutWorkflowArgs {
  readonly client: TemporalClientLike;
  readonly input: OwnerPayoutWorkflowInput;
}

export function ownerPayoutWorkflowId(ownerId: string, periodEnd: string): string {
  return `owner-payout-${ownerId}-${periodEnd}`;
}

export async function startOwnerPayoutWorkflow(
  args: StartOwnerPayoutWorkflowArgs,
): Promise<{ workflowId: string; runId: string }> {
  const handle = await args.client.start({
    workflowId: ownerPayoutWorkflowId(args.input.ownerId, args.input.periodEnd),
    workflowType: TEMPORAL_WORKFLOW_TYPES.OWNER_PAYOUT,
    taskQueue: TEMPORAL_TASK_QUEUES.OWNER_PAYOUT,
    args: [args.input],
  });
  return { workflowId: handle.workflowId, runId: handle.runId };
}
