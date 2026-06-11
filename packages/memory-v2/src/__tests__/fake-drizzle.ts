/**
 * Minimal in-memory Drizzle-shaped fake for the memory-v2 store tests.
 *
 * It is NOT a general drizzle emulator — it interprets only the exact query
 * shapes the six store adapters issue:
 *   - insert(table).values(v).onConflictDoUpdate({ set }) / .onConflictDoNothing()
 *   - select([proj]).from(table).where(pred).orderBy(o).limit(n)
 *   - update(table).set(patch).where(pred)
 *   - delete(table).where(pred)
 *
 * The key property under test is DURABILITY ACROSS A SIMULATED RESTART: the
 * same `FakeTables` backing store is shared between two distinct store-adapter
 * instances. Writing through instance #1 and reading through a freshly
 * constructed instance #2 (over the same tables) proves the adapter persists
 * to the store rather than to per-instance process memory — exactly the
 * guarantee the in-memory reference impl FAILS to provide (MEM-01).
 *
 * The drizzle condition helpers (`eq` / `and` / `like`) are replaced via a
 * module mock (see the test file) with the `fakeEq` / `fakeAnd` / `fakeLike`
 * factories below, which read a drizzle column's real `.name` (snake_case db
 * column) so the matcher can evaluate against stored rows. `sql` / `desc` /
 * `asc` are mocked to no-op markers — ordering + pgvector ranking are
 * irrelevant to the persistence proof.
 */

import type { DatabaseClient } from '@borjie/database';

type Row = Record<string, unknown>;

export interface FakeTable {
  readonly name: string;
  readonly rows: Map<string, Row>;
}

/** Shared backing store. Survives across store-adapter instances. */
export class FakeTables {
  private readonly tables = new Map<object, FakeTable>();

  table(tableObj: object): FakeTable {
    let t = this.tables.get(tableObj);
    if (!t) {
      t = { name: 'tbl', rows: new Map() };
      this.tables.set(tableObj, t);
    }
    return t;
  }

  allRows(tableObj: object): Row[] {
    return Array.from(this.tables.get(tableObj)?.rows.values() ?? []);
  }
}

export interface Condition {
  readonly kind: 'eq' | 'and' | 'like' | 'true';
  readonly col?: string;
  readonly value?: unknown;
  readonly parts?: ReadonlyArray<Condition>;
}

interface DrizzleColumnLike {
  readonly name: string;
}

export function fakeEq(col: DrizzleColumnLike, value: unknown): Condition {
  return { kind: 'eq', col: col.name, value };
}
export function fakeAnd(...parts: Condition[]): Condition {
  return { kind: 'and', parts };
}
export function fakeLike(col: DrizzleColumnLike, pattern: string): Condition {
  return { kind: 'like', col: col.name, value: pattern };
}
export function fakeMarker(): Condition {
  return { kind: 'true' };
}

function rowMatches(row: Row, cond: Condition | undefined): boolean {
  if (!cond) return true;
  switch (cond.kind) {
    case 'true':
      return true;
    case 'eq':
      return row[cond.col as string] === cond.value;
    case 'like': {
      const raw = String(cond.value ?? '');
      const prefix = raw.replace(/%$/, '').replace(/\\(.)/g, '$1');
      return String(row[cond.col as string] ?? '').startsWith(prefix);
    }
    case 'and':
      return (cond.parts ?? []).every((p) => rowMatches(row, p));
    default:
      return true;
  }
}

const PK = 'id';

interface ColumnRef {
  readonly name: string;
}

/**
 * Build the JS-property ⇄ db-column-name maps from a drizzle table object. The
 * table exposes its columns as own-enumerable properties whose `.name` is the
 * snake_case db column. Real drizzle stores/returns rows keyed by the JS
 * property name; predicates reference the db column name. The fake therefore
 * persists rows in db-name form (so predicates match) and re-projects to JS
 * keys on read (so the store adapters' `rowToX` mappers see the expected
 * camelCase shape).
 */
function columnMaps(tableObj: object): {
  jsToDb: Map<string, string>;
  dbToJs: Map<string, string>;
} {
  const jsToDb = new Map<string, string>();
  const dbToJs = new Map<string, string>();
  for (const [jsKey, col] of Object.entries(
    tableObj as Record<string, unknown>,
  )) {
    const dbName =
      col && typeof col === 'object' && typeof (col as ColumnRef).name === 'string'
        ? (col as ColumnRef).name
        : null;
    if (dbName) {
      jsToDb.set(jsKey, dbName);
      dbToJs.set(dbName, jsKey);
    }
  }
  return { jsToDb, dbToJs };
}

function toDbRow(tableObj: object, jsRow: Row): Row {
  const { jsToDb } = columnMaps(tableObj);
  const out: Row = {};
  for (const [k, v] of Object.entries(jsRow)) {
    out[jsToDb.get(k) ?? k] = v;
  }
  return out;
}

function toJsRow(tableObj: object, dbRow: Row): Row {
  const { dbToJs } = columnMaps(tableObj);
  const out: Row = {};
  for (const [k, v] of Object.entries(dbRow)) {
    out[dbToJs.get(k) ?? k] = v;
  }
  return out;
}

export function createFakeDb(store: FakeTables): DatabaseClient {
  const api = {
    insert(tableObj: object) {
      return {
        values(values: Row | Row[]) {
          const rows = Array.isArray(values) ? values : [values];
          const apply = (mode: 'update' | 'nothing', set?: Row): Promise<Row[]> => {
            const t = store.table(tableObj);
            const written: Row[] = [];
            for (const v of rows) {
              const dbRow = toDbRow(tableObj, v);
              const id = String(dbRow[PK]);
              const existing = t.rows.get(id);
              if (existing) {
                if (mode === 'update') {
                  const merged = {
                    ...existing,
                    ...(set ? toDbRow(tableObj, set) : {}),
                  };
                  t.rows.set(id, merged);
                  written.push(toJsRow(tableObj, merged));
                }
              } else {
                t.rows.set(id, dbRow);
                written.push(toJsRow(tableObj, dbRow));
              }
            }
            return Promise.resolve(written);
          };
          const base = Object.assign(apply('update'), {
            onConflictDoUpdate: (a: { set: Row }) => apply('update', a.set),
            onConflictDoNothing: () => apply('nothing'),
            returning: () => apply('update'),
          });
          return base;
        },
      };
    },

    select(proj?: unknown) {
      const projection: Record<string, ColumnRef> | null =
        proj && typeof proj === 'object'
          ? (proj as Record<string, ColumnRef>)
          : null;
      return {
        from(tableObj: object) {
          let cond: Condition | undefined;
          let lim: number | undefined;
          function run(): Promise<Row[]> {
            const all = store.allRows(tableObj).filter((r) => rowMatches(r, cond));
            const sliced = typeof lim === 'number' ? all.slice(0, lim) : all;
            const projected =
              projection === null
                ? // No projection → drizzle returns the full $inferSelect shape
                  // keyed by JS property names.
                  sliced.map((r) => toJsRow(tableObj, r))
                : // Explicit projection ({ alias: column }) → key by alias,
                  // reading the stored db-name value.
                  sliced.map((r) => {
                    const out: Row = {};
                    for (const [alias, ref] of Object.entries(projection)) {
                      out[alias] = r[ref.name];
                    }
                    return out;
                  });
            return Promise.resolve(projected);
          }
          const chain = {
            where(c: Condition) {
              cond = c;
              return chain;
            },
            orderBy() {
              return chain;
            },
            limit(n: number) {
              lim = n;
              return run();
            },
            then(
              resolve: (v: Row[]) => unknown,
              reject?: (e: unknown) => unknown,
            ) {
              return run().then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },

    update(tableObj: object) {
      return {
        set(patch: Row) {
          const dbPatch = toDbRow(tableObj, patch);
          return {
            where(cond: Condition) {
              const t = store.table(tableObj);
              for (const [id, row] of t.rows) {
                if (rowMatches(row, cond)) t.rows.set(id, { ...row, ...dbPatch });
              }
              return Promise.resolve([] as Row[]);
            },
          };
        },
      };
    },

    delete(tableObj: object) {
      return {
        where(cond: Condition) {
          const t = store.table(tableObj);
          for (const [id, row] of Array.from(t.rows)) {
            if (rowMatches(row, cond)) t.rows.delete(id);
          }
          return Object.assign(Promise.resolve([] as Row[]), {
            catch: (f: (e: unknown) => unknown) =>
              Promise.resolve([] as Row[]).catch(f),
          });
        },
      };
    },
  };
  return api as unknown as DatabaseClient;
}
