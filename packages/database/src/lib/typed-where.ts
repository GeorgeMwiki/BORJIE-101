/**
 * Typed `WHERE` helpers — narrow drizzle-orm's `eq()` for pgEnum columns
 * without resorting to `// @ts-nocheck` at file scope.
 *
 * Background (drizzle-team/drizzle-orm#2389):
 * `eq(col, val)` infers the value type from the column. For pgEnum
 * columns it is `TValues[number]` (the literal union). When repositories
 * accept a generic `string` query parameter, drizzle refuses the call.
 * We previously suppressed the whole file with `@ts-nocheck`, hiding
 * unrelated bugs.
 *
 * This helper validates the runtime value against the column's
 * `enumValues` (so an invalid status surfaces as a thrown
 * `ENUM_VALUE_INVALID` instead of an empty result set), then narrows
 * the call to the typed overload of `eq()`. Runtime behaviour is
 * preserved; the only change is that the cast is now local + checked
 * rather than file-wide and silent.
 */
import { eq, type SQL } from 'drizzle-orm';
import type { PgEnumColumn } from 'drizzle-orm/pg-core';

/**
 * A pgEnum column with values constrained to a known literal tuple.
 * Mirrors drizzle's own constraint on `PgEnumColumn` but is reusable as
 * a parameter type for our helper.
 */
type EnumCol<TValues extends [string, ...string[]]> = PgEnumColumn<{
  name: string;
  tableName: string;
  dataType: 'string';
  columnType: 'PgEnumColumn';
  data: TValues[number];
  enumValues: TValues;
  driverParam: string;
  notNull: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  isAutoincrement: boolean;
  hasRuntimeDefault: boolean;
  baseColumn: never;
  identity: undefined;
  generated: undefined;
}>;

/**
 * Equality predicate for a drizzle pgEnum column whose runtime input
 * arrives as `string` (e.g. a query-string filter). Validates the value
 * is a member of the enum literal union; throws `ENUM_VALUE_INVALID`
 * on mismatch so call sites surface a 400 rather than a silently-empty
 * result.
 */
export function eqEnum<TValues extends [string, ...string[]]>(
  column: EnumCol<TValues>,
  value: string,
): SQL {
  const allowed = column.enumValues as readonly string[];
  if (!allowed.includes(value)) {
    const err = new Error(
      `ENUM_VALUE_INVALID: expected one of [${allowed.join(', ')}], got "${value}"`,
    );
    (err as { code?: string }).code = 'ENUM_VALUE_INVALID';
    throw err;
  }
  // Safe: we've just validated `value` is a member of `column.enumValues`,
  // so the literal-union narrowing required by drizzle's `eq()` overload
  // holds at runtime. The local assertion replaces a file-wide `@ts-nocheck`.
  return eq(column, value as TValues[number]);
}

/**
 * Same as `eqEnum` but accepts an already-validated literal-typed
 * value. Use this when the caller has already validated via an
 * `assert*Status` guard from `repositories/enum-guards.ts` — the
 * helper is then purely a typing wrapper with no runtime cost.
 */
export function eqEnumValue<TValues extends [string, ...string[]]>(
  column: EnumCol<TValues>,
  value: TValues[number],
): SQL {
  return eq(column, value);
}
