/**
 * Type inference over a parsed tabular dataset. Pure, deterministic, no I/O.
 *
 * Confidence is calibrated against the fraction of non-null values that
 * match the type's pattern. Anything <0.5 falls back to 'string' /
 * 'unknown'. Type heuristics are intentionally conservative — better to
 * under-claim and let the LLM proposal refine than to over-claim.
 */

import type { InferredColumn, InferredSchema, InferredType, ParsedTable } from './types.js';

export const SCHEMA_VERSION = 'sniff-v1';

const MAX_SAMPLES = 8;

const EMAIL_RX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
// Phone: must look phone-shaped — either an explicit "+" country code, OR
// contains a separator (space, dash, paren). Pure digit strings are
// classified as integer, not phone (avoids "salary=1850000" → phone).
const PHONE_RX =
  /^(?:\+[0-9][0-9\s()-]{6,}|[0-9]{3,}[\s()-]+[0-9][0-9\s()-]{4,})$/;
const INTEGER_RX = /^-?\d+$/;
const DECIMAL_RX = /^-?\d+(\.\d+)?$/;
const CURRENCY_RX =
  /^(KSh|TZS|USD|EUR|GBP|KES|UGX|RWF|ZAR|\$|£|€)\s?-?[\d,]+(\.\d+)?$/i;
const BOOLEAN_RX = /^(true|false|yes|no|y|n)$/i;
const DATE_RX =
  /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}|\d{1,2}-[A-Za-z]{3}-\d{2,4})$/;
const DATETIME_RX =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

type TypeMatcher = (value: string) => boolean;

const TYPE_MATCHERS: ReadonlyArray<readonly [InferredType, TypeMatcher]> = [
  ['email', (v) => EMAIL_RX.test(v)],
  ['datetime', (v) => DATETIME_RX.test(v)],
  ['date', (v) => DATE_RX.test(v)],
  ['currency', (v) => CURRENCY_RX.test(v.trim())],
  ['phone', (v) => PHONE_RX.test(v) && v.replace(/\D/g, '').length >= 7],
  ['boolean', (v) => BOOLEAN_RX.test(v)],
  ['integer', (v) => INTEGER_RX.test(v)],
  ['decimal', (v) => DECIMAL_RX.test(v)],
];

interface ColumnStats {
  readonly nonNullCount: number;
  readonly nullCount: number;
  readonly uniqueValues: ReadonlySet<string>;
  readonly samples: ReadonlyArray<string>;
  readonly typeMatches: ReadonlyMap<InferredType, number>;
}

const isNullish = (v: string | undefined | null): boolean =>
  v === undefined || v === null || v.trim() === '';

function computeColumnStats(values: ReadonlyArray<string>): ColumnStats {
  const samplesSet = new Set<string>();
  const uniqueValues = new Set<string>();
  const typeMatches = new Map<InferredType, number>();
  let nonNullCount = 0;
  let nullCount = 0;

  for (const raw of values) {
    if (isNullish(raw)) {
      nullCount += 1;
      continue;
    }
    const v = raw.trim();
    nonNullCount += 1;
    uniqueValues.add(v);
    if (samplesSet.size < MAX_SAMPLES) samplesSet.add(v);

    for (const [type, matcher] of TYPE_MATCHERS) {
      if (matcher(v)) {
        typeMatches.set(type, (typeMatches.get(type) ?? 0) + 1);
      }
    }
  }

  return Object.freeze({
    nonNullCount,
    nullCount,
    uniqueValues,
    samples: Array.from(samplesSet),
    typeMatches,
  });
}

function selectBestType(
  stats: ColumnStats
): { readonly type: InferredType; readonly confidence: number } {
  if (stats.nonNullCount === 0) {
    return { type: 'unknown', confidence: 0 };
  }

  // Highest-precision types are checked first. Email, datetime, date,
  // currency, phone all exclude later types so the order in TYPE_MATCHERS
  // matters: precise → broad.
  //
  // For each candidate type, the score is matches / nonNullCount. We accept
  // the highest-scoring candidate where score >= 0.7. Boolean has a higher
  // bar (0.95) because most short strings spuriously match.
  let best: { readonly type: InferredType; readonly confidence: number } = {
    type: 'string',
    confidence: 0.5,
  };

  for (const [type] of TYPE_MATCHERS) {
    const matches = stats.typeMatches.get(type) ?? 0;
    const score = matches / stats.nonNullCount;
    const threshold = type === 'boolean' ? 0.95 : 0.7;
    if (score >= threshold && score > best.confidence) {
      // Special-case: integer matches also match decimal — prefer integer
      // if the integer score is comparable.
      if (type === 'decimal') {
        const intMatches = stats.typeMatches.get('integer') ?? 0;
        if (intMatches / stats.nonNullCount >= threshold) continue;
      }
      best = { type, confidence: score };
    }
  }

  if (best.type === 'string') {
    // Fall back: if everything looked like a free string, confidence is
    // proportional to non-nullness. Still cap at 0.6 — a free string column
    // is genuinely low information.
    const conf = Math.min(0.6, stats.nonNullCount / (stats.nonNullCount + stats.nullCount));
    return { type: 'string', confidence: conf };
  }
  return best;
}

const DEDUP_HINT_HEADERS = new Set([
  'id',
  'reference',
  'ref',
  'code',
  'sku',
  'pin',
  'tin',
  'national_id',
  'national id',
  'email',
  'lease_ref',
  'employee_ref',
  'employee_id',
  'tenant_ref',
  'tenant_id',
  'property_ref',
  'property_id',
]);

function isHeaderDedupHint(header: string): boolean {
  return DEDUP_HINT_HEADERS.has(header.trim().toLowerCase());
}

export function inferSchema(table: ParsedTable): InferredSchema {
  const columns: InferredColumn[] = [];
  const dedupCandidates: string[] = [];

  for (let colIdx = 0; colIdx < table.headers.length; colIdx += 1) {
    const header = table.headers[colIdx] ?? `column_${colIdx + 1}`;
    const values: string[] = [];
    for (const row of table.rows) {
      values.push(row[colIdx] ?? '');
    }

    const stats = computeColumnStats(values);
    const totalRows = stats.nonNullCount + stats.nullCount;
    const nullability = totalRows === 0 ? 0 : stats.nullCount / totalRows;
    const { type, confidence } = selectBestType(stats);
    const isUnique =
      stats.nonNullCount > 0 && stats.uniqueValues.size === stats.nonNullCount;
    const isPkCandidate =
      isUnique && nullability < 0.05 && stats.nonNullCount >= Math.min(3, totalRows);

    if (isPkCandidate || (isUnique && isHeaderDedupHint(header))) {
      dedupCandidates.push(header);
    }

    columns.push(
      Object.freeze({
        name: header,
        type,
        type_confidence: Number(confidence.toFixed(3)),
        samples: stats.samples,
        nullability: Number(nullability.toFixed(3)),
        primary_key_candidate: isPkCandidate,
      })
    );
  }

  return Object.freeze({
    rowCount: table.rows.length,
    columns,
    dedup_key_candidates: dedupCandidates,
    source_format: table.source_format,
    schema_version: SCHEMA_VERSION,
  });
}
