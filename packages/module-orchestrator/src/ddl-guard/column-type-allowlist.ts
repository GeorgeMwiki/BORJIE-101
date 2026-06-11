/**
 * column-type-allowlist.ts — the safe column-type wall.
 *
 * A spawned CREATE TABLE may only use column types from a tiny, fixed
 * allowlist. Arbitrary types (e.g. a custom domain, an array, a
 * composite, `regclass`, `oid`) are rejected because they can carry
 * side effects, reference catalog objects, or break the RLS model.
 *
 * Defaults are even tighter: a module AUTHOR may supply NO default
 * expression at all. The compiler's own fixed system columns (id,
 * tenant_id, lifecycle_state, created_at, …) use a closed set of
 * SYSTEM_DEFAULTS — `NOW()`, the literal `'active'`, and `NULL`. Any
 * other default (`now() - interval ...`, a sub-select, a function call,
 * `gen_random_uuid()`, a string concat) is rejected so a default can
 * never become an injection or a side-effecting expression.
 *
 * Pure validators. They classify already-tokenized column fragments
 * (string literals already stripped to placeholders upstream).
 */

export interface AllowlistResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
}

const OK: AllowlistResult = Object.freeze({ ok: true, errors: Object.freeze([]) });

function fail(...errors: string[]): AllowlistResult {
  return Object.freeze({ ok: false, errors: Object.freeze(errors) });
}

/**
 * Base type tokens (upper-cased). Parameterised types (varchar(n),
 * numeric(p,s)) are validated separately so the parameter list can be
 * range-checked.
 */
export const SAFE_BASE_TYPES: ReadonlySet<string> = new Set([
  'TEXT',
  'INTEGER',
  'BIGINT',
  'BOOLEAN',
  'TIMESTAMPTZ',
  'DATE',
  'UUID',
  'JSONB',
]);

/** Parameterised types and their parameter-arity bounds. */
export const SAFE_PARAMETERISED_TYPES: ReadonlyMap<
  string,
  { readonly minArgs: number; readonly maxArgs: number }
> = new Map([
  ['VARCHAR', { minArgs: 1, maxArgs: 1 }],
  ['NUMERIC', { minArgs: 0, maxArgs: 2 }],
]);

/**
 * The ONLY default expressions permitted, and only on the compiler's
 * fixed system columns. Compared case-insensitively after collapsing
 * internal whitespace. Author-supplied defaults are rejected wholesale.
 */
export const SYSTEM_DEFAULTS: ReadonlySet<string> = new Set([
  'NOW()',
  "'ACTIVE'",
  'NULL',
]);

/**
 * Validate a single column's TYPE fragment (everything after the
 * column name, with any trailing `NOT NULL` / `DEFAULT …` / `CHECK …`
 * already separated out by the validator). `typeFragment` is the bare
 * type, e.g. `TEXT`, `VARCHAR(120)`, `NUMERIC(18, 4)`.
 */
export function isSafeColumnType(typeFragment: string): AllowlistResult {
  const t = typeFragment.trim();
  if (t.length === 0) return fail('empty column type');

  const paren = t.indexOf('(');
  if (paren === -1) {
    const base = t.toUpperCase();
    if (SAFE_BASE_TYPES.has(base)) return OK;
    // A parameterised type used WITHOUT parameters is allowed only when
    // its parameter list is optional (minArgs === 0), e.g. bare NUMERIC.
    const spec = SAFE_PARAMETERISED_TYPES.get(base);
    if (spec && spec.minArgs === 0) return OK;
    return fail(`disallowed column type: ${typeFragment}`);
  }

  // Parameterised form.
  if (!t.endsWith(')')) {
    return fail(`malformed parameterised type: ${typeFragment}`);
  }
  const base = t.slice(0, paren).trim().toUpperCase();
  const spec = SAFE_PARAMETERISED_TYPES.get(base);
  if (!spec) {
    return fail(`disallowed parameterised column type: ${typeFragment}`);
  }
  const inner = t.slice(paren + 1, t.length - 1).trim();
  const args = inner.length === 0 ? [] : inner.split(',').map((a) => a.trim());
  if (args.length < spec.minArgs || args.length > spec.maxArgs) {
    return fail(
      `type ${base} expects ${spec.minArgs}-${spec.maxArgs} args, got ${args.length}: ${typeFragment}`,
    );
  }
  for (const a of args) {
    if (!/^\d{1,4}$/.test(a)) {
      return fail(`type ${base} parameters must be small integers: ${typeFragment}`);
    }
  }
  return OK;
}

/**
 * Validate a DEFAULT clause value. `forSystemColumn` is true ONLY when
 * the column is one of the compiler's fixed system columns; author
 * columns must pass `forSystemColumn=false` and therefore reject EVERY
 * default.
 */
export function isSafeDefault(
  defaultExpr: string,
  forSystemColumn: boolean,
): AllowlistResult {
  if (!forSystemColumn) {
    return fail(
      `author-supplied DEFAULT is forbidden (got: ${defaultExpr})`,
    );
  }
  const normalised = defaultExpr.replace(/\s+/g, '').toUpperCase();
  // Re-add the single space NOW() form has none; SYSTEM_DEFAULTS are
  // stored whitespace-free-equivalent already.
  if (SYSTEM_DEFAULTS.has(normalised)) return OK;
  return fail(`disallowed DEFAULT expression: ${defaultExpr}`);
}
