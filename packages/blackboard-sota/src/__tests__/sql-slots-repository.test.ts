/**
 * SQL `SlotsRepository` — durable CRDT slot persistence (EA-05).
 *
 * Drives the package's `createSqlSlotsRepository(port)` through a fake
 * `SlotsDbPort` backed by a plain Map (a stand-in for the `blackboard_slots`
 * Postgres rows the gateway wires). Proves:
 *   - round-trip (set → persist → read)
 *   - the CRDT lattice-join is the persistence merge (survives a "restart":
 *     a fresh repo over the SAME backing rows reads the converged value)
 *   - tenant A cannot read tenant B's slot (the row key is tenant-scoped)
 *   - merge is idempotent (re-merging the same delta is a no-op)
 *   - projection provenance persists across a rebuild
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSqlSlotsRepository,
  createSlotStore,
  writeSlot,
  mergeSlot,
  type SlotsDbPort,
  type SlotRow,
  type Slot,
  type SlotWriteInput,
} from '../index.js';
import { createInMemoryRealtime } from '@borjie/realtime-adapter';

/**
 * A fake DB port over a shared Map — the durable rows "in Postgres". The same
 * `rows` map is reused across repo instances to simulate a process restart.
 */
function makeFakeDb(rows: Map<string, SlotRow>): SlotsDbPort {
  const key = (t: string, s: string) => `${t}::${s}`;
  return {
    async getRow(tenantId, slotId) {
      return rows.get(key(tenantId, slotId)) ?? null;
    },
    async upsertRow(row) {
      rows.set(key(row.tenantId, row.slotId), row);
    },
    async listRows(tenantId, filter) {
      const out: SlotRow[] = [];
      for (const r of rows.values()) {
        if (r.tenantId !== tenantId) continue;
        if (filter?.slotKind && r.slotKind !== filter.slotKind) continue;
        out.push(r);
      }
      return out;
    },
    async setProjections(tenantId, slotId, projections) {
      const existing = rows.get(key(tenantId, slotId));
      if (existing) {
        rows.set(key(tenantId, slotId), { ...existing, projections });
      }
    },
  };
}

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const SLOT = 'incident:KAH-088:decision';

function write(
  overrides: Partial<SlotWriteInput> & { tenantId: string },
  prev: Slot | null,
  clockMs: number,
): Slot {
  return writeSlot(
    {
      tenantId: overrides.tenantId,
      slotId: overrides.slotId ?? SLOT,
      slotKind: overrides.slotKind ?? 'decision',
      value: overrides.value ?? { status: 'approved' },
      actorId: overrides.actorId ?? 'brain:md',
      surface: overrides.surface ?? 'chat',
    },
    prev,
    clockMs,
  );
}

describe('sql-slots-repository — durable round-trip', () => {
  let rows: Map<string, SlotRow>;

  beforeEach(() => {
    rows = new Map();
  });

  it('set → persist → read round-trips the converged value', async () => {
    const repo = createSqlSlotsRepository(makeFakeDb(rows));
    const slot = write({ tenantId: TENANT_A, value: { status: 'approved' } }, null, 1000);
    await repo.merge(slot);
    const read = await repo.get(TENANT_A, SLOT);
    expect(read?.value).toEqual({ status: 'approved' });
    expect(read?.writerId).toBe('brain:md');
    expect(read?.clock).toBe(1);
  });

  it('CRDT merge survives a restart — fresh repo over the same rows converges', async () => {
    // First "process": write twice from two actors (concurrent-ish).
    const repo1 = createSqlSlotsRepository(makeFakeDb(rows));
    const first = write(
      { tenantId: TENANT_A, actorId: 'chat:md', value: { status: 'draft' } },
      null,
      1000,
    );
    const converged1 = await repo1.merge(first);
    const second = write(
      { tenantId: TENANT_A, actorId: 'owner-web:u1', value: { status: 'approved' } },
      converged1,
      2000,
    );
    await repo1.merge(second);

    // "Restart": a brand-new repo over the SAME backing rows.
    const repo2 = createSqlSlotsRepository(makeFakeDb(rows));
    const afterRestart = await repo2.get(TENANT_A, SLOT);
    // Higher clock wins (the owner-web write at clock 2 dominates).
    expect(afterRestart?.value).toEqual({ status: 'approved' });
    expect(afterRestart?.writerId).toBe('owner-web:u1');
    // The version vector retained BOTH actors' causal history.
    expect(Object.keys(afterRestart?.version ?? {}).sort()).toEqual([
      'chat:md',
      'owner-web:u1',
    ]);
  });

  it('tenant A cannot read tenant B slot (row key is tenant-scoped)', async () => {
    const repo = createSqlSlotsRepository(makeFakeDb(rows));
    await repo.merge(write({ tenantId: TENANT_A, value: { who: 'A' } }, null, 1000));
    await repo.merge(write({ tenantId: TENANT_B, value: { who: 'B' } }, null, 1000));
    expect((await repo.get(TENANT_A, SLOT))?.value).toEqual({ who: 'A' });
    expect((await repo.get(TENANT_B, SLOT))?.value).toEqual({ who: 'B' });
    // Tenant A's list never contains tenant B's row.
    const listA = await repo.list(TENANT_A);
    expect(listA).toHaveLength(1);
    expect(listA[0]?.tenantId).toBe(TENANT_A);
  });

  it('merge is idempotent — re-merging the same delta is a no-op', async () => {
    const repo = createSqlSlotsRepository(makeFakeDb(rows));
    const slot = write({ tenantId: TENANT_A }, null, 1000);
    const once = await repo.merge(slot);
    const twice = await repo.merge(slot);
    // mergeSlot(a, a) === a — the converged value/clock/version are stable.
    expect(twice.value).toEqual(once.value);
    expect(twice.clock).toBe(once.clock);
    expect(twice.version).toEqual(once.version);
    // And it matches a direct CRDT self-merge.
    expect(mergeSlot(once, once).clock).toBe(once.clock);
  });

  it('projection provenance persists across a rebuild', async () => {
    const repo1 = createSqlSlotsRepository(makeFakeDb(rows));
    await repo1.merge(write({ tenantId: TENANT_A }, null, 1000));
    await repo1.recordProjection(TENANT_A, SLOT, 'chat');
    await repo1.recordProjection(TENANT_A, SLOT, 'owner-web');
    // Idempotent tail: recording the same surface again does not duplicate.
    await repo1.recordProjection(TENANT_A, SLOT, 'owner-web');

    const repo2 = createSqlSlotsRepository(makeFakeDb(rows));
    const chain = await repo2.projectionsOf(TENANT_A, SLOT);
    expect(chain).toEqual(['chat', 'owner-web']);
  });
});

describe('sql-slots-repository — behind the SlotStore (persist + broadcast)', () => {
  it('a store.set persists durably AND broadcasts on the state-bus', async () => {
    const rows = new Map<string, SlotRow>();
    const realtime = createInMemoryRealtime();
    const seen: Slot[] = [];
    const store = createSlotStore({
      repository: createSqlSlotsRepository(makeFakeDb(rows)),
      realtime,
      surface: 'chat',
    });
    // A subscriber on another surface converges via the merge.
    const otherRows = new Map<string, SlotRow>();
    const other = createSlotStore({
      repository: createSqlSlotsRepository(makeFakeDb(otherRows)),
      realtime,
      surface: 'owner-web',
      onConverged: (s) => seen.push(s),
    });
    const stop = await other.connect(TENANT_A);

    await store.set({
      tenantId: TENANT_A,
      slotId: SLOT,
      slotKind: 'decision',
      value: { status: 'approved' },
      actorId: 'chat:md',
      surface: 'chat',
    });

    // Durable on the writer's rows.
    expect(rows.size).toBe(1);
    // Fanned out + merged into the subscriber's durable rows (lives once).
    expect(seen.at(-1)?.value).toEqual({ status: 'approved' });
    expect(otherRows.size).toBe(1);
    await stop();
  });
});
