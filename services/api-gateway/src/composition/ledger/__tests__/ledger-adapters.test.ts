/**
 * Production ledger adapter tests — the LIVE money path.
 *
 * Covers:
 *   - settlement posts a BALANCED 4-leg journal with the right legs
 *     (DR clearing gross; CR royalty/fee/seller-net) in integer minor
 *     units, with net as the exact remainder;
 *   - settlement passes its derived key to the ledger as the durable
 *     `idempotencyKey`, and a retry under the same key replays the prior
 *     journal (no second post) — dedupe lives in the ledger's atomic post,
 *     not an adapter probe;
 *   - an unbalanced journal throws BEFORE hitting the ledger;
 *   - a failed LedgerService.post() propagates (no silent success);
 *   - payroll posts a balanced DR wage / CR clearing journal, idempotent
 *     on (run, worker).
 *
 * Strategy: the adapters take a `LedgerService` and a `DatabaseClient`. We
 * inject a fake LedgerService that records the `CreateJournalEntryRequest`
 * + the `idempotencyKey` option and models the ledger's durable dedupe,
 * and a fake Drizzle client that answers the currency + account-ensure
 * `.execute` calls. The REAL single-transaction atomic post (balance CAS +
 * entry inserts + `journal_idempotency` + hash-chain) is exercised at the
 * repository layer in `gateway-atomic-post.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  createSettlementLedgerAdapter,
  createPayrollLedgerAdapter,
  assertBalanced,
  buildLedgerService,
  settlementMoneyKey,
} from '../index';
import {
  splitSettlementMinorUnits,
  toIntegerMinorUnits,
} from '../money-minor-units';
import { Money } from '@borjie/domain-models';

const TENANT = '11111111-2222-3333-4444-555555555555';
const RESPONSE_ID = '33333333-4444-5555-6666-777777777777';

/**
 * Fake Drizzle client for the ADAPTER-level tests. After the convergence
 * onto the ledger's durable idempotency key, the adapters no longer run a
 * metadata-probe SELECT — they only touch the DB via `.execute(sql)` for
 * `resolveTenantCurrency` + `ensureLedgerAccounts`. So this fake answers
 * `.execute`: the tenant primary-currency row, the account-ownership guard
 * row (M2 — `SELECT tenant_id` after the upsert), and empty for the
 * upserts / GUC binds. `ensureLedgerAccounts` now wraps its work in a
 * `db.transaction`, so the fake also provides `.transaction(cb)` that runs
 * the callback against this same client. The durable atomic post +
 * idempotency dedupe is covered at the repository layer in
 * `gateway-atomic-post.test.ts`.
 *
 * `tenantOverride` lets a test simulate the account-ownership guard
 * detecting a row owned by a DIFFERENT tenant (M2 fail-loud).
 */
function makeDb(opts: { currency?: string; ownerTenantId?: string }) {
  const currency = opts.currency ?? 'TZS';
  const executed: string[] = [];

  const db: Record<string, unknown> = {
    async execute(q: unknown) {
      // Flatten the drizzle SQL to a string so we can branch on it.
      const text = JSON.stringify(q);
      executed.push(text);
      if (text.includes('set_config')) {
        return { rows: [] };
      }
      if (text.includes('primary_currency')) {
        return { rows: [{ primary_currency: currency }] };
      }
      // M2 ownership guard: `SELECT tenant_id … FROM accounts WHERE id = …`.
      // The id placeholder is `mining-<key>-<currency>-<tenantId>`, so the
      // tenant the row belongs to is whatever the test seeds (defaults to
      // the value baked into the id via `ownerTenantId`, else echo the
      // caller's tenant so the guard passes).
      if (text.includes('tenant_id') && text.includes('accounts')) {
        const owner =
          opts.ownerTenantId ?? extractTenantFromAccountId(text) ?? TENANT;
        return { rows: [{ tenant_id: owner }] };
      }
      // INSERT INTO accounts … ON CONFLICT DO NOTHING
      return { rows: [] };
    },
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      // Run the callback against the same client (no real isolation needed
      // for these adapter-level assertions).
      return cb(db);
    },
  };
  return { db: db as unknown as never, executed };
}

/**
 * Pull the tenant id out of a serialized `mining-<key>-<currency>-<tenant>`
 * account-id placeholder so the ownership-guard SELECT echoes the right
 * owner. Returns undefined if not found.
 */
function extractTenantFromAccountId(serialized: string): string | undefined {
  const m = serialized.match(/mining-[a-z_]+-[a-z]+-([0-9a-fA-F-]{36})/);
  return m?.[1];
}

/**
 * Fake LedgerService capturing the journal request AND the
 * `idempotencyKey` option. Models the hardened service's durable
 * idempotency: a repeated `(tenantId, idempotencyKey)` returns the
 * ORIGINAL journal WITHOUT recording a second post — exactly what
 * `postJournalAtomic` + `journal_idempotency` guarantee in production.
 * `priorKeys` seeds keys as if a previous process already posted them.
 */
function makeLedger(
  opts: { fail?: boolean; priorKeys?: Record<string, string> } = {},
) {
  const posts: Array<{
    lines: Array<{
      accountId: string;
      direction: 'DEBIT' | 'CREDIT';
      amountMinorUnits: number;
      currency: string;
      description: string;
      metadata?: Record<string, unknown>;
    }>;
    tenantId: string;
    idempotencyKey?: string;
  }> = [];
  // (tenantId::idempotencyKey) → journalId, seeded from priorKeys.
  const ledgerByKey = new Map<string, string>(
    Object.entries(opts.priorKeys ?? {}),
  );
  let seq = 0;

  const ledger = {
    async postJournalEntry(
      request: {
        tenantId: string;
        lines: Array<{
          accountId: string;
          direction: 'DEBIT' | 'CREDIT';
          amount: { amountMinorUnits: number; currency: string };
          description: string;
          metadata?: Record<string, unknown>;
        }>;
      },
      options?: { idempotencyKey?: string },
    ) {
      if (opts.fail) {
        throw new Error('ledger blew up');
      }
      const key = options?.idempotencyKey;
      // Durable idempotency: a known key replays the prior journal,
      // no second post.
      if (key !== undefined) {
        const mapKey = `${request.tenantId}::${key}`;
        const existing = ledgerByKey.get(mapKey);
        if (existing !== undefined) {
          return {
            journalId: existing,
            entries: [],
            updatedAccounts: [],
            idempotentReplay: true,
          };
        }
        const journalId = `jnl_real_${(seq += 1)}`;
        ledgerByKey.set(mapKey, journalId);
        posts.push({
          tenantId: request.tenantId,
          idempotencyKey: key,
          lines: request.lines.map((l) => ({
            accountId: l.accountId,
            direction: l.direction,
            amountMinorUnits: l.amount.amountMinorUnits,
            currency: l.amount.currency,
            description: l.description,
            metadata: l.metadata,
          })),
        });
        return { journalId, entries: [], updatedAccounts: [] };
      }
      posts.push({
        tenantId: request.tenantId,
        lines: request.lines.map((l) => ({
          accountId: l.accountId,
          direction: l.direction,
          amountMinorUnits: l.amount.amountMinorUnits,
          currency: l.amount.currency,
          description: l.description,
          metadata: l.metadata,
        })),
      });
      return { journalId: 'jnl_real_123', entries: [], updatedAccounts: [] };
    },
  };
  return { ledger: ledger as never, posts };
}

// ---------------------------------------------------------------------------
// money-minor-units primitives
// ---------------------------------------------------------------------------

describe('splitSettlementMinorUnits — integer balance guarantee', () => {
  it('nets the exact remainder so DR == CR at integer scale', () => {
    // Deliberately pick legs whose float identity has a residual.
    const split = splitSettlementMinorUnits({
      grossTzs: 1_000_000,
      royaltyTzs: 70_000,
      feeTzs: 15_000,
    });
    expect(split.grossMinor).toBe(1_000_000);
    expect(split.netMinor).toBe(1_000_000 - 70_000 - 15_000);
    // The double-entry identity the ledger enforces.
    expect(split.royaltyMinor + split.feeMinor + split.netMinor).toBe(
      split.grossMinor,
    );
  });

  it('throws when royalty + fee exceed gross (inverted settlement)', () => {
    expect(() =>
      splitSettlementMinorUnits({
        grossTzs: 100,
        royaltyTzs: 80,
        feeTzs: 40,
      }),
    ).toThrow(/exceed gross/i);
  });

  it('rounds an upstream float residual to an integer minor unit', () => {
    expect(toIntegerMinorUnits(14_999.985, 'fee')).toBe(15_000);
    expect(() => toIntegerMinorUnits(-1, 'x')).toThrow();
    expect(() => toIntegerMinorUnits(Number.NaN, 'x')).toThrow();
  });
});

describe('real LedgerService — balance guard (CLAUDE.md hard rule)', () => {
  it('the REAL LedgerService rejects an unbalanced journal before any DB write', async () => {
    // A db that throws on ANY access — proves the balance check fires
    // FIRST, before repositories are touched.
    const explodingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('db must not be touched for an unbalanced journal');
        },
      },
    ) as unknown as never;
    const ledger = buildLedgerService(explodingDb);

    await expect(
      ledger.postJournalEntry({
        tenantId: TENANT as never,
        effectiveDate: new Date(),
        createdBy: 'test',
        lines: [
          {
            accountId: 'a' as never,
            type: 'RENT_PAYMENT' as never,
            direction: 'DEBIT',
            amount: Money.fromMinorUnits(100, 'TZS'),
            description: 'dr',
          },
          {
            accountId: 'b' as never,
            type: 'PLATFORM_FEE' as never,
            direction: 'CREDIT',
            amount: Money.fromMinorUnits(60, 'TZS'), // 60 != 100 → unbalanced
            description: 'cr',
          },
        ],
      }),
    ).rejects.toThrow(/not balanced/i);
  });
});

describe('assertBalanced — debits must equal credits', () => {
  it('accepts a balanced journal', () => {
    expect(() =>
      assertBalanced([
        { direction: 'DEBIT', amount: Money.fromMinorUnits(100, 'TZS') },
        { direction: 'CREDIT', amount: Money.fromMinorUnits(60, 'TZS') },
        { direction: 'CREDIT', amount: Money.fromMinorUnits(40, 'TZS') },
      ]),
    ).not.toThrow();
  });

  it('THROWS on an unbalanced journal', () => {
    expect(() =>
      assertBalanced([
        { direction: 'DEBIT', amount: Money.fromMinorUnits(100, 'TZS') },
        { direction: 'CREDIT', amount: Money.fromMinorUnits(60, 'TZS') },
        // missing 40 — debits != credits
      ]),
    ).toThrow(/does not balance/i);
  });
});

// ---------------------------------------------------------------------------
// settlement adapter
// ---------------------------------------------------------------------------

describe('settlement ledger adapter — LIVE money path', () => {
  it('posts a balanced 4-leg journal with the right legs at 5,000,000,000 minor units (no overflow, C2)', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();
    const adapter = createSettlementLedgerAdapter(db, ledger);

    // 5e9 is ABOVE the old INT4_MAX (2,147,483,647) the money columns used
    // to cap at — with the BIGINT migration + bigint({mode:'number'}) local
    // decls, this large settlement now POSTS cleanly instead of overflowing.
    const grossTzs = 5_000_000_000;
    expect(grossTzs).toBeGreaterThan(2_147_483_647);

    const res = await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'coc-aaaa',
      math: {
        grossTzs,
        royaltyTzs: 350_000_000,
        feeTzs: 75_000_000,
        netTzs: 4_575_000_000,
      },
    });

    // A real journal was posted (id is the ledger's, not a stub skip).
    expect(res.journalId).toMatch(/^jnl_real_/);
    expect(posts.length).toBe(1);
    const lines = posts[0]!.lines;
    expect(lines.length).toBe(4);

    // DR gross
    const dr = lines.filter((l) => l.direction === 'DEBIT');
    const cr = lines.filter((l) => l.direction === 'CREDIT');
    expect(dr.length).toBe(1);
    expect(dr[0]!.amountMinorUnits).toBe(5_000_000_000);

    // CR legs sum to gross (balanced)
    const crSum = cr.reduce((a, l) => a + l.amountMinorUnits, 0);
    expect(crSum).toBe(5_000_000_000);

    // right credit amounts present
    const crAmounts = cr.map((l) => l.amountMinorUnits).sort((a, b) => a - b);
    expect(crAmounts).toEqual([75_000_000, 350_000_000, 4_575_000_000]);

    // currency threaded from tenant primary_currency
    expect(lines.every((l) => l.currency === 'TZS')).toBe(true);
    // idempotency metadata stamped
    expect(lines.every((l) => l.metadata?.settlementKey)).toBeTruthy();
  });

  it('is idempotent on retry — the durable idempotencyKey replays the prior journal (no second post)', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    // The settlement adapter now derives a MONEY-BOUND key (H3): a stable
    // hash of responseId + the four integer legs. Seed THAT key as
    // already-posted so the hardened ledger replays it.
    const math = {
      grossTzs: 5_000_000_000,
      royaltyTzs: 350_000_000,
      feeTzs: 75_000_000,
      netTzs: 4_575_000_000,
    };
    const priorKey = settlementMoneyKey(
      RESPONSE_ID,
      splitSettlementMinorUnits(math),
    );
    const { ledger, posts } = makeLedger({
      priorKeys: { [`${TENANT}::${priorKey}`]: 'jnl_prior_999' },
    });
    const adapter = createSettlementLedgerAdapter(db, ledger);

    const res = await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'coc-aaaa',
      math,
    });

    expect(res.journalId).toBe('jnl_prior_999');
    expect(posts.length).toBe(0); // no second post — deduped in the ledger
  });

  it('passes the MONEY-BOUND settlementKey to the ledger as its idempotencyKey (H3)', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();
    const adapter = createSettlementLedgerAdapter(db, ledger);

    const math = {
      grossTzs: 1_000_000,
      royaltyTzs: 70_000,
      feeTzs: 15_000,
      netTzs: 915_000,
    };
    await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'coc-key-xyz',
      math,
    });

    expect(posts.length).toBe(1);
    // The key is now a pure function of responseId + the integer legs —
    // NOT the CoC checksum. It equals the exported `settlementMoneyKey`.
    expect(posts[0]!.idempotencyKey).toBe(
      settlementMoneyKey(RESPONSE_ID, splitSettlementMinorUnits(math)),
    );
  });

  it('the settlement key is independent of the CoC checksum but bound to the money (H3)', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();
    const adapter = createSettlementLedgerAdapter(db, ledger);

    const math = {
      grossTzs: 1_000_000,
      royaltyTzs: 70_000,
      feeTzs: 15_000,
      netTzs: 915_000,
    };
    // Two posts, SAME money but DIFFERENT CoC checksums → SAME key (the
    // checksum no longer participates), so the second replays.
    await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'checksum-A',
      math,
    });
    await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'checksum-B-different',
      math,
    });
    expect(posts.length).toBe(1); // deduped — checksum is irrelevant

    // Now change ONE amount (an economically different settlement under the
    // same response) → DIFFERENT key → a fresh post (no silent under-post).
    await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'checksum-A',
      math: { ...math, grossTzs: 1_000_001, netTzs: 915_001 },
    });
    expect(posts.length).toBe(2);
    expect(posts[0]!.idempotencyKey).not.toBe(posts[1]!.idempotencyKey);
  });

  it('a second post with the SAME settlement key does not double-post', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();
    const adapter = createSettlementLedgerAdapter(db, ledger);

    const math = {
      grossTzs: 1_000_000,
      royaltyTzs: 70_000,
      feeTzs: 15_000,
      netTzs: 915_000,
    };
    const first = await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'coc-dup',
      math,
    });
    const second = await adapter.post({
      tenantId: TENANT,
      responseId: RESPONSE_ID,
      idempotencyKey: 'coc-dup',
      math,
    });

    expect(second.journalId).toBe(first.journalId); // same journal
    expect(posts.length).toBe(1); // exactly ONE post landed
  });

  it('propagates a failed LedgerService.post() (no silent success)', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger } = makeLedger({ fail: true });
    const adapter = createSettlementLedgerAdapter(db, ledger);

    await expect(
      adapter.post({
        tenantId: TENANT,
        responseId: RESPONSE_ID,
        idempotencyKey: 'coc-bbbb',
        math: {
          grossTzs: 1_000_000,
          royaltyTzs: 70_000,
          feeTzs: 15_000,
          netTzs: 915_000,
        },
      }),
    ).rejects.toThrow(/ledger blew up/i);
  });

  it('refuses an inverted settlement (royalty+fee > gross) before posting', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();
    const adapter = createSettlementLedgerAdapter(db, ledger);

    await expect(
      adapter.post({
        tenantId: TENANT,
        responseId: RESPONSE_ID,
        idempotencyKey: 'coc-cccc',
        math: { grossTzs: 100, royaltyTzs: 80, feeTzs: 40, netTzs: -20 },
      }),
    ).rejects.toThrow(/exceed gross/i);
    expect(posts.length).toBe(0);
  });

  it('fails loud when an account id is owned by a DIFFERENT tenant (M2 ownership guard)', async () => {
    // Simulate the post-upsert ownership SELECT returning a row owned by
    // someone else (defense-in-depth even if RLS were inert). The adapter
    // must refuse rather than build a journal against another tenant's
    // account — no post reaches the ledger.
    const { db } = makeDb({
      currency: 'TZS',
      ownerTenantId: '99999999-9999-9999-9999-999999999999',
    });
    const { ledger, posts } = makeLedger();
    const adapter = createSettlementLedgerAdapter(db, ledger);

    await expect(
      adapter.post({
        tenantId: TENANT,
        responseId: RESPONSE_ID,
        idempotencyKey: 'coc-tenant-guard',
        math: {
          grossTzs: 1_000_000,
          royaltyTzs: 70_000,
          feeTzs: 15_000,
          netTzs: 915_000,
        },
      }),
    ).rejects.toThrow(/owned by tenant/i);
    expect(posts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// payroll adapter
// ---------------------------------------------------------------------------

describe('payroll ledger adapter — LIVE money path', () => {
  it('posts a balanced DR wage / CR clearing journal', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();
    const adapter = createPayrollLedgerAdapter(db, ledger);

    const res = await adapter.post({
      tenantId: TENANT,
      workerUserId: 'worker-1',
      payrollRunId: 'run-1',
      netTzs: 1_250_000,
      idempotencyKey: 'run-1:worker-1',
    });

    expect(res.journalId).toMatch(/^jnl_real_/);
    expect(posts.length).toBe(1);
    const lines = posts[0]!.lines;
    expect(lines.length).toBe(2);
    const dr = lines.find((l) => l.direction === 'DEBIT')!;
    const cr = lines.find((l) => l.direction === 'CREDIT')!;
    expect(dr.amountMinorUnits).toBe(1_250_000);
    expect(cr.amountMinorUnits).toBe(1_250_000); // balanced
    expect(lines.every((l) => l.metadata?.payrollKey)).toBeTruthy();
  });

  it('is idempotent on (run, worker) retry — durable idempotencyKey replays the prior journal', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    // The payroll adapter derives the key `${payrollRunId}:${workerUserId}`.
    const priorKey = 'run-1:worker-1';
    const { ledger, posts } = makeLedger({
      priorKeys: { [`${TENANT}::${priorKey}`]: 'jnl_pay_prior' },
    });
    const adapter = createPayrollLedgerAdapter(db, ledger);

    const res = await adapter.post({
      tenantId: TENANT,
      workerUserId: 'worker-1',
      payrollRunId: 'run-1',
      netTzs: 1_250_000,
      idempotencyKey: 'run-1:worker-1',
    });
    expect(res.journalId).toBe('jnl_pay_prior');
    expect(posts.length).toBe(0); // no second post — deduped in the ledger
  });

  it('passes the (run, worker) key to the ledger as its idempotencyKey', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger, posts } = makeLedger();
    const adapter = createPayrollLedgerAdapter(db, ledger);

    await adapter.post({
      tenantId: TENANT,
      workerUserId: 'worker-7',
      payrollRunId: 'run-9',
      netTzs: 500_000,
      idempotencyKey: 'ignored-by-adapter',
    });

    expect(posts.length).toBe(1);
    expect(posts[0]!.idempotencyKey).toBe('run-9:worker-7');
  });

  it('rejects a non-positive payroll net', async () => {
    const { db } = makeDb({ currency: 'TZS' });
    const { ledger } = makeLedger();
    const adapter = createPayrollLedgerAdapter(db, ledger);

    await expect(
      adapter.post({
        tenantId: TENANT,
        workerUserId: 'worker-1',
        payrollRunId: 'run-1',
        netTzs: 0,
        idempotencyKey: 'run-1:worker-1',
      }),
    ).rejects.toThrow(/positive/i);
  });
});
