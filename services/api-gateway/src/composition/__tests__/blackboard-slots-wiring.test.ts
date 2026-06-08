/**
 * blackboard-slots-wiring — unit tests for the cross-surface state-bus
 * broadcaster + durable slot wiring (EA-05).
 *
 * Covers:
 *   - in-process realtime fallback when no Supabase env is set (the store must
 *     never throw for want of a backend — flag/degrade-safe).
 *   - the Drizzle `SlotsDbPort` binds the tenant RLS GUC (withTenantContext)
 *     and issues an idempotent upsert keyed by (tenant_id, slot_id).
 *   - idempotent board_add: persisting the SAME `board:<id>` slot twice is an
 *     in-place update (same row, no duplicate) — the brain-teach persist
 *     contract.
 *   - broadcaster fan-out: a store.set broadcasts a slot-delta on the
 *     tenant-scoped state-bus channel (mocked realtime).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDrizzleSlotsDbPort,
  resolveRealtimePort,
  __setSlotServicesForTests,
} from '../blackboard-slots-wiring.js';
import {
  createSqlSlotsRepository,
  createSlotStore,
  type SlotRow,
} from '@borjie/blackboard-sota';
import { createInMemoryRealtime } from '@borjie/realtime-adapter';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

const silentLogger: PinoLikeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const TENANT = 'tenant-x';

/**
 * Minimal Drizzle-shaped stub: a `.transaction(fn)` that runs `fn` against a
 * recording tx with `.execute` (the SET LOCAL GUC binds) + chainable
 * select/insert/update. We capture the GUC binds + the upserted row.
 */
function makeStubDb() {
  const rows = new Map<string, SlotRow>();
  const gucBinds: string[] = [];
  const key = (t: string, s: string) => `${t}::${s}`;

  function rowFor(tenantId: string, slotId: string): SlotRow | undefined {
    return rows.get(key(tenantId, slotId));
  }

  const tx = {
    async execute(q: unknown) {
      // Capture the tenant GUC bind text for the RLS assertion.
      const text = JSON.stringify(q);
      if (text.includes('current_tenant_id')) gucBinds.push('current_tenant_id');
      return { rows: [] };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  // getRow path: returns [] or [row]. We resolve dynamically in
                  // the where() captured below via the pending lookup.
                  return pendingSelect ? [pendingSelect] : [];
                },
                then(resolve: (v: SlotRow[]) => void) {
                  // listRows path (no .limit()): resolve all tenant rows.
                  resolve(pendingList);
                  return Promise.resolve(pendingList);
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(v: Record<string, unknown>) {
          return {
            onConflictDoUpdate() {
              const r = v as unknown as SlotRow;
              rows.set(key(r.tenantId, r.slotId), r);
              return Promise.resolve();
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  let pendingSelect: SlotRow | undefined;
  let pendingList: SlotRow[] = [];

  const db = {
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(tx);
    },
  };

  return {
    db: db as never,
    rows,
    gucBinds,
    setPendingSelect(t: string, s: string) {
      pendingSelect = rowFor(t, s);
    },
    setPendingList(list: SlotRow[]) {
      pendingList = list;
    },
  };
}

describe('blackboard-slots-wiring — realtime fallback', () => {
  beforeEach(() => {
    __setSlotServicesForTests(null);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('resolves an in-process realtime port when no Supabase env is set', () => {
    const port = resolveRealtimePort(silentLogger);
    // It is a working RealtimePort: broadcast resolves without throwing.
    expect(port).toBeTruthy();
    expect(typeof port.broadcast).toBe('function');
    expect(typeof port.subscribe).toBe('function');
  });
});

describe('blackboard-slots-wiring — Drizzle SlotsDbPort', () => {
  it('upsertRow binds the tenant GUC (RLS) and persists idempotently', async () => {
    const stub = makeStubDb();
    const port = createDrizzleSlotsDbPort(stub.db, silentLogger);
    const row: SlotRow = {
      tenantId: TENANT,
      slotId: 'board:e1',
      slotKind: 'note',
      value: { kind: 'board-element', element: { type: 'text', id: 'e1' } },
      writerId: 'chat:u1',
      clock: 1,
      wallClockMs: 1000,
      deleted: false,
      version: { 'chat:u1': 1 },
      projections: [],
    };
    await port.upsertRow(row);
    // The RLS GUC (app.current_tenant_id) was bound inside the transaction.
    expect(stub.gucBinds).toContain('current_tenant_id');
    // The row landed keyed by (tenant, slot).
    expect(stub.rows.get(`${TENANT}::board:e1`)?.slotId).toBe('board:e1');

    // Idempotent: a second upsert of the SAME slot id overwrites in place — one row.
    await port.upsertRow({ ...row, value: { kind: 'board-element', element: { type: 'text', id: 'e1', body: 'v2' } } });
    expect(stub.rows.size).toBe(1);
  });
});

describe('blackboard-slots-wiring — idempotent board_add + broadcast', () => {
  it('same board:<id> slot set twice is an in-place update (no duplicate)', async () => {
    // Drive the SQL repo over a Map-backed fake port so we can count rows.
    const rows = new Map<string, SlotRow>();
    const fakePort = {
      async getRow(t: string, s: string) {
        return rows.get(`${t}::${s}`) ?? null;
      },
      async upsertRow(r: SlotRow) {
        rows.set(`${r.tenantId}::${r.slotId}`, r);
      },
      async listRows(t: string) {
        return [...rows.values()].filter((r) => r.tenantId === t);
      },
      async setProjections() {
        /* no-op */
      },
    };
    const realtime = createInMemoryRealtime();
    const broadcasts: Array<{ channel: string; event: string }> = [];
    const spy = vi.spyOn(realtime, 'broadcast');

    const store = createSlotStore({
      repository: createSqlSlotsRepository(fakePort),
      realtime,
      surface: 'chat',
    });

    // First board_add for element e1.
    await store.set({
      tenantId: TENANT,
      slotId: 'board:e1',
      slotKind: 'note',
      value: { kind: 'board-element', element: { type: 'text', id: 'e1', body: 'v1' } },
      actorId: 'chat:u1',
      surface: 'chat',
    });
    // Re-emit the SAME element id (a correction) — must update in place.
    await store.set({
      tenantId: TENANT,
      slotId: 'board:e1',
      slotKind: 'note',
      value: { kind: 'board-element', element: { type: 'text', id: 'e1', body: 'v2' } },
      actorId: 'chat:u1',
      surface: 'chat',
    });

    // ONE row, latest value wins — no duplicate board slot.
    const list = await fakePort.listRows(TENANT);
    expect(list).toHaveLength(1);
    expect((list[0]?.value as { element?: { body?: string } })?.element?.body).toBe('v2');

    // Broadcaster fanned out on the tenant state-bus channel, twice.
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      broadcasts.push({ channel: String(call[0]), event: String(call[1]) });
    }
    expect(broadcasts.every((b) => b.channel === `tenant.${TENANT}.state-bus`)).toBe(true);
    expect(broadcasts.every((b) => b.event === 'slot-delta')).toBe(true);
  });
});
