/**
 * Piece L — Canonical entity resolver.
 *
 * Maps raw entity mentions (regex NER output: "Mr Juma", "godown 3",
 * "350k", "Jan") to canonical core-entity IDs that the platform can
 * key off (e.g. `customers.id = 'cust_juma_x'`).
 *
 * The default implementation is a port + an in-memory store for tests.
 * Production wires a DB-backed resolver (Piece K's bridge or a direct
 * Drizzle lookup) into the same port.
 *
 * Resolution policy:
 *   - Exact case-insensitive match on canonical name wins (confidence 0.95).
 *   - Substring match on canonical name (confidence 0.75).
 *   - Levenshtein distance ≤ 2 (confidence 0.6).
 *   - Otherwise return `null` so the dispatcher DROPS the entity
 *     (no hallucinations: an entity that can't be resolved is not
 *     stored on the capture row).
 *
 * The resolver is tenant-scoped: every lookup carries the tenant id
 * and the in-memory store is partitioned by tenant.
 */

import type {
  CanonicalResolver,
  CanonicalResolverResult,
  ResolvedEntityType,
} from './types.js';

export interface InMemoryEntityRecord {
  readonly tenant_id: string;
  readonly type: ResolvedEntityType;
  readonly canonical_id: string;
  readonly canonical_name: string;
  /** Alternative names / aliases that should also match exactly. */
  readonly aliases?: ReadonlyArray<string>;
}

export interface InMemoryResolverStore {
  /** Returns all records the tenant has registered. */
  readonly listByTenant: (tenant_id: string) => ReadonlyArray<InMemoryEntityRecord>;
  /** Add a new record. */
  readonly add: (record: InMemoryEntityRecord) => void;
}

/**
 * Build the in-memory resolver store + a `CanonicalResolver` that reads
 * from it. The store is exposed so tests (and the demo flow) can seed
 * entities deterministically.
 */
export function createInMemoryCanonicalResolver(): {
  readonly store: InMemoryResolverStore;
  readonly resolver: CanonicalResolver;
} {
  const records: InMemoryEntityRecord[] = [];

  const store: InMemoryResolverStore = {
    listByTenant: (tenant_id) =>
      records.filter((r) => r.tenant_id === tenant_id),
    add: (record) => {
      records.push(record);
    },
  };

  const resolver: CanonicalResolver = async (args) => {
    const candidates = store.listByTenant(args.tenant_id);
    const normalisedQuery = normalise(args.raw_value);
    const queryType = coerceEntityType(args.raw_type);

    // 1. Exact name match — confidence 0.95
    for (const r of candidates) {
      if (queryType && r.type !== queryType) continue;
      if (normalise(r.canonical_name) === normalisedQuery) {
        return mkResult(r, 0.95, 'exact_name');
      }
      for (const alias of r.aliases ?? []) {
        if (normalise(alias) === normalisedQuery) {
          return mkResult(r, 0.95, 'exact_alias');
        }
      }
    }

    // 2. Substring match — confidence 0.75
    for (const r of candidates) {
      if (queryType && r.type !== queryType) continue;
      const canon = normalise(r.canonical_name);
      if (canon.includes(normalisedQuery) || normalisedQuery.includes(canon)) {
        return mkResult(r, 0.75, 'substring');
      }
      for (const alias of r.aliases ?? []) {
        const aliasN = normalise(alias);
        if (
          aliasN.includes(normalisedQuery) ||
          normalisedQuery.includes(aliasN)
        ) {
          return mkResult(r, 0.75, 'substring_alias');
        }
      }
    }

    // 3. Fuzzy match (Levenshtein ≤ 2) — confidence 0.6
    for (const r of candidates) {
      if (queryType && r.type !== queryType) continue;
      const canon = normalise(r.canonical_name);
      if (
        canon.length >= 3 &&
        normalisedQuery.length >= 3 &&
        levenshteinAtMost(canon, normalisedQuery, 2)
      ) {
        return mkResult(r, 0.6, 'fuzzy');
      }
    }

    return null;
  };

  return { store, resolver };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function mkResult(
  r: InMemoryEntityRecord,
  confidence: number,
  source: string,
): CanonicalResolverResult {
  return {
    type: r.type,
    canonical_id: r.canonical_id,
    confidence,
    source,
  };
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function coerceEntityType(rawType: string): ResolvedEntityType | null {
  const candidates: ReadonlyArray<ResolvedEntityType> = [
    'customer',
    'unit',
    'property',
    'lease',
    'amount',
    'date',
    'district',
    'tenant_user',
    'document',
    'invoice',
    'maintenance_ticket',
  ];
  const lower = rawType.toLowerCase();
  const exact = candidates.find((c) => c === lower);
  if (exact) return exact;
  // Map regex-NER types to canonical types.
  if (lower === 'tenant_name') return 'customer';
  if (lower === 'unit_id') return 'unit';
  if (lower === 'property_id') return 'property';
  if (lower === 'amount_tzs') return 'amount';
  return null;
}

/**
 * Returns true when the Levenshtein distance between `a` and `b` is
 * at most `maxDist`. Early-exit optimisation: rows of the DP table are
 * pruned when no cell can be ≤ maxDist, so the loop short-circuits in
 * O(min(|a|, |b|) * maxDist) instead of O(|a| * |b|).
 */
export function levenshteinAtMost(
  a: string,
  b: string,
  maxDist: number,
): boolean {
  if (Math.abs(a.length - b.length) > maxDist) return false;
  if (a === b) return true;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    let minInRow = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? Number.POSITIVE_INFINITY) + 1;
      const ins = (curr[j - 1] ?? Number.POSITIVE_INFINITY) + 1;
      const sub = (prev[j - 1] ?? Number.POSITIVE_INFINITY) + cost;
      const v = Math.min(del, ins, sub);
      curr.push(v);
      if (v < minInRow) minInRow = v;
    }
    if (minInRow > maxDist) return false;
    prev = curr;
  }
  return (prev[b.length] ?? Number.POSITIVE_INFINITY) <= maxDist;
}
