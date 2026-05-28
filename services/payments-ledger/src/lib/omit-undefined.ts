/**
 * Object utility: strip keys whose value is `undefined`.
 *
 * Required because the project's `exactOptionalPropertyTypes: true`
 * tsconfig forbids explicit `undefined` on optional fields. Spreading
 * a partially-undefined source into a strict shape fails the type
 * check; this helper materialises only the keys that actually have a
 * value, so the returned object satisfies the target type.
 *
 * Pure — never mutates the input. Returns a new plain object.
 */
export function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}
