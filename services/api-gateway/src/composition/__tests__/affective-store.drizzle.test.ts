/**
 * Drizzle `AffectiveStore` adapter tests (migration 0372).
 *
 * Proves the durable store is REAL, not born-dark:
 *
 *   - observe → persist → hydrate round-trips a five-dimension profile through
 *     the DB adapter (a fresh, cache-empty accumulator hydrates what the first
 *     accumulator's observe() wrote);
 *   - tenant-scoped — a hydrate for tenant B never observes tenant A's rows
 *     (the tenant GUC bound by withTenantContext isolates the read);
 *   - fail-safe — a DB fault degrades the accumulator to in-memory and NEVER
 *     throws into the turn.
 *
 * The fake DB models `affective_profiles` as an in-memory long-format table with
 * a tenant GUC. `select().from().where()` returns ONLY rows whose tenant_id
 * matches the GUC bound inside the transaction, so cross-tenant isolation is
 * exercised the same way the RLS policy enforces it in prod.
 */

import { describe, it, expect } from 'vitest';

import { createDrizzleAffectiveStore } from '../affective-store.drizzle';
import {
  createAffectiveAccumulator,
  type AffectiveObservation,
} from '@borjie/central-intelligence';

// ── Fake tenant-isolated affective_profiles table ─────────────────────────
interface FakeRow {
  tenantId: string;
  userId: string;
  dimension: string;
  value: string;
  turns: number;
  expiresAt: Date;
  updatedAt: Date;
}

interface FakeDbOpts {
  /** When set, every transaction rejects — models a DB fault. */
  readonly fail?: boolean;
}

function createFakeDb(opts: FakeDbOpts = {}) {
  const rows: FakeRow[] = [];

  // A transaction carries the currently-bound tenant GUC. The adapter's
  // withTenantContext binds it via `SELECT set_config('app.current_tenant_id', …)`.
  function makeTx() {
    let boundTenant = '';
    const tx = {
      async execute(query: unknown) {
        // Capture the tenant id from the `SELECT set_config('app.current_
        // tenant_id', $tenant, true)` binding. drizzle's sql`` template stores
        // alternating text chunks ({ value: string[] }) and Param objects
        // ({ value: <the bound value> }) on `.queryChunks`. When a text chunk
        // names the tenant GUC, the FOLLOWING Param carries the tenant id.
        const chunks =
          ((query as { queryChunks?: unknown[] }).queryChunks ?? []) as unknown[];
        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i] as { value?: unknown };
          const txt = chunk?.value;
          const namesTenantGuc =
            Array.isArray(txt) &&
            txt.some(
              (s) =>
                typeof s === 'string' && s.includes('app.current_tenant_id'),
            );
          if (namesTenantGuc) {
            // The bound param is the NEXT chunk — a raw string primitive.
            const param = chunks[i + 1];
            if (typeof param === 'string') boundTenant = param;
          }
        }
        return [];
      },
      insert() {
        return {
          values(vals: FakeRow[]) {
            return {
              onConflictDoUpdate() {
                for (const v of vals) {
                  const idx = rows.findIndex(
                    (r) =>
                      r.tenantId === v.tenantId &&
                      r.userId === v.userId &&
                      r.dimension === v.dimension,
                  );
                  if (idx >= 0) rows[idx] = { ...v };
                  else rows.push({ ...v });
                }
                return Promise.resolve();
              },
            };
          },
        };
      },
      select() {
        return {
          from() {
            return {
              where() {
                // Tenant isolation: only rows for the GUC-bound tenant leak out.
                return Promise.resolve(
                  rows.filter((r) => r.tenantId === boundTenant),
                );
              },
            };
          },
        };
      },
    };
    return tx;
  }

  return {
    async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      if (opts.fail) throw new Error('boom: db down');
      return cb(makeTx());
    },
    // Test hook — inspect persisted rows.
    __rows: rows,
  };
}

const OBS: AffectiveObservation = {
  mindState: {
    urgency: 'high',
    expertise: 'novice',
    mode: 'decide',
    emotionalCharge: -0.6,
  },
  capturedAt: new Date('2026-07-02T10:00:00Z').toISOString(),
};

describe('createDrizzleAffectiveStore — durable affective profile', () => {
  it('observe → persist → hydrate round-trips through the DB adapter', async () => {
    const db = createFakeDb();
    const store = createDrizzleAffectiveStore(db);

    // Accumulator A observes a turn — write-through persists 5 rows.
    const writer = createAffectiveAccumulator({ store });
    const written = writer.observe('tnt_estate_1', 'user_x', OBS);
    // Let the fire-and-forget write-through settle.
    await new Promise((r) => setTimeout(r, 0));

    // 5 dimension rows landed for this (tenant,user).
    const persisted = db.__rows.filter(
      (r) => r.tenantId === 'tnt_estate_1' && r.userId === 'user_x',
    );
    expect(persisted.length).toBe(5);

    // A FRESH accumulator (cache empty — models a restart / other replica)
    // hydrates the same profile from the DB.
    const reader = createAffectiveAccumulator({ store });
    expect(reader.read('tnt_estate_1', 'user_x')).toBeNull(); // cold cache
    const hydrated = await reader.hydrate('tnt_estate_1', 'user_x');
    expect(hydrated).not.toBeNull();
    expect(hydrated?.turns).toBe(written.turns);
    // Frustration rose (negative emotional charge) — persisted value survives.
    expect(hydrated?.state.frustration).toBeCloseTo(
      written.state.frustration,
      3,
    );
    expect(hydrated?.state.urgency).toBeCloseTo(written.state.urgency, 3);
  });

  it('is tenant-scoped: tenant B never hydrates tenant A rows', async () => {
    const db = createFakeDb();
    const store = createDrizzleAffectiveStore(db);

    const writer = createAffectiveAccumulator({ store });
    writer.observe('tnt_estate_1', 'user_shared', OBS);
    await new Promise((r) => setTimeout(r, 0));

    // Same userId, DIFFERENT tenant — must see nothing.
    const reader = createAffectiveAccumulator({ store });
    const leak = await reader.hydrate('tnt_estate_2', 'user_shared');
    expect(leak).toBeNull();

    // The rightful tenant still hydrates.
    const legit = await reader.hydrate('tnt_estate_1', 'user_shared');
    expect(legit).not.toBeNull();
  });

  it('fail-safe: a DB fault degrades to in-memory and never throws', async () => {
    const db = createFakeDb({ fail: true });
    const store = createDrizzleAffectiveStore(db);
    const acc = createAffectiveAccumulator({ store });

    // observe() must not throw even though the write-through rejects.
    const profile = acc.observe('tnt_estate_1', 'user_y', OBS);
    await new Promise((r) => setTimeout(r, 0));
    // In-memory cache still holds the profile.
    expect(acc.read('tnt_estate_1', 'user_y')?.turns).toBe(profile.turns);

    // hydrate() on a cold cache with a failing store resolves null, never throws.
    const cold = createAffectiveAccumulator({ store });
    await expect(
      cold.hydrate('tnt_estate_1', 'user_y'),
    ).resolves.toBeNull();
  });
});
