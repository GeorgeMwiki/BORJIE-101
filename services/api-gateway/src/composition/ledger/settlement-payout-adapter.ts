/**
 * Production settlement PAYOUT adapter — the EXTERNAL seller-payout rail.
 *
 * This closes the launch blocker where settlements posted to the ledger and
 * then sat at `status='posted'` forever, because no production payout port
 * was registered (resolveSettlementPayoutPort fails loud PAYOUT_NOT_WIRED).
 *
 * CRITICAL money invariant (CLAUDE.md): this adapter does NOT create
 * accounting truth. `LedgerService.post()` remains the ONLY ledger writer.
 * The orchestrator posts the balanced double-entry journal FIRST (step 5),
 * and only THEN calls `payout()` here (step 6). This adapter merely triggers
 * the EXTERNAL transfer via the existing `IPaymentProvider.createTransfer`
 * rail and returns the provider's external ref + provider name so the
 * orchestrator can stamp `payout_provider` / `payout_provider_ref` on the
 * settlements row. No ledger row is written here.
 *
 * Ship-dark gate: the adapter is only REGISTERED when the kill-switch flag
 * `BORJIE_SETTLEMENT_PAYOUT_ENABLED` is truthy (see
 * `registerProductionLedgerPorts`). Default OFF — until provider credentials
 * + a seller payout-destination resolver exist, the existing fail-loud
 * `PAYOUT_NOT_WIRED` behaviour is preserved (we never fabricate a payout
 * success). When the flag is ON but a destination / currency cannot be
 * resolved for a given settlement, `payout()` THROWS; the orchestrator
 * treats a payout throw as best-effort (leaves status='posted' for a
 * background retry) — it NEVER stamps a fake success.
 *
 * Provider-availability caveat (recorded as a follow-up blocker): the
 * Tanzania TZS seller-payout B2C rail (M-Pesa B2C) is NOT yet available —
 * `MpesaPaymentProvider.supportedCurrencies === ['KES']`, so it cannot pay a
 * TZS seller. Stripe lists TZS among its transfer currencies but a Stripe
 * transfer needs a connected-account `destination` (acct_…), which Borjie
 * does not yet resolve per seller. This adapter therefore wires the provider
 * PORT generically and fails loud when the rail cannot honour the
 * settlement; the concrete TZS-B2C provider + creds + seller
 * payout-destination column remain a follow-up.
 */

import { Money } from '@borjie/domain-models';
import type { CurrencyCode } from '@borjie/domain-models';
import type { IPaymentProvider } from '@borjie/payments-ledger-service';
import { sql } from 'drizzle-orm';

import { createDatabaseClient } from '@borjie/database';
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

import { createLogger } from '../../utils/logger';
import type {
  SettlementPayoutPort,
  SettlementPayoutInput,
  SettlementPayoutResult,
  PayoutProvider,
} from '../../services/settlement/types';

const moduleLogger = createLogger('settlement-payout-adapter');

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

/**
 * Map an `IPaymentProvider.name` to the `PayoutProvider` enum the
 * settlements row stores. Falls back to `stripe` for any card rail and
 * `mpesa_b2c` for the mobile-money rail; unknown providers throw rather than
 * silently mis-label the payout.
 */
function payoutProviderFor(providerName: string): PayoutProvider {
  switch (providerName) {
    case 'stripe':
      return 'stripe';
    case 'mpesa':
      return 'mpesa_b2c';
    default:
      throw new Error(
        `settlement payout: unsupported provider '${providerName}' — ` +
          `no PayoutProvider mapping. Wire the mapping before enabling this rail.`,
      );
  }
}

/**
 * Resolve the seller's primary currency (the payout currency) from the
 * tenant primary currency. The payout is denominated in the SELLER tenant's
 * currency — the same currency the net leg was posted in. Throws when the
 * tenant currency is missing (fail-closed, no guessed currency on a payout).
 */
async function resolvePayoutCurrency(
  db: DatabaseClient,
  tenantId: string,
): Promise<CurrencyCode> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT primary_currency
        FROM tenants
       WHERE id = ${tenantId}::uuid
       LIMIT 1
    `),
  );
  const currency = rows[0]?.primary_currency;
  if (typeof currency !== 'string' || currency.trim().length === 0) {
    throw new Error(
      `settlement payout: tenant ${tenantId} has no primary_currency — ` +
        `cannot denominate the external transfer`,
    );
  }
  return currency.trim().toUpperCase() as CurrencyCode;
}

/**
 * Resolve the seller's EXTERNAL payout destination (a provider-specific
 * handle: a Stripe connected-account id, or an M-Pesa phone). Borjie does
 * NOT yet persist a seller payout destination, so this currently returns
 * null for every seller and `payout()` fails loud (the orchestrator then
 * leaves the settlement at status='posted' for a later retry). Wire the
 * destination lookup (a `seller_payout_accounts`-style table) before the
 * rail can move money. Kept as a single seam so that wiring is one edit.
 */
async function resolveSellerPayoutDestination(
  _db: DatabaseClient,
  _input: SettlementPayoutInput,
): Promise<string | null> {
  // FOLLOW-UP BLOCKER: no seller payout-destination column exists yet.
  // Returning null keeps the rail honest (fail-loud) until it is wired.
  return null;
}

/**
 * Build the production settlement payout adapter from an existing payment
 * provider. The adapter triggers the EXTERNAL transfer AFTER the ledger has
 * posted; it writes NOTHING to the ledger.
 */
export function createSettlementPayoutAdapter(
  db: DatabaseClient,
  provider: IPaymentProvider,
): SettlementPayoutPort {
  return {
    async payout(
      input: SettlementPayoutInput,
    ): Promise<SettlementPayoutResult> {
      const currency = await resolvePayoutCurrency(db, input.tenantId);

      // Provider must support the payout currency — never attempt a transfer
      // in a currency the rail cannot settle (fail-loud, best-effort retry).
      if (!provider.supportsCurrency(currency)) {
        throw new Error(
          `settlement payout: provider '${provider.name}' does not support ` +
            `currency ${currency} (settlement ${input.settlementId}). The ` +
            `seller-payout rail for this jurisdiction is not yet available.`,
        );
      }

      const destination = await resolveSellerPayoutDestination(db, input);
      if (!destination) {
        throw new Error(
          `settlement payout: no external payout destination resolved for ` +
            `seller ${input.sellerUserId} (settlement ${input.settlementId}). ` +
            `Seller payout-destination wiring is a follow-up blocker; refusing ` +
            `to fabricate a payout.`,
        );
      }

      if (input.netTzs <= 0) {
        throw new Error(
          `settlement payout: non-positive net amount (${input.netTzs}) for ` +
            `settlement ${input.settlementId}`,
        );
      }

      // Idempotency: a stable key per settlement so a retry of the same payout
      // does not double-transfer at the provider.
      const idempotencyKey = `stl-payout:${input.settlementId}`;
      const amount = Money.fromMinorUnits(input.netTzs, currency);

      // Trigger the EXTERNAL transfer. This is the ONLY side effect — no
      // ledger write happens here (the ledger already posted in step 5).
      const transfer = await provider.createTransfer({
        amount,
        destination,
        description: `Seller settlement ${input.settlementId}`,
        metadata: {
          settlementId: input.settlementId,
          sellerUserId: input.sellerUserId,
          tenantId: input.tenantId,
        },
        idempotencyKey,
      });

      moduleLogger.info(
        {
          tenantId: input.tenantId,
          settlementId: input.settlementId,
          provider: provider.name,
          transferId: transfer.transferId,
          transferStatus: transfer.status,
          netMinor: input.netTzs,
          currency,
        },
        'settlement_external_payout_triggered',
      );

      return {
        provider: payoutProviderFor(provider.name),
        providerRef: transfer.transferId,
      };
    },
  };
}

/**
 * Kill-switch flag (default OFF). The payout adapter is only registered when
 * this is truthy. Bootstrap reads `process.env` once here; the value is
 * resolved at boot, not on the hot path.
 */
export function isSettlementPayoutEnabled(): boolean {
  const raw = process.env.BORJIE_SETTLEMENT_PAYOUT_ENABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
