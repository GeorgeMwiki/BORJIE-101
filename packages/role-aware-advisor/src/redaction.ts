/**
 * Field-level redactor.
 *
 * Takes a plain JSON-y object and replaces values keyed by `redactSet`
 * with a `[redacted: <reason>]` sentinel. The sentinel preserves the
 * type-checker's view of the field (still a string) so renderers don't
 * blow up on `undefined`, but is human-recognisable in the answer
 * text and machine-grep-able in audit logs.
 *
 * Design choices:
 *
 *  - The set is matched against the LEAF KEY name (case-insensitive),
 *    not the full path. PII fields tend to be named consistently
 *    across the platform (`email`, `phone`, `nationalId`); collisions
 *    are vanishingly rare and false positives are cheaper than
 *    false negatives.
 *
 *  - Arrays are walked element-wise; nested objects recurse. Cycles
 *    are broken via a `WeakSet` guard.
 *
 *  - We never mutate the input — the redactor returns a deep clone
 *    with substitutions applied. Mutating the live snippet would leak
 *    redactions into the caller's cache + violate the immutability
 *    rule in the global coding-style.
 */

const DEFAULT_REDACTION_REASON = 'pii';

export interface RedactOptions {
  readonly reason?: string;
  /**
   * Sentinel format: `'inline'` (default) writes `[redacted: <reason>]`
   * into the value. `'null'` replaces the value with `null` — useful
   * when the consumer is a downstream renderer that already handles
   * missing fields specially.
   */
  readonly sentinel?: 'inline' | 'null';
}

/**
 * Redact every leaf field whose key (lower-cased) appears in
 * `redactKeys`. Returns a new object — the input is never mutated.
 */
export function redactFields<T>(
  input: T,
  redactKeys: ReadonlyArray<string>,
  options: RedactOptions = {},
): T {
  const reason = options.reason ?? DEFAULT_REDACTION_REASON;
  const sentinel = options.sentinel ?? 'inline';
  const normalised = new Set(redactKeys.map((k) => k.toLowerCase()));
  const sentinelValue =
    sentinel === 'inline' ? `[redacted: ${reason}]` : null;
  const seen = new WeakSet<object>();

  function visit(value: unknown, currentKey: string | null): unknown {
    if (
      currentKey !== null &&
      normalised.has(currentKey.toLowerCase()) &&
      // never redact `false` / `0` — only actual non-empty values
      value !== null &&
      value !== undefined &&
      !(typeof value === 'string' && value.length === 0)
    ) {
      return sentinelValue;
    }
    if (Array.isArray(value)) {
      return value.map((el) => visit(el, currentKey));
    }
    if (value !== null && typeof value === 'object') {
      if (seen.has(value as object)) return value; // break cycle
      seen.add(value as object);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = visit(v, k);
      }
      return out;
    }
    return value;
  }

  return visit(input, null) as T;
}

/**
 * Canonical PII key set — the redactor used inside the orchestrator
 * defaults to this when the caller doesn't pass a custom list. Kept
 * conservative on purpose: false positives (a benign `name` field
 * appearing redacted) are recoverable; false negatives are not.
 */
export const DEFAULT_PII_KEYS: ReadonlyArray<string> = [
  'email',
  'emailaddress',
  'phone',
  'phonenumber',
  'mobile',
  'mobilephone',
  'nationalid',
  'national_id',
  'nin',
  'passport',
  'ssn',
  'taxid',
  'tin',
  'name',
  'fullname',
  'firstname',
  'lastname',
  'surname',
  'givenname',
  'address',
  'street',
  'postcode',
  'zipcode',
  'dob',
  'dateofbirth',
  'birthdate',
  'bankaccount',
  'iban',
  'cardnumber',
];

/**
 * Summarise what was redacted — useful for the audit entry. Returns a
 * de-duplicated list of leaf keys that were rewritten to the sentinel.
 */
export function summariseRedactions<T>(
  before: T,
  after: T,
  redactKeys: ReadonlyArray<string>,
): string[] {
  const normalised = new Set(redactKeys.map((k) => k.toLowerCase()));
  const touched = new Set<string>();
  const seen = new WeakSet<object>();

  function walk(a: unknown, b: unknown, key: string | null): void {
    if (a === b) return;
    if (
      key !== null &&
      normalised.has(key.toLowerCase()) &&
      a !== b &&
      a !== null &&
      a !== undefined
    ) {
      touched.add(key.toLowerCase());
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) walk(a[i], b[i], key);
      return;
    }
    if (
      a !== null &&
      b !== null &&
      typeof a === 'object' &&
      typeof b === 'object'
    ) {
      if (seen.has(a as object)) return;
      seen.add(a as object);
      const oa = a as Record<string, unknown>;
      const ob = b as Record<string, unknown>;
      for (const k of Object.keys(oa)) walk(oa[k], ob[k], k);
    }
  }

  walk(before, after, null);
  return [...touched];
}
