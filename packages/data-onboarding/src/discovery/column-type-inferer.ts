/**
 * Stage 2.b — Column-type inference.
 *
 * Regex-driven heuristics for the closed `InferredType` taxonomy. The
 * inference is intentionally conservative — borderline values fall
 * back to `'string'`, and the caller can layer LLM-driven re-typing
 * upstream when needed.
 *
 * Pure functions — no I/O. Detects (in priority order): boolean,
 * NIDA, TIN, phone, email, url, coordinate, datetime, date, number,
 * enum, string. Returns the dominant type for the column plus
 * cardinality + nullability.
 */

import type {
  Cardinality,
  DiscoveredColumn,
  InferredType,
} from '../types.js';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const BOOLEAN_RE = /^(?:true|false|yes|no|y|n|0|1)$/i;
// TZ NIDA: 20 digits, often with dashes — 19990321-12345-67890-12.
const NIDA_RE = /^\d{8}[-]?\d{5}[-]?\d{5}[-]?\d{2}$/;
// TZ TIN: 9-digit taxpayer id (typical pattern; spec allows flex).
const TIN_RE = /^\d{3}[-]?\d{3}[-]?\d{3}$/;
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
// "lat, lng" or "lat lng" with each in -90..90 / -180..180.
const COORDINATE_RE =
  /^[+-]?\d+(?:\.\d+)?\s*[,\s]\s*[+-]?\d+(?:\.\d+)?$/;
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2})?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;
const DATE_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4})$/;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// ---------------------------------------------------------------------------
// Per-cell classifier
// ---------------------------------------------------------------------------

function classifyCell(raw: string): InferredType | 'null' {
  const v = raw.trim();
  if (v.length === 0) return 'null';
  if (BOOLEAN_RE.test(v)) return 'boolean';
  if (NIDA_RE.test(v.replace(/\s/g, ''))) return 'nida';
  if (TIN_RE.test(v)) return 'tin';
  if (EMAIL_RE.test(v)) return 'email';
  if (URL_RE.test(v)) return 'url';
  if (COORDINATE_RE.test(v)) return 'coordinate';
  if (DATETIME_RE.test(v)) return 'datetime';
  if (DATE_RE.test(v)) return 'date';
  if (PHONE_RE.test(v) && /\d{7,}/.test(v.replace(/\D/g, ''))) return 'phone';
  if (NUMBER_RE.test(v)) return 'number';
  return 'string';
}

// ---------------------------------------------------------------------------
// Column-level inference
// ---------------------------------------------------------------------------

const PRIORITY: ReadonlyArray<InferredType> = Object.freeze([
  'nida',
  'tin',
  'email',
  'url',
  'coordinate',
  'datetime',
  'date',
  'phone',
  'number',
  'boolean',
  'enum',
  'string',
]);

interface ColumnInferenceInput {
  readonly name: string;
  readonly values: ReadonlyArray<string>;
}

function dedupeOrderPreserving<T>(arr: ReadonlyArray<T>): ReadonlyArray<T> {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return Object.freeze(out);
}

export function inferColumn(input: ColumnInferenceInput): DiscoveredColumn {
  const total = input.values.length;
  if (total === 0) {
    return Object.freeze({
      name: input.name,
      inferred_type: 'string' as const,
      cardinality: 'unknown' as Cardinality,
      nullability: 0,
      sample_values: Object.freeze([] as ReadonlyArray<unknown>),
    });
  }

  const tally = new Map<InferredType | 'null', number>();
  for (const cell of input.values) {
    const kind = classifyCell(cell);
    tally.set(kind, (tally.get(kind) ?? 0) + 1);
  }

  const null_count = tally.get('null') ?? 0;
  const non_null = total - null_count;
  const nullability = total === 0 ? 0 : Number((null_count / total).toFixed(2));

  let inferred: InferredType = 'string';
  if (non_null > 0) {
    let best = -1;
    for (const candidate of PRIORITY) {
      const count = tally.get(candidate) ?? 0;
      const share = count / non_null;
      if (share >= 0.8 && count > best) {
        best = count;
        inferred = candidate;
      }
    }
  }

  const non_null_values = input.values
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const unique = new Set(non_null_values);
  let cardinality: Cardinality = 'unknown';
  if (non_null === 0) {
    cardinality = 'unknown';
  } else if (unique.size === non_null) {
    cardinality = 'unique';
  } else if (unique.size / non_null > 0.5) {
    cardinality = 'high';
  } else {
    cardinality = 'low';
  }

  let enum_values: ReadonlyArray<string> | undefined;
  if (cardinality === 'low' && unique.size <= 12 && unique.size >= 2) {
    inferred = inferred === 'string' ? 'enum' : inferred;
    enum_values = dedupeOrderPreserving(non_null_values).slice(0, 12);
  }

  const sample_values = dedupeOrderPreserving(non_null_values).slice(0, 8);

  const base: Omit<DiscoveredColumn, 'enum_values'> = {
    name: input.name,
    inferred_type: inferred,
    cardinality,
    nullability,
    sample_values,
  };

  if (enum_values !== undefined) {
    return Object.freeze({ ...base, enum_values });
  }
  return Object.freeze(base);
}

export const __TEST_ONLY = Object.freeze({
  classifyCell,
  PRIORITY,
});
