/**
 * Postgres array literal helpers.
 *
 * Lifted from `services/decision-journal/recorder.ts` (commit 0214c417)
 * so other call sites (workers, services) that need to bind JS arrays
 * through drizzle's tagged-template `${arr}` interpolation can share
 * the same escape logic.
 *
 * Why this exists:
 *   drizzle's tagged-template binds bare JS arrays as N separate
 *   positional parameters instead of a single `text[]` value. The
 *   moment the array has any entries, postgres rejects the insert
 *   with `22P02 malformed array literal`. Encoding the array as a
 *   Postgres array literal text and casting (`::text[]`) sidesteps
 *   the issue without touching the SQL contract.
 *
 * Usage:
 *   import { toPgTextArray } from '../utils/pg-array';
 *
 *   await db.execute(sql`
 *     SELECT * FROM things
 *      WHERE tag = ANY(${toPgTextArray(tags)}::text[])
 *   `);
 *
 * All helpers are pure — no DB side effects, no logging.
 */

/**
 * Encode a JS string[] as a Postgres array literal text. Empty array
 * returns the canonical `{}` literal. Each element is wrapped in
 * double quotes with `\` and `"` escaped.
 *
 * The returned string is meant to be passed through drizzle's
 * tagged-template interpolation and cast to `::text[]` at the SQL
 * site.
 */
export function toPgTextArray(values: ReadonlyArray<string>): string {
  if (values.length === 0) return '{}';
  const escaped = values.map(
    (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"',
  );
  return '{' + escaped.join(',') + '}';
}
