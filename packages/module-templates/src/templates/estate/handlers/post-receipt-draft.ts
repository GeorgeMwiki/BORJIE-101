/**
 * estate / post_receipt_draft — record a draft receipt against a tenant.
 *
 * Money path goes through LedgerService.post() (via the ledger port). The
 * handler builds a DRAFT (status = 'pending_review') journal entry so a
 * human approves the actual post. Following the BORJIE hard rule:
 *
 *   "Money path goes through LedgerService.post() in services/payments-ledger/.
 *    Direct ledger writes break the immutable double-entry invariant."
 *
 * Triggered by:
 *   - kernel turn  : "Mr Juma paid 200k for his rent" (intent=file_event,
 *                    entity=amount)
 *   - document     : upload of GePG / M-Pesa / Stripe receipt (Piece K)
 *
 * The handler ONLY drafts. A separate accept_proposal handler on the
 * finance/post_receipt action commits it.
 */

import { z } from 'zod';

// ─── Payload schema ───────────────────────────────────────────────────────

export const PostReceiptDraftPayloadSchema = z.object({
  amount: z.object({
    amount: z.number().positive(),
    currency_code: z.enum(['TZS', 'KES', 'UGX', 'NGN', 'USD']),
  }),
  payer: z.object({
    canonical_entity_id: z.string().nullable(),
    full_name: z.string().min(2),
  }),
  /** Which lease / customer the receipt is anchored to. */
  customer_entity_id: z.string().min(1),
  /** Optional lease id for direct settlement. */
  lease_id: z.string().nullable(),
  /** Payment method reference (e.g. GePG ref / mpesa ref / stripe charge id). */
  external_ref: z.string().nullable(),
  /** ISO date of the actual payment. */
  payment_date: z.string(),
  source: z.object({
    capture_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type PostReceiptDraftPayload = z.infer<typeof PostReceiptDraftPayloadSchema>;

export interface PostReceiptDraftResult {
  readonly receipt_id: string;
  readonly ledger_draft_id: string;
  readonly audit_chain_id: string;
  readonly status: 'draft_pending_review';
}

// ─── Ports ────────────────────────────────────────────────────────────────

export interface LedgerDraftPort {
  /**
   * Create a DRAFT entry in the ledger — does NOT commit. The double-entry
   * gets reified only when a manager hits "approve" on the receipt.
   * Returns the draft id.
   */
  draft(args: {
    readonly tenantId: string;
    readonly amount: number;
    readonly currencyCode: string;
    readonly memo: string;
    readonly debitAccount: string;
    readonly creditAccount: string;
    readonly correlation: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface ReceiptStorePort {
  draft(args: {
    readonly tenantId: string;
    readonly customerEntityId: string;
    readonly leaseId: string | null;
    readonly amount: number;
    readonly currencyCode: string;
    readonly paymentDate: string;
    readonly externalRef: string | null;
    readonly ledgerDraftId: string;
  }): Promise<{ readonly id: string }>;
}

export interface AuditChainPort {
  append(args: {
    readonly tenantId: string;
    readonly action: string;
    readonly parentHash: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface PostReceiptDraftDeps {
  readonly ledger: LedgerDraftPort;
  readonly receipts: ReceiptStorePort;
  readonly auditChain: AuditChainPort;
}

export interface PostReceiptDraftContext {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly sourceAuditChainId: string | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function postReceiptDraftHandler(
  payload: PostReceiptDraftPayload,
  ctx: PostReceiptDraftContext,
  deps: PostReceiptDraftDeps,
): Promise<PostReceiptDraftResult> {
  // 1. Validate (defence in depth — orchestrator's executor also validates).
  const parsed = PostReceiptDraftPayloadSchema.parse(payload);

  // 2. Draft the ledger entry through LedgerService.post() (NOT direct write).
  const ledgerDraft = await deps.ledger.draft({
    tenantId: ctx.tenantId,
    amount: parsed.amount.amount,
    currencyCode: parsed.amount.currency_code,
    memo: `Receipt draft — payer ${parsed.payer.full_name}`,
    debitAccount: 'cash_clearing',
    creditAccount: 'tenant_receipts',
    correlation: {
      proposal_id: ctx.proposalId,
      customer_entity_id: parsed.customer_entity_id,
      lease_id: parsed.lease_id,
      external_ref: parsed.external_ref,
    },
  });

  // 3. Persist the receipt row.
  const receipt = await deps.receipts.draft({
    tenantId: ctx.tenantId,
    customerEntityId: parsed.customer_entity_id,
    leaseId: parsed.lease_id,
    amount: parsed.amount.amount,
    currencyCode: parsed.amount.currency_code,
    paymentDate: parsed.payment_date,
    externalRef: parsed.external_ref,
    ledgerDraftId: ledgerDraft.id,
  });

  // 4. Hash-chain into ai_audit_chain.
  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    action: 'estate.post_receipt_draft',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      receipt_id: receipt.id,
      ledger_draft_id: ledgerDraft.id,
      amount: parsed.amount,
      payer_name: parsed.payer.full_name,
      customer_entity_id: parsed.customer_entity_id,
    },
  });

  return Object.freeze({
    receipt_id: receipt.id,
    ledger_draft_id: ledgerDraft.id,
    audit_chain_id: audit.id,
    status: 'draft_pending_review' as const,
  });
}
