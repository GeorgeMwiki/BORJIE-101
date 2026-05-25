/**
 * Canonical JSON — keys sorted alphabetically, no whitespace.
 *
 * The hash function MUST consume canonical JSON to be stable across
 * Node versions, object-construction order, and any ordering ambiguity
 * the V8 implementation might introduce. Ported verbatim from LITFIN
 * `core/governance/audit/hash-chain.ts:canonicalJson` so both repos
 * produce byte-identical canonical forms for any shared payload.
 *
 * Behaviour:
 *   - `undefined` at the top level serialises as `undefined` (matches
 *     `JSON.stringify` for primitives).
 *   - Object properties with `undefined` values are omitted, mirroring
 *     `JSON.stringify`.
 *   - Arrays preserve order — only object keys are sorted.
 *   - `NaN`, `Infinity`, `-Infinity` serialise as `null` (matches
 *     `JSON.stringify`).
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}
