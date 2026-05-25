/**
 * IANA timezone validation. The single source of truth is
 * `Intl.DateTimeFormat` — if it accepts the id, we accept it.
 *
 * `Intl.supportedValuesOf('timeZone')` (Node 20+) returns the
 * **canonical** set, so we use it as a fast-path lookup and fall back to
 * `Intl.DateTimeFormat({ timeZone })` for aliases that resolve to a
 * canonical zone (e.g. `US/Eastern` → `America/New_York`).
 */

const CANONICAL: Set<string> = (() => {
  const s = new Set<string>();
  try {
    const supported = (Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf?.('timeZone') ?? [];
    for (const z of supported) s.add(z);
  } catch {
    // Older runtimes — fall through to the constructor check.
  }
  s.add('UTC');
  return s;
})();

/**
 * Return true iff `id` is a usable IANA timezone identifier in this
 * runtime. Both canonical and alias ids accepted.
 */
export function isValidTimezone(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (CANONICAL.has(id)) return true;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/** Throws if `id` is not a valid timezone. */
export function assertValidTimezone(id: unknown): asserts id is string {
  if (!isValidTimezone(id)) {
    throw new Error(`Invalid IANA timezone identifier: ${String(id)}`);
  }
}
