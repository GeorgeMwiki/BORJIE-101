/**
 * Disbursement reconciliation consumer (F3 — NEEDS_REVERSAL has a consumer).
 *
 * WHY THIS EXISTS
 * ---------------
 * `DisbursementService.processDisbursement` posts the ledger debit FIRST, then
 * initiates the outbound B2C transfer. If the transfer fails AFTER the ledger
 * post — or, worse, times out with NO result callback ever sent — the
 * disbursement is parked in `NEEDS_REVERSAL`: money is DEBITED, UNDELIVERED,
 * and (until now) UNREVERSED with NOTHING driving it. A timeout-only B2C left
 * that money silently lost. This sweep is the consumer that closes the loop.
 *
 * WHAT IT DOES (per tenant)
 * -------------------------
 *   1. `findPending(tenant)` → filter `NEEDS_REVERSAL`.
 *   2. SURFACE LOUD (the MINIMUM guarantee): a non-empty NEEDS_REVERSAL set is
 *      logged at WARN with a queryable count + ids, so debited-but-undelivered
 *      money can never sit silent even if every per-row action is indeterminate.
 *   3. For each NEEDS_REVERSAL disbursement, idempotently drive it to a
 *      terminal state WITHOUT ever blind-re-transferring or blind-reversing:
 *        - transfer NEVER got an id (the original createTransfer threw before
 *          returning) → RE-DRIVE under the SAME `disbursement-transfer:<id>`
 *          key (provider-idempotent, so no double-send). On success it moves to
 *          IN_TRANSIT/PROCESSING and a B2C result will finalise it.
 *        - provider can confirm the outcome via `getTransferStatus`:
 *            · delivered (PAID/IN_TRANSIT) → mark PAID;
 *            · confirmed non-delivery (FAILED/CANCELLED) → post the COMPENSATING
 *              reversal through `LedgerService.postJournalEntry` keyed
 *              `disbursement-reversal:<id>` (post-once) and mark FAILED.
 *        - otherwise UNDETERMINABLE (no id + no provider, status query throws —
 *          M-Pesa B2C is callback-only — or status still PENDING) → leave
 *          NEEDS_REVERSAL and flag LOUD for a human / the next B2C result.
 *
 * HARD RULES honoured (real money):
 *   - Money ONLY via `LedgerService.postJournalEntry`. The reversal is a
 *     balanced journal (DR holding / CR owner-operating) keyed on the
 *     disbursement id; the money-path audit greps for direct ledger writes —
 *     none live here.
 *   - Idempotent + restart-safe: the transfer key and the reversal key are both
 *     derived from the disbursement id, and every transition reads the current
 *     row first, so a re-run never double-acts.
 *   - Tenant-scoped: every disbursement DB op goes through the repository, which
 *     binds the tenant GUC. The sweep is invoked per tenant.
 *   - Fail LOUD: no silent loss; an indeterminate row stays NEEDS_REVERSAL and
 *     is logged, never masked.
 *   - Integer minor units; Pino logging only (the injected logger).
 */

import {
  Money,
  type AccountId,
  type OwnerId,
  type TenantId,
  type CreateJournalEntryRequest,
} from '@borjie/domain-models';
import type { LedgerService } from '../services/ledger.service';
import type { IPaymentProvider } from '../providers/payment-provider.interface';
import type {
  Disbursement,
  IDisbursementRepository,
} from '../repositories/disbursement.repository';

/** Pino-shaped logger subset this consumer reaches for. */
export interface ReconciliationLogger {
  info: (ctx: unknown, msg: string) => void;
  warn: (ctx: unknown, msg: string) => void;
  error: (ctx: unknown, msg: string) => void;
}

/**
 * Resolve the two accounts a compensating reversal touches for a disbursement
 * (mirror of the B2C-result path): the tenant's platform-holding account and
 * the owner's operating account. Returns null for an account that cannot be
 * found so the reversal fails LOUD instead of posting a mis-routed journal.
 */
export type ResolveReversalAccounts = (input: {
  tenantId: TenantId;
  ownerId: OwnerId;
}) => Promise<{
  platformHoldingAccountId: AccountId | null;
  ownerOperatingAccountId: AccountId | null;
}>;

export interface DisbursementReconciliationDeps {
  readonly disbursementRepository: IDisbursementRepository;
  readonly ledgerService: LedgerService;
  readonly resolveReversalAccounts: ResolveReversalAccounts;
  /**
   * Look up the payment provider by name so the sweep can re-drive a transfer
   * or query its status. Returns null when the provider is not wired (then the
   * row is left NEEDS_REVERSAL + flagged loud). Optional: omit entirely to run
   * in surface-only mode (the MINIMUM guarantee).
   */
  readonly getProvider?: (name: string) => IPaymentProvider | null;
  readonly logger: ReconciliationLogger;
}

/** Per-disbursement outcome of one sweep pass (for callers + tests). */
export type ReconciliationItemOutcome =
  | { readonly disbursementId: string; readonly action: 'reversed'; readonly journalId: string }
  | { readonly disbursementId: string; readonly action: 'redriven'; readonly transferId: string }
  | { readonly disbursementId: string; readonly action: 'marked-paid' }
  | { readonly disbursementId: string; readonly action: 'left-needs-reversal'; readonly reason: string };

/** The aggregate result of a sweep over one tenant. */
export interface DisbursementReconciliationResult {
  readonly tenantId: TenantId;
  /** Queryable count of NEEDS_REVERSAL rows found at sweep start. */
  readonly needsReversalCount: number;
  readonly reversed: number;
  readonly redriven: number;
  readonly markedPaid: number;
  readonly leftNeedsReversal: number;
  readonly outcomes: readonly ReconciliationItemOutcome[];
}

/**
 * Sweep one tenant's NEEDS_REVERSAL disbursements and drive each toward a
 * terminal state, fail-loud + idempotent. Never throws on a per-row failure —
 * a row that cannot be resolved is left NEEDS_REVERSAL and logged so the next
 * pass (or a human) retries it; the aggregate result always returns.
 */
export async function reconcileDisbursements(
  tenantId: TenantId,
  deps: DisbursementReconciliationDeps,
): Promise<DisbursementReconciliationResult> {
  const pending = await deps.disbursementRepository.findPending(tenantId);
  const needsReversal = pending.filter((d) => d.status === 'NEEDS_REVERSAL');

  // MINIMUM GUARANTEE — surface non-empty NEEDS_REVERSAL LOUDLY with a
  // queryable count, so debited-but-undelivered money is never silent even if
  // every per-row action below is indeterminate.
  if (needsReversal.length > 0) {
    deps.logger.warn(
      {
        tenantId,
        needsReversalCount: needsReversal.length,
        disbursementIds: needsReversal.map((d) => d.id),
      },
      'DISBURSEMENT RECONCILIATION: debited-but-undelivered disbursements in NEEDS_REVERSAL — driving to terminal / flagging',
    );
  }

  const outcomes: ReconciliationItemOutcome[] = [];
  for (const disbursement of needsReversal) {
    outcomes.push(await reconcileOne(disbursement, deps));
  }

  const tally = (action: ReconciliationItemOutcome['action']) =>
    outcomes.filter((o) => o.action === action).length;

  return {
    tenantId,
    needsReversalCount: needsReversal.length,
    reversed: tally('reversed'),
    redriven: tally('redriven'),
    markedPaid: tally('marked-paid'),
    leftNeedsReversal: tally('left-needs-reversal'),
    outcomes,
  };
}

/**
 * Resolve ONE NEEDS_REVERSAL disbursement. Order:
 *   1. No transferId → the transfer never got an id; re-drive idempotently.
 *   2. Else query provider status (if it can answer) → reverse / mark paid.
 *   3. Else leave NEEDS_REVERSAL + loud.
 * Catches its own errors and degrades to `left-needs-reversal` so the sweep
 * continues; nothing here blind-re-transfers or blind-reverses.
 */
async function reconcileOne(
  disbursement: Disbursement,
  deps: DisbursementReconciliationDeps,
): Promise<ReconciliationItemOutcome> {
  const provider =
    disbursement.provider && deps.getProvider
      ? deps.getProvider(disbursement.provider)
      : null;

  // (1) Transfer never got an id → re-drive under the SAME idempotency key so
  // the provider never double-sends. Only attempt when we have a provider.
  if (!disbursement.transferId) {
    if (!provider) {
      return leaveNeedsReversal(
        disbursement,
        deps,
        'no transferId and no provider wired to re-drive',
      );
    }
    return redriveTransfer(disbursement, provider, deps);
  }

  // (2) We have a transferId → ask the provider whether it was delivered.
  if (!provider) {
    return leaveNeedsReversal(
      disbursement,
      deps,
      'transferId present but no provider wired to confirm delivery',
    );
  }

  let status: Awaited<ReturnType<IPaymentProvider['getTransferStatus']>>;
  try {
    status = await provider.getTransferStatus(disbursement.transferId);
  } catch (err) {
    // M-Pesa B2C is callback-only (getTransferStatus throws): we cannot
    // determine delivery here. Leave NEEDS_REVERSAL for the next B2C result /
    // a human — NEVER guess.
    return leaveNeedsReversal(
      disbursement,
      deps,
      `provider status query failed/unsupported: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }

  if (status.status === 'PAID' || status.status === 'IN_TRANSIT') {
    return markPaid(disbursement, deps);
  }
  if (status.status === 'FAILED' || status.status === 'CANCELLED') {
    return postReversal(
      disbursement,
      deps,
      status.failureReason ?? `transfer-${status.status.toLowerCase()}`,
    );
  }
  // PENDING (still in flight at the provider) → not yet determinable.
  return leaveNeedsReversal(
    disbursement,
    deps,
    `provider transfer status is ${status.status} — not yet determinable`,
  );
}

/** Re-drive a transfer that never got an id. Idempotent on the disbursement id. */
async function redriveTransfer(
  disbursement: Disbursement,
  provider: IPaymentProvider,
  deps: DisbursementReconciliationDeps,
): Promise<ReconciliationItemOutcome> {
  try {
    const amount = Money.fromMinorUnits(
      disbursement.amountMinorUnits,
      disbursement.currency,
    );
    const transferResult = await provider.createTransfer({
      amount,
      destination: disbursement.destination,
      description:
        disbursement.description ?? `Disbursement to owner ${disbursement.ownerId}`,
      metadata: {
        tenantId: disbursement.tenantId,
        ownerId: disbursement.ownerId,
        disbursementId: disbursement.id,
        // Same Daraja B2C dedupe anchor the service stamped originally.
        originatorConversationId: `disb-${disbursement.id}`,
      },
      // SAME key the service used → the provider never double-sends.
      idempotencyKey: `disbursement-transfer:${disbursement.id}`,
    });

    const nextStatus =
      transferResult.status === 'PAID'
        ? 'PAID'
        : transferResult.status === 'IN_TRANSIT'
          ? 'IN_TRANSIT'
          : 'PROCESSING';

    await deps.disbursementRepository.update({
      ...disbursement,
      status: nextStatus,
      provider: provider.name,
      transferId: transferResult.transferId,
      completedAt: transferResult.status === 'PAID' ? new Date() : undefined,
      estimatedArrival: transferResult.arrivalDate,
      failureReason: undefined,
      updatedAt: new Date(),
      updatedBy: 'disbursement-reconciliation',
    });

    deps.logger.info(
      {
        disbursementId: disbursement.id,
        transferId: transferResult.transferId,
        status: nextStatus,
      },
      'DISBURSEMENT RECONCILIATION: re-drove transfer for a NEEDS_REVERSAL disbursement (idempotent key)',
    );
    return {
      disbursementId: disbursement.id,
      action: 'redriven',
      transferId: transferResult.transferId,
    };
  } catch (err) {
    return leaveNeedsReversal(
      disbursement,
      deps,
      `re-drive failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
}

/**
 * Confirmed non-delivery → post the compensating reversal (money back to
 * holding) keyed on the disbursement id, then mark FAILED. Money moves ONLY
 * through `LedgerService.postJournalEntry`.
 */
async function postReversal(
  disbursement: Disbursement,
  deps: DisbursementReconciliationDeps,
  failureReason: string,
): Promise<ReconciliationItemOutcome> {
  const { platformHoldingAccountId, ownerOperatingAccountId } =
    await deps.resolveReversalAccounts({
      tenantId: disbursement.tenantId,
      ownerId: disbursement.ownerId,
    });
  if (!platformHoldingAccountId || !ownerOperatingAccountId) {
    // Cannot post a balanced reversal without BOTH accounts. Leave
    // NEEDS_REVERSAL (money still owed back) and flag loud — never mark FAILED
    // without the compensating entry.
    return leaveNeedsReversal(
      disbursement,
      deps,
      'reversal account(s) not found — cannot post compensating reversal',
    );
  }

  const amount = Money.fromMinorUnits(
    disbursement.amountMinorUnits,
    disbursement.currency,
  );

  // Mirror of JournalTemplates.ownerDisbursement, reversed: DR holding /
  // CR owner-operating — the money returns to platform-holding because it
  // never reached the owner.
  const reversal: CreateJournalEntryRequest = {
    tenantId: disbursement.tenantId,
    effectiveDate: new Date(),
    createdBy: 'disbursement-reconciliation',
    lines: [
      {
        accountId: platformHoldingAccountId,
        type: 'OWNER_DISBURSEMENT',
        direction: 'DEBIT',
        amount,
        description: 'B2C non-delivery reversal (reconciliation) — funds returned to holding',
        metadata: {
          provider: disbursement.provider ?? 'unknown',
          disbursementId: disbursement.id,
          source: 'reconciliation',
        },
      },
      {
        accountId: ownerOperatingAccountId,
        type: 'OWNER_DISBURSEMENT',
        direction: 'CREDIT',
        amount,
        description: 'B2C non-delivery reversal (reconciliation) — owner operating reversed',
        metadata: {
          provider: disbursement.provider ?? 'unknown',
          disbursementId: disbursement.id,
          source: 'reconciliation',
        },
      },
    ],
  };

  const posted = await deps.ledgerService.postJournalEntry(reversal, {
    idempotencyKey: `disbursement-reversal:${disbursement.id}`,
  });

  await deps.disbursementRepository.update({
    ...disbursement,
    status: 'FAILED',
    failedAt: new Date(),
    failureReason: `b2c-non-delivery:${failureReason}`,
    updatedAt: new Date(),
    updatedBy: 'disbursement-reconciliation',
  });

  deps.logger.error(
    {
      disbursementId: disbursement.id,
      journalId: posted.journalId,
      failureReason,
    },
    'DISBURSEMENT RECONCILIATION: confirmed non-delivery — compensating reversal posted, disbursement FAILED',
  );
  return {
    disbursementId: disbursement.id,
    action: 'reversed',
    journalId: posted.journalId,
  };
}

/** Provider confirms the payout was delivered → mark PAID (idempotent flip). */
async function markPaid(
  disbursement: Disbursement,
  deps: DisbursementReconciliationDeps,
): Promise<ReconciliationItemOutcome> {
  await deps.disbursementRepository.update({
    ...disbursement,
    status: 'PAID',
    completedAt: new Date(),
    failureReason: undefined,
    failedAt: undefined,
    updatedAt: new Date(),
    updatedBy: 'disbursement-reconciliation',
  });
  deps.logger.info(
    { disbursementId: disbursement.id },
    'DISBURSEMENT RECONCILIATION: provider confirms delivery — disbursement marked PAID',
  );
  return { disbursementId: disbursement.id, action: 'marked-paid' };
}

/** Leave the disbursement NEEDS_REVERSAL and flag LOUD (no silent loss). */
function leaveNeedsReversal(
  disbursement: Disbursement,
  deps: DisbursementReconciliationDeps,
  reason: string,
): ReconciliationItemOutcome {
  deps.logger.warn(
    {
      disbursementId: disbursement.id,
      tenantId: disbursement.tenantId,
      ownerId: disbursement.ownerId,
      amountMinorUnits: disbursement.amountMinorUnits,
      reason,
    },
    'DISBURSEMENT RECONCILIATION: could not resolve NEEDS_REVERSAL disbursement — left for next pass / human (money debited, undelivered)',
  );
  return { disbursementId: disbursement.id, action: 'left-needs-reversal', reason };
}

/**
 * Thin job wrapper mirroring the existing job classes (DisbursementJob /
 * ReconciliationJob). Sweeps a set of tenants on a cadence the scheduler
 * drives. Each tenant sweep is isolated: one tenant's failure never aborts the
 * batch.
 */
export class DisbursementReconciliationJob {
  constructor(private readonly deps: DisbursementReconciliationDeps) {}

  /**
   * Run the NEEDS_REVERSAL sweep for the given tenants. Returns a result per
   * tenant. A throw from one tenant's sweep is caught + logged so the rest of
   * the batch still runs.
   */
  async run(
    tenantIds: readonly TenantId[],
  ): Promise<readonly DisbursementReconciliationResult[]> {
    const results: DisbursementReconciliationResult[] = [];
    for (const tenantId of tenantIds) {
      try {
        results.push(await reconcileDisbursements(tenantId, this.deps));
      } catch (err) {
        this.deps.logger.error(
          { err, tenantId },
          'DISBURSEMENT RECONCILIATION: tenant sweep threw — continuing with next tenant',
        );
        results.push({
          tenantId,
          needsReversalCount: 0,
          reversed: 0,
          redriven: 0,
          markedPaid: 0,
          leftNeedsReversal: 0,
          outcomes: [],
        });
      }
    }
    return results;
  }
}
