/**
 * Record validator — builds a payload validator GENERICALLY from a tab's own
 * `PortalTabField[]`.
 *
 * A generated tab is render-only until it can COLLECT records. The records it
 * accepts are not a hand-written schema — they are derived, field by field,
 * from the tab the LLM minted: a `required` field must be present, a `dropdown`
 * value must be one of its options, a `number` must honour its min/max, and so
 * on. Every one of those per-field rules already lives in the field-kind
 * registry (`../fields/registry.ts` — `buildFieldValueValidator`), so this
 * module COMPOSES those per-field validators into one object validator rather
 * than re-implementing kind logic (no per-case handler).
 *
 * The validator is `.strip()`-style strict-by-omission: unknown keys are
 * rejected so a caller cannot smuggle columns the tab never declared. Read-only
 * fields are NOT writable by the submitter — their value comes from the system,
 * so they are dropped from the writable validator.
 *
 * Pure — no I/O. Exported standalone so the store + the tests can reuse it.
 */

import { z } from 'zod';
import { buildFieldValueValidator } from '../fields/registry.js';
import { collectTabFields, type PortalTab, type PortalTabField } from '../types.js';

// ────────────────────────────────────────────────────────────────────
// Result types
// ────────────────────────────────────────────────────────────────────

export interface RecordValidationFailure {
  readonly ok: false;
  /** The field keys that failed validation (deduped, stable order). */
  readonly invalidFieldKeys: ReadonlyArray<string>;
  /** Human-readable per-field messages (key → first message). */
  readonly issues: Readonly<Record<string, string>>;
}

export interface RecordValidationSuccess {
  readonly ok: true;
  /** The validated, stripped payload (only declared writable fields). */
  readonly payload: Record<string, unknown>;
}

export type RecordValidationResult =
  | RecordValidationSuccess
  | RecordValidationFailure;

// ────────────────────────────────────────────────────────────────────
// Validator construction
// ────────────────────────────────────────────────────────────────────

/** The fields a submitter may write — everything except read-only fields. */
function writableFields(
  fields: ReadonlyArray<PortalTabField>,
): ReadonlyArray<PortalTabField> {
  return fields.filter((field) => field.readonly !== true);
}

/**
 * Build a zod object validator for a record from a tab's writable fields. Each
 * field's per-kind validator (required / options / min-max / format) is taken
 * verbatim from the field-kind registry. Unknown keys are rejected (`.strict()`)
 * so the payload can never exceed the tab's declared shape.
 */
export function buildRecordValidator(
  fields: ReadonlyArray<PortalTabField>,
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of writableFields(fields)) {
    shape[field.key] = buildFieldValueValidator(field);
  }
  return z.object(shape).strict();
}

/**
 * Validate a record payload against a tab's writable fields. On success returns
 * the stripped payload; on failure returns the failing field keys + per-field
 * messages (so the API can answer 422 with the exact offending keys).
 */
export function validateRecordPayload(
  fields: ReadonlyArray<PortalTabField>,
  payload: unknown,
): RecordValidationResult {
  const validator = buildRecordValidator(fields);
  const result = validator.safeParse(payload);
  if (result.success) {
    return { ok: true, payload: result.data as Record<string, unknown> };
  }

  const invalidFieldKeys: string[] = [];
  const issues: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_root';
    if (!invalidFieldKeys.includes(key)) invalidFieldKeys.push(key);
    if (!(key in issues)) issues[key] = issue.message;
  }
  return { ok: false, invalidFieldKeys, issues };
}

/**
 * Validate a record payload against a whole tab (flattening its sections to the
 * canonical field list). Convenience wrapper used by the store + router.
 */
export function validateRecordAgainstTab(
  tab: Pick<PortalTab, 'sections'>,
  payload: unknown,
): RecordValidationResult {
  return validateRecordPayload(collectTabFields(tab), payload);
}
