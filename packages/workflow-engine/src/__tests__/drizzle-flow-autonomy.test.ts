/**
 * Drizzle FlowAutonomyRepository test — proves the Drizzle-backed adapter
 * satisfies the same Port contract as the in-memory one and round-trips
 * durably through a fake transaction-capable store. Mirrors the fake-store
 * idiom in `drizzle-repos.test.ts`, extended with `onConflictDoNothing`
 * (used by the idempotent creation-time record) and composite-key matching.
 *
 * The fake store keys rows by the pgTable handle so `withTenantContext`
 * (which needs `transaction` + `execute`) and the repo's
 * select/insert/update chains all resolve against one in-process map.
 */

import { describe, expect, it } from 'vitest';
import { flowAutonomyPrefs } from '@borjie/database';
import { createDrizzleFlowAutonomyRepository } from '../index.js';

const T = 'tenant-1';

interface FakeStore {
  rows: Map<unknown, Array<Record<string, unknown>>>;
}

function colName(col: unknown): string {
  const c = col as { name?: string };
  return c.name ?? '';
}

/** Extract {name,value} leaves from a drizzle condition tree. */
function extractLeaves(
  condition: unknown,
): Array<{ name: string; value: unknown }> {
  const out: Array<{ name: string; value: unknown }> = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const anyNode = node as Record<string, unknown>;
    const chunks =
      (anyNode.queryChunks as unknown[]) ??
      (anyNode.chunks as unknown[]) ??
      null;
    if (Array.isArray(chunks)) {
      let pendingName: string | null = null;
      for (const chunk of chunks) {
        if (chunk && typeof chunk === 'object') {
          const ch = chunk as Record<string, unknown>;
          if (typeof ch.name === 'string') {
            pendingName = ch.name;
          } else if (
            'value' in ch &&
            pendingName &&
            // A drizzle Param value is a scalar; a StringChunk's `value`
            // is an array (e.g. [" = "]) — skip those so the operator
            // chunk between a Column and its Param is not mistaken for it.
            !Array.isArray(ch.value)
          ) {
            out.push({ name: pendingName, value: ch.value });
            pendingName = null;
          } else {
            visit(chunk);
          }
        }
      }
    }
  };
  visit(condition);
  return out;
}

function matchesRow(
  row: Record<string, unknown>,
  leaves: Array<{ name: string; value: unknown }>,
): boolean {
  return leaves.every((leaf) => {
    const snake = leaf.name;
    const camel = snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    const actual = row[camel] ?? row[snake];
    return actual === leaf.value;
  });
}

/** Composite primary key columns for conflict detection. */
const PK_KEYS = ['tenantId', 'flowId'] as const;

function makeQueryBuilder(store: FakeStore) {
  function bucket(table: unknown): Array<Record<string, unknown>> {
    let b = store.rows.get(table);
    if (!b) {
      b = [];
      store.rows.set(table, b);
    }
    return b;
  }

  const tx = {
    async execute() {
      return undefined;
    },
    insert(table: unknown) {
      return {
        // The repo calls EITHER `.values(row)` (plain insert, awaited) OR
        // `.values(row).onConflictDoNothing(target)` (idempotent). We model
        // `.values()` as a thenable that defaults to a plain push, and expose
        // `.onConflictDoNothing()` on the same object which replaces that push
        // with a conflict-guarded one. The repo never awaits `.values()` AND
        // then calls `.onConflictDoNothing()` — it does exactly one of them.
        values(row: Record<string, unknown>) {
          const pendingRow = { ...row };
          let inserted = false;
          const doPlainInsert = () => {
            if (inserted) return;
            inserted = true;
            bucket(table).push(pendingRow);
          };
          const valueChain = {
            async onConflictDoNothing() {
              inserted = true; // suppress the plain insert path
              const b = bucket(table);
              const conflict = b.some((r) =>
                PK_KEYS.every((k) => r[k] === pendingRow[k]),
              );
              if (!conflict) b.push(pendingRow);
              return undefined;
            },
            then(
              resolve: (v: undefined) => unknown,
              reject?: (e: unknown) => unknown,
            ) {
              try {
                doPlainInsert();
                return Promise.resolve(resolve(undefined));
              } catch (e) {
                return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
              }
            },
          };
          return valueChain;
        },
      };
    },
    update(table: unknown) {
      let setValues: Record<string, unknown> = {};
      let leaves: Array<{ name: string; value: unknown }> = [];
      const chain = {
        set(values: Record<string, unknown>) {
          setValues = values;
          return chain;
        },
        where(condition: unknown) {
          leaves = extractLeaves(condition);
          const matched = bucket(table).filter((r) => matchesRow(r, leaves));
          for (const r of matched) Object.assign(r, setValues);
          return Promise.resolve(undefined);
        },
      };
      return chain;
    },
    select(_projection?: unknown) {
      let table: unknown = null;
      let leaves: Array<{ name: string; value: unknown }> = [];
      let limitN: number | null = null;
      const chain = {
        from(t: unknown) {
          table = t;
          return chain;
        },
        where(condition: unknown) {
          leaves = extractLeaves(condition);
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit(n: number) {
          limitN = n;
          return chain;
        },
        then(
          resolve: (rows: ReadonlyArray<Record<string, unknown>>) => unknown,
          reject?: (e: unknown) => unknown,
        ) {
          try {
            let rows = bucket(table).filter((r) => matchesRow(r, leaves));
            if (limitN !== null) rows = rows.slice(0, limitN);
            return Promise.resolve(resolve(rows.map((r) => ({ ...r }))));
          } catch (e) {
            return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
          }
        },
      };
      return chain;
    },
  };
  return tx;
}

function fakeDb(store: FakeStore) {
  return {
    async transaction(
      fn: (t: ReturnType<typeof makeQueryBuilder>) => Promise<unknown>,
    ) {
      return fn(makeQueryBuilder(store));
    },
  };
}

function build() {
  const store: FakeStore = { rows: new Map() };
  const repo = createDrizzleFlowAutonomyRepository(fakeDb(store));
  return { store, repo };
}

describe('createDrizzleFlowAutonomyRepository', () => {
  it('records a pending GATED row, idempotently', async () => {
    const { repo } = build();
    const first = await repo.recordFlowCreation({
      tenantId: T,
      flowId: 'f1',
      createdBy: 'u1',
    });
    expect(first.posture).toBe('gated');
    expect(first.confirmationState).toBe('pending');

    // confirm it, then re-create → must NOT reset.
    await repo.setPosture({
      tenantId: T,
      flowId: 'f1',
      posture: 'auto',
      actorUserId: 'owner',
    });
    const again = await repo.recordFlowCreation({
      tenantId: T,
      flowId: 'f1',
      createdBy: 'u2',
    });
    expect(again.posture).toBe('auto');
    expect(again.confirmationState).toBe('confirmed');
  });

  it('setPosture round-trips through the store', async () => {
    const { repo } = build();
    await repo.recordFlowCreation({ tenantId: T, flowId: 'f1', createdBy: 'u1' });
    const auto = await repo.setPosture({
      tenantId: T,
      flowId: 'f1',
      posture: 'auto',
      actorUserId: 'owner',
      amountThreshold: 1000,
    });
    expect(auto.posture).toBe('auto');
    expect(auto.amountThreshold).toBe(1000);
    expect(auto.promotedAt).not.toBeNull();

    const fetched = await repo.get(T, 'f1');
    expect(fetched?.posture).toBe('auto');
  });

  it('setPosture inserts a confirmed row when none exists', async () => {
    const { repo } = build();
    const pref = await repo.setPosture({
      tenantId: T,
      flowId: 'fresh',
      posture: 'auto',
      actorUserId: 'owner',
    });
    expect(pref.confirmationState).toBe('confirmed');
    expect(pref.createdBy).toBe('owner');
  });

  it('list / listPending filter correctly', async () => {
    const { repo } = build();
    await repo.recordFlowCreation({ tenantId: T, flowId: 'a', createdBy: 'u1' });
    await repo.recordFlowCreation({ tenantId: T, flowId: 'b', createdBy: 'u1' });
    await repo.setPosture({
      tenantId: T,
      flowId: 'b',
      posture: 'gated',
      actorUserId: 'owner',
    });
    expect(await repo.list(T)).toHaveLength(2);
    const pending = await repo.listPending(T);
    expect(pending.map((p) => p.flowId)).toEqual(['a']);
  });

  it('column handle name matches the snake_case migration column', () => {
    // Guard against a schema/migration drift in the conflict-target columns.
    expect(colName(flowAutonomyPrefs.tenantId)).toBe('tenant_id');
    expect(colName(flowAutonomyPrefs.flowId)).toBe('flow_id');
    expect(colName(flowAutonomyPrefs.confirmationState)).toBe(
      'confirmation_state',
    );
  });
});
