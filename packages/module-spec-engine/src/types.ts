/**
 * Module spec DSL — the LOCKED grammar an LLM may emit when authoring
 * a new module. NO raw SQL / JSX / DDL ever appears here.
 *
 * The grammar:
 *
 *   ModuleSpec = {
 *     entities:    EntityDecl[]
 *     workflows:   WorkflowDecl[]
 *     ui_sections: UiSectionDecl[]
 *   }
 *
 *   EntityDecl = {
 *     slug:               string  (snake_case, max 48)
 *     display_name_en:    string
 *     display_name_sw?:   string
 *     fields:             FieldDecl[]
 *   }
 *
 *   FieldDecl kinds:
 *     text     { name, kind:'text',     required, max_length?, index?, default? }
 *     int      { name, kind:'int',      required, min?, max?, index?, default? }
 *     numeric  { name, kind:'numeric',  required, precision?, scale?, min?, max? }
 *     money    { name, kind:'money',    required, currency_field? }
 *     date     { name, kind:'date',     required, default? }
 *     datetime { name, kind:'datetime', required, default? }
 *     boolean  { name, kind:'boolean',  required, default? }
 *     fk       { name, kind:'fk',       required, references:string }
 *     enum     { name, kind:'enum',     required, values:string[] }
 *
 *   WorkflowDecl = {
 *     slug:           string
 *     title:          string
 *     trigger_entity: string  (must match an entity.slug or be a built-in)
 *     trigger_event:  'create'|'update'|'delete'|'time'|'manual'|'payment'|'bulk_update'
 *     steps:          string[]  (slugs of canonical step functions)
 *   }
 *
 *   UiSectionDecl kinds:
 *     table    { kind:'table',    entity:string, columns:string[] }
 *     form     { kind:'form',     entity:string }
 *     kpi_tile { kind:'kpi_tile', title:string,  query:string }
 *
 * Grammar enforcement is the FIRST defence against prompt-injection:
 * field names are restricted to `^[a-z][a-z0-9_]{0,47}$`, enum values
 * to `^[a-z0-9_]{1,32}$`, and total field count per entity is capped
 * at 64.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Constants — caps that bound the LLM output.
// ─────────────────────────────────────────────────────────────────────

export const MAX_ENTITIES_PER_SPEC = 24;
export const MAX_WORKFLOWS_PER_SPEC = 32;
export const MAX_UI_SECTIONS_PER_SPEC = 32;
export const MAX_FIELDS_PER_ENTITY = 64;
export const MAX_ENUM_VALUES = 32;
export const MAX_WORKFLOW_STEPS = 12;

/**
 * Field/entity/workflow slugs. Snake_case, ASCII letters / digits /
 * underscores only; must start with a letter. The leading-letter
 * requirement neutralises SQL injection via `;DROP TABLE` (no `;`
 * permitted) and prevents reserved-word collisions (no leading digit).
 */
export const SLUG_REGEX = /^[a-z][a-z0-9_]{0,47}$/;

/** Enum values are stricter: lowercase, digits, underscores, max 32. */
export const ENUM_VALUE_REGEX = /^[a-z0-9_]{1,32}$/;

// ─────────────────────────────────────────────────────────────────────
// Field kinds — discriminated union, each branch its own Zod schema.
// ─────────────────────────────────────────────────────────────────────

export const FIELD_KINDS = [
  'text',
  'int',
  'numeric',
  'money',
  'date',
  'datetime',
  'boolean',
  'fk',
  'enum',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

const SlugSchema = z
  .string()
  .regex(SLUG_REGEX, 'slug must match ^[a-z][a-z0-9_]{0,47}$');

const TextField = z.object({
  name: SlugSchema,
  kind: z.literal('text'),
  required: z.boolean(),
  max_length: z.number().int().min(1).max(8192).optional(),
  index: z.boolean().optional(),
  default: z.string().optional(),
});

const IntField = z.object({
  name: SlugSchema,
  kind: z.literal('int'),
  required: z.boolean(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  index: z.boolean().optional(),
  default: z.number().int().optional(),
});

const NumericField = z.object({
  name: SlugSchema,
  kind: z.literal('numeric'),
  required: z.boolean(),
  precision: z.number().int().min(1).max(38).optional(),
  scale: z.number().int().min(0).max(38).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const MoneyField = z.object({
  name: SlugSchema,
  kind: z.literal('money'),
  required: z.boolean(),
  /** 'tenant_default' or a literal ISO-4217 column hint. */
  currency_field: z.string().min(1).max(64).optional(),
});

const DateField = z.object({
  name: SlugSchema,
  kind: z.literal('date'),
  required: z.boolean(),
  default: z.string().optional(),
});

const DatetimeField = z.object({
  name: SlugSchema,
  kind: z.literal('datetime'),
  required: z.boolean(),
  default: z.string().optional(),
});

const BooleanField = z.object({
  name: SlugSchema,
  kind: z.literal('boolean'),
  required: z.boolean(),
  default: z.boolean().optional(),
});

const FkField = z.object({
  name: SlugSchema,
  kind: z.literal('fk'),
  required: z.boolean(),
  /** Slug of the entity this FK references. */
  references: SlugSchema,
});

const EnumField = z.object({
  name: SlugSchema,
  kind: z.literal('enum'),
  required: z.boolean(),
  values: z
    .array(z.string().regex(ENUM_VALUE_REGEX, 'invalid enum value'))
    .min(1)
    .max(MAX_ENUM_VALUES),
});

export const FieldDeclSchema = z.discriminatedUnion('kind', [
  TextField,
  IntField,
  NumericField,
  MoneyField,
  DateField,
  DatetimeField,
  BooleanField,
  FkField,
  EnumField,
]);

export type FieldDecl = z.infer<typeof FieldDeclSchema>;

// ─────────────────────────────────────────────────────────────────────
// Entity decl
// ─────────────────────────────────────────────────────────────────────

export const EntityDeclSchema = z.object({
  slug: SlugSchema,
  display_name_en: z.string().min(1).max(128),
  display_name_sw: z.string().max(128).optional(),
  fields: z.array(FieldDeclSchema).min(1).max(MAX_FIELDS_PER_ENTITY),
});

export type EntityDecl = z.infer<typeof EntityDeclSchema>;

// ─────────────────────────────────────────────────────────────────────
// Workflow decl
// ─────────────────────────────────────────────────────────────────────

export const WORKFLOW_EVENTS = [
  'create',
  'update',
  'delete',
  'time',
  'manual',
  'payment',
  'bulk_update',
] as const;

export const WorkflowDeclSchema = z.object({
  slug: SlugSchema,
  title: z.string().min(1).max(128),
  trigger_entity: SlugSchema,
  trigger_event: z.enum(WORKFLOW_EVENTS),
  steps: z
    .array(SlugSchema)
    .min(1)
    .max(MAX_WORKFLOW_STEPS),
});

export type WorkflowDecl = z.infer<typeof WorkflowDeclSchema>;

// ─────────────────────────────────────────────────────────────────────
// UI section decl
// ─────────────────────────────────────────────────────────────────────

const TableUiSection = z.object({
  kind: z.literal('table'),
  entity: SlugSchema,
  columns: z.array(SlugSchema).min(1).max(32),
});

const FormUiSection = z.object({
  kind: z.literal('form'),
  entity: SlugSchema,
});

const KpiTileUiSection = z.object({
  kind: z.literal('kpi_tile'),
  title: z.string().min(1).max(128),
  /** A canonical KPI query slug; NOT raw SQL. */
  query: z.string().min(1).max(256),
});

export const UiSectionDeclSchema = z.discriminatedUnion('kind', [
  TableUiSection,
  FormUiSection,
  KpiTileUiSection,
]);

export type UiSectionDecl = z.infer<typeof UiSectionDeclSchema>;

// ─────────────────────────────────────────────────────────────────────
// Top-level module spec
// ─────────────────────────────────────────────────────────────────────

export const ModuleSpecSchema = z.object({
  entities: z.array(EntityDeclSchema).min(1).max(MAX_ENTITIES_PER_SPEC),
  workflows: z.array(WorkflowDeclSchema).max(MAX_WORKFLOWS_PER_SPEC),
  ui_sections: z
    .array(UiSectionDeclSchema)
    .max(MAX_UI_SECTIONS_PER_SPEC),
});

export type ModuleSpec = z.infer<typeof ModuleSpecSchema>;

// ─────────────────────────────────────────────────────────────────────
// Compile output
// ─────────────────────────────────────────────────────────────────────

export interface CompileResult {
  readonly ok: boolean;
  readonly migrationSql: string;
  readonly zodValidators: Readonly<Record<string, ZodValidatorTree>>;
  readonly uiLayout: Readonly<{
    sections: ReadonlyArray<{
      readonly kind: 'table' | 'form' | 'kpi_tile';
      readonly entity?: string;
      readonly title?: string;
      readonly columns?: readonly string[];
      readonly query?: string;
    }>;
  }>;
  readonly errors: readonly string[];
}

/**
 * Serialised Zod-schema tree, persisted to module_specs.generated_zod_validators.
 * Reconstructed to a runtime z.object at the module endpoints.
 */
export interface ZodValidatorTree {
  readonly kind: 'object';
  readonly fields: Readonly<Record<string, ZodFieldTree>>;
}

export interface ZodFieldTree {
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly max_length?: number;
  readonly min?: number;
  readonly max?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly references?: string;
  readonly values?: readonly string[];
}
