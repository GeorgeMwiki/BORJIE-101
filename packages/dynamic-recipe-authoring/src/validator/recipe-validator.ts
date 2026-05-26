/**
 * Recipe validator — Wave 18M.
 *
 * Mirrors the Wave 18B (`@borjie/dynamic-ui`) and Wave 18C
 * (`@borjie/document-templates`) contracts in zod so an LLM-authored
 * spec must satisfy the SAME shape contract a hand-written recipe
 * would. Returns a discriminated-union result; errors are
 * accumulated rather than throw so the caller UI can surface every
 * problem at once.
 *
 * Pure functions. No I/O. Deterministic.
 *
 * @module @borjie/dynamic-recipe-authoring/validator/recipe-validator
 */

import { z } from 'zod';
import type { RecipeKind } from '../types.js';

// ---------------------------------------------------------------------------
// Per-kind schemas
// ---------------------------------------------------------------------------

const CitationContractSchema = z.object({
  rule: z.string().min(1),
  citation_id: z.string().min(1),
});

const FieldKindEnum = z.enum([
  'text',
  'number',
  'date',
  'enum',
  'currency',
  'phone',
  'multiline',
  'file',
]);

const FieldSchema = z.object({
  id: z.string().min(1),
  kind: FieldKindEnum,
  label_en: z.string().min(1),
  label_sw: z.string().min(1),
  required: z.boolean(),
  required_because: CitationContractSchema.optional(),
});

const FieldGroupSchema = z.object({
  id: z.string().min(1),
  title_en: z.string().min(1),
  title_sw: z.string().min(1),
  fields: z.array(FieldSchema).min(1),
});

const ActionRefSchema = z.object({
  form_id: z.string().min(1),
  url: z
    .string()
    .min(1)
    .regex(
      /^(https?:\/\/[^\s]+)?\/api\/gateway\/forms\/[a-z0-9-]+$/i,
      'submit_action.url must match /api/gateway/forms/<form_id>',
    ),
  method: z.literal('POST'),
});

const FormSchemaSchema = z.object({
  title_en: z.string().min(1),
  title_sw: z.string().min(1),
  groups: z.array(FieldGroupSchema).min(1),
  submit_action: ActionRefSchema,
  evidence_ids: z.array(z.string().min(1)),
});

const TabRecipeSchema = z.object({
  id: z.string().min(1),
  intent: z.string().min(1),
  version: z.number().int().min(1),
  status: z.enum(['draft', 'shadow', 'live', 'locked', 'deprecated']),
  telemetry_key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'telemetry_key must be snake_case'),
  brand: z.literal('borjie'),
  authority_tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  form: FormSchemaSchema,
});

const DOCUMENT_CLASSES = [
  'daily_briefing',
  'board_report',
  'investor_briefing',
  'tumemadini_return',
  'nemc_filing',
  'buyer_kyb_pack',
  'sop',
  'financial_model',
  'contract',
  'geological_report',
  'marketplace_listing',
] as const;

const DOCUMENT_FORMATS = [
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'md',
  'html',
] as const;

const InputContractSchema = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean(),
});

const DocCitationContractSchema = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  minCount: z.number().int().nonnegative(),
});

const DocRecipeSchema = z.object({
  id: z.string().min(1),
  class: z.enum(DOCUMENT_CLASSES),
  version: z.number().int().min(1),
  status: z.enum(['draft', 'shadow', 'live', 'locked', 'deprecated']),
  authority_tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  brand: z.literal('borjie'),
  approval_required: z.boolean(),
  output_formats: z.array(z.enum(DOCUMENT_FORMATS)).min(1),
  required_inputs: z.array(InputContractSchema),
  required_citations: z.array(DocCitationContractSchema),
});

// `media | campaign | tool` are scaffolded shapes for v1; deeper
// invariants follow in subsequent waves. We enforce kind + brand here
// so a malformed payload is rejected at the package boundary.
const ShapeOnlySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  status: z.enum(['draft', 'shadow', 'live', 'locked', 'deprecated']),
  brand: z.literal('borjie'),
});

// ---------------------------------------------------------------------------
// Result + entry point
// ---------------------------------------------------------------------------

export type RecipeValidationResult =
  | {
      readonly ok: true;
      readonly spec: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

export function validateRecipe(
  kind: RecipeKind,
  input: unknown,
): RecipeValidationResult {
  switch (kind) {
    case 'tab':
      return validateTabRecipe(input);
    case 'doc':
      return validateDocRecipe(input);
    case 'media':
    case 'campaign':
    case 'tool':
      return validateShapeOnly(input, kind);
  }
}

// ---------------------------------------------------------------------------
// Per-kind entry points (also exported for tests / call-site reuse)
// ---------------------------------------------------------------------------

export function validateTabRecipe(input: unknown): RecipeValidationResult {
  const parsed = TabRecipeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: collectIssues(parsed.error.issues) };
  }
  const errors = checkTabInvariants(parsed.data);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, spec: freezeJson(parsed.data) };
}

export function validateDocRecipe(input: unknown): RecipeValidationResult {
  const parsed = DocRecipeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: collectIssues(parsed.error.issues) };
  }
  const errors = checkDocInvariants(parsed.data);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, spec: freezeJson(parsed.data) };
}

function validateShapeOnly(
  input: unknown,
  kind: RecipeKind,
): RecipeValidationResult {
  const parsed = ShapeOnlySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: collectIssues(parsed.error.issues) };
  }
  // Tag with the requested kind so persisted shape-only recipes
  // carry the discriminator the runtime will use to route them.
  const tagged = { ...parsed.data, kind };
  return { ok: true, spec: freezeJson(tagged) };
}

// ---------------------------------------------------------------------------
// Invariants beyond zod
// ---------------------------------------------------------------------------

type ParsedTab = z.infer<typeof TabRecipeSchema>;
type ParsedDoc = z.infer<typeof DocRecipeSchema>;

function checkTabInvariants(spec: ParsedTab): ReadonlyArray<string> {
  const errors: string[] = [];

  // Brand is locked. Zod literal already catches this — defensive.
  if (spec.brand !== 'borjie') {
    errors.push(`brand: must be the literal "borjie"`);
  }

  // Authority tier is 0|1|2.
  if (![0, 1, 2].includes(spec.authority_tier)) {
    errors.push(
      `authority_tier: must be 0, 1, or 2 (got ${String(spec.authority_tier)})`,
    );
  }

  // Field group ids unique.
  const groupIds = spec.form.groups.map((g) => g.id);
  const dupeGroups = groupIds.filter((id, i) => groupIds.indexOf(id) !== i);
  if (dupeGroups.length > 0) {
    errors.push(
      `form.groups: duplicate group ids ${[...new Set(dupeGroups)].join(', ')}`,
    );
  }

  // Required fields with regulatory provenance MUST carry
  // required_because. Heuristic: a field is regulatory-required when
  // the field id includes 'regulatory', 'tumemadini', 'nemc', or
  // 'tax'. The validator surfaces a violation if such a field is
  // required but has no citation.
  for (const group of spec.form.groups) {
    for (const field of group.fields) {
      if (!field.required) continue;
      if (isRegulatoryField(field.id) && field.required_because === undefined) {
        errors.push(
          `form.groups.${group.id}.fields.${field.id}: required regulatory field is missing required_because`,
        );
      }
    }
  }

  // Field ids unique within a group.
  for (const group of spec.form.groups) {
    const fieldIds = group.fields.map((f) => f.id);
    const dupeFields = fieldIds.filter((id, i) => fieldIds.indexOf(id) !== i);
    if (dupeFields.length > 0) {
      errors.push(
        `form.groups.${group.id}.fields: duplicate field ids ${[
          ...new Set(dupeFields),
        ].join(', ')}`,
      );
    }
  }

  // evidence_ids covers every citation referenced.
  const referenced = new Set<string>();
  for (const group of spec.form.groups) {
    for (const field of group.fields) {
      if (field.required_because !== undefined) {
        referenced.add(field.required_because.citation_id);
      }
    }
  }
  const declared = new Set(spec.form.evidence_ids);
  for (const id of referenced) {
    if (!declared.has(id)) {
      errors.push(
        `form.evidence_ids: missing referenced citation_id "${id}"`,
      );
    }
  }

  return errors;
}

function checkDocInvariants(spec: ParsedDoc): ReadonlyArray<string> {
  const errors: string[] = [];

  if (spec.brand !== 'borjie') {
    errors.push(`brand: must be the literal "borjie"`);
  }

  // Tier-2 docs must require approval.
  if (spec.authority_tier === 2 && !spec.approval_required) {
    errors.push(
      'approval_required: must be true when authority_tier === 2',
    );
  }

  // Unique input + citation keys.
  const inputKeys = spec.required_inputs.map((i) => i.key);
  const dupeInputs = inputKeys.filter((k, i) => inputKeys.indexOf(k) !== i);
  if (dupeInputs.length > 0) {
    errors.push(
      `required_inputs: duplicate keys ${[...new Set(dupeInputs)].join(', ')}`,
    );
  }

  const citationKeys = spec.required_citations.map((c) => c.key);
  const dupeCitations = citationKeys.filter(
    (k, i) => citationKeys.indexOf(k) !== i,
  );
  if (dupeCitations.length > 0) {
    errors.push(
      `required_citations: duplicate keys ${[
        ...new Set(dupeCitations),
      ].join(', ')}`,
    );
  }

  // Output formats unique.
  const fmtCounts = new Map<string, number>();
  for (const f of spec.output_formats) {
    fmtCounts.set(f, (fmtCounts.get(f) ?? 0) + 1);
  }
  const dupeFormats: string[] = [];
  for (const [k, v] of fmtCounts) {
    if (v > 1) dupeFormats.push(k);
  }
  if (dupeFormats.length > 0) {
    errors.push(
      `output_formats: duplicate entries ${dupeFormats.join(', ')}`,
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectIssues(issues: ReadonlyArray<z.ZodIssue>): ReadonlyArray<string> {
  return issues.map((i) => {
    const path = i.path.length === 0 ? '<root>' : i.path.join('.');
    return `${path}: ${i.message}`;
  });
}

function isRegulatoryField(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes('regulatory') ||
    lower.includes('tumemadini') ||
    lower.includes('nemc') ||
    lower.includes('tax')
  );
}

function freezeJson(input: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze(JSON.parse(JSON.stringify(input)) as Record<string, unknown>);
}
