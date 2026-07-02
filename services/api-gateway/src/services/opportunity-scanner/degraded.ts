/**
 * Opportunity-scanner — undefined-relation self-report helper.
 *
 * Mirrors the risk-scanner helper. The false-green this closes: each slice
 * resolver wraps its reads in one try/catch that degrades to `null` on ANY
 * error — so a MISSING backing table (a deploy / wiring defect) looks identical
 * to a slice that legitimately has no data. Both nullify the slice, and the
 * scanner silently skips every dependent rule, reporting an all-clear.
 *
 * This isolates the ONE distinction that matters: a Postgres `undefined_table`
 * (SQLSTATE 42P01) or `undefined_column` (42703) error is an infrastructure
 * DEGRADATION, not a no-signal. A slice records the offending relation into a
 * `DegradedReadCollector` when it catches one, so `resolveScanState` can
 * surface an UNAVAILABLE signal instead of a silent null. Every OTHER error
 * (and a genuinely empty slice) stays the conservative null it always was — the
 * scanner must never crash a whole scan because one slice faulted.
 */

const UNDEFINED_RELATION_SQLSTATES: ReadonlySet<string> = new Set([
  '42P01', // undefined_table
  '42703', // undefined_column
]);

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

export function isUndefinedRelationError(err: unknown): boolean {
  const { code } = pgErrorFields(err);
  return code !== undefined && UNDEFINED_RELATION_SQLSTATES.has(code);
}

const RELATION_IN_MESSAGE =
  /(?:relation|column|table)\s+"([a-zA-Z_][a-zA-Z0-9_.]*)"\s+does not exist/i;

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

/**
 * Convenience for a slice catch block: record the fault into `degraded` iff it
 * is an undefined-relation error, then let the caller return its null slice.
 * A genuine query error (constraint, timeout, etc.) is NOT recorded — only a
 * missing relation is a self-reportable degradation.
 */
export function noteSliceFault(
  degraded: DegradedReadCollector | undefined,
  err: unknown,
): void {
  if (degraded && isUndefinedRelationError(err)) {
    degraded.record(undefinedRelationName(err));
  }
}
