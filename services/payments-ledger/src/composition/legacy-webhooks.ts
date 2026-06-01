/**
 * Legacy Express webhook composition (server.ts) → hardened modules.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `server.ts` historically owned a SECOND, WEAKER copy of the webhook
 * logic: the STK route force-returned `{ ResultCode: 0 }` even when our
 * own processing threw (masking a genuine failure as "Accepted"), used a
 * PROCESS-LOCAL `mpesaDeduplicator` (lost on restart / not shared across
 * replicas → double-credit window), and the B2C-result route was a stub
 * that only logged. The sibling hardened the CLEAN provider modules
 * (`providers/mpesa/webhook-handler.ts`, `providers/stripe/webhook-handler.ts`,
 * `providers/webhook-dedupe-store.ts`) but intentionally left the legacy
 * routes alone. This module is the bridge: the legacy routes DELEGATE here
 * and here delegates to the hardened code, so there is exactly ONE money
 * path and ONE durable idempotency guarantee.
 *
 * HARD RULES honoured (real money):
 *   - Money ONLY via `LedgerService.postJournalEntry` (the STK credit goes
 *     through `handleMpesaWebhook`; the B2C compensating reversal posts a
 *     balanced journal through the same service). The money-path audit
 *     greps for direct ledger writes — none live here.
 *   - Idempotency via the DURABLE `WebhookDedupeStore` (DB-backed,
 *     migration 0163) — survives restart + multi-replica. NOT the legacy
 *     in-memory `mpesaDeduplicator`.
 *   - Fail LOUD: a genuine processing failure NEVER acks `{ResultCode:0}`.
 *     It surfaces a non-success ResultCode + a non-2xx HTTP status and logs
 *     at error level via Pino. A DUPLICATE acks success (already processed).
 *   - Integer minor units; tenant-scoped; Pino logging only.
 *
 * Signature verification + the 5-minute replay window are enforced UPSTREAM
 * by `mpesaSignatureMiddleware` (mounted on `/webhooks/mpesa`) before the
 * route runs, so the STK delegation passes `skipSignatureCheck: true` — the
 * bytes were already authenticated; re-checking with the handler's distinct
 * HMAC contract would double-reject a legitimately-verified callback.
 */

import {
  Money,
  type AccountId,
  type OwnerId,
  type TenantId,
  type CreateJournalEntryRequest,
} from '@borjie/domain-models';
import type { LedgerService } from '../services/ledger.service';
import {
  handleMpesaWebhook,
  type MpesaWebhookHandlerDeps,
  type MpesaWebhookResult,
} from '../providers/mpesa/webhook-handler';
import {
  handleStripeWebhook,
  type StripeWebhookHandlerDeps,
  type StripeWebhookResult,
} from '../providers/stripe/webhook-handler';
import { isMpesaSuccess, mpesaResultReason } from '../providers/mpesa/result-codes';
import type {
  Disbursement,
  DisbursementStatus,
  IDisbursementRepository,
} from '../repositories/disbursement.repository';

/**
 * Pino-shaped logger (the subset these handlers reach for). Matches the
 * `logger.<level>(ctx, msg)` call convention used across server.ts.
 */
export interface WebhookLogger {
  info: (ctx: unknown, msg: string) => void;
  warn: (ctx: unknown, msg: string) => void;
  error: (ctx: unknown, msg: string) => void;
}

/**
 * The Daraja ack body. Safaricom expects this exact shape on EVERY webhook
 * (STK / B2C). `ResultCode: 0` == "we accepted it, stop retrying". Any
 * non-zero value tells Safaricom the delivery was NOT cleanly accepted.
 */
export interface DarajaAck {
  readonly ResultCode: number;
  readonly ResultDesc: string;
}

/**
 * What a legacy webhook route should send back: the HTTP status + the
 * Daraja body. `loud` flags a genuine processing failure the route MUST log
 * at error level (the caller already has the structured context).
 */
export interface LegacyWebhookResponse {
  readonly httpStatus: number;
  readonly body: DarajaAck;
  /** True when this represents a real processing failure (log loud). */
  readonly loud: boolean;
}

const ACK_ACCEPTED: DarajaAck = { ResultCode: 0, ResultDesc: 'Accepted' };

// ===========================================================================
// STK — delegate to handleMpesaWebhook
// ===========================================================================

/**
 * Map a {@link MpesaWebhookResult} to the legacy Daraja HTTP response.
 *
 * ACK (HTTP 200, ResultCode 0) — Safaricom should stop retrying:
 *   - `posted`        → credited exactly once.
 *   - `duplicate`     → already processed (durable dedupe hit). Acking a
 *                       duplicate is CORRECT (the original post stands).
 *   - `failed-payment`→ a CORRECTLY-classified terminal customer failure
 *                       (insufficient funds / wrong PIN / amount mismatch).
 *                       The payment_intent is marked FAILED, NO credit was
 *                       posted; a retry would only re-deliver the same
 *                       failure. This is NOT a processing failure on our
 *                       side, so we ack — but the handler already logged it
 *                       loudly at warn/error.
 *   - `no-tenant`     → the shortcode→tenant map has no entry. A retry can
 *                       never resolve it; ack to stop the retry storm but
 *                       flag LOUD so operators fix the mapping / reconcile.
 *
 * NON-SUCCESS (non-2xx, ResultCode 1) — surface a real failure LOUD:
 *   - `rejected`      → invalid signature / shape / missing amount. Our
 *                       processing could not complete. NEVER mask as
 *                       Accepted; return non-success so the failure is
 *                       visible end-to-end.
 */
function mapMpesaResultToResponse(result: MpesaWebhookResult): LegacyWebhookResponse {
  switch (result.status) {
    case 'posted':
    case 'duplicate':
    case 'failed-payment':
      return { httpStatus: 200, body: ACK_ACCEPTED, loud: false };
    case 'no-tenant':
      // Config gap, not a transient error — ack to stop retries, but loud.
      return {
        httpStatus: 200,
        body: ACK_ACCEPTED,
        loud: true,
      };
    case 'rejected':
      // Genuine processing failure — DO NOT ack ResultCode 0.
      return {
        httpStatus: 400,
        body: { ResultCode: 1, ResultDesc: `Rejected: ${result.reason}` },
        loud: true,
      };
    default: {
      // Exhaustiveness guard — an unmapped status is itself a failure.
      const _never: never = result;
      return {
        httpStatus: 500,
        body: { ResultCode: 1, ResultDesc: 'Unhandled webhook result' },
        loud: true,
      };
    }
  }
}

export interface ProcessLegacyStkDeps {
  readonly handlerDeps: MpesaWebhookHandlerDeps;
  readonly logger: WebhookLogger;
}

/**
 * Process a legacy STK callback by delegating to the hardened
 * {@link handleMpesaWebhook}. Returns the Daraja HTTP response the route
 * should send. A genuine processing failure (`rejected`) or a thrown error
 * surfaces as a NON-success ResultCode + non-2xx — never `{ResultCode:0}`.
 *
 * The raw body is what the signature middleware already authenticated; the
 * handler is told to skip its own signature check (set on `handlerDeps`).
 */
export async function processLegacyStkWebhook(
  rawBody: string,
  headers: { signature?: string; timestamp?: string },
  deps: ProcessLegacyStkDeps,
): Promise<LegacyWebhookResponse> {
  let result: MpesaWebhookResult;
  try {
    result = await handleMpesaWebhook(rawBody, headers, deps.handlerDeps);
  } catch (error) {
    // A throw here is a REAL processing failure (ledger post, dedupe store,
    // resolver). NEVER swallow it into a ResultCode:0 ack — that is exactly
    // the bug we are closing. Surface non-success + log loud; Safaricom will
    // retry (at-least-once) and the durable claim + ledger idempotency key
    // keep the retry safe from double-crediting.
    deps.logger.error(
      { err: error },
      'legacy STK webhook processing FAILED — returning non-success (not masking as Accepted)',
    );
    return {
      httpStatus: 500,
      body: { ResultCode: 1, ResultDesc: 'Processing failed' },
      loud: true,
    };
  }

  const response = mapMpesaResultToResponse(result);
  if (response.loud) {
    deps.logger.error(
      { result },
      'legacy STK webhook did not cleanly process — surfacing non-success / flagged for reconciliation',
    );
  } else {
    deps.logger.info({ status: result.status }, 'legacy STK webhook handled');
  }
  return response;
}

// ===========================================================================
// Stripe — delegate to handleStripeWebhook
// ===========================================================================

/**
 * Map a {@link StripeWebhookResult} to an HTTP response for the legacy
 * `/webhooks/stripe` route. Stripe (unlike Daraja) just wants a 2xx to stop
 * retrying; a non-2xx triggers its at-least-once redelivery. So:
 *   - posted / refunded / duplicate / ignored / no-tenant → 200 `{received}`.
 *   - rejected (bad signature) → 400 so Stripe surfaces the failure.
 * A thrown error → 500 (Stripe will redeliver; the durable claim + ledger
 * idempotency key make the redelivery safe).
 */
export interface LegacyStripeResponse {
  readonly httpStatus: number;
  readonly body: Record<string, unknown>;
  readonly loud: boolean;
}

export interface ProcessLegacyStripeDeps {
  readonly handlerDeps: StripeWebhookHandlerDeps;
  readonly logger: WebhookLogger;
}

export async function processLegacyStripeWebhook(
  rawBody: string,
  signature: string,
  deps: ProcessLegacyStripeDeps,
): Promise<LegacyStripeResponse> {
  let result: StripeWebhookResult;
  try {
    result = await handleStripeWebhook(rawBody, signature, deps.handlerDeps);
  } catch (error) {
    deps.logger.error(
      { err: error },
      'legacy Stripe webhook processing FAILED — returning 500 (Stripe will redeliver, dedupe makes it safe)',
    );
    return {
      httpStatus: 500,
      body: { error: 'processing_failed' },
      loud: true,
    };
  }

  if (result.status === 'rejected') {
    deps.logger.warn({ reason: result.reason }, 'legacy Stripe webhook rejected');
    return {
      httpStatus: 400,
      body: { error: { code: 'WEBHOOK_REJECTED', reason: result.reason } },
      loud: true,
    };
  }

  deps.logger.info({ status: result.status }, 'legacy Stripe webhook handled');
  return {
    httpStatus: 200,
    body: { received: true, status: result.status },
    loud: false,
  };
}

// ===========================================================================
// B2C result — finalize a disbursement (NEEDS_REVERSAL → PAID, or reverse)
// ===========================================================================

/**
 * Parsed, minimal view of the Daraja B2C `Result` envelope. We only need
 * the fields that finalize a disbursement; the rest is ignored.
 */
export interface B2cResultEnvelope {
  readonly resultCode: number;
  readonly resultDesc: string;
  readonly conversationId: string | null;
  readonly originatorConversationId: string | null;
  readonly transactionId: string | null;
}

/**
 * Extract the B2C result fields from the raw request body. Returns null
 * when the envelope is absent/malformed so the route can ack-and-skip
 * (a body with no `Result` is not a processing failure — there is nothing
 * to act on).
 */
export function parseB2cResult(body: unknown): B2cResultEnvelope | null {
  if (!body || typeof body !== 'object') return null;
  const result = (body as { Result?: unknown }).Result;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const resultCode = Number(r.ResultCode);
  if (!Number.isFinite(resultCode)) return null;
  return {
    resultCode,
    resultDesc: typeof r.ResultDesc === 'string' ? r.ResultDesc : '',
    conversationId: asNonEmptyString(r.ConversationID),
    originatorConversationId: asNonEmptyString(r.OriginatorConversationID),
    transactionId: asNonEmptyString(r.TransactionID),
  };
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * The disbursement-id encoded in the OriginatorConversationID. The
 * disbursement service stamps `originatorConversationId: disb-<id>` on the
 * B2C transfer, so the result envelope echoes it back. We strip the prefix
 * to recover the disbursement id for a precise, tenant-scoped lookup.
 */
function disbursementIdFromOriginator(originator: string | null): string | null {
  if (!originator) return null;
  return originator.startsWith('disb-') ? originator.slice('disb-'.length) : null;
}

/** The outcome of finalizing a B2C result, for the route + tests. */
export type B2cFinalizeOutcome =
  | { readonly status: 'no-result' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'no-match'; readonly conversationId: string | null }
  | { readonly status: 'paid'; readonly disbursementId: string }
  | {
      readonly status: 'reversed';
      readonly disbursementId: string;
      readonly journalId: string;
    }
  | {
      readonly status: 'already-final';
      readonly disbursementId: string;
      readonly disbursementStatus: DisbursementStatus;
    };

export interface ProcessB2cResultDeps {
  readonly ledgerService: LedgerService;
  readonly disbursementRepository: IDisbursementRepository;
  /**
   * Durable claim guard (DB-backed). Keyed under the 'mpesa' namespace.
   *
   * F2 — this is recorded AFTER the side effect commits (claim-after-commit),
   * never before. It is an OPTIMISATION (skip recompute + log-spam on a
   * redelivery), NOT the idempotency guarantee. The real guarantees are the
   * already-terminal no-op (PAID/FAILED/CANCELLED) and the post-once
   * `disbursement-reversal:<id>` ledger key. A pre-claim would commit on a
   * delivery whose reversal then THREW (unresolved accounts) → Safaricom's
   * redelivery would see `duplicate` and the reversal would be PERMANENTLY
   * skipped, leaving the owner debited. So we claim only on success.
   */
  readonly dedupeStore: {
    claim(
      provider: 'mpesa',
      eventId: string,
      tenantId: string,
    ): Promise<'first-seen' | 'duplicate'>;
  };
  /**
   * Resolve the two accounts the compensating reversal touches. The
   * disbursement row stores the owner + amount but not the account ids, so
   * the route resolves them from the account repository (platform-holding
   * for the tenant + the owner's operating account). Returns null for an
   * account that cannot be found so the reversal fails LOUD rather than
   * posting an unbalanced/mis-routed journal.
   */
  readonly resolveReversalAccounts: (input: {
    tenantId: TenantId;
    ownerId: OwnerId;
  }) => Promise<{
    platformHoldingAccountId: AccountId | null;
    ownerOperatingAccountId: AccountId | null;
  }>;
  readonly logger: WebhookLogger;
}

/** Statuses we still consider "in flight" / reversible for a B2C result. */
const IN_FLIGHT_STATUSES: ReadonlySet<DisbursementStatus> = new Set([
  'PENDING',
  'PROCESSING',
  'IN_TRANSIT',
  'NEEDS_REVERSAL',
]);

/**
 * Finalize a B2C disbursement from its Daraja Result envelope. Idempotent
 * on the B2C transaction/disbursement id via the DURABLE dedupe store.
 *
 *   - ResultCode 0 (delivered) → transition the matching in-flight /
 *     NEEDS_REVERSAL disbursement to PAID.
 *   - non-zero terminal code (confirmed non-delivery) → post a COMPENSATING
 *     reversal through `LedgerService.postJournalEntry` (DR platform-holding
 *     / CR owner-operating — the mirror of the original `ownerDisbursement`
 *     journal, returning the money to holding because it never reached the
 *     owner) and set the terminal `FAILED` status. Money moves ONLY through
 *     the ledger service.
 *
 * A disbursement already in a terminal state (PAID/FAILED/CANCELLED) is a
 * no-op (`already-final`) so a late/duplicate result never double-acts.
 */
export async function processB2cResult(
  envelope: B2cResultEnvelope,
  deps: ProcessB2cResultDeps,
): Promise<B2cFinalizeOutcome> {
  // F1 — TENANT-RESOLVE FIRST, then bind. The B2C route runs OUTSIDE tenant
  // context (webhooks are excluded from auth), so we MUST learn the owning
  // tenant before any tenant-scoped disbursement op or a cross-tenant write
  // becomes possible. The OriginatorConversationID echoes our globally-unique
  // `disb-<id>`; we resolve its tenant from the PK, then every subsequent
  // lookup/update is tenant-scoped + GUC-bound inside the repository.
  const disbursement = await matchDisbursement(envelope, deps);
  if (!disbursement) {
    deps.logger.warn(
      {
        conversationId: envelope.conversationId,
        originatorConversationId: envelope.originatorConversationId,
        transactionId: envelope.transactionId,
      },
      'M-PESA B2C result matched no disbursement — manual reconciliation required',
    );
    return { status: 'no-match', conversationId: envelope.conversationId };
  }

  // F2 — NO pre-claim short-circuit. The dedupe claim is recorded AFTER the
  // side effect commits (below), so a delivery whose reversal throws does NOT
  // leave a committed claim that would suppress Safaricom's redelivery. Here
  // we only fast-path a duplicate that has ALREADY been recorded as seen — and
  // even that is belt-and-suspenders to the already-terminal guard.
  const claimKey = b2cClaimKey(envelope, disbursement.id);

  // Already terminal → nothing to do (PRIMARY idempotency against late /
  // redelivered results). This is checked on the freshly-read, tenant-scoped
  // row, so a redelivery after a successful finalize is a safe no-op even if
  // the dedupe claim was never recorded.
  if (!IN_FLIGHT_STATUSES.has(disbursement.status)) {
    deps.logger.info(
      { disbursementId: disbursement.id, status: disbursement.status },
      'M-PESA B2C result for an already-final disbursement — no-op',
    );
    // Record the claim so a storm of redeliveries stops recomputing; safe to
    // skip if the store is down (already-terminal carries the guarantee).
    await recordB2cClaim(deps, claimKey, disbursement.tenantId);
    return {
      status: 'already-final',
      disbursementId: disbursement.id,
      disbursementStatus: disbursement.status,
    };
  }

  // Perform the side effect FIRST. finalizeReversal posts through the
  // post-once `disbursement-reversal:<id>` ledger key and finalizePaid is an
  // idempotent status flip, so even a redelivery that races past the claim is
  // safe. Only AFTER the side effect durably commits do we record the claim.
  let outcome: B2cFinalizeOutcome;
  if (isMpesaSuccess(envelope.resultCode)) {
    outcome = await finalizePaid(disbursement, deps);
  } else {
    // If this throws (e.g. unresolved reversal accounts), we DO NOT record the
    // claim — the disbursement stays NEEDS_REVERSAL and Safaricom's redelivery
    // (or the reconciliation sweep) re-drives it. That is the F2 fix.
    outcome = await finalizeReversal(disbursement, envelope, deps);
  }

  await recordB2cClaim(deps, claimKey, disbursement.tenantId);
  return outcome;
}

/**
 * The durable dedupe key for a B2C result. The most stable B2C identifier
 * available (ConversationID == our transferId), falling back to the
 * TransactionID then the disbursement id.
 */
function b2cClaimKey(envelope: B2cResultEnvelope, disbursementId: string): string {
  const key =
    envelope.conversationId ?? envelope.transactionId ?? `disb-${disbursementId}`;
  return `b2c:${key}`;
}

/**
 * Record the durable dedupe claim AFTER the side effect committed (F2). The
 * claim outcome is intentionally ignored: a `duplicate` here only means a
 * concurrent delivery beat us, which the already-terminal guard + reversal
 * ledger key already made safe. Never throws into the caller.
 */
async function recordB2cClaim(
  deps: ProcessB2cResultDeps,
  claimKey: string,
  tenantId: TenantId,
): Promise<void> {
  try {
    await deps.dedupeStore.claim('mpesa', claimKey, tenantId);
  } catch (err) {
    // The claim is an optimisation, not the guarantee — a store outage must
    // not fail the (already-committed) finalize. Surface for ops, swallow.
    deps.logger.warn(
      { err, claimKey },
      'M-PESA B2C dedupe claim record failed (post-commit) — side effect already durable, continuing',
    );
  }
}

/**
 * Locate the disbursement this B2C result belongs to, TENANT-SCOPED (F1).
 * Precedence:
 *   1. OriginatorConversationID → `disb-<id>`: resolve the tenant from the
 *      globally-unique disbursement id, then a tenant-scoped findById. This
 *      is the canonical production path (the disbursement service stamps the
 *      originator on every B2C transfer).
 *   2. ConversationID == transferId: same tenant-resolution, but we cannot
 *      derive the disbursement id from a ConversationID, so we fall back to
 *      the originator. If only the ConversationID is present we have no
 *      tenant-safe lookup and return null (manual reconciliation) rather than
 *      a tenant-unscoped scan that could cross tenants.
 * Every DB op below is tenant-GUC-bound inside the repository.
 */
async function matchDisbursement(
  envelope: B2cResultEnvelope,
  deps: ProcessB2cResultDeps,
): Promise<Disbursement | null> {
  const disbId = disbursementIdFromOriginator(envelope.originatorConversationId);
  if (!disbId) {
    // No tenant-bearing originator → no tenant-safe way to resolve. Refuse
    // rather than risk a cross-tenant match on a shared transfer-id namespace.
    deps.logger.warn(
      {
        conversationId: envelope.conversationId,
        transactionId: envelope.transactionId,
      },
      'M-PESA B2C result has no disb-<id> OriginatorConversationID — cannot tenant-resolve safely',
    );
    return null;
  }

  // F1 — discover the owning tenant from the globally-unique id (service-role
  // bypass read), THEN bind that tenant for the actual lookup.
  const resolved = await deps.disbursementRepository.resolveTenantById(disbId);
  if (!resolved) return null;

  const byId = await deps.disbursementRepository.findById(
    disbId,
    resolved.tenantId,
  );
  if (!byId) return null;

  // Cross-check: the ConversationID the provider echoed MUST match the
  // transferId we recorded on this disbursement (when both are present). A
  // mismatch means the envelope does not actually correspond to this row —
  // refuse rather than act on a mis-correlated result.
  if (
    envelope.conversationId &&
    byId.transferId &&
    envelope.conversationId !== byId.transferId
  ) {
    deps.logger.warn(
      {
        disbursementId: byId.id,
        envelopeConversationId: envelope.conversationId,
        recordedTransferId: byId.transferId,
      },
      'M-PESA B2C result ConversationID does not match the disbursement transferId — refusing',
    );
    return null;
  }

  return byId;
}

/** Transition an in-flight/NEEDS_REVERSAL disbursement → PAID. */
async function finalizePaid(
  disbursement: Disbursement,
  deps: ProcessB2cResultDeps,
): Promise<B2cFinalizeOutcome> {
  const paid: Disbursement = {
    ...disbursement,
    status: 'PAID',
    completedAt: new Date(),
    failureReason: undefined,
    failedAt: undefined,
    updatedAt: new Date(),
    updatedBy: 'mpesa-b2c-result',
  };
  await deps.disbursementRepository.update(paid);
  deps.logger.info(
    { disbursementId: disbursement.id },
    'M-PESA B2C delivered — disbursement marked PAID',
  );
  return { status: 'paid', disbursementId: disbursement.id };
}

/**
 * Confirmed non-delivery → post a compensating reversal (money back to
 * platform-holding) and mark the disbursement terminally FAILED.
 *
 * The reversal MUST go through `LedgerService.postJournalEntry`. It is keyed
 * on the disbursement id so a redelivered failure result (that somehow
 * slips past the durable claim) cannot double-reverse.
 */
async function finalizeReversal(
  disbursement: Disbursement,
  envelope: B2cResultEnvelope,
  deps: ProcessB2cResultDeps,
): Promise<B2cFinalizeOutcome> {
  const { platformHoldingAccountId, ownerOperatingAccountId } =
    await deps.resolveReversalAccounts({
      tenantId: disbursement.tenantId,
      ownerId: disbursement.ownerId,
    });
  if (!platformHoldingAccountId || !ownerOperatingAccountId) {
    // We cannot post a balanced reversal without BOTH accounts. This is a
    // REAL failure — surface loud and leave the disbursement NEEDS_REVERSAL
    // for the reconciliation job. We DO NOT mark it FAILED, because the
    // compensating entry has not been posted (money is still owed back).
    deps.logger.error(
      {
        disbursementId: disbursement.id,
        tenantId: disbursement.tenantId,
        hasHolding: !!platformHoldingAccountId,
        hasOperating: !!ownerOperatingAccountId,
      },
      'M-PESA B2C non-delivery: reversal account(s) not found — cannot post reversal, leaving NEEDS_REVERSAL',
    );
    throw new Error(
      `B2C reversal: reversal account(s) not found for tenant ${disbursement.tenantId}`,
    );
  }

  const amount = Money.fromMinorUnits(
    disbursement.amountMinorUnits,
    disbursement.currency,
  );

  // Mirror of JournalTemplates.ownerDisbursement: the original posted
  // CR holding / DR owner-operating. The reversal is DR holding / CR
  // owner-operating — the money returns to platform-holding because it
  // never reached the owner's bank.
  const reversal: CreateJournalEntryRequest = {
    tenantId: disbursement.tenantId,
    effectiveDate: new Date(),
    createdBy: 'mpesa-b2c-result',
    lines: [
      {
        accountId: platformHoldingAccountId,
        type: 'OWNER_DISBURSEMENT',
        direction: 'DEBIT',
        amount,
        description: 'B2C non-delivery reversal — funds returned to holding',
        metadata: {
          provider: 'mpesa',
          disbursementId: disbursement.id,
          conversationId: envelope.conversationId,
          resultCode: envelope.resultCode,
        },
      },
      {
        accountId: ownerOperatingAccountId,
        type: 'OWNER_DISBURSEMENT',
        direction: 'CREDIT',
        amount,
        description: 'B2C non-delivery reversal — owner operating reversed',
        metadata: {
          provider: 'mpesa',
          disbursementId: disbursement.id,
          conversationId: envelope.conversationId,
          resultCode: envelope.resultCode,
        },
      },
    ],
  };

  const posted = await deps.ledgerService.postJournalEntry(reversal, {
    idempotencyKey: `disbursement-reversal:${disbursement.id}`,
  });

  const failureReason = mpesaResultReason(envelope.resultCode, envelope.resultDesc);
  const failed: Disbursement = {
    ...disbursement,
    status: 'FAILED',
    failedAt: new Date(),
    failureReason: `b2c-non-delivery:${failureReason}`,
    failureCode: String(envelope.resultCode),
    updatedAt: new Date(),
    updatedBy: 'mpesa-b2c-result',
  };
  await deps.disbursementRepository.update(failed);

  deps.logger.error(
    {
      disbursementId: disbursement.id,
      resultCode: envelope.resultCode,
      journalId: posted.journalId,
    },
    'M-PESA B2C confirmed non-delivery — compensating reversal posted, disbursement FAILED',
  );
  return {
    status: 'reversed',
    disbursementId: disbursement.id,
    journalId: posted.journalId,
  };
}
