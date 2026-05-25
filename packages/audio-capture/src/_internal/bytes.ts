/**
 * Internal helpers shared by adapters.
 *
 * - `toBodyInit` coerces a `Uint8Array` (which may sit on top of a
 *   `SharedArrayBuffer`) into a `BodyInit` (`ArrayBuffer`) that strict TS
 *   versions accept.
 * - `pruneUndefined` strips `undefined` properties — required because we
 *   compile with `exactOptionalPropertyTypes: true`.
 */

export function toBodyInit(bytes: Uint8Array): ArrayBuffer {
  // Slice into a fresh ArrayBuffer so the resulting body type is unambiguous.
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  return toBodyInit(bytes);
}

export function pruneUndefined<T extends Record<string, unknown>>(
  input: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}
