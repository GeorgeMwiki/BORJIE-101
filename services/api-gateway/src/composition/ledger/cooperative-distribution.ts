/**
 * Cooperative member-distribution money-leg (FIX: coop-distribute-no-ledger).
 *
 * The ONE legal place a cooperative member payout is posted to the books.
 * Previously `POST /cooperatives/settlement-periods/:id/distribute` only
 * stamped `paid_at` + a FABRICATED `payment_ref` and posted NOTHING to the
 * ledger while telling members they were paid — phantom, off-ledger money.
 * Per the CLAUDE.md hard rule "money path goes through LedgerService.post()",
 * this posts a BALANCED double-entry journal per member through the SAME real
 * `LedgerService` settlement + payroll + sale-proceeds use:
 *
 *   DR  cooperative_clearing   amount   (the cooperative pool drawn down)
 *   CR  member_payable         amount   (net owed to the member)
 *
 * DR === CR (one amount, two legs), so the journal provably balances.
 *
 * Currency: NEVER hard-coded. Resolved from the tenant's primary currency.
 * The `cooperative_member_distributions.amount_tzs` column is
 * `numeric(18,2)` MAJOR units; this boundary scales currency-aware via
 * `CURRENCY_DECIMALS` to integer minor units.
 *
 * Idempotency: the post key is `coop-dist:<distributionId>` — a retried
 * distribute of the SAME member row replays the original journal instead of
 * double-posting (the hardened ledger records the key inside the atomic post
 * transaction). The real ledger journal id is returned and stored as the
 * member row's `payment_ref` — never a fabricated reference.
 *
 * RLS: the LedgerService repositories bind `app.current_tenant_id`
 * transaction-locally as the first statement of the atomic post; the account
 * provisioner does the same (`set_config(..., true)`). FORCE RLS applies even
 * though the service is built from the request's pooled client.
 *
 * The caller (the distribute route) wraps the per-member posts in a single
 * `db.transaction` so a failure on ANY member rolls the whole distribution
 * back — never a partial paid state, never a fabricated success.
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

/**
 * The slice of `LedgerService` this adapter depends on. Declared as a
 * structural type so a test can inject a fake ledger and assert the exact
 * journal request + idempotency key without the heavy real service (mirrors
 * how `createSettlementLedgerAdapter` takes a `LedgerService`).
 */
export interface CooperativeLedgerService {
  postJournalEntry(
    request: CreateJournalEntryRequest,
    options?: { idempotencyKey?: string },
  ): Promise<{ journalId: string }>;
}
import { createDatabaseClient } from '@borjie/database';
import {
  GatewayDrizzleAccountRepository,
  GatewayDrizzleLedgerRepository,
} from './drizzle-ledger-repos';
import { ensureLedgerAccounts } from './accounts-provisioner';
import { createLogger } from '../../utils/logger';

// `DatabaseClient` via ReturnType to dodge the TS2709 namespace collision
// (same pattern as composition/ledger/index.ts + post-sale-proceeds.ts).
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const moduleLogger = createLogger('cooperative-distribution-ledger');

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
      `cooperative-distribution-ledger: tenant ${tenantId} has no ` +
        `primary_currency — cannot post a distribution journal without a currency`,
    );
  }
  return currency as CurrencyCode;
}

/** Currency-aware MAJOR → integer-minor scale (no hard-coded decimals). */
function majorToMinor(amountMajor: number, currency: CurrencyCode): number {
  if (!Number.isFinite(amountMajor) || amountMajor < 0) {
    throw new Error(
      `cooperative-distribution-ledger: amount must be a non-negative finite ` +
        `number (got ${String(amountMajor)})`,
    );
  }
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const factor = decimals === 0 ? 1 : Math.pow(10, decimals);
  return Math.round(amountMajor * factor);
}

export interface CooperativeDistributionInput {
  readonly db: DatabaseClient;
  readonly tenantId: string;
  /** The `cooperative_member_distributions` row id — drives the key. */
  readonly distributionId: string;
  /** The member party paid — recorded in the journal metadata. */
  readonly memberPartyId: string;
  /** Net distributable amount in MAJOR units (tenant primary currency). */
  readonly amountMajor: number;
}

export interface CooperativeDistributionResult {
  /** The REAL ledger journal id — stored as the member row's payment_ref. */
  readonly journalId: string;
  readonly currency: CurrencyCode;
  readonly amountMinorUnits: number;
}

/**
 * The ledger-poster seam the distribute route depends on. A test can inject a
 * fake; the production adapter (below) posts through the real LedgerService.
 */
export interface CooperativeDistributionLedgerPort {
  post(
    input: CooperativeDistributionInput,
  ): Promise<CooperativeDistributionResult>;
}

/**
 * Post a single cooperative member distribution through a LedgerService — a
 * balanced 2-leg journal:
 *
 *   DR  cooperative_clearing   amount
 *   CR  member_payable         amount
 *
 * MUST be called inside the same db.transaction that flips the member row's
 * `paid_at` / `payment_ref` so a failed post rolls back the phantom payout.
 * Idempotency key `coop-dist:<distributionId>` so a retried distribute
 * replays the original journal instead of double-posting.
 *
 * `ledger` is injected so a test can assert the exact journal request + key
 * with a fake; production passes a real `LedgerService` (see
 * `postCooperativeDistribution`).
 */
export async function postCooperativeDistributionWithLedger(
  input: CooperativeDistributionInput,
  ledger: CooperativeLedgerService,
): Promise<CooperativeDistributionResult> {
  const { db, tenantId } = input;
  if (!Number.isFinite(input.amountMajor) || input.amountMajor <= 0) {
    throw new Error(
      `cooperative-distribution-ledger: distribution ${input.distributionId} ` +
        `has a non-positive amount — nothing to post`,
    );
  }

  const currency = await resolveTenantCurrency(db, tenantId);
  const amountMinor = majorToMinor(input.amountMajor, currency);
  if (amountMinor <= 0) {
    throw new Error(
      `cooperative-distribution-ledger: distribution ${input.distributionId} ` +
        `rounds to zero minor units — nothing to post`,
    );
  }

  const accounts = await ensureLedgerAccounts(db, {
    tenantId,
    currency,
    keys: ['cooperative_clearing', 'member_payable'],
    createdBy: 'cooperative-distribution',
  });

  const meta = {
    distributionId: input.distributionId,
    memberPartyId: input.memberPartyId,
  };
  const amount = Money.fromMinorUnits(amountMinor, currency);
  const lines: CreateJournalEntryRequest['lines'] = [
    {
      accountId: accounts.cooperative_clearing as AccountId,
      type: 'OWNER_DISBURSEMENT',
      direction: 'DEBIT',
      amount,
      description: `Cooperative distribution — ${input.distributionId}`,
      metadata: meta,
    },
    {
      accountId: accounts.member_payable as AccountId,
      type: 'OWNER_DISBURSEMENT',
      direction: 'CREDIT',
      amount,
      description: `Member payable — ${input.memberPartyId}`,
      metadata: meta,
    },
  ];

  const request: CreateJournalEntryRequest = {
    tenantId: tenantId as TenantId,
    effectiveDate: new Date(),
    lines,
    createdBy: 'cooperative-distribution',
  };

  const result = await ledger.postJournalEntry(request, {
    idempotencyKey: `coop-dist:${input.distributionId}`,
  });

  moduleLogger.info(
    {
      tenantId,
      distributionId: input.distributionId,
      memberPartyId: input.memberPartyId,
      journalId: result.journalId,
      amountMinor,
      currency,
    },
    'cooperative_distribution_ledger_post_committed',
  );

  return {
    journalId: result.journalId,
    currency,
    amountMinorUnits: amountMinor,
  };
}

/**
 * Production entry point: builds a REAL request-scoped LedgerService from the
 * caller's Drizzle client and posts through it. The route runs the per-member
 * posts inside one db.transaction on the request's reserved connection.
 */
export async function postCooperativeDistribution(
  input: CooperativeDistributionInput,
): Promise<CooperativeDistributionResult> {
  const ledger = buildLedgerService(input.db);
  return postCooperativeDistributionWithLedger(input, ledger);
}

/** The production port — a thin wrapper over `postCooperativeDistribution`. */
export const productionCooperativeDistributionLedgerPort: CooperativeDistributionLedgerPort =
  {
    post: postCooperativeDistribution,
  };
