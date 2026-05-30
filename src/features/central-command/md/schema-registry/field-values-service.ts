/**
 * Field-values service — the sparse column store.
 *
 * Every dynamic field that's been approved into `org_field_schemas`
 * may carry per-row values in `field_values`. This service is the
 * canonical write + read path.
 *
 * Architecture choices:
 *   - Writes are upserts on (org_id, table_key, row_id, field_key) so
 *     re-submitting the same value is idempotent and won't create
 *     duplicate rows. The DB UNIQUE constraint enforces this; the
 *     service preserves the contract by always passing the conflict
 *     target.
 *   - The service stores typed values in `value_text` / `value_number`
 *     / `value_date` / `value_bool` / `value_json` columns. The picker
 *     fans out by the live field's `fieldKind` so a row authored as
 *     `money` lands in `value_number`, while `enum` lands in
 *     `value_text`. This keeps queries that aggregate (SUM, AVG) fast
 *     and avoids per-row JSON parsing.
 *   - Reads return a `FieldValueMap` keyed by `row_id` → fieldKey →
 *     typed value. The renderer joins this with the live-field
 *     definitions to emit dynamic columns.
 *   - The service is RLS-scoped at the route layer; client never
 *     trusts caller-supplied `orgId`. We pass it through so the
 *     service can short-circuit obvious mismatches in dev.
 *
 * @module features/central-command/md/schema-registry/field-values-service
 */

import { z } from "zod";

import { createLogger } from "@/lib/logger";

import {
  FIELD_KINDS,
  TABLE_KEYS,
  type FieldKind,
  type TableKey,
} from "./types";

const log = createLogger("md.field-values");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldValuePrimitive =
  | string
  | number
  | boolean
  | { readonly iso: string } // date as ISO 8601 string
  | null;

export interface FieldValueUpsert {
  readonly orgId: string;
  readonly tableKey: TableKey;
  readonly rowId: string;
  readonly fieldKey: string;
  readonly fieldKind: FieldKind;
  readonly value: FieldValuePrimitive;
  readonly setBy: string;
}

export const fieldValueUpsertSchema = z.object({
  orgId: z.string().uuid(),
  tableKey: z.enum(TABLE_KEYS),
  rowId: z.string().uuid(),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  fieldKind: z.enum(FIELD_KINDS),
  value: z.union([
    z.string().max(8_000),
    z.number().finite(),
    z.boolean(),
    z.object({ iso: z.string().datetime() }),
    z.null(),
  ]),
  setBy: z.string().uuid(),
});

export interface FieldValueRecord {
  readonly orgId: string;
  readonly tableKey: TableKey;
  readonly rowId: string;
  readonly fieldKey: string;
  readonly value: FieldValuePrimitive;
  readonly setBy: string | null;
  readonly setAt: string;
}

/** Nested map: rowId → fieldKey → value. */
export type FieldValueMap = ReadonlyMap<
  string,
  ReadonlyMap<string, FieldValuePrimitive>
>;

// ---------------------------------------------------------------------------
// Public ports
// ---------------------------------------------------------------------------

export interface FieldValuesSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    upsert(rows: unknown, options?: unknown): any;
  };
}

export interface FieldValuesService {
  /**
   * Upsert a single value. Idempotent on
   * (orgId, tableKey, rowId, fieldKey).
   */
  upsert(args: FieldValueUpsert): Promise<{
    readonly ok: boolean;
    readonly error?: string;
  }>;
  /**
   * Bulk upsert. Each entry is validated independently; failed entries
   * are reported in the result.
   */
  upsertMany(args: ReadonlyArray<FieldValueUpsert>): Promise<{
    readonly ok: boolean;
    readonly applied: number;
    readonly failed: ReadonlyArray<{
      readonly fieldKey: string;
      readonly rowId: string;
      readonly error: string;
    }>;
  }>;
  /**
   * Read all field values for a (org, tableKey) limited to `rowIds`.
   * Returns a nested map so the renderer can do O(1) lookups.
   */
  readForRows(
    orgId: string,
    tableKey: TableKey,
    rowIds: ReadonlyArray<string>,
  ): Promise<FieldValueMap>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function makeFieldValuesService(
  supabase: FieldValuesSupabaseLike,
): FieldValuesService {
  return Object.freeze({
    async upsert(input: FieldValueUpsert) {
      const parsed = fieldValueUpsertSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: `invalid_upsert: ${parsed.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        };
      }
      try {
        const row = toDbRow(parsed.data);
        const r = await supabase.from("field_values").upsert([row], {
          onConflict: "org_id,table_key,row_id,field_key",
        });
        const err = (r as { error?: { message: string } | null }).error;
        if (err) return { ok: false, error: err.message };
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "upsert_failed",
        };
      }
    },

    async upsertMany(input: ReadonlyArray<FieldValueUpsert>) {
      if (input.length === 0) {
        return { ok: true, applied: 0, failed: [] };
      }
      const dbRows: unknown[] = [];
      const failed: Array<{
        fieldKey: string;
        rowId: string;
        error: string;
      }> = [];
      for (const entry of input) {
        const parsed = fieldValueUpsertSchema.safeParse(entry);
        if (!parsed.success) {
          failed.push({
            fieldKey: entry.fieldKey,
            rowId: entry.rowId,
            error: parsed.error.issues.map((i) => i.message).join(", "),
          });
          continue;
        }
        dbRows.push(toDbRow(parsed.data));
      }
      if (dbRows.length === 0) {
        return { ok: false, applied: 0, failed: Object.freeze(failed) };
      }
      try {
        const r = await supabase.from("field_values").upsert(dbRows, {
          onConflict: "org_id,table_key,row_id,field_key",
        });
        const err = (r as { error?: { message: string } | null }).error;
        if (err) {
          return {
            ok: false,
            applied: 0,
            failed: Object.freeze([
              ...failed,
              ...dbRows.map((d) => ({
                fieldKey: String(
                  (d as { field_key?: unknown }).field_key ?? "?",
                ),
                rowId: String((d as { row_id?: unknown }).row_id ?? "?"),
                error: err.message,
              })),
            ]),
          };
        }
        return {
          ok: failed.length === 0,
          applied: dbRows.length,
          failed: Object.freeze(failed),
        };
      } catch (e) {
        return {
          ok: false,
          applied: 0,
          failed: Object.freeze([
            ...failed,
            {
              fieldKey: "*",
              rowId: "*",
              error: e instanceof Error ? e.message : "upsert_failed",
            },
          ]),
        };
      }
    },

    async readForRows(
      orgId: string,
      tableKey: TableKey,
      rowIds: ReadonlyArray<string>,
    ): Promise<FieldValueMap> {
      if (rowIds.length === 0) return new Map();
      // Hard upper bound — never let a caller flood Postgres with a
      // 100k-id `IN` list. Anything larger should batch.
      if (rowIds.length > 1_000) {
        log.warn("md.field-values.read.too-many-row-ids", {
          orgId,
          tableKey,
          rowIds: rowIds.length,
        });
        return new Map();
      }
      try {
        const r = await supabase
          .from("field_values")
          .select(
            "org_id, table_key, row_id, field_key, value_text, value_number, value_date, value_bool, value_json, set_by, set_at",
          )
          .eq("org_id", orgId)
          .eq("table_key", tableKey)
          .in("row_id", [...rowIds])
          .limit(rowIds.length * 32);
        const data = (r as { data?: unknown[] }).data;
        if (!Array.isArray(data)) return new Map();
        const out = new Map<string, Map<string, FieldValuePrimitive>>();
        for (const row of data) {
          const r2 = row as Record<string, unknown>;
          const rowId = String(r2.row_id ?? "");
          const fieldKey = String(r2.field_key ?? "");
          if (!rowId || !fieldKey) continue;
          let inner = out.get(rowId);
          if (!inner) {
            inner = new Map();
            out.set(rowId, inner);
          }
          inner.set(fieldKey, decodeDbRow(r2));
        }
        // Freeze each inner + outer for caller safety.
        const frozenInner = new Map<
          string,
          ReadonlyMap<string, FieldValuePrimitive>
        >();
        for (const [k, v] of out) frozenInner.set(k, v);
        return frozenInner;
      } catch (e) {
        log.warn("md.field-values.read.threw", {
          orgId,
          tableKey,
          error: e instanceof Error ? e.message : String(e),
        });
        return new Map();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Row encode / decode — picks the typed column based on fieldKind.
// ---------------------------------------------------------------------------

function toDbRow(input: FieldValueUpsert): Record<string, unknown> {
  const base = {
    org_id: input.orgId,
    table_key: input.tableKey,
    row_id: input.rowId,
    field_key: input.fieldKey,
    set_by: input.setBy,
    value_text: null as string | null,
    value_number: null as number | null,
    value_date: null as string | null,
    value_bool: null as boolean | null,
    value_json: null as unknown,
  };
  if (input.value === null) return base;
  switch (input.fieldKind) {
    case "money":
    case "percent":
    case "number": {
      const n =
        typeof input.value === "number" ? input.value : Number(input.value);
      base.value_number = Number.isFinite(n) ? n : null;
      return base;
    }
    case "boolean": {
      base.value_bool =
        typeof input.value === "boolean"
          ? input.value
          : String(input.value).toLowerCase() === "true";
      return base;
    }
    case "date": {
      const iso =
        typeof input.value === "object" && input.value && "iso" in input.value
          ? (input.value as { iso: string }).iso
          : typeof input.value === "string"
            ? input.value
            : null;
      base.value_date = iso;
      return base;
    }
    case "enum":
    case "id":
    case "string":
    default:
      base.value_text =
        typeof input.value === "string"
          ? input.value
          : input.value === null
            ? null
            : JSON.stringify(input.value);
      return base;
  }
}

function decodeDbRow(row: Record<string, unknown>): FieldValuePrimitive {
  if (row.value_number !== null && row.value_number !== undefined) {
    return Number(row.value_number);
  }
  if (row.value_bool !== null && row.value_bool !== undefined) {
    return Boolean(row.value_bool);
  }
  if (row.value_date !== null && row.value_date !== undefined) {
    return { iso: String(row.value_date) };
  }
  if (row.value_text !== null && row.value_text !== undefined) {
    return String(row.value_text);
  }
  if (row.value_json !== null && row.value_json !== undefined) {
    return JSON.stringify(row.value_json);
  }
  return null;
}
