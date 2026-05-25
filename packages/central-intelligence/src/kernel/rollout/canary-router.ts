/**
 * Canary router — stable tenant-hash bucketing.
 *
 * Central Command Phase D (D5 — Rollout safety). The rollout controller
 * uses this module to decide, given a `(tenantId, capability)` tuple and
 * a set of rollout fractions, which variant a particular tenant lands on
 * for the next request.
 *
 * Design:
 *   - We hash `crc32(tenantId + ':' + capability)` and map it into the
 *     [0, 100) interval. The same tenant always lands in the same
 *     bucket within a rollout window, so a single tenant never flickers
 *     between variants mid-session.
 *   - Variants are evaluated in priority order: an active row consumes
 *     `100 - sum(canary fractions)` of the bucket space; canary-25
 *     consumes 25%; canary consumes 5% (defaults — operator can
 *     override via metadata).
 *   - Shadow variants are NOT routed here. They live in a parallel
 *     comparison harness (`shadow-mode/shadow-runner.ts`).
 *
 * The router is pure: same input → same output. Easy to unit-test
 * fairness + stability without touching the DB or the clock.
 */

export interface CanaryVariant {
  readonly version: string;
  readonly weight: number; // 0..100, the percentage of traffic this variant should receive
}

export interface CanaryRoute {
  readonly variants: ReadonlyArray<CanaryVariant>;
  readonly fallbackVersion: string;
}

export interface CanaryDecision {
  readonly version: string;
  readonly variant: 'active' | 'canary' | 'canary-25' | 'fallback';
  readonly bucket: number; // 0..99 — the bucket the tenant hashed into
}

// ─────────────────────────────────────────────────────────────────────
// CRC32 — RFC 1952 polynomial 0xEDB88320. Inlined here so the rollout
// module has zero external deps. Tested against the standard
// "123456789" vector → 0xCBF43926.
// ─────────────────────────────────────────────────────────────────────

const CRC32_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c | 0;
  }
  return table;
})();

export function crc32(value: string): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < value.length; i += 1) {
    const byte = value.charCodeAt(i) & 0xff;
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Stable [0, 100) bucket for the (tenantId, capability) tuple. Pure
 * function — same inputs always produce the same bucket.
 */
export function tenantBucket(tenantId: string, capability: string): number {
  if (!tenantId) return 0;
  const seed = `${tenantId}:${capability}`;
  return crc32(seed) % 100;
}

/**
 * Pick the variant for the given tenant. Variants are evaluated in
 * descending weight order so the largest band wins the highest bucket
 * range; the remainder of the [0, 100) space falls through to the
 * fallback (the prior active version, by convention).
 */
export function pickVariant(
  tenantId: string,
  capability: string,
  route: CanaryRoute,
): CanaryDecision {
  const bucket = tenantBucket(tenantId, capability);

  // Sort canary variants by weight DESC so the larger band claims the
  // top of the [0, 100) space first; this also keeps stable assignment
  // when an operator adds a smaller canary alongside an existing one.
  const ordered = [...route.variants].sort((a, b) => b.weight - a.weight);

  let cursor = 0;
  for (const v of ordered) {
    if (v.weight <= 0) continue;
    const clamped = Math.min(v.weight, 100 - cursor);
    const lo = cursor;
    const hi = cursor + clamped;
    if (bucket >= lo && bucket < hi) {
      const variantKind: CanaryDecision['variant'] =
        clamped >= 100
          ? 'active'
          : clamped >= 20
            ? 'canary-25'
            : 'canary';
      return { version: v.version, variant: variantKind, bucket };
    }
    cursor = hi;
    if (cursor >= 100) break;
  }
  return { version: route.fallbackVersion, variant: 'fallback', bucket };
}

/**
 * Tally how many tenants land on each variant across a sample. Used by
 * the unit tests to assert bucket fairness, and by the operator UI to
 * surface "actual vs. configured" traffic split.
 */
export function tallyVariantAssignments(
  tenantIds: ReadonlyArray<string>,
  capability: string,
  route: CanaryRoute,
): Readonly<Record<string, number>> {
  const tally: Record<string, number> = {};
  for (const t of tenantIds) {
    const d = pickVariant(t, capability, route);
    tally[d.version] = (tally[d.version] ?? 0) + 1;
  }
  return tally;
}
