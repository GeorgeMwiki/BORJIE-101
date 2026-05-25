/**
 * Heuristic coaching rules — no LLM required. Run synchronously on
 * every keystroke (well, every debounced tick), produce a small bundle
 * of hints. These fire whether or not a brain is wired.
 */
import { createHash } from 'crypto';
import type {
  CoachingHint,
  CoachingSchema,
  CoachingSchemaField,
  CoachingSeverity,
} from '../types.js';

function hintId(field: string, severity: CoachingSeverity, reason: string): string {
  return createHash('sha1')
    .update(`${field}|${severity}|${reason}`)
    .digest('hex')
    .slice(0, 12);
}

function isMissing(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string' && value.trim().length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function checkRequired(
  field: CoachingSchemaField,
  value: unknown,
): CoachingHint | null {
  if (!field.required || !isMissing(value)) return null;
  const label = field.label ?? field.name;
  return {
    id: hintId(field.name, 'warn', 'missing_required'),
    field: field.name,
    severity: 'warn',
    message: `${label} is required.`,
    confidence: 1,
    suggestion: `Provide a value for ${label}.`,
    reason: 'missing_required',
  };
}

function checkRange(
  field: CoachingSchemaField,
  value: unknown,
): CoachingHint | null {
  if (field.type !== 'number' || !field.expectedRange) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const { min, max } = field.expectedRange;
  if (typeof min === 'number' && value < min) {
    return {
      id: hintId(field.name, 'warn', 'below_range'),
      field: field.name,
      severity: 'warn',
      message: `${field.label ?? field.name} (${value}) is below expected minimum (${min}).`,
      confidence: 0.9,
      suggestion: `Did you mean a value >= ${min}?`,
      reason: 'below_range',
    };
  }
  if (typeof max === 'number' && value > max) {
    return {
      id: hintId(field.name, 'warn', 'above_range'),
      field: field.name,
      severity: 'warn',
      message: `${field.label ?? field.name} (${value}) is above expected maximum (${max}).`,
      confidence: 0.9,
      suggestion: `Did you mean a value <= ${max}?`,
      reason: 'above_range',
    };
  }
  return null;
}

function checkEnum(
  field: CoachingSchemaField,
  value: unknown,
): CoachingHint | null {
  if (!field.allowedValues || field.allowedValues.length === 0) return null;
  if (value == null) return null;
  const str = typeof value === 'string' ? value : String(value);
  if (field.allowedValues.includes(str)) return null;
  return {
    id: hintId(field.name, 'block', 'bad_enum'),
    field: field.name,
    severity: 'block',
    message: `${field.label ?? field.name} must be one of ${field.allowedValues.join(', ')}.`,
    confidence: 1,
    suggestion: `Pick from: ${field.allowedValues.join(', ')}`,
    reason: 'bad_enum',
  };
}

function checkTypeShape(
  field: CoachingSchemaField,
  value: unknown,
): CoachingHint | null {
  if (value == null) return null;
  let bad = false;
  switch (field.type) {
    case 'number':
      bad = typeof value !== 'number' || Number.isNaN(value);
      break;
    case 'string':
      bad = typeof value !== 'string';
      break;
    case 'boolean':
      bad = typeof value !== 'boolean';
      break;
    case 'date':
      bad = !(typeof value === 'string' && !Number.isNaN(Date.parse(value)));
      break;
    case 'enum':
      // handled by checkEnum
      return null;
    case 'json':
      return null;
  }
  if (!bad) return null;
  return {
    id: hintId(field.name, 'block', 'wrong_type'),
    field: field.name,
    severity: 'block',
    message: `${field.label ?? field.name} should be a ${field.type}.`,
    confidence: 1,
    suggestion: `Provide a ${field.type} value.`,
    reason: 'wrong_type',
  };
}

export interface HeuristicCoachArgs {
  readonly workInProgress: Readonly<Record<string, unknown>>;
  readonly schema: CoachingSchema;
}

/**
 * Run the heuristic rule bundle on every field in the schema. Returns
 * deduplicated hints (by id) so re-running on identical input produces
 * the same set of hints with the same React keys.
 */
export function heuristicCoach(args: HeuristicCoachArgs): ReadonlyArray<CoachingHint> {
  const seen = new Set<string>();
  const out: CoachingHint[] = [];
  for (const field of args.schema.fields) {
    const value = args.workInProgress[field.name];
    const candidates: Array<CoachingHint | null> = [
      checkRequired(field, value),
      checkTypeShape(field, value),
      checkRange(field, value),
      checkEnum(field, value),
    ];
    for (const c of candidates) {
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  return out;
}
