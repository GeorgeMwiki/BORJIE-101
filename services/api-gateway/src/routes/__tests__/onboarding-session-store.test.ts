/**
 * RSS-09 — durability + isolation proof for the onboarding-session store.
 *
 * The crown-jewel assertion: writing an onboarding session through a FIRST
 * Drizzle-repo instance, then constructing a SECOND, freshly-built repo over
 * the SAME shared backing table and reading it back, returns the session. The
 * second instance models the gateway AFTER a process restart — a brand-new
 * repo object with zero per-instance memory. The in-memory repo FAILS this
 * (its `Map` lives in the closure and is lost on reconstruction); the Drizzle
 * repo PASSES (the rows live in the shared store). Tenant isolation is also
 * asserted: tenant-A's session is never returned to a tenant-B lookup.
 *
 * A minimal, self-contained drizzle-shaped fake interprets only the query
 * shapes the repo issues: insert().values().onConflictDoUpdate() and
 * select().from().where().limit(). `eq`/`and` are mocked to evaluate against
 * the stored rows.
 */

import { describe, expect, it, vi } from 'vitest';

// ── drizzle condition helpers → predicate factories the fake can evaluate ──
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: { name: string }, value: unknown) => ({
      kind: 'eq' as const,
      col: col.name,
      value,
    }),
    and: (...parts: unknown[]) => ({ kind: 'and' as const, parts }),
  };
});

import {
  createInMemoryOnboardingRepo,
  createDrizzleOnboardingRepo,
} from '../onboarding-session-store';
import { onboardingSessions, type DatabaseClient } from '@borjie/database';
import type {
  OnboardingSession,
  OnboardingSessionId,
} from '@borjie/domain-services/onboarding';
import type {
  TenantId,
  CustomerId,
  LeaseId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Self-contained drizzle-shaped fake (composite (tenant_id, id) keyed).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Cond =
  | { kind: 'eq'; col: string; value: unknown }
  | { kind: 'and'; parts: Cond[] };

/** Shared backing store — survives across repo-instance reconstruction. */
class FakeTable {
  readonly rows = new Map<string, Row>();
}

function columnMaps(tableObj: object): {
  jsToDb: Map<string, string>;
  dbToJs: Map<string, string>;
} {
  const jsToDb = new Map<string, string>();
  const dbToJs = new Map<string, string>();
  for (const [jsKey, col] of Object.entries(
    tableObj as Record<string, unknown>,
  )) {
    const name =
      col && typeof col === 'object' && typeof (col as { name?: unknown }).name === 'string'
        ? (col as { name: string }).name
        : null;
    if (name) {
      jsToDb.set(jsKey, name);
      dbToJs.set(name, jsKey);
    }
  }
  return { jsToDb, dbToJs };
}

function toDbRow(tableObj: object, jsRow: Row): Row {
  const { jsToDb } = columnMaps(tableObj);
  const out: Row = {};
  for (const [k, v] of Object.entries(jsRow)) out[jsToDb.get(k) ?? k] = v;
  return out;
}

function toJsRow(tableObj: object, dbRow: Row): Row {
  const { dbToJs } = columnMaps(tableObj);
  const out: Row = {};
  for (const [k, v] of Object.entries(dbRow)) out[dbToJs.get(k) ?? k] = v;
  return out;
}

function rowMatches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true;
  if (cond.kind === 'eq') return row[cond.col] === cond.value;
  return cond.parts.every((p) => rowMatches(row, p));
}

/** Composite-PK key matching the (tenant_id, id) primary key. */
function pkOf(dbRow: Row): string {
  return `${String(dbRow['tenant_id'])}::${String(dbRow['id'])}`;
}

function createFakeDb(table: FakeTable): DatabaseClient {
  const api = {
    insert(tableObj: object) {
      return {
        values(values: Row) {
          const dbRow = toDbRow(tableObj, values);
          const write = (set?: Row): Promise<Row[]> => {
            const key = pkOf(dbRow);
            const existing = table.rows.get(key);
            if (existing) {
              const merged = { ...existing, ...(set ? toDbRow(tableObj, set) : {}) };
              table.rows.set(key, merged);
              return Promise.resolve([toJsRow(tableObj, merged)]);
            }
            table.rows.set(key, dbRow);
            return Promise.resolve([toJsRow(tableObj, dbRow)]);
          };
          return Object.assign(write(), {
            onConflictDoUpdate: (a: { set: Row }) => write(a.set),
          });
        },
      };
    },
    select() {
      return {
        from(tableObj: object) {
          let cond: Cond | undefined;
          let lim: number | undefined;
          const run = (): Promise<Row[]> => {
            const all = Array.from(table.rows.values()).filter((r) =>
              rowMatches(r, cond),
            );
            const sliced = typeof lim === 'number' ? all.slice(0, lim) : all;
            return Promise.resolve(sliced.map((r) => toJsRow(tableObj, r)));
          };
          const chain = {
            where(c: Cond) {
              cond = c;
              return chain;
            },
            limit(n: number) {
              lim = n;
              return run();
            },
            then(resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) {
              return run().then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },
  };
  return api as unknown as DatabaseClient;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = '2026-06-08T00:00:00.000Z' as ISOTimestamp;

function makeSession(overrides: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: 'onb_1' as OnboardingSessionId,
    tenantId: 'tenant-a' as TenantId,
    customerId: 'cust-1' as CustomerId,
    leaseId: 'lease-1' as LeaseId,
    state: 'PRE_MOVE_IN',
    language: 'en',
    preferredChannel: 'whatsapp',
    moveInDate: NOW,
    checklist: { items: [], completedCount: 0 },
    procedureCompletionLog: [],
    moveInConditionReport: null,
    utilitySetupRecords: [],
    welcomePackGeneratedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'user-1' as UserId,
    updatedBy: 'user-1' as UserId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RSS-09 — in-memory onboarding repo (current default behaviour)', () => {
  it('round-trips a session within one instance', async () => {
    const repo = createInMemoryOnboardingRepo();
    await repo.create(makeSession());
    const byId = await repo.findById(
      'onb_1' as OnboardingSessionId,
      'tenant-a' as TenantId,
    );
    expect(byId?.id).toBe('onb_1');
    const byCustomer = await repo.findByCustomer(
      'cust-1' as CustomerId,
      'tenant-a' as TenantId,
    );
    expect(byCustomer?.id).toBe('onb_1');
    const byLease = await repo.findByLease(
      'lease-1' as LeaseId,
      'tenant-a' as TenantId,
    );
    expect(byLease?.id).toBe('onb_1');
  });

  it('LOSES data when the repo instance is reconstructed (the RSS-09 gap)', async () => {
    const before = createInMemoryOnboardingRepo();
    await before.create(makeSession());
    // Simulate a restart: a brand-new in-memory repo has an empty closure map.
    const after = createInMemoryOnboardingRepo();
    const recalled = await after.findById(
      'onb_1' as OnboardingSessionId,
      'tenant-a' as TenantId,
    );
    expect(recalled).toBeNull();
  });

  it('isolates tenants via the composite key', async () => {
    const repo = createInMemoryOnboardingRepo();
    await repo.create(makeSession({ tenantId: 'tenant-a' as TenantId }));
    const crossTenant = await repo.findById(
      'onb_1' as OnboardingSessionId,
      'tenant-b' as TenantId,
    );
    expect(crossTenant).toBeNull();
  });
});

describe('RSS-09 — Drizzle onboarding repo (durable, RSS-09 fix)', () => {
  it('PERSISTS a session across a simulated restart (crown-jewel)', async () => {
    const table = new FakeTable();

    // ── before restart ──
    const writer = createDrizzleOnboardingRepo(createFakeDb(table));
    await writer.create(makeSession({ state: 'PRE_MOVE_IN' }));

    // ── after restart: brand-new repo over the SAME backing table ──
    const reader = createDrizzleOnboardingRepo(createFakeDb(table));
    const recalled = await reader.findById(
      'onb_1' as OnboardingSessionId,
      'tenant-a' as TenantId,
    );
    expect(recalled).not.toBeNull();
    expect(recalled?.id).toBe('onb_1');
    expect(recalled?.tenantId).toBe('tenant-a');
    expect(recalled?.state).toBe('PRE_MOVE_IN');
    // The full aggregate rehydrates from the jsonb payload.
    expect(recalled?.preferredChannel).toBe('whatsapp');
    expect(recalled?.checklist).toEqual({ items: [], completedCount: 0 });
  });

  it('reflects an update (state transition) back on read', async () => {
    const table = new FakeTable();
    const repo = createDrizzleOnboardingRepo(createFakeDb(table));
    await repo.create(makeSession({ state: 'PRE_MOVE_IN' }));
    await repo.update(makeSession({ state: 'WELCOME' }));

    const reader = createDrizzleOnboardingRepo(createFakeDb(table));
    const recalled = await reader.findById(
      'onb_1' as OnboardingSessionId,
      'tenant-a' as TenantId,
    );
    expect(recalled?.state).toBe('WELCOME');
  });

  it('finds by customer and by lease', async () => {
    const table = new FakeTable();
    const repo = createDrizzleOnboardingRepo(createFakeDb(table));
    await repo.create(makeSession());

    const byCustomer = await repo.findByCustomer(
      'cust-1' as CustomerId,
      'tenant-a' as TenantId,
    );
    expect(byCustomer?.id).toBe('onb_1');
    const byLease = await repo.findByLease(
      'lease-1' as LeaseId,
      'tenant-a' as TenantId,
    );
    expect(byLease?.id).toBe('onb_1');
  });

  it('isolates tenants — tenant-A session never returned to a tenant-B lookup', async () => {
    const table = new FakeTable();
    const repo = createDrizzleOnboardingRepo(createFakeDb(table));
    await repo.create(
      makeSession({ id: 'onb_a' as OnboardingSessionId, tenantId: 'tenant-a' as TenantId }),
    );
    await repo.create(
      makeSession({ id: 'onb_b' as OnboardingSessionId, tenantId: 'tenant-b' as TenantId }),
    );

    const reader = createDrizzleOnboardingRepo(createFakeDb(table));
    const aFromB = await reader.findById(
      'onb_a' as OnboardingSessionId,
      'tenant-b' as TenantId,
    );
    expect(aFromB).toBeNull();
    const aFromA = await reader.findById(
      'onb_a' as OnboardingSessionId,
      'tenant-a' as TenantId,
    );
    expect(aFromA?.id).toBe('onb_a');
  });

  it('rejects a session missing a required lookup key', async () => {
    const table = new FakeTable();
    const repo = createDrizzleOnboardingRepo(createFakeDb(table));
    const bad = makeSession({ customerId: '' as CustomerId });
    await expect(repo.create(bad)).rejects.toThrow(/invalid session keys/);
  });
});
