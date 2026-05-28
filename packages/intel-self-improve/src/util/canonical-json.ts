/**
 * `canonicalJson` — deterministic JSON serialiser used to seed the
 * pattern signature and the audit-hash payload. Mirrors the algorithm
 * in `@borjie/audit-hash-chain` (see canonical-json.ts): objects are
 * sorted by key, arrays preserve order, NaN/Infinity are rejected so
 * the hash never depends on a floating-point quirk.
 *
 * Kept local (no cross-package import) because this file runs on the
 * happy path of every wrapped intel call — we want zero overhead.
 *
 * @module @borjie/intel-self-improve/util/canonical-json
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalJson: non-finite number');
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) {
        out[k] = canonicalize(v);
      }
    }
    return out;
  }
  if (typeof value === 'undefined') return undefined;
  // bigint / function / symbol — coerce to string to keep deterministic
  return String(value);
}
