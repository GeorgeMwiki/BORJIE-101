/**
 * Unit tests for PostgresMigrationRepository using a minimal in-memory
 * Drizzle-like fake — no live Postgres needed.
 */
import { describe, it, expect } from 'vitest';
import {
  PostgresMigrationRepository,
  type DrizzleLike,
} from '../postgres-migration-repository.js';

// -------- In-memory fake Drizzle --------

interface FakeTable {
  readonly name: string;
  readonly rows: Map<string, Record<string, unknown>>;
  /** Composite natural key → primary id, used for ON CONFLICT DO NOTHING. */
  readonly naturalKeyIndex: Map<string, string>;
  readonly conflictKey: (row: Record<string, unknown>) => string;
}

function makeFake(): DrizzleLike & { tables: Map<unknown, FakeTable> } {
  const tables = new Map<unknown, FakeTable>();

  function ensureTable(
    table: unknown,
    conflictKey: (row: Record<string, unknown>) => string = (r) =>
      (r.id as string) ?? JSON.stringify(r)
  ): FakeTable {
    let t = tables.get(table);
    if (!t) {
      t = {
        name: String(table),
        rows: new Map(),
        naturalKeyIndex: new Map(),
        conflictKey,
      };
      tables.set(table, t);
    }
    return t;
  }

  const db: DrizzleLike & { tables: Map<unknown, FakeTable> } = {
    tables,
    async transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T> {
      return fn(db);
    },
    insert(table: unknown) {
      const t = ensureTable(table);
      return {
        values(values: unknown) {
          const rows = Array.isArray(values) ? values : [values];
          const pending = rows as Array<Record<string, unknown>>;
          return {
            onConflictDoNothing() {
              return {
                async returning() {
                  const inserted: Array<{ id: string }> = [];
                  for (const row of pending) {
                    const key = t.conflictKey(row);
                    if (t.naturalKeyIndex.has(key)) continue;
                    const id = (row.id as string) ?? `gen-${t.rows.size + 1}`;
                    t.rows.set(id, { ...row, id });
                    t.naturalKeyIndex.set(key, id);
                    inserted.push({ id });
                  }
                  return inserted;
                },
              };
            },
            onConflictDoUpdate() {
              return { async returning() { return []; } };
            },
            async returning() {
              const inserted: Array<{ id: string }> = [];
              for (const row of pending) {
                const id = (row.id as string) ?? `gen-${t.rows.size + 1}`;
                t.rows.set(id, { ...row, id });
                inserted.push({ id });
              }
              return inserted;
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const t = ensureTable(table);
          return {
            where() {
              return {
                async limit() {
                  return Array.from(t.rows.values()).slice(0, 1);
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      const t = ensureTable(table);
      return {
        set(patch: Record<string, unknown>) {
          return {
            async where() {
              // Apply to every row in-memory (tests use a single row).
              for (const [id, row] of t.rows) {
                t.rows.set(id, { ...row, ...patch });
              }
            },
          };
        },
      };
    },
  };

  return db;
}

// -------- Tests --------

describe('PostgresMigrationRepository', () => {
  const tenantId = 'tenant-1';
  const createdBy = 'user-1';

  it('creates a migration run with status=uploaded', async () => {
    const db = makeFake();
    const repo = new PostgresMigrationRepository({ db });
    const run = await repo.createRun({
      tenantId,
      createdBy,
      uploadFilename: 'bundle.csv',
      uploadMimeType: 'text/csv',
      uploadSizeBytes: 1024,
    });
    expect(run.tenantId).toBe(tenantId);
    expect(run.status).toBe('uploaded');
    expect(run.uploadFilename).toBe('bundle.csv');
    expect(run.id).toBeTruthy();
  });

  it('runInTransaction inserts all kinds and returns correct counts', async () => {
    const db = makeFake();
    const repo = new PostgresMigrationRepository({ db });

    const result = await repo.runInTransaction(tenantId, 'run-1', {
      properties: [
        { id: 'p1', ownerId: 'u1', propertyCode: 'P01', name: 'A', type: 'apartment' },
        { id: 'p2', ownerId: 'u1', propertyCode: 'P02', name: 'B', type: 'apartment' },
      ],
      units: [{ id: 'u1', propertyId: 'p1', unitCode: 'U01', baseRentAmount: 1000 }],
      tenants: [{ id: 't1', phone: '+254700000001', firstName: 'Ann' }],
      employees: [{ id: 'e1', employeeCode: 'EMP001', firstName: 'Ben' }],
      departments: [{ id: 'd1', code: 'OPS', name: 'Operations' }],
      teams: [{ id: 'tm1', code: 'TEAM_A', name: 'Team A' }],
    });

    expect(result.counts.properties).toBe(2);
    expect(result.counts.units).toBe(1);
    expect(result.counts.tenants).toBe(1);
    expect(result.counts.employees).toBe(1);
    expect(result.counts.departments).toBe(1);
    expect(result.counts.teams).toBe(1);
    expect(result.skipped.properties).toEqual([]);
  });

  it('handles empty bundles without error', async () => {
    const db = makeFake();
    const repo = new PostgresMigrationRepository({ db });

    const result = await repo.runInTransaction(tenantId, 'run-empty', {
      properties: [],
      units: [],
      tenants: [],
      employees: [],
      departments: [],
      teams: [],
    });

    expect(result.counts.properties).toBe(0);
    expect(result.counts.units).toBe(0);
  });
});
