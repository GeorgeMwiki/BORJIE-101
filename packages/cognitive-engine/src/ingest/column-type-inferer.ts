/**
 * Column-type inferer — Discipline 6, post-parse typing.
 *
 * Given a header + raw row values, infers a `ColumnSpec` per column.
 * Deterministic — no LLM. Type precedence: boolean > integer > number >
 * date > datetime > currency > string. PII flag is set if ANY sample
 * value matches the PII redactor patterns.
 *
 * @module @borjie/cognitive-engine/ingest/column-type-inferer
 */

import type { ColumnSpec } from '../types.js';
import { redactPii } from './pii-redactor.js';

const BOOLEAN_TOKENS = new Set(['true', 'false', 'yes', 'no', '1', '0']);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const CURRENCY_PREFIX_RE = /^(USD|TZS|KES|\$|TSh|KSh)\s*[-]?\d/i;
const INTEGER_RE = /^[-+]?\d+$/;
const NUMBER_RE = /^[-+]?\d+([.,]\d+)?$/;

export function inferColumnSpec(
  name: string,
  values: ReadonlyArray<unknown>,
): ColumnSpec {
  const stringified = values
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter((v) => v.length > 0);
  const nullable = stringified.length < values.length;
  if (stringified.length === 0) {
    return {
      name,
      inferred_type: 'unknown',
      nullable: true,
      is_pii: false,
    };
  }

  const sampleValues = stringified.slice(0, 5);
  const isPii = sampleValues.some((v) => {
    const { redactions } = redactPii(v);
    return redactions.length > 0;
  });

  const type = pickType(stringified);
  return {
    name,
    inferred_type: type,
    nullable,
    sample_values: sampleValues,
    is_pii: isPii,
  };
}

function pickType(values: ReadonlyArray<string>): ColumnSpec['inferred_type'] {
  if (values.every((v) => BOOLEAN_TOKENS.has(v.toLowerCase()))) return 'boolean';
  if (values.every((v) => INTEGER_RE.test(v))) return 'integer';
  if (values.every((v) => NUMBER_RE.test(v))) return 'number';
  if (values.every((v) => ISO_DATE_RE.test(v))) return 'date';
  if (values.every((v) => ISO_DATETIME_RE.test(v))) return 'datetime';
  if (values.every((v) => CURRENCY_PREFIX_RE.test(v))) return 'currency';
  return 'string';
}

export function inferAllColumns(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): ReadonlyArray<ColumnSpec> {
  return headers.map((h, i) => {
    const column = rows.map((r) => r[i]);
    return inferColumnSpec(h, column);
  });
}
