/**
 * Spec validator.
 *
 * ON_DEMAND_INTERNAL_SOFTWARE_SPEC §3: every generated tool spec must
 * conform to the shape contract before it can be persisted. The
 * generator emits a candidate; this validator enforces:
 *
 *   - non-empty title + unique non-empty field names
 *   - handler descriptor: at least one read source; if it has writes,
 *     the audit hook must be enabled
 *   - archetype must be one of the five recognised names
 *   - audit hook must be enabled when handler.writesSources is non-empty
 *
 * Returns a discriminated union for ergonomic call-site handling.
 */

import { z } from 'zod';
import type {
  DashboardArchetypeName,
  ToolFormField,
  ToolSpec,
} from '../types.js';

const ARCHETYPE_NAMES: ReadonlyArray<DashboardArchetypeName> = [
  'kpi-grid',
  'time-series-chart',
  'table',
  'detail-card',
  'list-with-detail',
];

const FieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/i, 'field name must be a snake-case identifier'),
  label: z.string().min(1),
  kind: z.enum(['text', 'number', 'date', 'select', 'boolean']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const FormSchema = z.object({
  title: z.string().min(1),
  fields: z.array(FieldSchema).min(1),
});

const HandlerSchema = z.object({
  handlerId: z.string().min(1),
  readsFields: z.array(z.string()),
  readsSources: z.array(z.string()).min(1, 'handler must read at least one source'),
  writesSources: z.array(z.string()),
});

const AuditHookSchema = z.object({
  enabled: z.boolean(),
  redactFields: z.array(z.string()),
});

const ToolSpecSchema = z.object({
  form: FormSchema,
  handler: HandlerSchema,
  archetype: z.enum([
    'kpi-grid',
    'time-series-chart',
    'table',
    'detail-card',
    'list-with-detail',
  ]),
  auditHook: AuditHookSchema,
});

type ParsedSpec = z.infer<typeof ToolSpecSchema>;
type ParsedField = z.infer<typeof FieldSchema>;

export type SpecValidationResult =
  | { readonly ok: true; readonly spec: ToolSpec }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/**
 * Validate a raw spec against the shape contract. Errors are
 * accumulated; the function returns all problems, not just the first.
 */
export function validateToolSpec(input: unknown): SpecValidationResult {
  const parsed = ToolSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '<root>'}: ${i.message}`,
      ),
    };
  }
  const data = parsed.data;
  const extra = extraInvariants(data);
  if (extra.length > 0) {
    return { ok: false, errors: extra };
  }
  const spec = freezeSpec(data);
  return { ok: true, spec };
}

/** Convenience: throw on invalid spec. */
export function assertValidToolSpec(input: unknown): ToolSpec {
  const result = validateToolSpec(input);
  if (!result.ok) {
    throw new Error(`Invalid tool spec: ${result.errors.join('; ')}`);
  }
  return result.spec;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function freezeSpec(data: ParsedSpec): ToolSpec {
  return Object.freeze({
    form: Object.freeze({
      title: data.form.title,
      fields: Object.freeze(
        data.form.fields.map((f) => Object.freeze(toToolFormField(f))),
      ),
    }),
    handler: Object.freeze({
      handlerId: data.handler.handlerId,
      readsFields: Object.freeze([...data.handler.readsFields]),
      readsSources: Object.freeze([...data.handler.readsSources]),
      writesSources: Object.freeze([...data.handler.writesSources]),
    }),
    archetype: data.archetype as DashboardArchetypeName,
    auditHook: Object.freeze({
      enabled: data.auditHook.enabled,
      redactFields: Object.freeze([...data.auditHook.redactFields]),
    }),
  });
}

function toToolFormField(field: ParsedField): ToolFormField {
  if (field.options !== undefined) {
    return {
      name: field.name,
      label: field.label,
      kind: field.kind,
      required: field.required,
      options: Object.freeze([...field.options]),
    };
  }
  return {
    name: field.name,
    label: field.label,
    kind: field.kind,
    required: field.required,
  };
}

function extraInvariants(spec: ParsedSpec): ReadonlyArray<string> {
  const errors: string[] = [];

  // Unique field names.
  const names = spec.form.fields.map((f) => f.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    errors.push(`form.fields: duplicate field names ${[...new Set(dupes)].join(', ')}`);
  }

  // Select fields must have options.
  for (const f of spec.form.fields) {
    if (f.kind === 'select' && (f.options === undefined || f.options.length === 0)) {
      errors.push(`form.fields.${f.name}: select fields must declare options[]`);
    }
  }

  // Archetype must be in our enum (Zod already covers — defensive).
  if (!ARCHETYPE_NAMES.includes(spec.archetype as DashboardArchetypeName)) {
    errors.push(`archetype: unknown archetype "${spec.archetype}"`);
  }

  // If handler writes, audit hook MUST be enabled.
  if (spec.handler.writesSources.length > 0 && !spec.auditHook.enabled) {
    errors.push(
      'auditHook.enabled: must be true when handler.writesSources is non-empty',
    );
  }

  // handler.readsFields must reference real field names.
  for (const fieldName of spec.handler.readsFields) {
    if (!names.includes(fieldName)) {
      errors.push(
        `handler.readsFields: references unknown form field "${fieldName}"`,
      );
    }
  }

  return errors;
}
