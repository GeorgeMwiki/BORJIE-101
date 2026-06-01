/**
 * Durable webhook dedupe store tests (EDGE-HARDENING #3).
 *
 * Covers:
 *   1. InMemoryWebhookDedupeStore — first claim 'first-seen', second
 *      'duplicate', distinct (provider,eventId) independent.
 *   2. DbWebhookDedupeStore — INSERTs under the tenant RLS GUC; a 23505
 *      unique-violation on the (provider,event_id) PK → 'duplicate'; a
 *      non-23505 error fails OPEN to 'first-seen' (with a warn) so the
 *      ledger idempotency key remains the post-once backstop.
 *   3. createWebhookDedupeStore — returns in-memory without a db, DB-backed
 *      with one.
 *
 * The DB adapter is exercised against a fake DatabaseClient that records
 * the SQL/inserts and can be told to throw a 23505 — no real Postgres.
 */

import { describe, it, expect } from 'vitest';
import {
  InMemoryWebhookDedupeStore,
  DbWebhookDedupeStore,
  createWebhookDedupeStore,
} from '../providers/webhook-dedupe-store.js';

describe('InMemoryWebhookDedupeStore', () => {
  it('returns first-seen once then duplicate', async () => {
    const store = new InMemoryWebhookDedupeStore();
    expect(await store.claim('stripe', 'evt_1', 't1')).toBe('first-seen');
    expect(await store.claim('stripe', 'evt_1', 't1')).toBe('duplicate');
  });

  it('namespaces by provider (same id under two providers is independent)', async () => {
    const store = new InMemoryWebhookDedupeStore();
    expect(await store.claim('stripe', 'shared-id', 't1')).toBe('first-seen');
    expect(await store.claim('mpesa', 'shared-id', 't1')).toBe('first-seen');
    expect(await store.claim('stripe', 'shared-id', 't1')).toBe('duplicate');
  });
});

/**
 * Minimal fake of the Drizzle DatabaseClient surface the store touches:
 * `.transaction(cb)` → runs cb with a tx that exposes `.execute` (GUC
 * binds) and `.insert(table).values(row)` which throws when armed.
 */
function makeFakeDb(opts: { failWith?: { code?: string } } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const guc: Array<unknown> = [];
  const tx = {
    execute: async (q: unknown) => {
      guc.push(q);
      return [];
    },
    insert: (_table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (opts.failWith) {
          const err = new Error('insert failed') as Error & { code?: string };
          if (opts.failWith.code) err.code = opts.failWith.code;
          throw err;
        }
        inserts.push(row);
        return [];
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };
  const db = {
    transaction: async <T>(cb: (t: unknown) => Promise<T>): Promise<T> => cb(tx),
  };
  return { db, inserts, guc };
}

describe('DbWebhookDedupeStore', () => {
  it('claims first-seen on a clean insert and binds the tenant RLS GUC', async () => {
    const { db, inserts, guc } = makeFakeDb();
    const store = new DbWebhookDedupeStore(db as never);
    const claim = await store.claim('mpesa', 'ws_CO_1', 'tenant-9');
    expect(claim).toBe('first-seen');
    expect(inserts).toEqual([
      { provider: 'mpesa', eventId: 'ws_CO_1', tenantId: 'tenant-9' },
    ]);
    // Two set_config binds (app.current_tenant_id + legacy app.tenant_id)
    // ran BEFORE the insert.
    expect(guc.length).toBe(2);
  });

  it('returns duplicate on a 23505 unique-violation', async () => {
    const { db } = makeFakeDb({ failWith: { code: '23505' } });
    const store = new DbWebhookDedupeStore(db as never);
    expect(await store.claim('stripe', 'evt_dup', 't1')).toBe('duplicate');
  });

  it('fails OPEN to first-seen on a non-23505 error (does not suppress the event)', async () => {
    const warnings: Array<[unknown, string]> = [];
    const { db } = makeFakeDb({ failWith: { code: '08006' } }); // connection error
    const store = new DbWebhookDedupeStore(db as never, {
      warn: (ctx, msg) => warnings.push([ctx, msg]),
    });
    // Must NOT throw, must NOT report duplicate — the ledger idempotency
    // key keyed on the same event id is the post-once backstop.
    expect(await store.claim('mpesa', 'ws_err', 't1')).toBe('first-seen');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[1]).toContain('webhook dedupe claim failed');
  });
});

describe('createWebhookDedupeStore', () => {
  it('returns InMemory when no db is provided', () => {
    const store = createWebhookDedupeStore({ db: null });
    expect(store).toBeInstanceOf(InMemoryWebhookDedupeStore);
  });

  it('returns DbWebhookDedupeStore when a db is provided', () => {
    const { db } = makeFakeDb();
    const store = createWebhookDedupeStore({ db: db as never });
    expect(store).toBeInstanceOf(DbWebhookDedupeStore);
  });
});
