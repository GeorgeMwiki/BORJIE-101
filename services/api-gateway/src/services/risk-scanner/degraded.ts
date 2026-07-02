/**
 * Risk-scanner — undefined-relation self-report helper.
 *
 * The false-green this closes: a resolver's per-query try/catch cannot tell
 * "relation does not exist" (a deploy / wiring defect — the backing migration
 * was never applied here) apart from "query returned no rows" (a genuine
 * no-signal). Both collapse to `[]`, so a MISSING backing table masquerades as
 * an all-clear scan.
 *
 * This module isolates the ONE distinction that matters: a Postgres
 * `undefined_table` (SQLSTATE 42P01) or `undefined_column` (42703) error is an
 * infrastructure DEGRADATION, not a no-signal. When `safeExecute` catches one
 * it records the offending relation into a `DegradedReadCollector` so the
 * scanner can surface an UNAVAILABLE signal in its result instead of a silent
 * empty list. Every OTHER error (and a genuine empty result set) is left as the
 * conservative no-signal it always was — the scanner must never crash a whole
 * scan because one slice faulted.
 */

/** SQLSTATE codes that mean "this relation/column was never provisioned here". */
const UNDEFINED_RELATION_SQLSTATES: ReadonlySet<string> = new Set([
  '42P01', // undefined_table
  '42703', // undefined_column
]);

/**
 * Mutable sink the resolvers thread through `safeExecute`. Collects the names
 * of relations that faulted with an undefined-table/column error during a
 * single `buildScannerState` pass. De-dups by relation name.
 */
export interface DegradedReadCollector {
  record(relation: string): void;
  readonly relations: ReadonlySet<string>;
}

export function createDegradedReadCollector(): DegradedReadCollector {
  const relations = new Set<string>();
  return {
    record(relation: string): void {
      relations.add(relation);
    },
    relations,
  };
}

interface PgErrorFields {
  code: string | undefined;
  table: string | undefined;
  column: string | undefined;
  message: string | undefined;
}

/** Narrow an unknown thrown value to a Postgres error carrying a SQLSTATE. */
function pgErrorFields(err: unknown): PgErrorFields {
  const empty: PgErrorFields = {
    code: undefined,
    table: undefined,
    column: undefined,
    message: undefined,
  };
  if (err == null || typeof err !== 'object') return empty;
  const e = err as Record<string, unknown>;
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    table: typeof e.table === 'string' ? e.table : undefined,
    column: typeof e.column === 'string' ? e.column : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
  };
}

/**
 * True when `err` is a Postgres undefined-table / undefined-column error —
 * i.e. the backing relation the query targets is not provisioned in this DB.
 */
export function isUndefinedRelationError(err: unknown): boolean {
  const { code } = pgErrorFields(err);
  return code !== undefined && UNDEFINED_RELATION_SQLSTATES.has(code);
}

// Extract the relation name from a Postgres "relation \"x\" does not exist" or
// "column \"x\" does not exist" message when the driver did not populate the
// structured `table` / `column` field. Bounded, anchored, single-match — no
// catastrophic backtracking.
const RELATION_IN_MESSAGE =
  /(?:relation|column|table)\s+"([a-zA-Z_][a-zA-Z0-9_.]*)"\s+does not exist/i;

/**
 * Best-effort name of the missing relation/column for the degraded report.
 * Prefers the structured driver fields, falls back to the message, then to a
 * stable sentinel so the degraded signal is never lost even if the driver
 * gives us nothing to name.
 */
export function undefinedRelationName(err: unknown): string {
  const { table, column, message } = pgErrorFields(err);
  if (table) return table;
  if (column) return column;
  if (message) {
    const m = RELATION_IN_MESSAGE.exec(message);
    if (m && m[1]) return m[1];
  }
  return 'unknown_relation';
}
