/**
 * /api/v1/mining/buyers/wallet — buyer wallet snapshot (BY-4).
 *
 * Backs `apps/buyer-mobile/src/api/wallet.ts` → the marketplace
 * `WalletBar`. Returns the buyer's REAL at-a-glance balance plus
 * display-only pinned FX. The buyer-mobile NEVER converts client-side;
 * the FX rates here are render hints only (per buyer-sota §8).
 *
 * REAL data sources:
 *   - `accounts.balance_minor_units` (bigint, the canonical double-entry
 *     ledger) summed over the buyer's customer-scoped accounts for the
 *     buyer's preferred currency. This is the AUTHORITATIVE balance —
 *     `balance_minor_units` is maintained inside the ledger's atomic post,
 *     so it reflects every top-up / escrow release / settlement. We do NOT
 *     read the `buyers.wallet_balance_minor` mirror column (migration 0087):
 *     it has no write path and would always read a stale 0.
 *   - `buyers.preferred_currency` — the buyer's native render unit
 *     (USD/TZS/KES/EUR/CNY/INR per the 0087 CHECK constraint).
 *   - `fx_rates` (treasury schema) — the live BoT `TZS_USD` spot the
 *     fx-feed-cron writes. Used ONLY to pin a display rate.
 *
 * HONESTY / FLAGS (no fabricated balances):
 *   - The `WalletSnapshot` shape carries three fixed currency fields
 *     (tzs / usd / kes). Only the buyer's `preferred_currency` has a
 *     real balance; the other two are returned as 0 and the snapshot is
 *     flagged so the client can render "—" rather than a fake figure.
 *   - `kesPerTzs` has NO real source — the fx-feed-cron only writes
 *     `TZS_USD` (+ XAU benchmarks), not a TZS/KES pair. It is returned
 *     as 0 and flagged. `usdPerTzs` is derived from the real `TZS_USD`
 *     row (usdPerTzs = 1 / (TZS per USD)).
 *   - When the calling user has no linked buyer row, we return a zeroed
 *     snapshot with `available: false` + a flag — never invented funds.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; `buyers` is
 * FORCE-RLS. We additionally scope to the calling user's linked buyer
 * (`buyers.linked_user_id = auth.userId`) so one tenant's users cannot
 * read each other's wallet.
 */

import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';

import { fxRates, CURRENCY_DECIMALS } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-buyers-wallet');

/** Narrow an unknown driver result to its row array (drizzle / node-pg). */
function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

/** Currency codes the buyer-mobile `WalletSnapshot` renders as fixed fields. */
const SNAPSHOT_CURRENCIES = ['TZS', 'USD', 'KES'] as const;

interface WalletFlags {
  /**
   * True when a real, linked buyer wallet was found. When false the
   * balances are zeroed placeholders and the client should hide / dim
   * the wallet bar rather than render fabricated zeros as real funds.
   */
  readonly available: boolean;
  /** Real balance currency (the buyer's preferred render unit). */
  readonly balanceCurrency: string | null;
  /**
   * Non-fatal notes the client / integrator can surface — e.g. which
   * currency fields are placeholders and which FX legs lack a source.
   */
  readonly notes: ReadonlyArray<string>;
}

interface WalletSnapshotPayload {
  readonly tzs: number;
  readonly usd: number;
  readonly kes: number;
  readonly fxRates: {
    readonly usdPerTzs: number;
    readonly kesPerTzs: number;
    readonly capturedAt: string;
  };
  readonly flags: WalletFlags;
}

/** Convert a minor-units integer to a major-unit decimal, currency-aware. */
function minorToMajor(minor: number, currency: string): number {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  if (decimals === 0) return minor;
  return minor / Math.pow(10, decimals);
}

export const buyersWalletRouter = new Hono();
buyersWalletRouter.use('*', authMiddleware);
buyersWalletRouter.use('*', databaseMiddleware);

buyersWalletRouter.get('/wallet', async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WALLET_UNAVAILABLE',
          message: {
            en: 'Wallet service temporarily unavailable',
            sw: 'Huduma ya pochi haipatikani kwa muda',
          },
        },
      },
      503,
    );
  }

  // ---- pin a display-only FX rate from the REAL TZS_USD spot ----------
  // fx_rates is tenant-agnostic (global BoT/LBMA benchmarks). `TZS_USD`
  // = TZS per 1 USD, so usdPerTzs = 1 / rate. Best-effort: if the feed
  // has no row yet we leave usdPerTzs = 0 and flag it.
  let usdPerTzs = 0;
  let fxCapturedAt = new Date().toISOString();
  const fxNotes: string[] = [];
  try {
    const fxRow = await db
      .select({ rate: fxRates.rate, ts: fxRates.ts })
      .from(fxRates)
      .where(eq(fxRates.pair, 'TZS_USD'))
      .orderBy(desc(fxRates.ts))
      .limit(1);
    const row = fxRow[0];
    const rate = row ? Number(row.rate) : 0;
    if (row && rate > 0) {
      usdPerTzs = 1 / rate;
      fxCapturedAt =
        row.ts instanceof Date
          ? row.ts.toISOString()
          : new Date(String(row.ts)).toISOString();
    } else {
      fxNotes.push('FLAG: no live TZS_USD fx_rates row — usdPerTzs is 0');
    }
  } catch (err) {
    moduleLogger.warn(
      { err, tenantId: auth.tenantId },
      'wallet_fx_lookup_failed',
    );
    fxNotes.push('FLAG: fx_rates lookup failed — usdPerTzs is 0');
  }
  // kesPerTzs has no backing source (fx-feed-cron writes no TZS/KES pair).
  fxNotes.push('FLAG: kesPerTzs has no fx_rates source — returned 0');

  // ---- resolve the calling user's linked buyer (tenant + user scoped) -
  // AUTHORITATIVE balance: the buyer's balance is read from the canonical
  // double-entry `accounts` table (balance_minor_units is maintained inside
  // the ledger's atomic post), NOT the `buyers.wallet_balance_minor` mirror,
  // which has no write path and would always read 0. We sum the buyer's
  // customer-scoped account balances per the buyer's preferred currency.
  let balanceMinor = 0;
  let currency = 'USD';
  let hasBuyer = false;
  let ledgerBalanceAvailable = false;
  try {
    // `preferred_currency` exists in the DB (migration 0087) but is not
    // declared on the canonical `buyers` Drizzle table, so we read it (and
    // the buyer id, to scope the ledger accounts) with parameterised SQL.
    const buyerRow = rowsOf(
      await db.execute(sql`
        SELECT
          id,
          COALESCE(preferred_currency, 'USD') AS preferred_currency
          FROM buyers
         WHERE tenant_id = ${auth.tenantId}
           AND linked_user_id = ${auth.userId}
         LIMIT 1
      `),
    )[0];
    if (buyerRow) {
      hasBuyer = true;
      currency = String(buyerRow.preferred_currency || 'USD');
      const buyerId = String(buyerRow.id);

      // Sum the authoritative customer-scoped balances from the ledger's
      // `accounts` table for this buyer + currency. A positive net liability
      // (CUSTOMER_LIABILITY / CUSTOMER_DEPOSIT) is the buyer's spendable
      // wallet. Tenant-scoped (RLS + predicate) + customer-scoped.
      const balRow = rowsOf(
        await db.execute(sql`
          SELECT COALESCE(SUM(balance_minor_units), 0) AS balance_minor
            FROM accounts
           WHERE tenant_id = ${auth.tenantId}
             AND customer_id = ${buyerId}
             AND currency = ${currency}
             AND status = 'ACTIVE'
        `),
      )[0];
      if (balRow) {
        balanceMinor = Number(balRow.balance_minor ?? 0);
        ledgerBalanceAvailable = true;
      }
    }
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'wallet_buyer_lookup_failed',
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'WALLET_LOOKUP_FAILED',
          message: {
            en: 'Failed to load wallet',
            sw: 'Imeshindwa kupakia pochi',
          },
        },
      },
      500,
    );
  }

  if (!hasBuyer) {
    // No linked buyer — honest empty, flagged. Never fabricate funds.
    moduleLogger.info(
      { tenantId: auth.tenantId },
      'wallet_no_linked_buyer_returning_empty',
    );
    const payload: WalletSnapshotPayload = {
      tzs: 0,
      usd: 0,
      kes: 0,
      fxRates: { usdPerTzs, kesPerTzs: 0, capturedAt: fxCapturedAt },
      flags: {
        available: false,
        balanceCurrency: null,
        notes: [
          'FLAG: no linked buyer row for this user — submit KYC at ' +
            '/api/v1/mining/buyers/kyc first; balances are placeholders',
          ...fxNotes,
        ],
      },
    };
    return c.json({ success: true as const, data: payload }, 200);
  }

  // ---- map the REAL balance onto the snapshot's fixed currency fields -
  const major = minorToMajor(balanceMinor, currency);
  const balanceNotes: string[] = [];
  let tzs = 0;
  let usd = 0;
  let kes = 0;
  if (currency === 'TZS') {
    tzs = major;
  } else if (currency === 'USD') {
    usd = major;
  } else if (currency === 'KES') {
    kes = major;
  } else {
    // The real balance is in a currency the fixed snapshot can't show
    // (EUR/CNY/INR). Surface it via the flag rather than mis-attributing
    // it to one of the three fixed fields.
    balanceNotes.push(
      `FLAG: real balance is in ${currency} (${major}) — not representable ` +
        'in the tzs/usd/kes snapshot fields; shown as 0 to avoid mis-display',
    );
  }
  // Note which fixed fields are placeholders (not real wallet legs).
  for (const code of SNAPSHOT_CURRENCIES) {
    if (code !== currency) {
      balanceNotes.push(`FLAG: ${code.toLowerCase()} field is placeholder (0)`);
    }
  }
  if (!ledgerBalanceAvailable) {
    balanceNotes.push(
      'FLAG: no ledger account for this buyer yet — balance reads 0 from the ' +
        'authoritative ledger until the buyer has a settled money movement',
    );
  }

  const payload: WalletSnapshotPayload = {
    tzs,
    usd,
    kes,
    fxRates: { usdPerTzs, kesPerTzs: 0, capturedAt: fxCapturedAt },
    flags: {
      available: true,
      balanceCurrency: currency,
      notes: [...balanceNotes, ...fxNotes],
    },
  };
  return c.json({ success: true as const, data: payload }, 200);
});

export default buyersWalletRouter;
