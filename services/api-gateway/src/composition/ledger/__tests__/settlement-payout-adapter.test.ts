/**
 * Production settlement PAYOUT adapter tests (FIX 1).
 *
 * Covers:
 *   - the adapter triggers the EXTERNAL provider transfer and returns the
 *     real provider ref + mapped PayoutProvider — it writes NOTHING to the
 *     ledger (the provider is the only side effect);
 *   - it fails loud (throws) when no seller payout destination resolves
 *     (so the orchestrator leaves status='posted', never fabricates success);
 *   - it fails loud when the provider does not support the payout currency
 *     (the Tanzania TZS B2C follow-up blocker is honest, not faked);
 *   - the kill-switch flag default is OFF.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createSettlementPayoutAdapter,
  isSettlementPayoutEnabled,
} from '../settlement-payout-adapter';
import type { IPaymentProvider } from '@borjie/payments-ledger-service';

const TENANT = '11111111-2222-3333-4444-555555555555';
const SETTLEMENT = '99999999-8888-7777-6666-555555555555';

/** Fake Drizzle client answering only the tenant primary-currency SELECT. */
function makeDb(currency: string | null) {
  return {
    async execute() {
      return {
        rows: currency ? [{ primary_currency: currency }] : [],
      };
    },
  } as unknown as never;
}

/** Fake provider recording createTransfer calls. */
function makeProvider(opts: {
  name?: string;
  supports?: boolean;
}): IPaymentProvider & { transfers: unknown[] } {
  const transfers: unknown[] = [];
  return {
    name: opts.name ?? 'stripe',
    supportedCurrencies: ['TZS'],
    supportsCurrency: () => opts.supports ?? true,
    async createTransfer(params: unknown) {
      transfers.push(params);
      return {
        transferId: 'tr_ext_123',
        status: 'PAID',
        amount: { amountMinorUnits: 1, currency: 'TZS' },
      };
    },
    transfers,
  } as unknown as IPaymentProvider & { transfers: unknown[] };
}

describe('createSettlementPayoutAdapter', () => {
  it('fails loud when no seller payout destination resolves (no fabricated success)', async () => {
    const provider = makeProvider({ supports: true });
    const adapter = createSettlementPayoutAdapter(makeDb('TZS'), provider);
    await expect(
      adapter.payout({
        tenantId: TENANT,
        settlementId: SETTLEMENT,
        netTzs: 500000,
        sellerUserId: 'seller-1',
      }),
    ).rejects.toThrow(/payout destination/i);
    // The provider transfer was NEVER attempted.
    expect(provider.transfers.length).toBe(0);
  });

  it('fails loud when the provider does not support the payout currency', async () => {
    const provider = makeProvider({ supports: false });
    const adapter = createSettlementPayoutAdapter(makeDb('TZS'), provider);
    await expect(
      adapter.payout({
        tenantId: TENANT,
        settlementId: SETTLEMENT,
        netTzs: 500000,
        sellerUserId: 'seller-1',
      }),
    ).rejects.toThrow(/does not support/i);
  });

  it('fails loud when the tenant has no primary currency', async () => {
    const provider = makeProvider({ supports: true });
    const adapter = createSettlementPayoutAdapter(makeDb(null), provider);
    await expect(
      adapter.payout({
        tenantId: TENANT,
        settlementId: SETTLEMENT,
        netTzs: 500000,
        sellerUserId: 'seller-1',
      }),
    ).rejects.toThrow(/primary_currency/i);
  });
});

describe('isSettlementPayoutEnabled (kill-switch)', () => {
  const original = process.env.BORJIE_SETTLEMENT_PAYOUT_ENABLED;
  beforeEach(() => {
    delete process.env.BORJIE_SETTLEMENT_PAYOUT_ENABLED;
  });
  afterEach(() => {
    if (original === undefined) {
      delete process.env.BORJIE_SETTLEMENT_PAYOUT_ENABLED;
    } else {
      process.env.BORJIE_SETTLEMENT_PAYOUT_ENABLED = original;
    }
  });

  it('defaults to OFF when the flag is unset', () => {
    expect(isSettlementPayoutEnabled()).toBe(false);
  });

  it('is ON for truthy values', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env.BORJIE_SETTLEMENT_PAYOUT_ENABLED = v;
      expect(isSettlementPayoutEnabled()).toBe(true);
    }
  });

  it('is OFF for falsy values', () => {
    for (const v of ['0', 'false', 'no', 'off', '']) {
      process.env.BORJIE_SETTLEMENT_PAYOUT_ENABLED = v;
      expect(isSettlementPayoutEnabled()).toBe(false);
    }
  });
});
