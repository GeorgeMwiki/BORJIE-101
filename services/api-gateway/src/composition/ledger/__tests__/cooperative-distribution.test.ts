/**
 * Cooperative member-distribution ledger adapter — LIVE money path.
 *
 * Proves the FIX for the silent-no-op defect: `distribute` now posts a REAL
 * balanced double-entry journal per member through the LedgerService instead
 * of stamping a fabricated `payment_ref` and writing NOTHING.
 *
 * Covers:
 *   - posts a BALANCED 2-leg journal (DR cooperative_clearing /
 *     CR member_payable) in integer minor units (DR === CR);
 *   - passes the `coop-dist:<distributionId>` key to the ledger as its
 *     durable `idempotencyKey`;
 *   - returns the REAL ledger journal id (never a fabricated ref);
 *   - currency is resolved from the tenant primary currency (no hard-code);
 *   - a non-positive amount fails loud before any post.
 *
 * Strategy mirrors `ledger-adapters.test.ts`: a fake Drizzle client answering
 * the currency + account-ensure `.execute` calls (+ `.transaction`), and a
 * fake LedgerService recording the journal request + the `idempotencyKey`.
 */

import { describe, it, expect } from 'vitest';

import {
  postCooperativeDistributionWithLedger,
  type CooperativeLedgerService,
} from '../cooperative-distribution';
import type { CreateJournalEntryRequest } from '@borjie/domain-models';

const TENANT = '11111111-2222-3333-4444-555555555555';
const DIST_ID = '44444444-5555-6666-7777-888888888888';
const MEMBER_ID = '55555555-6666-7777-8888-999999999999';

/**
 * Fake Drizzle client: answers `.execute` for the tenant primary-currency
 * row, the account-ownership guard row (M2 — `SELECT tenant_id` after the
 * upsert), and empty for upserts / GUC binds. `ensureLedgerAccounts` wraps
 * its work in `db.transaction`, so the fake runs the callback against itself.
 */
function makeDb(opts: { currency?: string; ownerTenantId?: string } = {}) {
  const currency = opts.currency ?? 'TZS';
  const db: Record<string, unknown> = {
    async execute(q: unknown) {
      const text = JSON.stringify(q);
      if (text.includes('set_config')) return { rows: [] };
      if (text.includes('primary_currency')) {
        return { rows: [{ primary_currency: currency }] };
      }
      if (text.includes('tenant_id') && text.includes('accounts')) {
        const owner = opts.ownerTenantId ?? TENANT;
        return { rows: [{ tenant_id: owner }] };
      }
      return { rows: [] };
    },
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      return cb(db);
    },
  };
  return { db: db as unknown as never };
}

/**
 * Fake LedgerService capturing the journal request AND the `idempotencyKey`.
 * Returns a deterministic real-shaped journal id so the route can store it as
 * `payment_ref`.
 */
function makeLedger() {
  const posts: Array<{
    lines: Array<{
      accountId: string;
      direction: 'DEBIT' | 'CREDIT';
      amountMinorUnits: number;
      currency: string;
    }>;
    idempotencyKey?: string;
  }> = [];
  let seq = 0;
  const ledger: CooperativeLedgerService = {
    async postJournalEntry(
      request: CreateJournalEntryRequest,
      options?: { idempotencyKey?: string },
    ) {
      posts.push({
        idempotencyKey: options?.idempotencyKey,
        lines: request.lines.map((l) => ({
          accountId: String(l.accountId),
          direction: l.direction,
          amountMinorUnits: l.amount.amountMinorUnits,
          currency: l.amount.currency,
        })),
      });
      return { journalId: `jnl_coop_${(seq += 1)}` };
    },
  };
  return { ledger, posts };
}

describe('cooperative distribution ledger adapter — LIVE money path', () => {
  it('posts a BALANCED 2-leg journal (DR cooperative_clearing / CR member_payable)', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();

    const res = await postCooperativeDistributionWithLedger(
      {
        db,
        tenantId: TENANT,
        distributionId: DIST_ID,
        memberPartyId: MEMBER_ID,
        amountMajor: 1_250_000, // TZS, 0-decimal → 1,250,000 minor units
      },
      ledger,
    );

    // A real journal was posted (id is the ledger's, not a fabricated ref).
    expect(res.journalId).toMatch(/^jnl_coop_/);
    expect(posts.length).toBe(1);

    const lines = posts[0]!.lines;
    expect(lines.length).toBe(2);

    const dr = lines.filter((l) => l.direction === 'DEBIT');
    const cr = lines.filter((l) => l.direction === 'CREDIT');
    expect(dr.length).toBe(1);
    expect(cr.length).toBe(1);

    // DR === CR — the journal balances.
    expect(dr[0]!.amountMinorUnits).toBe(1_250_000);
    expect(cr[0]!.amountMinorUnits).toBe(1_250_000);
    expect(dr[0]!.amountMinorUnits).toBe(cr[0]!.amountMinorUnits);

    // Right accounts, currency threaded from tenant primary_currency.
    expect(dr[0]!.accountId).toContain('cooperative_clearing');
    expect(cr[0]!.accountId).toContain('member_payable');
    expect(lines.every((l) => l.currency === 'TZS')).toBe(true);
  });

  it('passes the coop-dist:<distributionId> key to the ledger as its idempotencyKey', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();

    await postCooperativeDistributionWithLedger(
      {
        db,
        tenantId: TENANT,
        distributionId: DIST_ID,
        memberPartyId: MEMBER_ID,
        amountMajor: 500_000,
      },
      ledger,
    );

    expect(posts.length).toBe(1);
    expect(posts[0]!.idempotencyKey).toBe(`coop-dist:${DIST_ID}`);
  });

  it('rejects a non-positive amount before any post (nothing to post)', async () => {
    const { db } = makeDb();
    const { ledger, posts } = makeLedger();
    await expect(
      postCooperativeDistributionWithLedger(
        {
          db,
          tenantId: TENANT,
          distributionId: DIST_ID,
          memberPartyId: MEMBER_ID,
          amountMajor: 0,
        },
        ledger,
      ),
    ).rejects.toThrow(/non-positive/i);
    expect(posts.length).toBe(0);
  });
});
