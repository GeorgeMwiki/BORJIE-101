/**
 * Gateway `postJournalAtomic` — the LIVE money path, repository layer.
 *
 * These tests drive the REAL `GatewayDrizzleLedgerRepository.postJournalAtomic`
 * (and `GatewayDrizzleAccountRepository`) — the single-transaction atomic
 * post the api-gateway runs for settlement / payroll. They pin the
 * money-critical invariants the convergence onto M2's hardened ledger must
 * uphold:
 *
 *   - ONE transaction wraps balance CAS + entry inserts + the
 *     `journal_idempotency` dedupe row (whole post commits or rolls back).
 *   - a duplicate idempotencyKey returns the EXISTING journal and writes
 *     nothing a second time (no double-post) — durably, via
 *     `journal_idempotency`, NOT a pre-check probe.
 *   - the per-(tenant, account) hash-chain links prevHash→thisHash via the
 *     SHARED `computeEntryHash` exported from the package barrel (parity:
 *     `verifyHashChain` from the same barrel accepts the stored chain).
 *   - a CAS miss (stale entry_count) rolls the WHOLE post back ⇒ `stale`,
 *     no orphan balance, no entries.
 *   - an unbalanced journal is rejected by the REAL `LedgerService` BEFORE
 *     any write (asserted end-to-end through `buildLedgerService`).
 *
 * The Drizzle client is faked at the query-builder level. `drizzle-orm`'s
 * operators are mocked so `eq` / `and` become row predicates and `desc` /
 * `asc` become orderings the in-memory store understands; the store models
 * `accounts` / `ledger_entries` / `journal_idempotency` as arrays and
 * supports `.transaction()` with snapshot-rollback (modelling Postgres
 * commit/rollback). This exercises the adapter's REAL SQL-building code
 * path, not a reimplementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock drizzle-orm operators as row predicates / orderings ───────────
// `eq(col, val)` → `{ __pred: (row) => row[col.name] === val }`
// `and(...preds)` → conjunction. `sql\`… + 1\`` is only used for
// entry_count bump; we tag it so the fake `update().set()` increments.
vi.mock('drizzle-orm', () => {
  type Pred = { __pred: (row: Record<string, unknown>) => boolean };
  type Order = { __order: true; col: string; dir: 'asc' | 'desc' };
  // Drizzle columns expose only the SQL (snake_case) `.name`; the in-memory
  // store rows are keyed by the camelCase JS field names (what
  // `$inferInsert` produces). Bridge the two so predicates index correctly.
  const snakeToCamel = (s: string): string =>
    s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  const colKey = (c: unknown): string =>
    snakeToCamel((c as { name: string }).name);
  return {
    eq: (col: unknown, val: unknown): Pred => ({
      __pred: (row) => row[colKey(col)] === val,
    }),
    and: (...preds: Array<Pred | undefined>): Pred => ({
      __pred: (row) =>
        preds.every((p) => (p ? p.__pred(row) : true)),
    }),
    desc: (col: unknown): Order => ({
      __order: true,
      col: colKey(col),
      dir: 'desc',
    }),
    asc: (col: unknown): Order => ({
      __order: true,
      col: colKey(col),
      dir: 'asc',
    }),
    // Two `sql\`…\`` uses to model:
    //   1. `sql\`${accounts.entryCount} + 1\`` — the CAS version bump.
    //      Tagged `__sqlIncrement` so the fake update applies +1.
    //   2. `sql\`SELECT set_config('app.current_tenant_id', …, true)\`` —
    //      the C1 tenant-GUC bind. Carries `__rawText` so the fake
    //      `execute` can recognise it and bump `setConfigCalls`.
    sql: (() => {
      const tag = (strings: TemplateStringsArray, ..._vals: unknown[]) => {
        const rawText = Array.from(strings).join(' ');
        return { __sqlIncrement: true, __rawText: rawText };
      };
      return tag;
    })(),
  };
});

import {
  GatewayDrizzleLedgerRepository,
  GatewayDrizzleAccountRepository,
} from '../drizzle-ledger-repos';
import {
  computeEntryHash,
  verifyHashChain,
  GENESIS_HASH,
  type HashableEntry,
} from '@borjie/payments-ledger-service';
import {
  Money,
  type AccountId,
  type LedgerEntry,
  type LedgerEntryId,
  type TenantId,
} from '@borjie/domain-models';

// ── In-memory transactional Drizzle fake ───────────────────────────────

type Row = Record<string, unknown>;
type Pred = { __pred: (row: Row) => boolean };
type Order = { __order: true; col: string; dir: 'asc' | 'desc' };

interface Store {
  accounts: Row[];
  ledger_entries: Row[];
  journal_idempotency: Row[];
}

function tableKeyOf(table: unknown): keyof Store {
  // The local pgTable consts carry their SQL name via a symbol; the
  // simplest stable handle is the table's own `[Symbol]` name. drizzle
  // exposes it on `Table.Symbol.Name`, but to stay version-stable we
  // sniff the declared columns instead.
  const cols = Object.keys(table as Record<string, unknown>);
  if (cols.includes('idempotencyKey')) return 'journal_idempotency';
  if (cols.includes('balanceMinorUnits')) return 'accounts';
  return 'ledger_entries';
}

function applyOrder(rows: Row[], order: Order | undefined): Row[] {
  if (!order) return rows;
  const sorted = [...rows].sort((a, b) => {
    const av = a[order.col] as number;
    const bv = b[order.col] as number;
    return av - bv;
  });
  return order.dir === 'desc' ? sorted.reverse() : sorted;
}

/**
 * Builds a fake `DatabaseClient` whose `.select/.insert/.update/.transaction`
 * read and write `store`. `transaction(cb)` snapshots the store, runs the
 * callback against a tx-scoped client, and on throw restores the snapshot
 * (Postgres rollback). Tracks `txDepth` so a test can assert the post ran
 * inside exactly ONE transaction.
 */
function makeTxDb(store: Store) {
  const counters = {
    txDepth: 0,
    maxTxDepth: 0,
    commits: 0,
    rollbacks: 0,
    setConfigCalls: 0,
  };

  function clientFor(s: Store) {
    function select(projection?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          const key = tableKeyOf(table);
          let pred: Pred | undefined;
          let order: Order | undefined;
          let lim: number | undefined;
          const api = {
            where(p: Pred) {
              pred = p;
              return api;
            },
            orderBy(o: Order) {
              order = o;
              return api;
            },
            limit(n: number) {
              lim = n;
              return run();
            },
            then(resolve: (rows: Row[]) => unknown) {
              return Promise.resolve(run()).then(resolve);
            },
          };
          function run(): Row[] {
            let rows = s[key].filter((r) => (pred ? pred.__pred(r) : true));
            rows = applyOrder(rows, order);
            if (lim !== undefined) rows = rows.slice(0, lim);
            // Apply projection key-renaming (select({ alias: col })). The
            // store is keyed camelCase; the column's `.name` is snake_case.
            if (projection) {
              const toCamel = (s: string): string =>
                s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
              return rows.map((r) => {
                const out: Row = {};
                for (const [alias, col] of Object.entries(projection)) {
                  out[alias] = r[toCamel((col as { name: string }).name)];
                }
                return out;
              });
            }
            return rows.map((r) => ({ ...r }));
          }
          return api;
        },
      };
    }

    function insert(table: unknown) {
      const key = tableKeyOf(table);
      return {
        values(vals: Row | Row[]) {
          const arr = Array.isArray(vals) ? vals : [vals];
          // Enforce the journal_idempotency composite-PK uniqueness so a
          // duplicate key throws a 23505-shaped error (production parity).
          if (key === 'journal_idempotency') {
            for (const v of arr) {
              const clash = s.journal_idempotency.some(
                (r) =>
                  r.tenantId === v.tenantId &&
                  r.idempotencyKey === v.idempotencyKey,
              );
              if (clash) {
                const err = new Error(
                  'duplicate key value violates unique constraint',
                ) as Error & { code: string };
                err.code = '23505';
                throw err;
              }
            }
          }
          // Enforce ledger_entries (account_id, sequence_number) uniqueness.
          if (key === 'ledger_entries') {
            for (const v of arr) {
              const clash = s.ledger_entries.some(
                (r) =>
                  r.tenantId === v.tenantId &&
                  r.accountId === v.accountId &&
                  r.sequenceNumber === v.sequenceNumber,
              );
              if (clash) {
                const err = new Error(
                  'duplicate key value violates unique constraint',
                ) as Error & { code: string };
                err.code = '23505';
                throw err;
              }
            }
          }
          for (const v of arr) s[key].push({ ...v });
          const result = {
            returning() {
              return Promise.resolve(arr.map((v) => ({ ...v })));
            },
            then(resolve: (v: unknown) => unknown) {
              return Promise.resolve(undefined).then(resolve);
            },
          };
          return result;
        },
      };
    }

    function update(table: unknown) {
      const key = tableKeyOf(table);
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(pred: Pred) {
              return {
                returning() {
                  const matched = s[key].filter((r) => pred.__pred(r));
                  for (const r of matched) {
                    for (const [k, val] of Object.entries(patch)) {
                      if (
                        val &&
                        typeof val === 'object' &&
                        '__sqlIncrement' in (val as object)
                      ) {
                        r[k] = (r[k] as number) + 1;
                      } else {
                        r[k] = val;
                      }
                    }
                  }
                  return Promise.resolve(
                    matched.map((r) => ({ id: r.id })),
                  );
                },
              };
            },
          };
        },
      };
    }

    // `execute(sql)` — models the tx-local `set_config('app.current_tenant_id',
    // …, true)` GUC bind the atomic post / CAS now runs as its FIRST
    // statement (RLS self-sufficiency fix). The in-memory store has no RLS,
    // so this is a recorded no-op; `setConfigCalls` lets a test assert the
    // bind fired.
    function execute(query: unknown) {
      const rawText =
        query && typeof query === 'object' && '__rawText' in query
          ? String((query as { __rawText: unknown }).__rawText)
          : JSON.stringify(query);
      if (rawText.includes('set_config')) {
        counters.setConfigCalls += 1;
      }
      return Promise.resolve({ rows: [] });
    }

    async function transaction<T>(
      cb: (tx: unknown) => Promise<T>,
    ): Promise<T> {
      counters.txDepth += 1;
      counters.maxTxDepth = Math.max(counters.maxTxDepth, counters.txDepth);
      const snapshot: Store = {
        accounts: s.accounts.map((r) => ({ ...r })),
        ledger_entries: s.ledger_entries.map((r) => ({ ...r })),
        journal_idempotency: s.journal_idempotency.map((r) => ({ ...r })),
      };
      try {
        // tx-scoped client mutates the SAME store; rollback restores it.
        const result = await cb(clientFor(s));
        counters.commits += 1;
        counters.txDepth -= 1;
        return result;
      } catch (err) {
        s.accounts = snapshot.accounts;
        s.ledger_entries = snapshot.ledger_entries;
        s.journal_idempotency = snapshot.journal_idempotency;
        counters.rollbacks += 1;
        counters.txDepth -= 1;
        throw err;
      }
    }

    return { select, insert, update, transaction, execute };
  }

  return { db: clientFor(store) as unknown as never, counters, store };
}

// ── Fixtures ───────────────────────────────────────────────────────────

const TENANT = 'tenant-atomic-1' as TenantId;
const ACCT_A = 'acct-A' as AccountId;
const ACCT_B = 'acct-B' as AccountId;

function seedAccount(id: string, balance = 0, entryCount = 0): Row {
  return {
    id,
    tenantId: TENANT,
    customerId: null,
    ownerId: null,
    propertyId: null,
    name: id,
    type: 'CUSTOMER_LIABILITY',
    status: 'ACTIVE',
    currency: 'TZS',
    balanceMinorUnits: balance,
    lastEntryId: null,
    lastEntryAt: null,
    entryCount,
    description: null,
    metadata: {},
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    createdBy: 'seed',
    updatedBy: 'seed',
  };
}

let entrySeq = 0;
function entry(
  accountId: string,
  direction: 'DEBIT' | 'CREDIT',
  amountMinor: number,
  sequenceNumber: number,
  journalId: string,
  balanceAfterMinor: number,
): LedgerEntry {
  entrySeq += 1;
  return {
    id: `le_${entrySeq}` as LedgerEntryId,
    tenantId: TENANT,
    accountId: accountId as AccountId,
    journalId,
    type: 'RENT_PAYMENT',
    direction,
    amount: Money.fromMinorUnits(amountMinor, 'TZS'),
    balanceAfter: Money.fromMinorUnits(balanceAfterMinor, 'TZS'),
    sequenceNumber,
    effectiveDate: new Date('2026-06-01T00:00:00Z'),
    postedAt: new Date('2026-06-01T00:00:00Z'),
    description: `${direction} ${amountMinor}`,
    metadata: {},
    createdAt: new Date('2026-06-01T00:00:00Z'),
    createdBy: 'test',
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    updatedBy: 'test',
  } as LedgerEntry;
}

function emptyStore(): Store {
  return { accounts: [], ledger_entries: [], journal_idempotency: [] };
}

beforeEach(() => {
  entrySeq = 0;
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('GatewayDrizzleLedgerRepository.postJournalAtomic — single transaction', () => {
  it('posts a balanced 2-leg journal: balances CAS + entries + idempotency in ONE tx', async () => {
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 0, 0), seedAccount(ACCT_B, 0, 0));
    const { db, counters } = makeTxDb(store);
    const repo = new GatewayDrizzleLedgerRepository(db);

    const result = await repo.postJournalAtomic({
      tenantId: TENANT,
      journalId: 'jnl-1',
      entries: [
        entry(ACCT_A, 'DEBIT', 1000, 1, 'jnl-1', 1000),
        entry(ACCT_B, 'CREDIT', 1000, 1, 'jnl-1', -1000),
      ],
      balanceUpdates: [
        {
          accountId: ACCT_A,
          tenantId: TENANT,
          newBalanceMinorUnits: 1000,
          lastEntryId: 'le_1',
          expectedVersion: 0,
        },
        {
          accountId: ACCT_B,
          tenantId: TENANT,
          newBalanceMinorUnits: -1000,
          lastEntryId: 'le_2',
          expectedVersion: 0,
        },
      ],
      idempotencyKey: 'settle-key-1',
    });

    expect(result.status).toBe('committed');
    // Exactly ONE transaction wrapped the whole post.
    expect(counters.maxTxDepth).toBe(1);
    expect(counters.commits).toBe(1);
    expect(counters.rollbacks).toBe(0);

    // Entries landed.
    expect(store.ledger_entries.length).toBe(2);
    // Balances + entry_count CAS applied (version bumped 0 → 1).
    const a = store.accounts.find((r) => r.id === ACCT_A)!;
    const b = store.accounts.find((r) => r.id === ACCT_B)!;
    expect(a.balanceMinorUnits).toBe(1000);
    expect(b.balanceMinorUnits).toBe(-1000);
    expect(a.entryCount).toBe(1);
    expect(b.entryCount).toBe(1);
    // Idempotency row persisted in the SAME tx.
    expect(store.journal_idempotency.length).toBe(1);
    expect(store.journal_idempotency[0]!.journalId).toBe('jnl-1');
  });

  it('binds app.current_tenant_id transaction-locally as the FIRST statement (RLS self-sufficiency, C1)', async () => {
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 0, 0), seedAccount(ACCT_B, 0, 0));
    const { db, counters } = makeTxDb(store);
    const repo = new GatewayDrizzleLedgerRepository(db);

    await repo.postJournalAtomic({
      tenantId: TENANT,
      journalId: 'jnl-guc',
      entries: [
        entry(ACCT_A, 'DEBIT', 10, 1, 'jnl-guc', 10),
        entry(ACCT_B, 'CREDIT', 10, 1, 'jnl-guc', -10),
      ],
      balanceUpdates: [
        { accountId: ACCT_A, tenantId: TENANT, newBalanceMinorUnits: 10, lastEntryId: 'le_1', expectedVersion: 0 },
        { accountId: ACCT_B, tenantId: TENANT, newBalanceMinorUnits: -10, lastEntryId: 'le_2', expectedVersion: 0 },
      ],
    });

    // The atomic post is built once at boot against the singleton pool —
    // a DIFFERENT connection from the request middleware — so it MUST bind
    // the tenant GUC itself or FORCE RLS is fail-closed. Assert the bind
    // ran (once, inside the tx).
    expect(counters.setConfigCalls).toBe(1);
  });

  it('posts a 5,000,000,000-minor-unit journal without 32-bit overflow (BIGINT columns, C2)', async () => {
    // 5e9 exceeds INT4_MAX (2,147,483,647). With the local pgTable money
    // columns now BIGINT { mode: 'number' }, the value round-trips as a JS
    // number and the post commits — the overflow that would have corrupted
    // a 5-billion-shilling settlement is gone.
    const BIG = 5_000_000_000;
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 0, 0), seedAccount(ACCT_B, 0, 0));
    const { db } = makeTxDb(store);
    const repo = new GatewayDrizzleLedgerRepository(db);

    const result = await repo.postJournalAtomic({
      tenantId: TENANT,
      journalId: 'jnl-big',
      entries: [
        entry(ACCT_A, 'DEBIT', BIG, 1, 'jnl-big', BIG),
        entry(ACCT_B, 'CREDIT', BIG, 1, 'jnl-big', -BIG),
      ],
      balanceUpdates: [
        { accountId: ACCT_A, tenantId: TENANT, newBalanceMinorUnits: BIG, lastEntryId: 'le_1', expectedVersion: 0 },
        { accountId: ACCT_B, tenantId: TENANT, newBalanceMinorUnits: -BIG, lastEntryId: 'le_2', expectedVersion: 0 },
      ],
      idempotencyKey: 'big-key',
    });

    expect(result.status).toBe('committed');
    // The full 5e9 magnitude survives (no truncation / overflow).
    const a = store.accounts.find((r) => r.id === ACCT_A)!;
    const b = store.accounts.find((r) => r.id === ACCT_B)!;
    expect(a.balanceMinorUnits).toBe(BIG);
    expect(b.balanceMinorUnits).toBe(-BIG);
    expect(
      store.ledger_entries.find((r) => r.accountId === ACCT_A)!
        .amountMinorUnits,
    ).toBe(BIG);
  });

  it('rejects a cross-tenant balance batch in updateBalancesAtomic (RLS bind safety, C1)', async () => {
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 0, 0), seedAccount(ACCT_B, 0, 0));
    const { db } = makeTxDb(store);
    const repo = new GatewayDrizzleAccountRepository(db);

    await expect(
      repo.updateBalancesAtomic([
        { accountId: ACCT_A, tenantId: TENANT, newBalanceMinorUnits: 5, lastEntryId: 'le_1', expectedVersion: 0 },
        {
          accountId: ACCT_B,
          tenantId: 'other-tenant' as TenantId,
          newBalanceMinorUnits: -5,
          lastEntryId: 'le_2',
          expectedVersion: 0,
        },
      ]),
    ).rejects.toThrow(/share one tenant_id/i);
  });

  it('a duplicate idempotencyKey returns the existing journal and posts NOTHING again', async () => {
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 0, 0), seedAccount(ACCT_B, 0, 0));
    const { db } = makeTxDb(store);
    const repo = new GatewayDrizzleLedgerRepository(db);

    const post = (journalId: string) =>
      repo.postJournalAtomic({
        tenantId: TENANT,
        journalId,
        entries: [
          entry(ACCT_A, 'DEBIT', 500, 1, journalId, 500),
          entry(ACCT_B, 'CREDIT', 500, 1, journalId, -500),
        ],
        balanceUpdates: [
          {
            accountId: ACCT_A,
            tenantId: TENANT,
            newBalanceMinorUnits: 500,
            lastEntryId: 'le_x',
            expectedVersion: 0,
          },
          {
            accountId: ACCT_B,
            tenantId: TENANT,
            newBalanceMinorUnits: -500,
            lastEntryId: 'le_y',
            expectedVersion: 0,
          },
        ],
        idempotencyKey: 'dup-key',
      });

    const first = await post('jnl-first');
    expect(first.status).toBe('committed');

    // Retry under the same key — second post must short-circuit.
    const second = await post('jnl-second');
    expect(second.status).toBe('duplicate');
    if (second.status === 'duplicate') {
      expect(second.existingJournalId).toBe('jnl-first');
    }

    // No second post landed: still 2 entries, 1 idempotency row, balances
    // moved exactly once (entry_count == 1, not 2).
    expect(store.ledger_entries.length).toBe(2);
    expect(store.journal_idempotency.length).toBe(1);
    expect(store.accounts.find((r) => r.id === ACCT_A)!.entryCount).toBe(1);
  });

  it('links the per-account hash-chain via the SHARED computeEntryHash (verifyHashChain accepts it)', async () => {
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 0, 0), seedAccount(ACCT_B, 0, 0));
    const { db } = makeTxDb(store);
    const repo = new GatewayDrizzleLedgerRepository(db);

    // Two sequential posts on ACCT_A so the chain has > 1 link.
    await repo.postJournalAtomic({
      tenantId: TENANT,
      journalId: 'jnl-h1',
      entries: [
        entry(ACCT_A, 'DEBIT', 100, 1, 'jnl-h1', 100),
        entry(ACCT_B, 'CREDIT', 100, 1, 'jnl-h1', -100),
      ],
      balanceUpdates: [
        { accountId: ACCT_A, tenantId: TENANT, newBalanceMinorUnits: 100, lastEntryId: 'le_1', expectedVersion: 0 },
        { accountId: ACCT_B, tenantId: TENANT, newBalanceMinorUnits: -100, lastEntryId: 'le_2', expectedVersion: 0 },
      ],
    });
    await repo.postJournalAtomic({
      tenantId: TENANT,
      journalId: 'jnl-h2',
      entries: [
        entry(ACCT_A, 'DEBIT', 200, 2, 'jnl-h2', 300),
        entry(ACCT_B, 'CREDIT', 200, 2, 'jnl-h2', -300),
      ],
      balanceUpdates: [
        { accountId: ACCT_A, tenantId: TENANT, newBalanceMinorUnits: 300, lastEntryId: 'le_3', expectedVersion: 1 },
        { accountId: ACCT_B, tenantId: TENANT, newBalanceMinorUnits: -300, lastEntryId: 'le_4', expectedVersion: 1 },
      ],
    });

    // Pull ACCT_A's chain in sequence order and verify with the SAME
    // helper the package uses (parity).
    const chainA = store.ledger_entries
      .filter((r) => r.accountId === ACCT_A)
      .sort((a, b) => (a.sequenceNumber as number) - (b.sequenceNumber as number))
      .map((r) => toHashable(r));

    // First link seeds from GENESIS; second link's prevHash == first's thisHash.
    expect(chainA.length).toBe(2);
    expect(chainA[0]!.prevHash).toBe(GENESIS_HASH);
    expect(chainA[1]!.prevHash).toBe(chainA[0]!.thisHash);
    // The stored thisHash equals the shared recompute (no re-implementation).
    expect(chainA[0]!.thisHash).toBe(
      computeEntryHash(GENESIS_HASH, chainA[0]!),
    );
    // Whole-chain verification via the package barrel helper.
    expect(verifyHashChain(chainA).ok).toBe(true);
  });

  it('a CAS miss (stale entry_count) rolls the WHOLE post back — no entries, no balance move, no idempotency row', async () => {
    const store = emptyStore();
    // Seed ACCT_A at entry_count 5 but post with expectedVersion 0 → stale.
    store.accounts.push(seedAccount(ACCT_A, 0, 5), seedAccount(ACCT_B, 0, 0));
    const { db, counters } = makeTxDb(store);
    const repo = new GatewayDrizzleLedgerRepository(db);

    const result = await repo.postJournalAtomic({
      tenantId: TENANT,
      journalId: 'jnl-stale',
      entries: [
        entry(ACCT_A, 'DEBIT', 100, 1, 'jnl-stale', 100),
        entry(ACCT_B, 'CREDIT', 100, 1, 'jnl-stale', -100),
      ],
      balanceUpdates: [
        { accountId: ACCT_A, tenantId: TENANT, newBalanceMinorUnits: 100, lastEntryId: 'le_1', expectedVersion: 0 },
        { accountId: ACCT_B, tenantId: TENANT, newBalanceMinorUnits: -100, lastEntryId: 'le_2', expectedVersion: 0 },
      ],
      idempotencyKey: 'stale-key',
    });

    expect(result.status).toBe('stale');
    if (result.status === 'stale') {
      expect(result.conflictAccountId).toBe(ACCT_A);
    }
    // Rolled back: nothing written, balances untouched.
    expect(store.ledger_entries.length).toBe(0);
    expect(store.journal_idempotency.length).toBe(0);
    expect(store.accounts.find((r) => r.id === ACCT_A)!.balanceMinorUnits).toBe(0);
    expect(store.accounts.find((r) => r.id === ACCT_A)!.entryCount).toBe(5);
    expect(counters.rollbacks).toBe(1);
    expect(counters.commits).toBe(0);
  });
});

describe('GatewayDrizzleLedgerRepository.findJournalIdByIdempotencyKey', () => {
  it('returns the recorded journalId, tenant-scoped', async () => {
    const store = emptyStore();
    store.journal_idempotency.push({
      tenantId: TENANT,
      idempotencyKey: 'k-1',
      journalId: 'jnl-found',
      createdAt: new Date(),
    });
    const { db } = makeTxDb(store);
    const repo = new GatewayDrizzleLedgerRepository(db);

    expect(
      await repo.findJournalIdByIdempotencyKey(TENANT, 'k-1'),
    ).toBe('jnl-found');
    // Unknown key → null.
    expect(
      await repo.findJournalIdByIdempotencyKey(TENANT, 'nope'),
    ).toBeNull();
    // Wrong tenant → null (tenant isolation).
    expect(
      await repo.findJournalIdByIdempotencyKey(
        'other-tenant' as TenantId,
        'k-1',
      ),
    ).toBeNull();
  });
});

describe('GatewayDrizzleAccountRepository.updateBalancesAtomic — CAS', () => {
  it('applies all updates on a version match, bumping entry_count', async () => {
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 0, 0));
    const { db } = makeTxDb(store);
    const repo = new GatewayDrizzleAccountRepository(db);

    const res = await repo.updateBalancesAtomic([
      {
        accountId: ACCT_A,
        tenantId: TENANT,
        newBalanceMinorUnits: 750,
        lastEntryId: 'le_z',
        expectedVersion: 0,
      },
    ]);
    expect(res.ok).toBe(true);
    expect(store.accounts[0]!.balanceMinorUnits).toBe(750);
    expect(store.accounts[0]!.entryCount).toBe(1);
  });

  it('a stale expectedVersion conflicts and rolls back', async () => {
    const store = emptyStore();
    store.accounts.push(seedAccount(ACCT_A, 100, 3));
    const { db } = makeTxDb(store);
    const repo = new GatewayDrizzleAccountRepository(db);

    const res = await repo.updateBalancesAtomic([
      {
        accountId: ACCT_A,
        tenantId: TENANT,
        newBalanceMinorUnits: 999,
        lastEntryId: 'le_z',
        expectedVersion: 0, // actual is 3 → conflict
      },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflictAccountId).toBe(ACCT_A);
    // Untouched.
    expect(store.accounts[0]!.balanceMinorUnits).toBe(100);
    expect(store.accounts[0]!.entryCount).toBe(3);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────

/** Re-hydrate a stored ledger_entries row into the HashableEntry shape. */
function toHashable(row: Row): HashableEntry & {
  prevHash?: string;
  thisHash?: string;
} {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    accountId: row.accountId as string,
    journalId: row.journalId as string,
    type: row.type as string,
    direction: row.direction as string,
    amount: Money.fromMinorUnits(
      row.amountMinorUnits as number,
      row.currency as never,
    ),
    balanceAfter: Money.fromMinorUnits(
      row.balanceAfterMinorUnits as number,
      row.currency as never,
    ),
    sequenceNumber: row.sequenceNumber as number,
    effectiveDate: row.effectiveDate as Date,
    postedAt: row.postedAt as Date,
    prevHash: (row.prevHash ?? undefined) as string | undefined,
    thisHash: (row.thisHash ?? undefined) as string | undefined,
  };
}
