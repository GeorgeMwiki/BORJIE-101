/**
 * Royalty money-leg service (FLOW-3 / OW-8).
 *
 * The ONE legal place a royalty PAYMENT is posted to the books. Per the
 * CLAUDE.md hard rule "money path goes through LedgerService.post()", this
 * builds a real `LedgerService` (the same one payroll + settlement use, via
 * the gateway's Drizzle client) and posts a BALANCED double-entry journal
 * that discharges the royalty liability with cash:
 *
 *   DR  royalty_payable   amount   (discharge the royalty owed to the state)
 *   CR  cash_clearing     amount   (cash paid out to settle it)
 *
 * Why this direction: the marketplace settlement adapter ACCRUES royalty as
 * a CREDIT to `royalty_payable` when a sale settles
 * (composition/ledger/index.ts createSettlementLedgerAdapter). Filing +
 * paying the royalty return therefore DEBITS `royalty_payable` (reducing the
 * outstanding liability) and CREDITS `cash_clearing` (the cash leaving). The
 * draft in `royalty_return_drafts` (migration 0159) is the SOURCE document;
 * its money figures are supplied by the owner at sign time (the draft table
 * itself carries no money column by design).
 *
 * Idempotency: the post key is `royalty:<draftId>` — a retried sign of the
 * SAME draft replays the original journal instead of double-posting (the
 * hardened ledger records the key inside the atomic post transaction).
 *
 * Currency: NEVER hard-coded. The amount arrives in MAJOR units in the
 * tenant's primary currency and is scaled to integer minor units
 * currency-aware via `CURRENCY_DECIMALS` (TZS = 0 decimals, etc.).
 *
 * RLS: the LedgerService's repositories bind `app.current_tenant_id`
 * transaction-locally as the FIRST statement of the atomic post
 * (drizzle-ledger-repos.ts), so FORCE RLS applies even though we construct
 * the service from the request's pooled client. We also pass `tenantId`
 * explicitly (belt-and-braces).
 */

import { sql } from 'drizzle-orm';
import {
  LedgerService,
  InMemoryEventPublisher,
} from '@borjie/payments-ledger-service';
import {
  Money,
  CURRENCY_DECIMALS,
  type CreateJournalEntryRequest,
  type CurrencyCode,
  type TenantId,
  type AccountId,
} from '@borjie/domain-models';
import { createDatabaseClient } from '@borjie/database';
import {
  GatewayDrizzleAccountRepository,
  GatewayDrizzleLedgerRepository,
} from '../../composition/ledger/drizzle-ledger-repos';
import { ensureLedgerAccounts } from '../../composition/ledger/accounts-provisioner';
import { createLogger } from '../../utils/logger';

// `DatabaseClient` via ReturnType to dodge the TS2709 namespace collision
// (same pattern as composition/ledger/index.ts).
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const moduleLogger = createLogger('royalty-ledger');

const ledgerLogger = {
  info: (message: string, context?: Record<string, unknown>): void =>
    moduleLogger.info(context ?? {}, message),
  warn: (message: string, context?: Record<string, unknown>): void =>
    moduleLogger.warn(context ?? {}, message),
  error: (message: string, context?: Record<string, unknown>): void =>
    moduleLogger.error(context ?? {}, message),
};

/** Build a real LedgerService bound to the request's Drizzle client. */
function buildLedgerService(db: DatabaseClient): LedgerService {
  return new LedgerService({
    ledgerRepository: new GatewayDrizzleLedgerRepository(db),
    accountRepository: new GatewayDrizzleAccountRepository(db),
    eventPublisher: new InMemoryEventPublisher(),
    logger: ledgerLogger,
  });
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

/**
 * Resolve the tenant's primary currency (no hard-coded currency — CLAUDE.md).
 * Throws when unset: we cannot post a money journal without a currency.
 */
async function resolveTenantCurrency(
  db: DatabaseClient,
  tenantId: string,
): Promise<CurrencyCode> {
  const raw = await db.execute(sql`
    SELECT primary_currency
      FROM tenants
     WHERE id = ${tenantId}::uuid
     LIMIT 1
  `);
  const currency = rowsOf(raw)[0]?.primary_currency as string | undefined;
  if (!currency) {
    throw new Error(
      `royalty-ledger: tenant ${tenantId} has no primary_currency — ` +
        `cannot post a royalty journal without a currency`,
    );
  }
  return currency as CurrencyCode;
}

/** Currency-aware MAJOR → integer-minor scale (no hard-coded decimals). */
export function royaltyMajorToMinor(
  amountMajor: number,
  currency: CurrencyCode,
): number {
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    throw new Error(
      `royalty-ledger: amount must be a positive finite number (got ${String(
        amountMajor,
      )})`,
    );
  }
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const factor = decimals === 0 ? 1 : Math.pow(10, decimals);
  return Math.round(amountMajor * factor);
}

export interface RoyaltyPostInput {
  readonly db: DatabaseClient;
  readonly tenantId: string;
  readonly userId: string;
  /** The `royalty_return_drafts` row id this payment settles. */
  readonly draftId: string;
  /** Royalty amount in MAJOR units (tenant primary currency). */
  readonly royaltyAmountMajor: number;
  /** Mineral scope (for the journal description + metadata). */
  readonly mineral: string;
  /** YYYY-MM-DD period start (for description). */
  readonly periodStart: string;
  /** Optional site linkage so the accounting projection can scope by site. */
  readonly siteId?: string;
}

export interface RoyaltyPostResult {
  readonly journalId: string;
  readonly currency: CurrencyCode;
  readonly amountMinorUnits: number;
  readonly debitAccountId: string;
  readonly creditAccountId: string;
}

/**
 * Post the royalty payment journal through the REAL LedgerService.
 *
 * Returns the journal id + the resolved currency / minor-unit amount so the
 * caller can persist the linkage onto the draft and surface it to the FE.
 */
export async function postRoyaltyPayment(
  input: RoyaltyPostInput,
): Promise<RoyaltyPostResult> {
  const { db, tenantId } = input;
  const currency = await resolveTenantCurrency(db, tenantId);
  const amountMinor = royaltyMajorToMinor(input.royaltyAmountMajor, currency);

  // Ensure the chart-of-accounts rows exist (idempotent).
  const accounts = await ensureLedgerAccounts(db, {
    tenantId,
    currency,
    keys: ['royalty_payable', 'cash_clearing'],
    createdBy: 'royalty-filing',
  });

  const meta = {
    royaltyDraftId: input.draftId,
    mineral: input.mineral,
    periodStart: input.periodStart,
    ...(input.siteId ? { siteId: input.siteId } : {}),
  };

  const amount = Money.fromMinorUnits(amountMinor, currency);
  const lines: CreateJournalEntryRequest['lines'] = [
    {
      accountId: accounts.royalty_payable as AccountId,
      type: 'RENT_CHARGE',
      direction: 'DEBIT',
      amount,
      description: `Royalty filed — ${input.mineral} (${input.periodStart})`,
      metadata: meta,
    },
    {
      accountId: accounts.cash_clearing as AccountId,
      type: 'OWNER_DISBURSEMENT',
      direction: 'CREDIT',
      amount,
      description: `Royalty payment — ${input.mineral} (${input.periodStart})`,
      metadata: meta,
    },
  ];

  const request: CreateJournalEntryRequest = {
    tenantId: tenantId as TenantId,
    effectiveDate: new Date(),
    lines,
    createdBy: 'royalty-filing',
  };

  // Idempotency: a retried sign of the same draft replays the original
  // journal (no double-post) — recorded inside the atomic post tx.
  const ledger = buildLedgerService(db);
  const result = await ledger.postJournalEntry(request, {
    idempotencyKey: `royalty:${input.draftId}`,
  });

  moduleLogger.info(
    {
      tenantId,
      royaltyDraftId: input.draftId,
      journalId: result.journalId,
      amountMinor,
      currency,
      mineral: input.mineral,
    },
    'royalty_ledger_post_committed',
  );

  return {
    journalId: result.journalId,
    currency,
    amountMinorUnits: amountMinor,
    debitAccountId: accounts.royalty_payable,
    creditAccountId: accounts.cash_clearing,
  };
}
