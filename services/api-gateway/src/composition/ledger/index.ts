/**
 * Production ledger wiring for the LIVE money paths.
 *
 * Replaces the dev SHA-256 stubs in
 *   - services/api-gateway/src/services/settlement/index.ts
 *   - services/api-gateway/src/services/payroll/ledger-port.ts
 * with REAL adapters that post a BALANCED double-entry journal through
 * the package's `LedgerService` (imported from the barrel — the CLAUDE.md
 * "money goes through LedgerService.post()" hard rule is satisfied by the
 * real service performing the atomic CAS post).
 *
 * Package-vs-HTTP decision: `@borjie/payments-ledger-service` is an
 * importable workspace package (already a dependency of api-gateway, used
 * by the arrears wiring). We construct `LedgerService` IN PROCESS against
 * the gateway's own Drizzle `DatabaseClient`. No HTTP hop.
 *
 * Idempotency: each adapter derives a stable key (settlement →
 * `responseId:idempotencyKey`; payroll → `payrollRunId:workerUserId`) and
 * passes it to `LedgerService.postJournalEntry()` as its `idempotencyKey`.
 * The hardened ledger records it under a UNIQUE (tenant_id,
 * idempotency_key) row INSIDE the same transaction as the atomic post
 * (`postJournalAtomic`), so a retry returns the ORIGINAL journal without
 * double-posting — durably and race-safe. No adapter-level metadata probe
 * (that pre-check window could not survive a concurrent retry). The
 * orchestrator's own status-machine guard remains a belt on top.
 */

import {
  LedgerService,
  InMemoryEventPublisher,
  StripePaymentProvider,
} from '@borjie/payments-ledger-service';
import type { IPaymentProvider } from '@borjie/payments-ledger-service';
import type {
  CreateJournalEntryRequest,
  CurrencyCode,
  TenantId,
  AccountId,
  EntryDirection,
  LedgerEntryType,
} from '@borjie/domain-models';
import { Money } from '@borjie/domain-models';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
// `DatabaseClient` type derived via ReturnType to dodge the TS2709
// namespace collision (see drizzle-ledger-repos.ts header).
import { createDatabaseClient } from '@borjie/database';
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

import { createLogger } from '../../utils/logger';
import {
  GatewayDrizzleAccountRepository,
  GatewayDrizzleLedgerRepository,
} from './drizzle-ledger-repos';
import {
  ensureLedgerAccounts,
  type LedgerAccountKey,
} from './accounts-provisioner';
import {
  splitSettlementMinorUnits,
  toIntegerMinorUnits,
  type SettlementMinorUnitSplit,
} from './money-minor-units';
import type {
  SettlementLedgerPort,
  SettlementLedgerPostInput,
  SettlementLedgerPostResult,
} from '../../services/settlement/types';
import {
  __setSettlementProductionLedgerPort,
  __setSettlementProductionPayoutPort,
  __allowSettlementLedgerStub,
  __allowSettlementPayoutStub,
} from '../../services/settlement';
import {
  createSettlementPayoutAdapter,
  isSettlementPayoutEnabled,
} from './settlement-payout-adapter';
import type {
  PayrollLedgerPort,
  PayrollPostInput,
  PayrollPostResult,
} from '../../services/payroll/ledger-port';
import {
  __setPayrollProductionLedgerPort,
  __allowPayrollLedgerStub,
} from '../../services/payroll/ledger-port';

const moduleLogger = createLogger('ledger-production-wiring');

/**
 * Pino-shaped logger the LedgerService expects
 * (info/warn/error(message, context)). Bridges to the gateway logger.
 */
const ledgerLogger = {
  info: (message: string, context?: Record<string, unknown>): void =>
    moduleLogger.info(context ?? {}, message),
  warn: (message: string, context?: Record<string, unknown>): void =>
    moduleLogger.warn(context ?? {}, message),
  error: (message: string, context?: Record<string, unknown>): void =>
    moduleLogger.error(context ?? {}, message),
};

/**
 * Build a real `LedgerService` bound to the gateway's Drizzle client.
 * The `InMemoryEventPublisher` is sufficient here: the balance-update /
 * journal-created events are an in-process notification, not the durable
 * money record — the durable record is the `ledger_entries` rows the
 * repository writes inside the CAS-guarded post.
 */
export function buildLedgerService(db: DatabaseClient): LedgerService {
  return new LedgerService({
    ledgerRepository: new GatewayDrizzleLedgerRepository(db),
    accountRepository: new GatewayDrizzleAccountRepository(db),
    eventPublisher: new InMemoryEventPublisher(),
    logger: ledgerLogger,
  });
}

// ────────────────────────────────────────────────────────────────────
// Tenant primary-currency resolution (no hard-coded currency in the
// money path — CLAUDE.md). Cached per tenant for the process lifetime.
// ────────────────────────────────────────────────────────────────────

const tenantCurrencyCache = new Map<string, CurrencyCode>();

async function resolveTenantCurrency(
  db: DatabaseClient,
  tenantId: string,
): Promise<CurrencyCode> {
  const cached = tenantCurrencyCache.get(tenantId);
  if (cached) return cached;

  const raw = await db.execute(sql`
    SELECT primary_currency
      FROM tenants
     WHERE id = ${tenantId}::uuid
     LIMIT 1
  `);
  const rows = rowsOf(raw);
  const currency = rows[0]?.primary_currency as string | undefined;
  if (!currency) {
    throw new Error(
      `resolveTenantCurrency: tenant ${tenantId} has no primary_currency — ` +
        `cannot post a ledger journal without a currency`,
    );
  }
  const code = currency as CurrencyCode;
  tenantCurrencyCache.set(tenantId, code);
  return code;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

// ────────────────────────────────────────────────────────────────────
// Journal-line helper
// ────────────────────────────────────────────────────────────────────

function line(
  accountId: string,
  direction: EntryDirection,
  type: LedgerEntryType,
  amountMinor: number,
  currency: CurrencyCode,
  description: string,
  metadata: Record<string, unknown>,
): CreateJournalEntryRequest['lines'][number] {
  return {
    accountId: accountId as AccountId,
    type,
    direction,
    amount: Money.fromMinorUnits(amountMinor, currency),
    description,
    metadata,
  };
}

/**
 * Assert the journal balances per currency BEFORE handing it to the
 * ledger. The LedgerService re-checks via `validateJournalBalance`, but
 * we fail loud here too — real money, belt and suspenders.
 */
export function assertBalanced(
  lines: ReadonlyArray<{ direction: EntryDirection; amount: Money }>,
): void {
  const byCurrency = new Map<string, number>();
  for (const l of lines) {
    const cur = l.amount.currency;
    const signed =
      l.direction === 'DEBIT' ? l.amount.amountMinorUnits : -l.amount.amountMinorUnits;
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + signed);
  }
  for (const [cur, net] of byCurrency) {
    if (net !== 0) {
      throw new Error(
        `Journal does not balance for ${cur}: net debits-minus-credits = ${net} (must be 0)`,
      );
    }
  }
}

/**
 * Money-bound settlement idempotency key (H3). A stable SHA-256 over the
 * responseId AND the four integer legs (gross/royalty/fee/net), so the key
 * is a pure function of the financial substance: ANY change to ANY amount
 * yields a different key and forces a fresh ledger post, while a genuine
 * retry of the identical settlement collides on the same key and replays
 * the original journal (no double-post). Prefixed `stl:` for readability
 * in the `journal_idempotency` table.
 */
export function settlementMoneyKey(
  responseId: string,
  split: SettlementMinorUnitSplit,
): string {
  const material = [
    responseId,
    split.grossMinor,
    split.royaltyMinor,
    split.feeMinor,
    split.netMinor,
  ].join(':');
  const digest = createHash('sha256').update(material).digest('hex');
  return `stl:${responseId}:${digest.slice(0, 32)}`;
}

// ────────────────────────────────────────────────────────────────────
// Settlement adapter
// ────────────────────────────────────────────────────────────────────

/**
 * Settlement → 4-leg balanced journal:
 *   DR  settlement_clearing   gross
 *   CR  royalty_payable       royalty
 *   CR  platform_fee_revenue  fee
 *   CR  seller_payable        net   (gross - royalty - fee, integer remainder)
 *
 * Idempotent on the settlement id: `settlementKey` is passed as the
 * ledger `idempotencyKey`, deduped inside the atomic post's transaction.
 */
export function createSettlementLedgerAdapter(
  db: DatabaseClient,
  ledger: LedgerService,
): SettlementLedgerPort {
  return {
    async post(
      input: SettlementLedgerPostInput,
    ): Promise<SettlementLedgerPostResult> {
      const tenantId = input.tenantId;

      const currency = await resolveTenantCurrency(db, tenantId);

      // ---- integer minor-unit split that provably balances -----------
      // Computed BEFORE the idempotency key so the key can bind to the
      // actual money content (H3).
      const split = splitSettlementMinorUnits(input.math);

      // Idempotency key for this settlement money event. It MUST be a pure
      // function of the MONEY content, not just the CoC-step checksum: if
      // two economically-DIFFERENT settlements ever shared a checksum, a
      // checksum-only key would silently no-op the second post and return
      // the FIRST journal — under-posting real money behind a success
      // surface. We therefore hash the responseId together with the four
      // integer legs (gross/royalty/fee/net), so ANY amount change forces a
      // NEW key and a fresh post. Passed to `LedgerService.postJournalEntry()`
      // as its `idempotencyKey`, recorded under a UNIQUE (tenant_id,
      // idempotency_key) row in the SAME transaction as the atomic post
      // (durability defect #2): a genuine retry (identical money) returns
      // the ORIGINAL journal without double-posting. A sibling engine-side
      // replay-amount assertion is the backstop. Defence in depth on top of
      // the orchestrator's status-machine guard.
      const settlementKey = settlementMoneyKey(input.responseId, split);

      // ---- ensure the chart-of-accounts exists -----------------------
      const keys: ReadonlyArray<LedgerAccountKey> = [
        'settlement_clearing',
        'royalty_payable',
        'platform_fee_revenue',
        'seller_payable',
      ];
      const accounts = await ensureLedgerAccounts(db, {
        tenantId,
        currency,
        keys,
        createdBy: 'settlement-orchestrator',
      });

      const meta = { settlementKey, responseId: input.responseId };

      // ---- build the balanced journal --------------------------------
      const lines = [
        line(
          accounts.settlement_clearing,
          'DEBIT',
          'RENT_PAYMENT',
          split.grossMinor,
          currency,
          'Settlement gross (buyer clearing)',
          meta,
        ),
        line(
          accounts.royalty_payable,
          'CREDIT',
          'PLATFORM_FEE',
          split.royaltyMinor,
          currency,
          'Royalty payable',
          meta,
        ),
        line(
          accounts.platform_fee_revenue,
          'CREDIT',
          'PLATFORM_FEE',
          split.feeMinor,
          currency,
          'Platform fee revenue',
          meta,
        ),
        line(
          accounts.seller_payable,
          'CREDIT',
          'OWNER_DISBURSEMENT',
          split.netMinor,
          currency,
          'Seller net payable',
          meta,
        ),
      ];
      assertBalanced(lines);

      const request: CreateJournalEntryRequest = {
        tenantId: tenantId as TenantId,
        effectiveDate: new Date(),
        lines,
        createdBy: 'settlement-orchestrator',
      };

      // ---- post through the REAL LedgerService -----------------------
      // `settlementKey` is the durable idempotency key: postJournalAtomic
      // writes it (tenant_id, idempotency_key) in the same tx as the
      // post, so a retry returns the original journal (no double-post).
      const result = await ledger.postJournalEntry(request, {
        idempotencyKey: settlementKey,
      });

      moduleLogger.info(
        {
          tenantId,
          responseId: input.responseId,
          journalId: result.journalId,
          grossMinor: split.grossMinor,
          royaltyMinor: split.royaltyMinor,
          feeMinor: split.feeMinor,
          netMinor: split.netMinor,
          currency,
        },
        'settlement_ledger_post_committed',
      );
      return { journalId: result.journalId };
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Payroll adapter
// ────────────────────────────────────────────────────────────────────

/**
 * Payroll → 2-leg balanced journal per worker line item:
 *   DR  wage_expense       net
 *   CR  payroll_clearing   net
 *
 * Idempotent on (payroll-run, worker): `payrollKey` is passed as the
 * ledger `idempotencyKey`, deduped inside the atomic post's transaction.
 */
export function createPayrollLedgerAdapter(
  db: DatabaseClient,
  ledger: LedgerService,
): PayrollLedgerPort {
  return {
    async post(input: PayrollPostInput): Promise<PayrollPostResult> {
      const tenantId = input.tenantId;
      // Idempotency key for this payroll money event: (run, worker).
      // Passed to `LedgerService.postJournalEntry()` as its
      // `idempotencyKey`; postJournalAtomic writes it under a UNIQUE
      // (tenant_id, idempotency_key) row in the same tx as the post, so a
      // retry returns the original journal (no double-post) — durably and
      // race-safe, no separate metadata probe.
      const payrollKey = `${input.payrollRunId}:${input.workerUserId}`;

      const currency = await resolveTenantCurrency(db, tenantId);
      const netMinor = toIntegerMinorUnits(input.netTzs, 'payroll_net');
      if (netMinor <= 0) {
        throw new Error(
          `Payroll net must be positive minor units (got ${netMinor}) for ` +
            `run ${input.payrollRunId} worker ${input.workerUserId}`,
        );
      }

      const accounts = await ensureLedgerAccounts(db, {
        tenantId,
        currency,
        keys: ['wage_expense', 'payroll_clearing'],
        createdBy: 'payroll-commit',
      });

      const meta = {
        payrollKey,
        payrollRunId: input.payrollRunId,
        workerUserId: input.workerUserId,
      };

      const lines = [
        line(
          accounts.wage_expense,
          'DEBIT',
          'OWNER_CONTRIBUTION',
          netMinor,
          currency,
          'Wage expense',
          meta,
        ),
        line(
          accounts.payroll_clearing,
          'CREDIT',
          'OWNER_DISBURSEMENT',
          netMinor,
          currency,
          'Net wages payable',
          meta,
        ),
      ];
      assertBalanced(lines);

      const request: CreateJournalEntryRequest = {
        tenantId: tenantId as TenantId,
        effectiveDate: new Date(),
        lines,
        createdBy: 'payroll-commit',
      };

      // `payrollKey` is the durable idempotency key — see settlement
      // adapter. postJournalAtomic dedupes it inside the post tx.
      const result = await ledger.postJournalEntry(request, {
        idempotencyKey: payrollKey,
      });

      moduleLogger.info(
        {
          tenantId,
          payrollRunId: input.payrollRunId,
          workerUserId: input.workerUserId,
          journalId: result.journalId,
          netMinor,
          currency,
        },
        'payroll_ledger_post_committed',
      );
      return { journalId: result.journalId };
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Composition-root entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Install the production settlement + payroll ledger adapters. Called
 * once from the gateway boot sequence with the singleton Drizzle client.
 *
 * When `db` is null (DATABASE_URL unset) we EXPLICITLY allow the dev stub
 * via `__allow*LedgerStub(true)` — there is no money infrastructure in
 * that mode, so a no-op post is correct and the gateway still boots.
 *
 * When `db` is non-null we register the REAL adapters and do NOT allow the
 * stub. If this throws, the caller in `index.ts` rethrows (fail boot, M1):
 * leaving the stub un-allowed means `resolveSettlement/PayrollLedgerPort`
 * fail loud with `LEDGER_NOT_WIRED` rather than silently no-op-posting and
 * firing a real payout against no ledger entry.
 */
export function registerProductionLedgerPorts(
  db: DatabaseClient | null,
): void {
  if (!db) {
    __allowSettlementLedgerStub(true);
    __allowPayrollLedgerStub(true);
    __allowSettlementPayoutStub(true);
    moduleLogger.warn(
      {},
      'ledger_production_wiring_skipped_no_db (dev stub explicitly allowed — no database present)',
    );
    return;
  }
  const ledger = buildLedgerService(db);
  __setSettlementProductionLedgerPort(createSettlementLedgerAdapter(db, ledger));
  __setPayrollProductionLedgerPort(createPayrollLedgerAdapter(db, ledger));

  // Settlement PAYOUT rail (FIX 1). Ship-dark behind a kill-switch:
  // registered ONLY when `BORJIE_SETTLEMENT_PAYOUT_ENABLED` is truthy AND a
  // payment provider is configured. When the flag is OFF (default) we leave
  // the payout port UNREGISTERED so `resolveSettlementPayoutPort` keeps
  // failing LOUD (PAYOUT_NOT_WIRED) rather than fabricating a fake payout
  // success. The adapter triggers the EXTERNAL transfer AFTER the ledger has
  // posted — it never writes ledger entries (LedgerService.post() stays the
  // sole ledger writer).
  registerSettlementPayoutPort(db);

  moduleLogger.info(
    {},
    'ledger_production_wiring_active (settlement + payroll → LedgerService.post)',
  );
}

/**
 * Build the payment provider for the seller-payout rail. Mirrors the
 * platform-billing provider construction (gated by `STRIPE_SECRET_KEY`).
 * Returns null when no provider key is present so the caller leaves the
 * payout port unregistered (fail-loud). Stripe is the only externally
 * available transfer rail today; the Tanzania TZS M-Pesa B2C provider + creds
 * remain a follow-up blocker (M-Pesa B2C is KES-only at present).
 */
function buildPayoutProvider(): IPaymentProvider | null {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeKey) return null;
  try {
    return new StripePaymentProvider({
      secretKey: stripeKey,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '',
    });
  } catch (err) {
    moduleLogger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'settlement_payout_provider_init_failed',
    );
    return null;
  }
}

/**
 * Register the production settlement payout port behind the kill-switch
 * flag. Leaves the port unregistered (fail-loud PAYOUT_NOT_WIRED) when the
 * flag is OFF or no provider is configured.
 */
function registerSettlementPayoutPort(db: DatabaseClient): void {
  if (!isSettlementPayoutEnabled()) {
    moduleLogger.warn(
      {},
      'settlement_payout_port_disabled (BORJIE_SETTLEMENT_PAYOUT_ENABLED off — ' +
        'resolveSettlementPayoutPort will fail loud PAYOUT_NOT_WIRED; safe to ship dark)',
    );
    return;
  }
  const provider = buildPayoutProvider();
  if (!provider) {
    moduleLogger.warn(
      {},
      'settlement_payout_port_no_provider (flag on but no payment provider ' +
        'configured — leaving port unwired; resolveSettlementPayoutPort fails loud)',
    );
    return;
  }
  __setSettlementProductionPayoutPort(
    createSettlementPayoutAdapter(db, provider),
  );
  moduleLogger.info(
    { provider: provider.name },
    'settlement_payout_port_wired (flag on, external transfer rail active — ' +
      'ledger posts first; payout triggers the external transfer only)',
  );
}
