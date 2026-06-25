/**
 * Offtake-agreement settlement enqueue — the SINGLE producer of the
 * `settlement.requested` outbox event.
 *
 * MONEY-FLOW INVARIANT (CLAUDE.md hard rule): signing an offtake agreement
 * is a document STATE TRANSITION, never a ledger posting. The money leg is
 * driven by a `settlement.requested` row written into the transactional
 * `event_outbox` IN THE SAME TRANSACTION as the `pending_signature → signed`
 * flip; a downstream settlement worker consumes it and routes the actual
 * money through `LedgerService.post()` (the sole money writer).
 *
 * WHY THIS LIVES IN ITS OWN MODULE — two surfaces complete the SAME
 * agreement signature and BOTH must trigger settlement:
 *   - the SELLER signs via  POST /api/v1/mining/bids/offtake-agreements/:id/sign
 *   - the BUYER  signs via  POST /api/v1/mining/buyers/documents/:id/sign
 * Whichever party signs FIRST flips the agreement to `signed` and completes
 * it (there is a single `signed` status — not a dual-party gate), so the
 * settlement must fire on whichever sign lands first. Re-implementing the
 * enqueue per surface would let the two emit divergent payloads or
 * double-enqueue; this module is the ONE place the event shape + the
 * idempotency contract are defined, imported by both handlers.
 *
 * IDEMPOTENCY: `event_outbox` carries NO unique constraint on
 * (aggregate_id, event_type), so dedupe is the CALLER's transition guard:
 * each handler enqueues ONLY on the real `pending_signature → signed`
 * transition (an optimistic compare-and-set on the prior status + an
 * already-signed early-return). The second party's later sign hits the
 * already-signed branch and never re-enqueues — settlement.requested is
 * emitted EXACTLY ONCE per agreement regardless of sign order.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { eventOutbox } from '@borjie/database';

/**
 * The minimal slice of a freshly-signed `offtake_agreements` row the
 * settlement event needs. Immutable — never mutate the passed object.
 */
export interface SignedOfftakeAgreement {
  readonly id: string;
  readonly bidId: string;
  readonly listingId: string;
  readonly buyerId: string;
  readonly buyerTenantId: string | null;
  readonly agreedPriceTzs: string;
  readonly quantityKg: string;
}

export interface EnqueueSettlementParams {
  /** The SELLER tenant (the agreement's RLS isolation key). */
  readonly tenantId: string;
  /** The freshly-signed agreement (the `pending_signature → signed` winner). */
  readonly agreement: SignedOfftakeAgreement;
  /** The authenticated user id that completed the signature. */
  readonly signedBy: string;
  /** Which surface drove the sign — recorded in metadata for audit. */
  readonly source: 'offtake-sign' | 'buyer-document-sign';
  /** Signature timestamp (shared with the status flip for consistency). */
  readonly signedAt: Date;
}

/**
 * Resolve the next per-tenant outbox sequence number (monotonic ordering
 * key). Tolerates both `rows[]`-shaped and array-shaped execute() returns.
 */
async function nextSequenceNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
): Promise<number> {
  const seqRow = await tx.execute(sql`
    SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
      FROM event_outbox
     WHERE tenant_id = ${tenantId}
  `);
  const rows: ReadonlyArray<Record<string, unknown>> = Array.isArray(seqRow)
    ? seqRow
    : ((seqRow as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ?? []);
  return Number(rows[0]?.next_seq ?? 1);
}

/**
 * Write the `settlement.requested` outbox row inside the caller's
 * tenant-bound transaction. The CALLER is responsible for only invoking
 * this on the genuine `pending_signature → signed` transition so the event
 * is emitted exactly once per agreement (see the module-level IDEMPOTENCY
 * note). Returns the assigned sequence number.
 *
 * The payload shape is the wire contract the settlement worker consumes;
 * it is computed HERE and only here so both sign surfaces enqueue an
 * identical event.
 */
export async function enqueueSettlementRequested(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  params: EnqueueSettlementParams,
): Promise<number> {
  const { tenantId, agreement, signedBy, source, signedAt } = params;
  const sequenceNumber = await nextSequenceNumber(tx, tenantId);

  await tx.insert(eventOutbox).values({
    id: randomUUID(),
    tenantId,
    eventType: 'settlement.requested',
    aggregateType: 'offtake_agreement',
    // aggregateId is the agreement id so a retry / replay is dedupable.
    aggregateId: agreement.id,
    payload: {
      offtakeAgreementId: agreement.id,
      bidId: agreement.bidId,
      listingId: agreement.listingId,
      buyerId: agreement.buyerId,
      buyerTenantId: agreement.buyerTenantId ?? null,
      agreedPriceTzs: agreement.agreedPriceTzs,
      quantityKg: agreement.quantityKg,
      tenantId,
      signedBy,
    },
    metadata: { source, signedAt: signedAt.toISOString() },
    sequenceNumber,
    priority: 'high',
    status: 'pending',
    createdAt: signedAt,
  });

  return sequenceNumber;
}
