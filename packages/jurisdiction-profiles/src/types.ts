/**
 * `@borjie/jurisdiction-profiles` — type definitions.
 *
 * Mirror of migration 0055 schema (jurisdiction_profiles,
 * compliance_frameworks, framework_control_mappings,
 * regulator_definitions). All zod schemas inferred to provide
 * runtime validation at seed-load time and at the composition
 * root (apps/api/src/bootstrap/jurisdictions.ts).
 *
 * Spec: Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums + branded primitives
// ---------------------------------------------------------------------------

export const DATA_RESIDENCY_KINDS = [
  'strict-in-country',
  'regional-bloc',
  'unrestricted',
] as const;
export type DataResidencyKind = (typeof DATA_RESIDENCY_KINDS)[number];

export const CONTROL_KINDS = [
  'breach-notification',
  'rtbf',
  'consent',
  'data-residency',
  'dpia',
  'data-minimisation',
  'encryption-at-rest',
  'encryption-in-transit',
  'access-log',
  'audit-trail',
  'cross-border-transfer',
  'data-subject-rights',
  'retention',
  'security-safeguards',
  'sensitive-data-handling',
  'breach-record',
] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const REGULATOR_DOMAINS = [
  'tax',
  'mining',
  'environment',
  'central-bank',
  'data-protection',
  'customs',
  'securities',
  'labour',
  'health',
  'telecommunications',
  'energy',
  'financial-services',
  'competition',
] as const;
export type RegulatorDomain = (typeof REGULATOR_DOMAINS)[number];

// ---------------------------------------------------------------------------
// Quiet hours + address format
// ---------------------------------------------------------------------------

export const QuietHoursSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export const AddressFormatSchema = z.object({
  lines: z.array(z.string()).min(1),
  required: z.array(z.string()).default([]),
  postal_code_pattern: z.string().optional(),
});
export type AddressFormat = z.infer<typeof AddressFormatSchema>;

// ---------------------------------------------------------------------------
// JurisdictionProfile
// ---------------------------------------------------------------------------

export const JurisdictionProfileSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[a-z]{2}(-[a-z]{2,3})?$/),
  iso_country: z.string().length(2).regex(/^[A-Z]{2}$/),
  iso_subdivision: z.string().optional(),
  display_name: z.string().min(1),
  data_protection_laws: z.array(z.string()).min(1),
  data_residency_kind: z.enum(DATA_RESIDENCY_KINDS),
  regional_bloc: z.string().optional(),
  breach_deadline_hours: z.number().int().min(0),
  rtbf_cascade_scope: z.string().min(1),
  currency_code: z.string().length(3).regex(/^[A-Z]{3}$/),
  phone_e164_cc: z.string().regex(/^\d{1,4}$/),
  phone_e164_pattern: z.string().min(1),
  address_format: AddressFormatSchema,
  holiday_calendar_key: z.string().min(1),
  working_week: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  timezone_default: z.string().min(1),
  quiet_hours_default: QuietHoursSchema,
  tax_matrix: z.record(z.string(), z.unknown()).default({}),
  language_pack_codes: z.array(z.string()).min(1),
  vertical_profile_codes: z.array(z.string()).default([]),
  profile_source_url: z.string().url(),
  profile_source_title: z.string().min(1),
  profile_source_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  audit_hash: z.string().min(1),
});
export type JurisdictionProfile = z.infer<typeof JurisdictionProfileSchema>;

// ---------------------------------------------------------------------------
// ComplianceFramework + ArticleRegistry
// ---------------------------------------------------------------------------

export const ArticleEntrySchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  topic: z.string().min(1),
});
export type ArticleEntry = z.infer<typeof ArticleEntrySchema>;

export const ArticleRegistrySchema = z.object({
  articles: z.array(ArticleEntrySchema).min(1),
});
export type ArticleRegistry = z.infer<typeof ArticleRegistrySchema>;

export const ComplianceFrameworkSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  display_name: z.string().min(1),
  jurisdictions: z.array(z.string()).min(1),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  article_registry: ArticleRegistrySchema,
  source_url: z.string().url(),
  source_title: z.string().min(1),
  source_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  audit_hash: z.string().min(1),
});
export type ComplianceFramework = z.infer<typeof ComplianceFrameworkSchema>;

// ---------------------------------------------------------------------------
// FrameworkControlMapping
// ---------------------------------------------------------------------------

export const FrameworkControlMappingSchema = z.object({
  framework_id: z.string().min(1),
  article_ref: z.string().min(1),
  control_kind: z.enum(CONTROL_KINDS),
  package_name: z.string().min(1),
  impl_pointer: z.string().min(1),
  audit_hash: z.string().min(1),
});
export type FrameworkControlMapping = z.infer<
  typeof FrameworkControlMappingSchema
>;

// ---------------------------------------------------------------------------
// RegulatorDefinition
// ---------------------------------------------------------------------------

export const FilingKindSchema = z.object({
  kind: z.string().min(1),
  cadence: z.enum([
    'per-transaction',
    'event-driven',
    'monthly',
    'quarterly',
    'annual',
    'pre-project',
  ]),
  due_day_of_month: z.number().int().min(1).max(31).optional(),
  due_pattern: z.string().optional(),
  late_penalty: z.string().optional(),
  source_url: z.string().url().optional(),
});
export type FilingKind = z.infer<typeof FilingKindSchema>;

export const RegulatorDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z]{2}(-[a-z]{2,3})?-[a-z0-9-]+$/),
  jurisdiction_id: z.string().min(2),
  display_name: z.string().min(1),
  domain: z.enum(REGULATOR_DOMAINS),
  filing_kinds: z.array(FilingKindSchema).default([]),
  due_pattern: z.record(z.string(), z.unknown()).default({}),
  api_endpoint: z.string().url().optional(),
  audit_hash: z.string().min(1),
});
export type RegulatorDefinition = z.infer<typeof RegulatorDefinitionSchema>;
