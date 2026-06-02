/**
 * PlatformBillingService — money-path unit tests (WS-4).
 *
 * Proves the platform's SaaS revenue path honours the CLAUDE.md hard rules:
 *   - the provider PORT (IPaymentProvider) is the ONLY money-out seam — every
 *     subscribe calls `createPaymentIntent` exactly once, with the resolved
 *     tenant currency (NEVER hardcoded) and a stable idempotency key;
 *   - the receivable posts through LedgerService.post() as a BALANCED 2-leg
 *     journal (DR receivable / CR revenue) — never a direct ledger write;
 *   - idempotency: a retried subscribe for the same (tenant, plan, period)
 *     does NOT re-charge the provider nor re-post the ledger;
 *   - a currency the provider can't support is refused loud.
 *
 * Real Postgres is not needed: the `db` (subscription read-model + account
 * provisioner) and the ledger are faked; the assertions are on the SERVICE's
 * orchestration of the provider PORT + ledger seam. The end-to-end DB+RLS
 * behaviour of `tenant_subscriptions` is covered by the migration set in the
 * database integration suite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Money } from '@borjie/domain-models';
import {
  PlatformBillingService,
  type SubscribeInput,
} from '../platform-billing-service';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface CapturedCharge {
  readonly amountMinor: number;
  readonly currency: string;
  readonly customerId: string;
  readonly idempotencyKey: string;
}

function makeFakeProvider() {
  const charges: CapturedCharge[] = [];
  let counter = 0;
  const provider = {
    name: 'fake-stripe',
    supportedCurrencies: ['TZS', 'USD', 'KES'],
    supportsCurrency(c: string) {
      return this.supportedCurrencies.includes(c);
    },
    async createPaymentIntent(params: {
      amount: Money;
      customerId: string;
      idempotencyKey: string;
    }) {
      charges.push({
        amountMinor: params.amount.amountMinorUnits,
        currency: params.amount.currency,
        customerId: params.customerId,
        idempotencyKey: params.idempotencyKey,
      });
      counter += 1;
      return { externalId: `pi_${counter}`, status: 'SUCCEEDED' as const };
    },
  };
  return { provider, charges };
}

interface PostedJournal {
  readonly tenantId: string;
  readonly idempotencyKey: string | undefined;
  readonly legs: ReadonlyArray<{ direction: string; amountMinor: number; currency: string }>;
}

function makeFakeLedger() {
  const posts: PostedJournal[] = [];
  let counter = 0;
  const ledger = {
    async postJournalEntry(
      request: {
        tenantId: string;
        lines: ReadonlyArray<{ direction: string; amount: Money }>;
      },
      options: { idempotencyKey?: string } = {},
    ) {
      // Assert balance here too (the real LedgerService rejects unbalanced).
      const net = request.lines.reduce(
        (s, l) =>
          s + (l.direction === 'DEBIT' ? l.amount.amountMinorUnits : -l.amount.amountMinorUnits),
        0,
      );
      if (net !== 0) throw new Error('fake-ledger: unbalanced journal');
      counter += 1;
      posts.push({
        tenantId: request.tenantId,
        idempotencyKey: options.idempotencyKey,
        legs: request.lines.map((l) => ({
          direction: l.direction,
          amountMinor: l.amount.amountMinorUnits,
          currency: l.amount.currency,
        })),
      });
      return { journalId: `jr_${counter}`, entries: [], updatedAccounts: [] };
    },
  };
  return { ledger, posts };
}

/**
 * Fake `db`: backs the subscription read-model with an in-memory array and the
 * account provisioner / insert / select chains the service touches. Only the
 * methods the service actually calls are implemented.
 */
function makeFakeDb() {
  const subs: Array<Record<string, unknown>> = [];

  // `select().from().where().limit()` → resolves to a filtered view. We can't
  // see the predicate, so we return the current active (non-cancelled) sub(s);
  // the service's own period predicate is exercised by the integration suite.
  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.from = ret;
    chain.where = ret;
    chain.limit = () =>
      Promise.resolve(subs.filter((s) => s.cancelledAt == null).slice(0, 1));
    return chain;
  };

  const db: Record<string, unknown> = {
    select: () => selectChain(),
    insert: () => {
      const chain: Record<string, unknown> = {};
      chain.values = (v: Record<string, unknown>) => {
        // Upsert into the active slot.
        const idx = subs.findIndex((s) => s.cancelledAt == null);
        if (idx >= 0) subs[idx] = { ...subs[idx], ...v };
        else subs.push({ ...v });
        chain.onConflictDoUpdate = () => chain;
        chain.returning = () =>
          Promise.resolve([subs.find((s) => s.cancelledAt == null)]);
        return chain;
      };
      return chain;
    },
    // ensureLedgerAccounts uses db.transaction(cb) then, per account, an
    // INSERT … ON CONFLICT DO NOTHING followed by a SELECT that reads the row
    // back and asserts tenant ownership. Drizzle `sql` objects don't stringify
    // to inspectable SQL, so we can't branch on the statement text; instead the
    // tx `execute` always returns the owning tenant row — INSERTs ignore the
    // return value, and the ownership SELECT sees the correct tenant_id.
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: () => Promise.resolve([{ tenant_id: currentTenant }]),
      };
      return cb(tx);
    },
    execute: () => Promise.resolve([{ tenant_id: currentTenant }]),
  };

  let currentTenant = 'tenant-bill-1';
  return {
    db,
    subs,
    setCurrentTenant: (t: string) => {
      currentTenant = t;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TENANT = 'tenant-bill-1';
const baseInput: SubscribeInput = {
  tenantId: TENANT,
  plan: 'mkulima',
  mrrMinor: 50_000,
  seats: 3,
  billingPeriod: '2026-05',
  providerCustomerId: 'cus_fake_1',
  actorId: 'owner-1',
};

describe('PlatformBillingService.subscribe (money path)', () => {
  let fakeProvider: ReturnType<typeof makeFakeProvider>;
  let fakeLedger: ReturnType<typeof makeFakeLedger>;
  let fakeDb: ReturnType<typeof makeFakeDb>;
  let service: PlatformBillingService;

  beforeEach(() => {
    fakeProvider = makeFakeProvider();
    fakeLedger = makeFakeLedger();
    fakeDb = makeFakeDb();
    fakeDb.setCurrentTenant(TENANT);
    service = new PlatformBillingService({
      db: fakeDb.db as never,
      provider: fakeProvider.provider as never,
      ledger: fakeLedger.ledger as never,
      // Currency resolved from the tenant — here TZS — and threaded everywhere.
      resolveCurrency: async () => 'TZS',
    });
  });

  it('charges via the provider PORT with the resolved currency + idempotency key', async () => {
    const result = await service.subscribe(baseInput);
    expect(fakeProvider.charges).toHaveLength(1);
    const charge = fakeProvider.charges[0]!;
    expect(charge.amountMinor).toBe(50_000);
    expect(charge.currency).toBe('TZS'); // resolved, never hardcoded
    expect(charge.customerId).toBe('cus_fake_1');
    expect(charge.idempotencyKey).toBe('platform-billing:tenant-bill-1:mkulima:2026-05');
    expect(result.providerPaymentId).toBe('pi_1');
    expect(result.idempotentReplay).toBe(false);
  });

  it('posts a BALANCED 2-leg journal through LedgerService (DR receivable / CR revenue)', async () => {
    await service.subscribe(baseInput);
    expect(fakeLedger.posts).toHaveLength(1);
    const post = fakeLedger.posts[0]!;
    expect(post.tenantId).toBe(TENANT);
    expect(post.idempotencyKey).toBe('platform-billing:tenant-bill-1:mkulima:2026-05');
    expect(post.legs).toHaveLength(2);
    const debit = post.legs.find((l) => l.direction === 'DEBIT');
    const credit = post.legs.find((l) => l.direction === 'CREDIT');
    expect(debit?.amountMinor).toBe(50_000);
    expect(credit?.amountMinor).toBe(50_000);
    expect(debit?.currency).toBe('TZS');
    expect(credit?.currency).toBe('TZS');
  });

  it('is idempotent: a same-period re-subscribe does NOT re-charge or re-post', async () => {
    await service.subscribe(baseInput);
    // Second call: the active sub now carries billingPeriod 2026-05 in metadata,
    // so the fast-path replay fires (no second provider charge / ledger post).
    const replay = await service.subscribe(baseInput);
    expect(replay.idempotentReplay).toBe(true);
    expect(fakeProvider.charges).toHaveLength(1); // still ONE charge
    expect(fakeLedger.posts).toHaveLength(1); // still ONE post
  });

  it('refuses a currency the provider does not support (loud)', async () => {
    const svc = new PlatformBillingService({
      db: fakeDb.db as never,
      provider: fakeProvider.provider as never,
      ledger: fakeLedger.ledger as never,
      resolveCurrency: async () => 'JPY', // not in the fake provider's set
    });
    await expect(svc.subscribe(baseInput)).rejects.toThrow(/does not support JPY/);
    expect(fakeProvider.charges).toHaveLength(0);
    expect(fakeLedger.posts).toHaveLength(0);
  });

  it('rejects a non-positive MRR', async () => {
    await expect(
      service.subscribe({ ...baseInput, mrrMinor: 0 }),
    ).rejects.toThrow(/positive integer/);
  });
});

describe('PlatformBillingService.getSubscription', () => {
  it('returns a "none" status when the tenant has never subscribed', async () => {
    const fakeDb = makeFakeDb();
    const service = new PlatformBillingService({
      db: fakeDb.db as never,
      provider: makeFakeProvider().provider as never,
      ledger: makeFakeLedger().ledger as never,
      resolveCurrency: async () => 'TZS',
    });
    const view = await service.getSubscription(TENANT);
    expect(view.status).toBe('none');
    expect(view.plan).toBeNull();
    expect(view.mrrMinor).toBe(0);
  });
});
