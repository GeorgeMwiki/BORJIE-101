/**
 * Tenant-scoped chart-of-accounts provisioner for settlement + payroll
 * journals.
 *
 * `LedgerService.postJournalEntry()` resolves every journal line's
 * account via `accountRepository.findById(accountId, tenantId)` and
 * THROWS if the account does not exist. The mining-domain database has no
 * chart-of-accounts seeder yet (the property-domain `demo-org-seed`
 * accounts are gone), so each money event must be able to find its
 * accounts. This module provisions the small fixed set of clearing /
 * payable / revenue accounts a settlement or payroll post needs, keyed by
 * a deterministic per-(tenant, currency) id, with an idempotent
 * `ON CONFLICT DO NOTHING` insert.
 *
 *   >>> FLAGGED SIBLING DEP <<<  The `accounts` table itself is restored
 *   by the ledger-durability / migration sibling (archived migration
 *   0167b). Until that lands, the INSERT below targets a table that does
 *   not exist and the post fails LOUD (correct — we never silently
 *   succeed a money event without a ledger row). A real mining
 *   chart-of-accounts (with proper account codes + a controlling
 *   GL hierarchy) is a follow-up the finance-schema owner should land;
 *   these auto-provisioned accounts are the minimum that makes the
 *   double-entry post balanced and durable today.
 *
 * Account types are drawn from the existing 6-value `AccountType` enum
 * (CUSTOMER_LIABILITY | CUSTOMER_DEPOSIT | OWNER_OPERATING | OWNER_RESERVE
 * | PLATFORM_REVENUE | PLATFORM_HOLDING). The double-entry direction is
 * carried by the journal line, not the account type, so the labels below
 * are the closest semantic fit; balance correctness does not depend on
 * them.
 */

import { sql } from 'drizzle-orm';
// `DatabaseClient` type derived via ReturnType to dodge the TS2709
// namespace collision (see drizzle-ledger-repos.ts header).
import { createDatabaseClient } from '@borjie/database';
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
import type { AccountType } from '@borjie/domain-models';

/** Logical settlement / payroll / platform-billing accounts a journal references. */
export type LedgerAccountKey =
  | 'settlement_clearing' // DR side of a mineral-sale settlement
  | 'royalty_payable' // CR — royalty owed to the state
  | 'platform_fee_revenue' // CR — Borjie platform fee
  | 'seller_payable' // CR — net owed to the seller
  | 'wage_expense' // DR side of payroll
  | 'payroll_clearing' // CR — net wages owed to workers
  | 'platform_billing_receivable' // DR — SaaS subscription owed to Borjie
  | 'platform_subscription_revenue' // CR — Borjie SaaS subscription revenue
  | 'cash_clearing' // DR — funds received pending settlement (deposits/receipts)
  | 'tenant_deposits'; // CR — refundable counterparty deposit liability

interface AccountSpec {
  readonly key: LedgerAccountKey;
  readonly type: AccountType;
  readonly name: string;
}

const ACCOUNT_SPECS: ReadonlyArray<AccountSpec> = [
  {
    key: 'settlement_clearing',
    type: 'PLATFORM_HOLDING',
    name: 'Settlement Clearing',
  },
  {
    key: 'royalty_payable',
    type: 'CUSTOMER_LIABILITY',
    name: 'Royalty Payable',
  },
  {
    key: 'platform_fee_revenue',
    type: 'PLATFORM_REVENUE',
    name: 'Platform Fee Revenue',
  },
  {
    key: 'seller_payable',
    type: 'CUSTOMER_LIABILITY',
    name: 'Seller Payable',
  },
  {
    key: 'wage_expense',
    type: 'OWNER_OPERATING',
    name: 'Wage Expense',
  },
  {
    key: 'payroll_clearing',
    type: 'PLATFORM_HOLDING',
    name: 'Payroll Clearing',
  },
  {
    // DR side of the platform SaaS subscription: the receivable Borjie is
    // owed by the tenant for the platform fee. OWNER_OPERATING is the
    // closest semantic fit (direction is carried by the journal line).
    key: 'platform_billing_receivable',
    type: 'OWNER_OPERATING',
    name: 'Platform Billing Receivable',
  },
  {
    // CR side: Borjie's own SaaS subscription revenue.
    key: 'platform_subscription_revenue',
    type: 'PLATFORM_REVENUE',
    name: 'Platform Subscription Revenue',
  },
  {
    // DR side of an estate deposit / receipt: cash received into a holding
    // account pending allocation. PLATFORM_HOLDING is the closest fit
    // (direction is carried by the journal line, not the account type).
    key: 'cash_clearing',
    type: 'PLATFORM_HOLDING',
    name: 'Cash Clearing',
  },
  {
    // CR side: refundable counterparty (tenant) deposit liability.
    key: 'tenant_deposits',
    type: 'CUSTOMER_DEPOSIT',
    name: 'Tenant Deposits',
  },
];

const SPEC_BY_KEY: ReadonlyMap<LedgerAccountKey, AccountSpec> = new Map(
  ACCOUNT_SPECS.map((s) => [s.key, s]),
);

/**
 * Deterministic, collision-free account id for a (tenant, currency, key)
 * triple. Currency is part of the id because the ledger refuses to post a
 * line whose currency differs from the account's currency — a tenant that
 * settles in two currencies needs one clearing account per currency.
 */
export function ledgerAccountId(
  tenantId: string,
  currency: string,
  key: LedgerAccountKey,
): string {
  return `mining-${key}-${currency.toLowerCase()}-${tenantId}`;
}

/**
 * Idempotently ensure the named accounts exist for (tenant, currency).
 * Uses a single multi-row INSERT … ON CONFLICT DO NOTHING so concurrent
 * posts race safely. Returns the resolved account ids keyed by logical
 * name so the caller can build the journal lines.
 *
 * Tenant isolation (M2): this runs on the boot-singleton pool — a
 * DIFFERENT connection from the request middleware that normally binds
 * `app.current_tenant_id` — so the whole provisioning runs inside ONE
 * transaction whose FIRST statement binds the tenant GUC transaction-
 * locally (`set_config(..., true)`), making the INSERT subject to FORCE
 * RLS. As a second line of defence (even if RLS is inert under a Supabase
 * BYPASSRLS role) we read each upserted row back and assert its
 * `tenant_id` equals the caller's — a deterministic account id whose row
 * is owned by a DIFFERENT tenant is a hard fault that must fail loud, never
 * silently reuse another tenant's account.
 */
export async function ensureLedgerAccounts(
  db: DatabaseClient,
  args: {
    readonly tenantId: string;
    readonly currency: string;
    readonly keys: ReadonlyArray<LedgerAccountKey>;
    readonly createdBy: string;
  },
): Promise<Record<LedgerAccountKey, string>> {
  if (!args.tenantId) {
    throw new Error('ensureLedgerAccounts requires a non-empty tenantId');
  }
  const ids = {} as Record<LedgerAccountKey, string>;
  const values = args.keys.map((key) => {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) {
      throw new Error(`ensureLedgerAccounts: unknown account key '${key}'`);
    }
    const id = ledgerAccountId(args.tenantId, args.currency, key);
    ids[key] = id;
    return { id, type: spec.type, name: spec.name };
  });

  await (
    db as unknown as {
      transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
    }
  ).transaction(async (txRaw) => {
    const tx = txRaw as DatabaseClient;
    // FIRST statement — bind the tenant GUC transaction-locally so the
    // INSERT/SELECT below are RLS-scoped to this tenant (M2). `true`
    // scopes set_config to this tx so it cannot leak across the pool.
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${args.tenantId}, true)`,
    );

    // Build a VALUES list. Each row carries the same tenant/currency/status.
    // ON CONFLICT (id) DO NOTHING keeps the call idempotent across retries
    // and concurrent settlements.
    for (const v of values) {
      await tx.execute(sql`
        INSERT INTO accounts (
          id, tenant_id, name, type, status, currency,
          balance_minor_units, entry_count, metadata,
          created_at, updated_at, created_by
        ) VALUES (
          ${v.id}, ${args.tenantId}, ${v.name}, ${v.type}, 'ACTIVE',
          ${args.currency}, 0, 0, ${sql.raw("'{}'::jsonb")},
          now(), now(), ${args.createdBy}
        )
        ON CONFLICT (id) DO NOTHING
      `);

      // Tenant guard — read the (now-guaranteed-present) row back and
      // assert ownership. A deterministic id colliding with another
      // tenant's account fails loud rather than silently cross-posting.
      const raw = await tx.execute(sql`
        SELECT tenant_id::text AS tenant_id
          FROM accounts
         WHERE id = ${v.id}
         LIMIT 1
      `);
      const row = rowsOf(raw)[0];
      const ownerTenantId = row?.tenant_id as string | undefined;
      if (ownerTenantId === undefined) {
        throw new Error(
          `ensureLedgerAccounts: account ${v.id} not visible after upsert ` +
            `(RLS may have hidden a row owned by another tenant)`,
        );
      }
      if (ownerTenantId !== args.tenantId) {
        throw new Error(
          `ensureLedgerAccounts: account ${v.id} is owned by tenant ` +
            `${ownerTenantId}, not ${args.tenantId} — refusing to reuse ` +
            `another tenant's ledger account`,
        );
      }
    }
  });

  return ids;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}
