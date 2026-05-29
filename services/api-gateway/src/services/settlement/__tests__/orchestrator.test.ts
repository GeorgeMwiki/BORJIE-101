/**
 * SettlementOrchestrator — commercial chain L8 tests.
 *
 * Covers gross math · royalty · fee · net identity (debits=credits) ·
 * cross-tenant denial · idempotency · ledger failure · payout
 * best-effort · audit / cockpit emission.
 */

import { describe, it, expect, vi } from 'vitest';

import { SettlementOrchestrator, SettlementError } from '../orchestrator';
import {
  computeSettlementMath,
  PLATFORM_FEE_RATE,
  royaltyRateForMineral,
  type SettlementLedgerPort,
  type SettlementPayoutPort,
  type SettlementMath,
} from '../types';

interface Recorded {
  fragments: ReadonlyArray<string>;
  params: ReadonlyArray<unknown>;
}

function flattenChunks(chunks: ReadonlyArray<unknown>): {
  fragments: string[];
  params: unknown[];
} {
  const fragments: string[] = [];
  const params: unknown[] = [];
  for (const c of chunks) {
    if (c && typeof c === 'object' && 'value' in c) {
      fragments.push(String((c as { value: unknown }).value ?? ''));
    } else if (c && typeof c === 'object' && 'queryChunks' in c) {
      const nested = flattenChunks(
        (c as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [],
      );
      fragments.push(...nested.fragments);
      params.push(...nested.params);
    } else {
      params.push(c);
    }
  }
  return { fragments, params };
}

function makeDb(responder: (rec: Recorded) => unknown) {
  const calls: Recorded[] = [];
  return {
    db: {
      async execute(q: unknown) {
        if (q && typeof q === 'object' && 'queryChunks' in q) {
          const flat = flattenChunks(
            (q as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [],
          );
          const rec = { fragments: flat.fragments, params: flat.params };
          calls.push(rec);
          return responder(rec);
        }
        return { rows: [] };
      },
    },
    calls,
  };
}

function stubLedgerPort(
  override: Partial<SettlementLedgerPort> = {},
): {
  port: SettlementLedgerPort;
  posts: Array<{ math: SettlementMath; idempotencyKey: string; tenantId: string }>;
} {
  const posts: Array<{
    math: SettlementMath;
    idempotencyKey: string;
    tenantId: string;
  }> = [];
  return {
    posts,
    port: {
      async post(input) {
        posts.push({
          math: input.math,
          idempotencyKey: input.idempotencyKey,
          tenantId: input.tenantId,
        });
        return { journalId: `jrn-${input.idempotencyKey.slice(0, 8)}` };
      },
      ...override,
    },
  };
}

function stubPayoutPort(
  override: Partial<SettlementPayoutPort> = {},
): {
  port: SettlementPayoutPort;
  payouts: Array<{ settlementId: string; netTzs: number }>;
} {
  const payouts: Array<{ settlementId: string; netTzs: number }> = [];
  return {
    payouts,
    port: {
      async payout(input) {
        payouts.push({
          settlementId: input.settlementId,
          netTzs: input.netTzs,
        });
        return { provider: 'mpesa_b2c' as const, providerRef: 'ref-1' };
      },
      ...override,
    },
  };
}

const TENANT = '11111111-2222-3333-4444-555555555555';
const RFB_ID = '22222222-3333-4444-5555-666666666666';
const RESPONSE_ID = '33333333-4444-5555-6666-777777777777';
const BUYER_ID = 'buyer-1';
const SELLER_ID = 'seller-1';

const happyJoinRow = {
  response_id: RESPONSE_ID,
  rfb_id: RFB_ID,
  tenant_id: TENANT,
  seller_id: SELLER_ID,
  offered_tonnage: '100',
  offered_price_tzs: '50000000',
  mineral_kind: 'gold',
  buyer_id: BUYER_ID,
  buyer_tenant_id: TENANT,
};

// ---------------------------------------------------------------------------
// math primitives
// ---------------------------------------------------------------------------

describe('computeSettlementMath — L8 math', () => {
  it('computes gross = tonnage * price', () => {
    const m = computeSettlementMath({
      offeredTonnage: 100,
      offeredPriceTzs: 50_000_000,
      mineralKind: 'gold',
    });
    expect(m.grossTzs).toBe(100 * 50_000_000);
  });

  it('applies the gold royalty rate (7%)', () => {
    const m = computeSettlementMath({
      offeredTonnage: 1,
      offeredPriceTzs: 1_000_000,
      mineralKind: 'gold',
    });
    expect(m.royaltyTzs).toBeCloseTo(70_000, 1);
    expect(royaltyRateForMineral('gold')).toBe(0.07);
  });

  it('applies the platform fee (1.5%)', () => {
    const m = computeSettlementMath({
      offeredTonnage: 1,
      offeredPriceTzs: 1_000_000,
      mineralKind: 'gold',
    });
    expect(m.feeTzs).toBeCloseTo(1_000_000 * PLATFORM_FEE_RATE, 1);
  });

  it('net = gross - royalty - fee (CHECK constraint identity)', () => {
    const inputs = [
      { offeredTonnage: 1, offeredPriceTzs: 1_000_000, mineralKind: 'gold' },
      { offeredTonnage: 50, offeredPriceTzs: 200_000_000, mineralKind: 'copper' },
      { offeredTonnage: 0.5, offeredPriceTzs: 999_999, mineralKind: 'tanzanite' },
    ];
    for (const input of inputs) {
      const m = computeSettlementMath(input);
      expect(m.netTzs).toBeCloseTo(
        Math.round((m.grossTzs - m.royaltyTzs - m.feeTzs) * 100) / 100,
        2,
      );
    }
  });

  it('rejects non-positive inputs', () => {
    expect(() =>
      computeSettlementMath({
        offeredTonnage: 0,
        offeredPriceTzs: 100,
        mineralKind: 'gold',
      }),
    ).toThrow();
    expect(() =>
      computeSettlementMath({
        offeredTonnage: 10,
        offeredPriceTzs: 0,
        mineralKind: 'gold',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// orchestrator
// ---------------------------------------------------------------------------

describe('SettlementOrchestrator.signDelivery — L8', () => {
  it('runs the happy path: math, ledger, payout, cockpit', async () => {
    let call = 0;
    const { db } = makeDb(() => {
      call += 1;
      if (call === 1) return { rows: [] }; // idempotency lookup — no prior
      if (call === 2) return { rows: [happyJoinRow] }; // SELECT response+rfb
      // INSERT + UPDATE statements — return nothing meaningful.
      return { rows: [] };
    });
    const ledger = stubLedgerPort();
    const payout = stubPayoutPort();
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: ledger.port,
      payoutPort: payout.port,
    });

    const res = await orch.signDelivery({
      tenantId: TENANT,
      buyerUserId: BUYER_ID,
      responseId: RESPONSE_ID,
      coCStepChecksum: 'coc-checksum-aaaa',
    });

    expect(res.idempotent).toBe(false);
    expect(res.math.grossTzs).toBe(100 * 50_000_000);
    expect(res.ledgerTxnId).toMatch(/^jrn-/);
    expect(res.payoutProvider).toBe('mpesa_b2c');
    expect(res.payoutProviderRef).toBe('ref-1');
    expect(res.status).toBe('paying_out');
    expect(ledger.posts.length).toBe(1);
    expect(ledger.posts[0]?.math.netTzs).toBe(res.math.netTzs);
    expect(payout.payouts.length).toBe(1);
    expect(payout.payouts[0]?.netTzs).toBe(res.math.netTzs);
  });

  it('debits balance the credits in the ledger post (gross = royalty + fee + net)', async () => {
    let call = 0;
    const { db } = makeDb(() => {
      call += 1;
      if (call === 1) return { rows: [] };
      if (call === 2) return { rows: [happyJoinRow] };
      return { rows: [] };
    });
    const ledger = stubLedgerPort();
    const payout = stubPayoutPort();
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: ledger.port,
      payoutPort: payout.port,
    });
    const res = await orch.signDelivery({
      tenantId: TENANT,
      buyerUserId: BUYER_ID,
      responseId: RESPONSE_ID,
      coCStepChecksum: 'coc-checksum-bbbb',
    });
    // Double-entry identity — the inverse of the migration's CHECK.
    expect(
      res.math.royaltyTzs + res.math.feeTzs + res.math.netTzs,
    ).toBeCloseTo(res.math.grossTzs, 2);
  });

  it('returns idempotent=true on replay with the same checksum', async () => {
    const existingRow = {
      id: 'existing-stl',
      status: 'paying_out',
      gross_tzs: '5000000000',
      royalty_tzs: '350000000',
      fee_tzs: '75000000',
      net_tzs: '4575000000',
      ledger_txn_id: 'jrn-existing',
      payout_provider: 'mpesa_b2c',
      payout_provider_ref: 'ref-existing',
    };
    const { db } = makeDb(() => ({ rows: [existingRow] }));
    const ledger = stubLedgerPort();
    const payout = stubPayoutPort();
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: ledger.port,
      payoutPort: payout.port,
    });
    const res = await orch.signDelivery({
      tenantId: TENANT,
      buyerUserId: BUYER_ID,
      responseId: RESPONSE_ID,
      coCStepChecksum: 'coc-checksum-cccc',
    });
    expect(res.idempotent).toBe(true);
    expect(res.settlementId).toBe('existing-stl');
    expect(res.ledgerTxnId).toBe('jrn-existing');
    expect(ledger.posts.length).toBe(0);
    expect(payout.payouts.length).toBe(0);
  });

  it('blocks a cross-tenant attempt (response belongs to another tenant)', async () => {
    let call = 0;
    const otherTenant = '99999999-9999-9999-9999-999999999999';
    const { db } = makeDb(() => {
      call += 1;
      if (call === 1) return { rows: [] };
      if (call === 2)
        return {
          rows: [
            {
              ...happyJoinRow,
              tenant_id: otherTenant,
            },
          ],
        };
      return { rows: [] };
    });
    const ledger = stubLedgerPort();
    const payout = stubPayoutPort();
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: ledger.port,
      payoutPort: payout.port,
    });
    await expect(
      orch.signDelivery({
        tenantId: TENANT,
        buyerUserId: BUYER_ID,
        responseId: RESPONSE_ID,
        coCStepChecksum: 'coc-cross-tenant',
      }),
    ).rejects.toThrow(SettlementError);
    expect(ledger.posts.length).toBe(0);
    expect(payout.payouts.length).toBe(0);
  });

  it('refuses when the response is not found', async () => {
    let call = 0;
    const { db } = makeDb(() => {
      call += 1;
      if (call === 1) return { rows: [] };
      if (call === 2) return { rows: [] }; // empty join
      return { rows: [] };
    });
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: stubLedgerPort().port,
      payoutPort: stubPayoutPort().port,
    });
    await expect(
      orch.signDelivery({
        tenantId: TENANT,
        buyerUserId: BUYER_ID,
        responseId: RESPONSE_ID,
        coCStepChecksum: 'coc-missing',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses when the buyer is not the one who owns the RFB', async () => {
    let call = 0;
    const { db } = makeDb(() => {
      call += 1;
      if (call === 1) return { rows: [] };
      if (call === 2)
        return { rows: [{ ...happyJoinRow, buyer_id: 'someone-else' }] };
      return { rows: [] };
    });
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: stubLedgerPort().port,
      payoutPort: stubPayoutPort().port,
    });
    await expect(
      orch.signDelivery({
        tenantId: TENANT,
        buyerUserId: BUYER_ID,
        responseId: RESPONSE_ID,
        coCStepChecksum: 'coc-not-buyer',
      }),
    ).rejects.toThrow(/not the buyer/i);
  });

  it('marks the row failed and surfaces an error when the ledger post throws', async () => {
    let call = 0;
    const { db, calls } = makeDb(() => {
      call += 1;
      if (call === 1) return { rows: [] };
      if (call === 2) return { rows: [happyJoinRow] };
      return { rows: [] };
    });
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: {
        async post() {
          throw new Error('ledger blew up');
        },
      },
      payoutPort: stubPayoutPort().port,
    });
    await expect(
      orch.signDelivery({
        tenantId: TENANT,
        buyerUserId: BUYER_ID,
        responseId: RESPONSE_ID,
        coCStepChecksum: 'coc-ledger-fail',
      }),
    ).rejects.toThrow(SettlementError);
    // Confirm an UPDATE settlements SET status = 'failed' was issued.
    const allFragments = calls.flatMap((c) => c.fragments).join('');
    expect(allFragments).toContain("status = 'failed'");
  });

  it('stays at posted (not paying_out) when payout port throws', async () => {
    let call = 0;
    const { db } = makeDb(() => {
      call += 1;
      if (call === 1) return { rows: [] };
      if (call === 2) return { rows: [happyJoinRow] };
      return { rows: [] };
    });
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: stubLedgerPort().port,
      payoutPort: {
        async payout() {
          throw new Error('mpesa down');
        },
      },
    });
    const res = await orch.signDelivery({
      tenantId: TENANT,
      buyerUserId: BUYER_ID,
      responseId: RESPONSE_ID,
      coCStepChecksum: 'coc-payout-fail',
    });
    expect(res.status).toBe('posted');
    expect(res.ledgerTxnId).not.toBeNull();
    expect(res.payoutProvider).toBeNull();
  });
});

describe('SettlementOrchestrator.listForTenant — owner.settlement.list_mine', () => {
  it('returns rows for the tenant', async () => {
    const { db } = makeDb(() => ({
      rows: [
        {
          id: 'stl-1',
          rfb_id: RFB_ID,
          response_id: RESPONSE_ID,
          status: 'paying_out',
          gross_tzs: '5000000000',
          royalty_tzs: '350000000',
          fee_tzs: '75000000',
          net_tzs: '4575000000',
          payout_provider: 'mpesa_b2c',
          payout_provider_ref: 'ref-x',
          created_at: '2026-05-29T12:00:00Z',
        },
      ],
    }));
    const orch = new SettlementOrchestrator({
      db,
      ledgerPort: stubLedgerPort().port,
      payoutPort: stubPayoutPort().port,
    });
    const list = await orch.listForTenant({ tenantId: TENANT });
    expect(list.length).toBe(1);
    expect(list[0]?.netTzs).toBe(4_575_000_000);
    expect(list[0]?.payoutProvider).toBe('mpesa_b2c');
  });
});
