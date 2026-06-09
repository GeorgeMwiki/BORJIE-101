/**
 * Mining money-leg services: DIRECT mineral SALE proceeds + LICENCE renewal
 * fees (FIX: mining-sales-no-ledger, mining-licence-renewal-fee-no-ledger).
 *
 * The ONE legal place a DIRECT mineral SALE is posted to the books. Per the
 * CLAUDE.md hard rule "money path goes through LedgerService.post()", this
 * builds a real `LedgerService` (the same one settlement + payroll + royalty
 * use, via the gateway's Drizzle client) and posts a BALANCED double-entry
 * journal that records the sale proceeds and the liabilities they create:
 *
 *   DR  cash_clearing     gross   (cash received from the buyer)
 *   CR  revenue_mineral   net     (mineral revenue earned by the estate)
 *   CR  royalty_payable   royalty (royalty owed to the state)
 *   CR  tax_payable       tax     (VAT + inspection + other levies owed)
 *
 * gross = net + royalty + tax, so debits === credits per currency. `net` is
 * the integer REMAINDER (gross − royalty − tax) so the journal provably
 * balances even when the percentage legs round.
 *
 * Why this matters: the growth/revenue warehouse computes revenue from CREDIT
 * `ledger_entries`, not the `sales` table — a sale that never posts a journal
 * is invisible (phantom, off-ledger) revenue with un-booked royalty/VAT
 * liabilities. This service closes that gap.
 *
 * Currency: NEVER hard-coded. Resolved from the sale's own legs — a USD sale
 * (`grossPriceUsd` present, no TZS) posts in USD; otherwise the tenant's
 * primary currency. The `sales` money columns are `numeric(18,2)` MAJOR-unit
 * strings, scaled to integer minor units currency-aware via `CURRENCY_DECIMALS`.
 *
 * Idempotency: the post key is `sale:<saleId>` — a retried POST of the SAME
 * sale replays the original journal instead of double-posting (the hardened
 * ledger records the key inside the atomic post transaction).
 *
 * Account provisioning: the four accounts are ensured idempotently. The two
 * sale-specific accounts (`revenue_mineral`, `tax_payable`) are provisioned
 * locally with the same deterministic per-(tenant, currency) id scheme and
 * `ON CONFLICT DO NOTHING` insert as the shared provisioner, so a concurrent
 * sale races safely and no cross-tenant account is ever reused.
 *
 * RLS: the LedgerService repositories bind `app.current_tenant_id`
 * transaction-locally as the first statement of the atomic post; the local
 * account provisioning does the same (`set_config(..., true)`). FORCE RLS
 * applies even though the service is built from the request's pooled client.
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
} from './drizzle-ledger-repos';
import {
  ensureLedgerAccounts,
  ledgerAccountId,
} from './accounts-provisioner';
import { createLogger } from '../../utils/logger';

// `DatabaseClient` via ReturnType to dodge the TS2709 namespace collision
// (same pattern as composition/ledger/index.ts + royalty-ledger.ts).
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const moduleLogger = createLogger('sale-proceeds-ledger');

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
      `sale-proceeds-ledger: tenant ${tenantId} has no primary_currency — ` +
        `cannot post a sale journal without a currency`,
    );
  }
  return currency as CurrencyCode;
}

/** Currency-aware MAJOR → integer-minor scale (no hard-coded decimals). */
function majorToMinor(amountMajor: number, currency: CurrencyCode): number {
  if (!Number.isFinite(amountMajor) || amountMajor < 0) {
    throw new Error(
      `sale-proceeds-ledger: amount must be a non-negative finite number ` +
        `(got ${String(amountMajor)})`,
    );
  }
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const factor = decimals === 0 ? 1 : Math.pow(10, decimals);
  return Math.round(amountMajor * factor);
}

/** Parse a `numeric` string / number / null into a non-negative major number. */
function toMajor(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Sum the `other_levies` JSONB ({clearing_fee, levy_LGA, ...}) into a single
 * non-negative major figure. Non-numeric / negative legs are ignored so a
 * malformed JSONB can never corrupt the tax total.
 */
function sumOtherLevies(otherLevies: unknown): number {
  if (!otherLevies || typeof otherLevies !== 'object') return 0;
  let total = 0;
  for (const v of Object.values(otherLevies as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

export interface SaleProceedsInput {
  readonly db: DatabaseClient;
  readonly tenantId: string;
  /** The `sales` row id this journal records. Drives the idempotency key. */
  readonly saleId: string;
  /** Gross sale price in TZS major units (numeric string) — when a TZS sale. */
  readonly grossPriceTzs?: string | number | null;
  /** Gross sale price in USD major units (numeric string) — when a USD sale. */
  readonly grossPriceUsd?: string | number | null;
  /** Royalty % applied to gross (e.g. 6 for 6%). */
  readonly royaltyPct?: string | number | null;
  /** VAT % applied to gross. */
  readonly vatPct?: string | number | null;
  /** Inspection % applied to gross (folded into the tax leg). */
  readonly inspectionPct?: string | number | null;
  /** Free-form per-sale levies JSONB ({clearing_fee, levy_LGA, ...}). */
  readonly otherLevies?: unknown;
}

export interface SaleProceedsResult {
  readonly journalId: string;
  readonly currency: CurrencyCode;
  readonly grossMinorUnits: number;
  readonly netMinorUnits: number;
  readonly royaltyMinorUnits: number;
  readonly taxMinorUnits: number;
}

/** A mining-specific ledger account this module provisions locally. */
interface LocalAccountSpec {
  /** Logical key — also the per-(tenant,currency) account-id segment. */
  readonly key: string;
  readonly type: 'PLATFORM_REVENUE' | 'CUSTOMER_LIABILITY' | 'OWNER_OPERATING';
  readonly name: string;
}

/**
 * Deterministic per-(tenant, currency) account id for a mining-specific key.
 * Reuses the shared id scheme so ids never collide with the provisioner's.
 */
function localAccountId(
  tenantId: string,
  currency: string,
  key: string,
): string {
  return ledgerAccountId(tenantId, currency, 'royalty_payable').replace(
    'royalty_payable',
    key,
  );
}

/**
 * Idempotently ensure mining-specific accounts (not in the shared chart) exist
 * for (tenant, currency). Mirrors the shared provisioner exactly: deterministic
 * id, tenant-GUC-bound tx, `ON CONFLICT DO NOTHING`, plus a read-back tenant
 * guard so a colliding id owned by another tenant fails loud.
 */
async function ensureLocalAccounts(
  db: DatabaseClient,
  tenantId: string,
  currency: string,
  specs: ReadonlyArray<LocalAccountSpec>,
  createdBy: string,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const spec of specs) ids[spec.key] = localAccountId(tenantId, currency, spec.key);
  await (
    db as unknown as {
      transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
    }
  ).transaction(async (txRaw) => {
    const tx = txRaw as DatabaseClient;
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    for (const spec of specs) {
      const id = ids[spec.key];
      await tx.execute(sql`
        INSERT INTO accounts (
          id, tenant_id, name, type, status, currency,
          balance_minor_units, entry_count, metadata,
          created_at, updated_at, created_by
        ) VALUES (
          ${id}, ${tenantId}, ${spec.name}, ${spec.type}, 'ACTIVE',
          ${currency}, 0, 0, ${sql.raw("'{}'::jsonb")},
          now(), now(), ${createdBy}
        )
        ON CONFLICT (id) DO NOTHING
      `);
      const row = rowsOf(
        await tx.execute(sql`
          SELECT tenant_id::text AS tenant_id FROM accounts WHERE id = ${id} LIMIT 1
        `),
      )[0];
      const ownerTenantId = row?.tenant_id as string | undefined;
      if (ownerTenantId === undefined) {
        throw new Error(
          `ensureLocalAccounts: account ${id} not visible after upsert ` +
            `(RLS may have hidden a row owned by another tenant)`,
        );
      }
      if (ownerTenantId !== tenantId) {
        throw new Error(
          `ensureLocalAccounts: account ${id} is owned by tenant ${ownerTenantId}, ` +
            `not ${tenantId} — refusing to reuse another tenant's ledger account`,
        );
      }
    }
  });
  return ids;
}

/**
 * Post the mineral-sale proceeds journal through the REAL LedgerService.
 *
 * Returns the journal id + the resolved currency / minor-unit legs so the
 * caller can surface the linkage. MUST be called inside the same
 * db.transaction that inserts the sale + flips the parcel so a failed post
 * rolls back the phantom sale.
 */
export async function postSaleProceeds(
  input: SaleProceedsInput,
): Promise<SaleProceedsResult> {
  const { db, tenantId } = input;

  // Resolve currency from the sale's own legs (no hard-coded currency): a
  // USD-only sale posts in USD; otherwise the tenant's primary currency.
  const grossUsdMajor = toMajor(input.grossPriceUsd);
  const grossTzsMajor = toMajor(input.grossPriceTzs);
  let currency: CurrencyCode;
  let grossMajor: number;
  if (grossUsdMajor > 0 && grossTzsMajor === 0) {
    currency = 'USD';
    grossMajor = grossUsdMajor;
  } else {
    currency = await resolveTenantCurrency(db, tenantId);
    grossMajor = grossTzsMajor > 0 ? grossTzsMajor : grossUsdMajor;
  }
  if (grossMajor <= 0) {
    throw new Error(
      `sale-proceeds-ledger: sale ${input.saleId} has no positive gross price — ` +
        `cannot post a money journal`,
    );
  }

  const grossMinor = majorToMinor(grossMajor, currency);

  // Liability legs: royalty + (VAT + inspection + other levies). Percentage
  // legs are derived off the gross; net is the integer remainder so the
  // journal provably balances.
  const royaltyPct = toMajor(input.royaltyPct);
  const vatPct = toMajor(input.vatPct);
  const inspectionPct = toMajor(input.inspectionPct);
  const royaltyMinor = Math.round((grossMinor * royaltyPct) / 100);
  const taxFromPct = Math.round((grossMinor * (vatPct + inspectionPct)) / 100);
  const otherLeviesMinor = majorToMinor(
    sumOtherLevies(input.otherLevies),
    currency,
  );
  let taxMinor = taxFromPct + otherLeviesMinor;

  // Net = gross − royalty − tax (integer REMAINDER). Always derived so the
  // journal provably balances (DR gross === CR net + royalty + tax) even when
  // the percentage legs round. If liabilities exceed gross, fail loud.
  if (royaltyMinor + taxMinor > grossMinor) {
    throw new Error(
      `sale-proceeds-ledger: royalty (${royaltyMinor}) + tax (${taxMinor}) ` +
        `exceed gross (${grossMinor}) for sale ${input.saleId} — refusing to ` +
        `post an inverted sale`,
    );
  }
  const netMinor = grossMinor - royaltyMinor - taxMinor;

  // Ensure the four accounts exist (idempotent). Royalty + cash come from the
  // shared provisioner; revenue + tax from the local sale provisioner.
  const shared = await ensureLedgerAccounts(db, {
    tenantId,
    currency,
    keys: ['cash_clearing', 'royalty_payable'],
    createdBy: 'mining-sale',
  });
  const saleAccounts = await ensureLocalAccounts(
    db,
    tenantId,
    currency,
    [
      { key: 'revenue_mineral', type: 'PLATFORM_REVENUE', name: 'Mineral Revenue' },
      { key: 'tax_payable', type: 'CUSTOMER_LIABILITY', name: 'Tax Payable' },
    ],
    'mining-sale',
  );

  const meta = { saleId: input.saleId };
  const lines: CreateJournalEntryRequest['lines'] = [
    {
      accountId: shared.cash_clearing as AccountId,
      type: 'RENT_PAYMENT',
      direction: 'DEBIT',
      amount: Money.fromMinorUnits(grossMinor, currency),
      description: `Mineral sale proceeds — ${input.saleId}`,
      metadata: meta,
    },
    {
      accountId: saleAccounts.revenue_mineral as AccountId,
      type: 'RENT_CHARGE',
      direction: 'CREDIT',
      amount: Money.fromMinorUnits(netMinor, currency),
      description: `Mineral revenue — ${input.saleId}`,
      metadata: meta,
    },
  ];
  if (royaltyMinor > 0) {
    lines.push({
      accountId: shared.royalty_payable as AccountId,
      type: 'PLATFORM_FEE',
      direction: 'CREDIT',
      amount: Money.fromMinorUnits(royaltyMinor, currency),
      description: `Royalty payable — ${input.saleId}`,
      metadata: meta,
    });
  }
  if (taxMinor > 0) {
    lines.push({
      accountId: saleAccounts.tax_payable as AccountId,
      type: 'PLATFORM_FEE',
      direction: 'CREDIT',
      amount: Money.fromMinorUnits(taxMinor, currency),
      description: `Tax payable (VAT + levies) — ${input.saleId}`,
      metadata: meta,
    });
  } else {
    taxMinor = 0;
  }

  const request: CreateJournalEntryRequest = {
    tenantId: tenantId as TenantId,
    effectiveDate: new Date(),
    lines,
    createdBy: 'mining-sale',
  };

  // Idempotency: a retried POST of the same sale replays the original journal
  // (no double-post) — recorded inside the atomic post tx.
  const ledger = buildLedgerService(db);
  const result = await ledger.postJournalEntry(request, {
    idempotencyKey: `sale:${input.saleId}`,
  });

  moduleLogger.info(
    {
      tenantId,
      saleId: input.saleId,
      journalId: result.journalId,
      grossMinor,
      netMinor,
      royaltyMinor,
      taxMinor,
      currency,
    },
    'sale_proceeds_ledger_post_committed',
  );

  return {
    journalId: result.journalId,
    currency,
    grossMinorUnits: grossMinor,
    netMinorUnits: netMinor,
    royaltyMinorUnits: royaltyMinor,
    taxMinorUnits: taxMinor,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Licence renewal fee money-leg (FIX: mining-licence-renewal-fee-no-ledger)
// ───────────────────────────────────────────────────────────────────────────

export interface LicenceFeePaymentInput {
  readonly db: DatabaseClient;
  readonly tenantId: string;
  /** The `licences` row id whose renewal fee is paid. */
  readonly licenceId: string;
  /** Renewal fee in MAJOR units (tenant primary currency). */
  readonly feePaidTzs: number;
  /** New expiry date (YYYY-MM-DD) — part of the idempotency key. */
  readonly newExpiryDate: string;
}

export interface LicenceFeePaymentResult {
  readonly journalId: string;
  readonly currency: CurrencyCode;
  readonly amountMinorUnits: number;
}

/**
 * Post a licence RENEWAL FEE through the REAL LedgerService — cash leaving the
 * estate to the regulator:
 *
 *   DR  licence_fee_expense   fee   (operating expense — fee paid to the state)
 *   CR  cash_clearing         fee   (cash out)
 *
 * `licence_fee_expense` is a mining-specific account not in the shared chart,
 * provisioned locally (OWNER_OPERATING). Currency from the tenant's primary
 * currency (no hard-coded currency). MUST be called inside the same
 * db.transaction as the licence update + licence-event insert so the three
 * writes are atomic. Idempotency key `licence-renew:<licenceId>:<newExpiry>` so
 * a retried renewal replays the original journal instead of double-posting.
 */
export async function postLicenceFeePayment(
  input: LicenceFeePaymentInput,
): Promise<LicenceFeePaymentResult> {
  const { db, tenantId } = input;
  if (!Number.isFinite(input.feePaidTzs) || input.feePaidTzs <= 0) {
    throw new Error(
      `licence-fee-ledger: fee must be a positive finite number ` +
        `(got ${String(input.feePaidTzs)})`,
    );
  }
  const currency = await resolveTenantCurrency(db, tenantId);
  const amountMinor = majorToMinor(input.feePaidTzs, currency);

  const shared = await ensureLedgerAccounts(db, {
    tenantId,
    currency,
    keys: ['cash_clearing'],
    createdBy: 'licence-renewal',
  });
  const local = await ensureLocalAccounts(
    db,
    tenantId,
    currency,
    [
      {
        key: 'licence_fee_expense',
        type: 'OWNER_OPERATING',
        name: 'Licence Fee Expense',
      },
    ],
    'licence-renewal',
  );

  const meta = { licenceId: input.licenceId, newExpiryDate: input.newExpiryDate };
  const amount = Money.fromMinorUnits(amountMinor, currency);
  const lines: CreateJournalEntryRequest['lines'] = [
    {
      accountId: local.licence_fee_expense as AccountId,
      type: 'RENT_CHARGE',
      direction: 'DEBIT',
      amount,
      description: `Licence renewal fee — ${input.licenceId}`,
      metadata: meta,
    },
    {
      accountId: shared.cash_clearing as AccountId,
      type: 'OWNER_DISBURSEMENT',
      direction: 'CREDIT',
      amount,
      description: `Licence fee payment — ${input.licenceId}`,
      metadata: meta,
    },
  ];

  const request: CreateJournalEntryRequest = {
    tenantId: tenantId as TenantId,
    effectiveDate: new Date(),
    lines,
    createdBy: 'licence-renewal',
  };

  const ledger = buildLedgerService(db);
  const result = await ledger.postJournalEntry(request, {
    idempotencyKey: `licence-renew:${input.licenceId}:${input.newExpiryDate}`,
  });

  moduleLogger.info(
    {
      tenantId,
      licenceId: input.licenceId,
      journalId: result.journalId,
      amountMinor,
      currency,
    },
    'licence_fee_ledger_post_committed',
  );

  return {
    journalId: result.journalId,
    currency,
    amountMinorUnits: amountMinor,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Procurement budget encumbrance (FIX: mining-procurement-no-po-write)
// ───────────────────────────────────────────────────────────────────────────

export interface BudgetEncumbranceInput {
  readonly db: DatabaseClient;
  readonly tenantId: string;
  /** The `procurement_requisitions` row id this encumbrance commits. */
  readonly requisitionId: string;
  /** Committed amount in MAJOR units. */
  readonly amountMajor: number;
  /** ISO-4217 currency of the requisition (single currency — no hard-code). */
  readonly currency: string;
}

export interface BudgetEncumbranceResult {
  readonly journalId: string;
  readonly currency: CurrencyCode;
  readonly amountMinorUnits: number;
}

/**
 * Post a procurement budget ENCUMBRANCE through the REAL LedgerService — the
 * committed (reserved) spend a requisition represents:
 *
 *   DR  procurement_reserve   amount   (spend reserved/committed)
 *   CR  budget_available      amount   (available budget consumed)
 *
 * Both accounts are mining-specific (OWNER_OPERATING), provisioned locally.
 * The currency is the requisition's own currency (no hard-coded currency).
 * Idempotency key `requisition:<id>` so a retried create replays the original
 * journal. The owner cockpit's Procurement Spend analytics then read committed
 * spend off the canonical `ledger_entries`.
 */
export async function postBudgetEncumbrance(
  input: BudgetEncumbranceInput,
): Promise<BudgetEncumbranceResult> {
  const { db, tenantId } = input;
  const currency = (input.currency || '').toUpperCase() as CurrencyCode;
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(
      `budget-encumbrance: requisition ${input.requisitionId} has an invalid ` +
        `currency '${String(input.currency)}'`,
    );
  }
  const amountMinor = majorToMinor(input.amountMajor, currency);
  if (amountMinor <= 0) {
    throw new Error(
      `budget-encumbrance: requisition ${input.requisitionId} has a non-positive ` +
        `committed amount — nothing to encumber`,
    );
  }

  const accounts = await ensureLocalAccounts(
    db,
    tenantId,
    currency,
    [
      {
        key: 'procurement_reserve',
        type: 'OWNER_OPERATING',
        name: 'Procurement Reserve',
      },
      {
        key: 'budget_available',
        type: 'OWNER_OPERATING',
        name: 'Budget Available',
      },
    ],
    'procurement-requisition',
  );

  const meta = { requisitionId: input.requisitionId };
  const amount = Money.fromMinorUnits(amountMinor, currency);
  const lines: CreateJournalEntryRequest['lines'] = [
    {
      accountId: accounts.procurement_reserve as AccountId,
      type: 'RENT_CHARGE',
      direction: 'DEBIT',
      amount,
      description: `Procurement encumbrance — ${input.requisitionId}`,
      metadata: meta,
    },
    {
      accountId: accounts.budget_available as AccountId,
      type: 'OWNER_DISBURSEMENT',
      direction: 'CREDIT',
      amount,
      description: `Budget reserved — ${input.requisitionId}`,
      metadata: meta,
    },
  ];

  const request: CreateJournalEntryRequest = {
    tenantId: tenantId as TenantId,
    effectiveDate: new Date(),
    lines,
    createdBy: 'procurement-requisition',
  };

  const ledger = buildLedgerService(db);
  const result = await ledger.postJournalEntry(request, {
    idempotencyKey: `requisition:${input.requisitionId}`,
  });

  moduleLogger.info(
    {
      tenantId,
      requisitionId: input.requisitionId,
      journalId: result.journalId,
      amountMinor,
      currency,
    },
    'budget_encumbrance_ledger_post_committed',
  );

  return {
    journalId: result.journalId,
    currency,
    amountMinorUnits: amountMinor,
  };
}
