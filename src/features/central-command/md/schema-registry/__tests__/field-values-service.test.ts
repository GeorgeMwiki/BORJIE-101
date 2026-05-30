/**
 * Tests — Field-values service. Exercises the typed-value
 * encoding/decoding + idempotent upsert + bulk + read path.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  makeFieldValuesService,
  type FieldValuesSupabaseLike,
} from "../field-values-service";

const ORG = "11111111-1111-1111-1111-111111111111";
const ROW = "22222222-2222-2222-2222-222222222222";
const ROW2 = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";

interface FakeRow {
  [k: string]: unknown;
}

function makeFakeSupabase(): {
  api: FieldValuesSupabaseLike;
  rows: FakeRow[];
} {
  const rows: FakeRow[] = [];
  const api: FieldValuesSupabaseLike = {
    from(table: string) {
      if (table !== "field_values")
        throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          const filters: Array<[string, unknown[]]> = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, [val]]);
              return builder;
            },
            in(col: string, vals: unknown[]) {
              filters.push([col, vals]);
              return builder;
            },
            limit() {
              const data = rows.filter((r) =>
                filters.every(([col, vals]) => vals.includes(r[col])),
              );
              return Promise.resolve({ data, error: null });
            },
          };
          return builder;
        },
        upsert(input: unknown) {
          const incoming = Array.isArray(input) ? input : [input];
          for (const r of incoming) {
            const r2 = r as FakeRow;
            // Conflict target is (org_id, table_key, row_id, field_key).
            const idx = rows.findIndex(
              (existing) =>
                existing.org_id === r2.org_id &&
                existing.table_key === r2.table_key &&
                existing.row_id === r2.row_id &&
                existing.field_key === r2.field_key,
            );
            if (idx >= 0) rows[idx] = { ...rows[idx], ...r2 };
            else rows.push({ ...r2, set_at: new Date().toISOString() });
          }
          return Promise.resolve({ data: incoming, error: null });
        },
      };
    },
  };
  return { api, rows };
}

describe("makeFieldValuesService", () => {
  let fake: ReturnType<typeof makeFakeSupabase>;
  beforeEach(() => {
    fake = makeFakeSupabase();
  });

  it("encodes money values into value_number", async () => {
    const svc = makeFieldValuesService(fake.api);
    const r = await svc.upsert({
      orgId: ORG,
      tableKey: "finance",
      rowId: ROW,
      fieldKey: "transport_stipend",
      fieldKind: "money",
      value: 15000,
      setBy: USER,
    });
    expect(r.ok).toBe(true);
    expect(fake.rows[0]!.value_number).toBe(15000);
    expect(fake.rows[0]!.value_text).toBeNull();
  });

  it("encodes enum values into value_text", async () => {
    const svc = makeFieldValuesService(fake.api);
    await svc.upsert({
      orgId: ORG,
      tableKey: "employees",
      rowId: ROW,
      fieldKey: "shift_pattern",
      fieldKind: "enum",
      value: "morning",
      setBy: USER,
    });
    expect(fake.rows[0]!.value_text).toBe("morning");
    expect(fake.rows[0]!.value_number).toBeNull();
  });

  it("idempotent on (org, tableKey, rowId, fieldKey)", async () => {
    const svc = makeFieldValuesService(fake.api);
    await svc.upsert({
      orgId: ORG,
      tableKey: "employees",
      rowId: ROW,
      fieldKey: "shift_pattern",
      fieldKind: "enum",
      value: "morning",
      setBy: USER,
    });
    await svc.upsert({
      orgId: ORG,
      tableKey: "employees",
      rowId: ROW,
      fieldKey: "shift_pattern",
      fieldKind: "enum",
      value: "evening", // overwrite
      setBy: USER,
    });
    expect(fake.rows.length).toBe(1);
    expect(fake.rows[0]!.value_text).toBe("evening");
  });

  it("rejects invalid input", async () => {
    const svc = makeFieldValuesService(fake.api);
    const r = await svc.upsert({
      orgId: "not-a-uuid",
      tableKey: "employees",
      rowId: ROW,
      fieldKey: "shift_pattern",
      fieldKind: "enum",
      value: "morning",
      setBy: USER,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid_upsert/);
  });

  it("upsertMany applies valid + reports failures separately", async () => {
    const svc = makeFieldValuesService(fake.api);
    const r = await svc.upsertMany([
      {
        orgId: ORG,
        tableKey: "employees",
        rowId: ROW,
        fieldKey: "shift_pattern",
        fieldKind: "enum",
        value: "morning",
        setBy: USER,
      },
      {
        orgId: ORG,
        tableKey: "employees",
        rowId: "bad-uuid",
        fieldKey: "shift_pattern",
        fieldKind: "enum",
        value: "morning",
        setBy: USER,
      },
    ]);
    expect(r.applied).toBe(1);
    expect(r.failed.length).toBe(1);
    expect(r.failed[0]!.rowId).toBe("bad-uuid");
  });

  it("readForRows returns a nested map", async () => {
    const svc = makeFieldValuesService(fake.api);
    await svc.upsertMany([
      {
        orgId: ORG,
        tableKey: "employees",
        rowId: ROW,
        fieldKey: "shift_pattern",
        fieldKind: "enum",
        value: "morning",
        setBy: USER,
      },
      {
        orgId: ORG,
        tableKey: "employees",
        rowId: ROW2,
        fieldKey: "shift_pattern",
        fieldKind: "enum",
        value: "evening",
        setBy: USER,
      },
      {
        orgId: ORG,
        tableKey: "employees",
        rowId: ROW,
        fieldKey: "transport_stipend",
        fieldKind: "money",
        value: 15000,
        setBy: USER,
      },
    ]);
    const map = await svc.readForRows(ORG, "employees", [ROW, ROW2]);
    expect(map.size).toBe(2);
    expect(map.get(ROW)!.get("shift_pattern")).toBe("morning");
    expect(map.get(ROW)!.get("transport_stipend")).toBe(15000);
    expect(map.get(ROW2)!.get("shift_pattern")).toBe("evening");
  });

  it("readForRows guards against oversized rowId lists", async () => {
    const svc = makeFieldValuesService(fake.api);
    const ids: string[] = [];
    for (let i = 0; i < 1_500; i += 1)
      ids.push("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const r = await svc.readForRows(ORG, "employees", ids);
    expect(r.size).toBe(0);
  });
});
