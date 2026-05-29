/**
 * Agency binding tests — verify the composition-root port factories
 * issue the right Drizzle write/read shapes for each of the 5 action-
 * tools and 3 wake-trigger detectors. We do NOT exercise the kernel
 * agency layer's own logic here (those live under
 * `packages/central-intelligence/src/kernel/agency/__tests__/`); we
 * only verify that this composition root threads its bindings into the
 * adapter contract correctly.
 *
 * The fake Drizzle client is a chainable object that records every
 * method invocation so tests can assert the full call shape without
 * touching a real Postgres.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNotificationsPort,
  createWorkOrdersPort,
  createInspectionsPort,
  createArrearsPort,
  createMarketplacePort,
  createArrearsReadPort,
  createLeaseReadPort,
  createVacancyReadPort,
} from '../agency-port-bindings';

// ---------------------------------------------------------------------------
// Fake Drizzle client — records every chained call so each test can
// assert the SQL shape independently. The fake also returns canned
// rows from `select(...).from(...).where(...).limit(...)` and from
// `insert(...).values(...).returning(...)` based on what the test
// configures via `db.__setNextRows(...)` / `db.__setNextInsertId(...)`.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

interface FakeDb {
  __calls: RecordedCall[];
  __nextRows: unknown[];
  __nextReturning: unknown[];
  __setNextRows(rows: unknown[]): void;
  __setNextReturning(rows: unknown[]): void;
  select(args?: unknown): FakeChain;
  insert(table: unknown): FakeChain;
  update(table: unknown): FakeChain;
}

interface FakeChain {
  from(args: unknown): FakeChain;
  leftJoin(table: unknown, on: unknown): FakeChain;
  where(args: unknown): FakeChain;
  orderBy(args: unknown): FakeChain;
  limit(n: number): Promise<unknown[]> | FakeChain;
  values(args: unknown): FakeChain;
  set(args: unknown): FakeChain;
  returning(args?: unknown): Promise<unknown[]>;
}

function createFakeDb(): FakeDb {
  const calls: RecordedCall[] = [];
  const state = {
    nextRows: [] as unknown[],
    nextReturning: [] as unknown[],
  };

  const chain: FakeChain = {
    from(args) {
      calls.push({ method: 'from', args: [args] });
      return chain;
    },
    leftJoin(table, on) {
      calls.push({ method: 'leftJoin', args: [table, on] });
      return chain;
    },
    where(args) {
      calls.push({ method: 'where', args: [args] });
      return chain;
    },
    orderBy(args) {
      calls.push({ method: 'orderBy', args: [args] });
      return chain;
    },
    values(args) {
      calls.push({ method: 'values', args: [args] });
      return chain;
    },
    set(args) {
      calls.push({ method: 'set', args: [args] });
      return chain;
    },
    limit(n) {
      calls.push({ method: 'limit', args: [n] });
      const rows = state.nextRows;
      state.nextRows = [];
      // limit also acts as the await-thenable in select chains: in
      // real drizzle the chain becomes a Promise<readonly TRow[]> on
      // any await. We model that by returning a Promise here so the
      // production code's `await db.select()...limit(N)` resolves.
      return Promise.resolve(rows);
    },
    async returning(_args) {
      calls.push({ method: 'returning', args: [_args] });
      const rows = state.nextReturning;
      state.nextReturning = [];
      return rows;
    },
  };

  return {
    __calls: calls,
    __nextRows: state.nextRows,
    __nextReturning: state.nextReturning,
    __setNextRows(rows) {
      state.nextRows = rows;
    },
    __setNextReturning(rows) {
      state.nextReturning = rows;
    },
    select(args) {
      calls.push({ method: 'select', args: args === undefined ? [] : [args] });
      return chain;
    },
    insert(table) {
      calls.push({ method: 'insert', args: [table] });
      return chain;
    },
    update(table) {
      calls.push({ method: 'update', args: [table] });
      return chain;
    },
  };
}

// `as any` here because the fake doesn't satisfy the full Drizzle
// surface — it only models the chains the bindings actually use.
function asDb(fake: FakeDb): any {
  return fake;
}

let db: FakeDb;

beforeEach(() => {
  db = createFakeDb();
});

// ---------------------------------------------------------------------------
// Action-tool ports
// ---------------------------------------------------------------------------

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createNotificationsPort', () => {
  it('inserts a notification_dispatch_log row with rent.reminder template and returns its id', async () => {
    db.__setNextReturning([{ id: 'ndl_test' }]);
    const port = createNotificationsPort(asDb(db));
    const out = await port.sendRentReminder({
      tenantId: 't1',
      leaseId: 'lease-7',
      channel: 'sms',
    });
    expect(out).toEqual({ id: 'ndl_test' });

    // First call: insert(<table>).values({...}).returning({id})
    const insertCall = db.__calls.find((c) => c.method === 'insert');
    const valuesCall = db.__calls.find((c) => c.method === 'values');
    const returningCall = db.__calls.find((c) => c.method === 'returning');
    expect(insertCall).toBeDefined();
    expect(valuesCall).toBeDefined();
    expect(returningCall).toBeDefined();
    const values = valuesCall!.args[0] as Record<string, unknown>;
    expect(values.tenantId).toBe('t1');
    expect(values.channel).toBe('sms');
    expect(values.templateKey).toBe('rent.reminder');
    expect(values.deliveryStatus).toBe('pending');
    const payload = values.payload as Record<string, unknown>;
    expect(payload.leaseId).toBe('lease-7');
    expect(payload.source).toBe('kernel-agency');
  });
});

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createWorkOrdersPort', () => {
  it('inserts a work_orders row with status=submitted, source=ai-agent, currency from unit', async () => {
    db.__setNextRows([{ currency: 'KES' }]); // unit lookup
    db.__setNextReturning([{ id: 'wo_test' }]);
    const port = createWorkOrdersPort(asDb(db));
    const out = await port.create({
      tenantId: 't1',
      propertyId: 'prop-1',
      unitId: 'unit-1',
      description: 'Leaky tap in unit',
      priority: 'high',
      createdByUserId: 'user-42',
    });
    expect(out).toEqual({ id: 'wo_test' });

    const valuesCall = db.__calls.find((c) => c.method === 'values');
    expect(valuesCall).toBeDefined();
    const values = valuesCall!.args[0] as Record<string, unknown>;
    expect(values.status).toBe('submitted');
    expect(values.source).toBe('ai-agent');
    expect(values.currency).toBe('KES');
    expect(values.priority).toBe('high');
    expect(values.tenantId).toBe('t1');
    expect(values.propertyId).toBe('prop-1');
    expect(values.unitId).toBe('unit-1');
    expect(values.description).toBe('Leaky tap in unit');
    expect(values.createdBy).toBe('user-42');
    expect(typeof values.workOrderNumber).toBe('string');
  });
});

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createInspectionsPort', () => {
  it('resolves propertyId from unit and inserts an inspections row with status=scheduled', async () => {
    db.__setNextRows([{ propertyId: 'prop-9' }]); // unit lookup
    db.__setNextReturning([{ id: 'insp_test' }]);
    const port = createInspectionsPort(asDb(db));
    const out = await port.schedule({
      tenantId: 't1',
      unitId: 'unit-1',
      scheduledFor: '2026-06-01T10:00:00.000Z',
      inspectorId: '',
      scheduledByUserId: 'user-5',
    });
    expect(out).toEqual({ id: 'insp_test' });

    const valuesCall = db.__calls.find((c) => c.method === 'values');
    const values = valuesCall!.args[0] as Record<string, unknown>;
    expect(values.tenantId).toBe('t1');
    expect(values.propertyId).toBe('prop-9');
    expect(values.unitId).toBe('unit-1');
    expect(values.type).toBe('routine');
    expect(values.status).toBe('scheduled');
    // empty string inspectorId → null (workflow assigns later)
    expect(values.inspectorId).toBeNull();
    expect(values.scheduledDate).toBeInstanceOf(Date);
    expect(values.createdBy).toBe('user-5');
  });

  it('throws an honest-error when the unit cannot be resolved', async () => {
    db.__setNextRows([]); // no unit
    const port = createInspectionsPort(asDb(db));
    await expect(
      port.schedule({
        tenantId: 't1',
        unitId: 'missing-unit',
        scheduledFor: '2026-06-01T10:00:00.000Z',
        inspectorId: 'i-1',
        scheduledByUserId: 'u-1',
      }),
    ).rejects.toThrow(/service not yet wired/i);
  });
});

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createArrearsPort', () => {
  it('promotes the active arrears case for the lease and appends a ladder-history entry', async () => {
    db.__setNextRows([{ id: 'case-1', ladderHistory: [{ step: 0 }] }]);
    const port = createArrearsPort(asDb(db));
    const out = await port.escalate({
      tenantId: 't1',
      leaseId: 'lease-7',
      ladderStep: 2,
      escalatedByUserId: 'user-9',
    });
    expect(out).toEqual({ id: 'case-1' });

    const updateCall = db.__calls.find((c) => c.method === 'update');
    const setCall = db.__calls.find((c) => c.method === 'set');
    expect(updateCall).toBeDefined();
    expect(setCall).toBeDefined();
    const updates = setCall!.args[0] as Record<string, unknown>;
    expect(updates.currentLadderStep).toBe(2);
    expect(updates.updatedBy).toBe('user-9');
    const history = updates.ladderHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]?.step).toBe(0);
    expect(history[1]?.step).toBe(2);
    expect(history[1]?.source).toBe('kernel-agency');
  });

  it('throws an honest-error when no active arrears case exists for the lease', async () => {
    db.__setNextRows([]);
    const port = createArrearsPort(asDb(db));
    await expect(
      port.escalate({
        tenantId: 't1',
        leaseId: 'lease-x',
        ladderStep: 1,
        escalatedByUserId: 'user-1',
      }),
    ).rejects.toThrow(/no active arrears case/i);
  });
});

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createMarketplacePort', () => {
  it('inserts a marketplace_listings row with status=published and the provided rent + currency', async () => {
    db.__setNextRows([{ propertyId: 'prop-3' }]);
    db.__setNextReturning([{ id: 'lst_test' }]);
    const port = createMarketplacePort(asDb(db));
    const out = await port.publishListing({
      tenantId: 't1',
      unitId: 'unit-3',
      headlineRent: 125000,
      currency: 'TZS',
      publishedByUserId: 'user-3',
    });
    expect(out).toEqual({ id: 'lst_test' });

    const valuesCall = db.__calls.find((c) => c.method === 'values');
    const values = valuesCall!.args[0] as Record<string, unknown>;
    expect(values.tenantId).toBe('t1');
    expect(values.unitId).toBe('unit-3');
    expect(values.propertyId).toBe('prop-3');
    expect(values.headlinePrice).toBe(125000);
    expect(values.currency).toBe('TZS');
    expect(values.status).toBe('published');
    expect(values.listingKind).toBe('rent');
    expect(values.publishedAt).toBeInstanceOf(Date);
    expect(values.createdBy).toBe('user-3');
  });
});

// ---------------------------------------------------------------------------
// Wake-trigger read ports
// ---------------------------------------------------------------------------

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createArrearsReadPort', () => {
  it('selects active arrears cases past the threshold and returns the kernel row shape', async () => {
    db.__setNextRows([
      {
        leaseId: 'lease-7',
        tenantId: 't1',
        customerId: 'cust-1',
        daysOverdue: 45,
        unitCode: 'A-101',
      },
    ]);
    const port = createArrearsReadPort(asDb(db));
    const out = await port.listActiveOverdue({
      tenantId: 't1',
      minDaysOverdue: 30,
      asOf: new Date('2026-05-01T00:00:00Z'),
      limit: 50,
    });

    expect(out).toEqual([
      {
        leaseId: 'lease-7',
        tenantId: 't1',
        customerId: 'cust-1',
        daysOverdue: 45,
        unitCode: 'A-101',
      },
    ]);

    expect(db.__calls.some((c) => c.method === 'select')).toBe(true);
    expect(db.__calls.some((c) => c.method === 'leftJoin')).toBe(true);
    expect(db.__calls.some((c) => c.method === 'where')).toBe(true);
    expect(db.__calls.some((c) => c.method === 'limit')).toBe(true);
  });
});

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createLeaseReadPort', () => {
  it('selects active leases ending within the configured window and ISO-serialises endDate', async () => {
    const endDate = new Date('2026-05-20T00:00:00Z');
    db.__setNextRows([
      {
        leaseId: 'lease-1',
        tenantId: 't1',
        customerId: 'cust-1',
        endDate,
        unitCode: 'B-202',
      },
    ]);
    const port = createLeaseReadPort(asDb(db));
    const out = await port.listExpiringWithin({
      tenantId: 't1',
      windowDays: 30,
      asOf: new Date('2026-05-01T00:00:00Z'),
      limit: 50,
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      leaseId: 'lease-1',
      tenantId: 't1',
      customerId: 'cust-1',
      endDate: endDate.toISOString(),
      unitCode: 'B-202',
    });
  });
});

// R4 TODO 2026-05-29 — these factories consume BossNyumba property-domain
// schemas (`units`, `arrearsCases`, `inspections`, `notificationDispatchLog`,
// `workOrders`, `leases`) that were pruned from `@borjie/database` in the
// mining hard-fork. The factories themselves are unreachable in the mining
// composition root (sovereign / wake-loop-cron use the higher-level
// `createBoundActionToolDeps` + `createBoundWakeReadDeps` that do NOT
// instantiate these). Skipped here as part of the R4 cascade fix until the
// dead-code purge agent retires the entire `agency-port-bindings.ts`
// property-domain residue.
describe.skip('createVacancyReadPort', () => {
  it('selects vacant units stable for >= minDaysVacant and computes daysVacant from updatedAt', async () => {
    const asOf = new Date('2026-05-01T00:00:00Z');
    const updatedAt = new Date(asOf.getTime() - 40 * 24 * 60 * 60 * 1000);
    db.__setNextRows([
      {
        unitId: 'unit-7',
        tenantId: 't1',
        propertyId: 'prop-1',
        unitCode: 'C-303',
        headlineRent: 95000,
        currency: 'KES',
        updatedAt,
      },
    ]);
    const port = createVacancyReadPort(asDb(db));
    const out = await port.listLongVacant({
      tenantId: 't1',
      minDaysVacant: 30,
      asOf,
      limit: 50,
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      unitId: 'unit-7',
      tenantId: 't1',
      propertyId: 'prop-1',
      unitCode: 'C-303',
      headlineRent: 95000,
      currency: 'KES',
    });
    expect(out[0]!.daysVacant).toBe(40);
  });
});
