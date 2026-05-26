/**
 * Stage 3.b — Column matching.
 *
 * For each discovered column, attempt to map onto an existing tenant
 * field by name + type compatibility. Returns one of:
 *
 *   exact     — identical snake-cased name and compatible type.
 *   fuzzy     — name similarity ≥ 0.8 + compatible type.
 *   rename_proposed — name similarity in [0.7, 0.8). Owner confirms.
 *   transform_proposed — incompatible-but-coercible type pairs (e.g.
 *                       date column whose values are dd/mm/yyyy
 *                       strings; phone column whose values lack +).
 *
 * Pure — no LLM, no I/O. The runtime can layer LLM-driven re-mapping
 * on a separate stage if needed.
 */

import type {
  ColumnMapping,
  DiscoveredColumn,
  InferredType,
  TenantColumn,
  TenantTable,
  TransformSpec,
} from '../types.js';

const TYPE_COMPATIBILITY: Readonly<Record<InferredType, ReadonlyArray<string>>> =
  Object.freeze({
    string: ['text', 'varchar', 'character varying'],
    number: ['integer', 'smallint', 'bigint', 'numeric', 'decimal', 'real', 'double precision'],
    date: ['date', 'timestamp', 'timestamp with time zone', 'timestamptz'],
    datetime: ['timestamp', 'timestamp with time zone', 'timestamptz'],
    boolean: ['boolean', 'bool'],
    enum: ['text', 'varchar', 'character varying'],
    email: ['text', 'varchar'],
    phone: ['text', 'varchar'],
    nida: ['text', 'varchar'],
    tin: ['text', 'varchar'],
    coordinate: ['text', 'point', 'geography', 'geometry'],
    url: ['text', 'varchar'],
  });

function snakeCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Levenshtein distance between two short strings. O(n*m), capped at
 * 64 chars per side — column names are short.
 */
function levenshtein(a: string, b: string): number {
  const m = Math.min(a.length, 64);
  const n = Math.min(b.length, 64);
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i += 1) {
    const row = dp[i];
    if (row !== undefined) row[0] = i;
  }
  const top = dp[0];
  if (top !== undefined) {
    for (let j = 0; j <= n; j += 1) top[j] = j;
  }
  for (let i = 1; i <= m; i += 1) {
    const row = dp[i];
    const prev = dp[i - 1];
    if (row === undefined || prev === undefined) continue;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (row[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      row[j] = Math.min(del, ins, sub);
    }
  }
  const last = dp[m];
  return last?.[n] ?? Math.max(m, n);
}

function nameSimilarity(a: string, b: string): number {
  const sa = snakeCase(a);
  const sb = snakeCase(b);
  if (sa === sb) return 1;
  const dist = levenshtein(sa, sb);
  const longest = Math.max(sa.length, sb.length);
  if (longest === 0) return 1;
  return Number((1 - dist / longest).toFixed(2));
}

function typeCompatible(
  inferred: InferredType,
  target_type: string,
): boolean {
  const t = target_type.toLowerCase();
  const accepted = TYPE_COMPATIBILITY[inferred];
  return accepted.some((candidate) => t.includes(candidate));
}

function proposeTransform(
  inferred: InferredType,
  target_type: string,
): TransformSpec | undefined {
  const t = target_type.toLowerCase();
  if ((inferred === 'date' || inferred === 'datetime') && t.includes('text')) {
    return Object.freeze({ kind: 'date_format' as const, to: 'iso8601' });
  }
  if (inferred === 'phone') {
    return Object.freeze({ kind: 'phone_e164' as const });
  }
  if (inferred === 'string' && t.includes('text')) {
    return Object.freeze({ kind: 'trim' as const });
  }
  return undefined;
}

function matchOneColumn(
  source: DiscoveredColumn,
  target: TenantColumn,
): ColumnMapping | null {
  const sim = nameSimilarity(source.name, target.name);
  if (sim < 0.7) return null;

  const compatible = typeCompatible(source.inferred_type, target.type);

  if (sim === 1 && compatible) {
    return Object.freeze({
      source_column: source.name,
      target_field: target.name,
      match_kind: 'exact' as const,
      confidence: 1,
    });
  }

  if (sim >= 0.8 && compatible) {
    return Object.freeze({
      source_column: source.name,
      target_field: target.name,
      match_kind: 'fuzzy' as const,
      confidence: sim,
    });
  }

  if (sim >= 0.7 && compatible) {
    return Object.freeze({
      source_column: source.name,
      target_field: target.name,
      match_kind: 'rename_proposed' as const,
      confidence: sim,
    });
  }

  if (sim >= 0.7 && !compatible) {
    const transform = proposeTransform(source.inferred_type, target.type);
    if (transform !== undefined) {
      return Object.freeze({
        source_column: source.name,
        target_field: target.name,
        match_kind: 'transform_proposed' as const,
        transform,
        confidence: Number((sim * 0.8).toFixed(2)),
      });
    }
  }

  return null;
}

export interface ColumnMatchOutcome {
  readonly mappings: ReadonlyArray<ColumnMapping>;
  readonly unmatched: ReadonlyArray<DiscoveredColumn>;
}

export function matchColumns(
  discovered: ReadonlyArray<DiscoveredColumn>,
  target: TenantTable,
): ColumnMatchOutcome {
  const mappings: ColumnMapping[] = [];
  const unmatched: DiscoveredColumn[] = [];
  const used_targets = new Set<string>();

  for (const source of discovered) {
    let best: ColumnMapping | null = null;
    for (const candidate of target.columns) {
      if (used_targets.has(candidate.name)) continue;
      const proposed = matchOneColumn(source, candidate);
      if (proposed === null) continue;
      if (best === null || proposed.confidence > best.confidence) {
        best = proposed;
      }
    }
    if (best !== null) {
      mappings.push(best);
      used_targets.add(best.target_field);
    } else {
      unmatched.push(source);
    }
  }

  return Object.freeze({
    mappings: Object.freeze(mappings),
    unmatched: Object.freeze(unmatched),
  });
}

export const __TEST_ONLY = Object.freeze({
  levenshtein,
  nameSimilarity,
  typeCompatible,
});
