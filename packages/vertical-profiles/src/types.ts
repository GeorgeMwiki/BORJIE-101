/**
 * `@borjie/vertical-profiles` — public type surface (Wave VP-1).
 *
 * Companion to `Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md`.
 *
 * Defines the canonical profile- and workflow-shape every vertical
 * profile registers under, plus the registry-port type a consumer
 * interacts with. The shapes are 1:1 with the database rows of
 * migration 0057 so we can round-trip between in-memory and SQL
 * adapters without field re-mapping.
 *
 * All types are `readonly`. All constructed values are frozen
 * (~/.claude/rules/coding-style.md immutability rule).
 *
 * Standards anchored at the profile level (deeper citations live on
 * each profile's `provenance` array — see Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md §6):
 *   - ICMM Mining Principles 2025          https://www.icmm.com/en-gb/our-work/sustainability-leadership/mining-principles
 *   - World Bank EITI Standard 2023        https://eiti.org/eiti-standard
 *   - USDA Foreign Agricultural Service    https://www.fas.usda.gov/data
 *   - FAO Global Forest Resources          https://www.fao.org/forest-resources-assessment/en
 *   - API Standards Catalogue 2026         https://www.api.org/products-and-services/standards
 *   - FSC International Standards          https://fsc.org/en/document-centre
 *   - UN-REDD+ Programme Framework         https://www.un-redd.org/about-un-redd-programme
 *   - ISO 14001:2015                       https://www.iso.org/standard/60857.html
 *   - GRI Standards 2021                   https://www.globalreporting.org/standards
 *   - UNWTO Statistical Framework          https://www.unwto.org/tourism-statistics
 *   - IFRS 16 Leases                       https://www.ifrs.org/issued-standards/list-of-standards/ifrs-16-leases
 *   (all accessed 2026-05-27)
 *
 * @module @borjie/vertical-profiles/types
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status + verticals + cadences
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a vertical profile.
 *   - 'live'       : an implementation package shipped + the definition
 *                    row carries a non-null `implementationPackage`.
 *   - 'reserved'   : definition row only — no implementation module yet.
 *                    Callers requesting a reserved profile should fall
 *                    back to the closest live profile (typically `mining-tz`).
 *   - 'deprecated' : historically supported, no longer accepting new tenants.
 */
export const PROFILE_STATUSES = ['live', 'reserved', 'deprecated'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/**
 * Top-level vertical categories. CHECK constraint in migration 0057
 * enforces this set on the database side.
 */
export const VERTICALS = [
  'mining',
  'agri',
  'oilgas',
  'fisheries',
  'forestry',
  'manufacturing',
  'tourism',
  'realestate',
] as const;
export type Vertical = (typeof VERTICALS)[number];

/**
 * Workflow cadence. Matches the CHECK constraint in migration 0057.
 *   - 'event' fires on an external trigger (e.g. NEMC EIA submission).
 */
export const CADENCES = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
  'event',
] as const;
export type Cadence = (typeof CADENCES)[number];

// ---------------------------------------------------------------------------
// Citation
// ---------------------------------------------------------------------------

/** URL + title + ISO date triple. Mandatory on every provenance entry. */
export interface Citation {
  readonly url: string;
  readonly title: string;
  readonly accessedAt: string;
}

export const CitationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  accessedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ---------------------------------------------------------------------------
// Entity definition
// ---------------------------------------------------------------------------

/**
 * Attribute on a vertical-profile entity. `kind` is intentionally
 * coarse — the workflow engine + LMBM use this for nudging, not for
 * formal type-checking. Strong types live in the per-vertical
 * implementation package (e.g. `@borjie/vertical-profile-mining-tz`).
 */
export interface EntityAttribute {
  readonly key: string;
  readonly kind:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'enum'
    | 'geo'
    | 'reference';
  readonly required: boolean;
  readonly enumValues?: ReadonlyArray<string>;
  readonly referenceEntity?: string;
}

export const EntityAttributeSchema = z.object({
  key: z.string().min(1),
  kind: z.enum([
    'string',
    'number',
    'boolean',
    'date',
    'enum',
    'geo',
    'reference',
  ]),
  required: z.boolean(),
  enumValues: z.array(z.string().min(1)).optional(),
  referenceEntity: z.string().min(1).optional(),
});

/**
 * Canonical noun in a vertical's world. Mine Site, Pit, Stockpile,
 * Buyer, Farm, Field, Vessel, etc.
 */
export interface VerticalEntityDefinition {
  readonly key: string;
  readonly displayName: string;
  readonly parentKey?: string;
  readonly description: string;
  readonly attributes: ReadonlyArray<EntityAttribute>;
}

export const VerticalEntityDefinitionSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_-]*$/),
  displayName: z.string().min(1),
  parentKey: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_-]*$/)
    .optional(),
  description: z.string().min(1),
  attributes: z.array(EntityAttributeSchema).min(1),
});

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export interface GlossaryEntry {
  readonly term: string;
  readonly translations: Readonly<Record<string, string>>;
  readonly definition: string;
}

export const GlossaryEntrySchema = z.object({
  term: z.string().min(1),
  translations: z.record(z.string().min(2), z.string().min(1)),
  definition: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Regulator binding
// ---------------------------------------------------------------------------

/**
 * Join into `regulator_definitions` (migration 0055). `regulatorId`
 * is the canonical lowercase id (`tz-tra`, `tz-tumemadini`, `ng-firs`,
 * `no-npd`, …). `filingKinds` is the list of filing slugs from that
 * regulator's catalogue that this profile cares about.
 */
export interface RegulatorBinding {
  readonly regulatorId: string;
  readonly filingKinds: ReadonlyArray<string>;
}

export const RegulatorBindingSchema = z.object({
  regulatorId: z
    .string()
    .min(2)
    .regex(/^[a-z]{2}(-[a-z]{2,3})?-[a-z0-9-]+$/),
  filingKinds: z.array(z.string().min(1)).min(1),
});

// ---------------------------------------------------------------------------
// Vertical profile definition (row of `vertical_profile_definitions`)
// ---------------------------------------------------------------------------

export interface VerticalProfileDefinition {
  readonly id: string;
  readonly vertical: Vertical;
  readonly region: string;
  readonly displayName: string;
  readonly status: ProfileStatus;
  readonly description: string;
  readonly entities: ReadonlyArray<VerticalEntityDefinition>;
  readonly glossary: ReadonlyArray<GlossaryEntry>;
  readonly regulatorBindings: ReadonlyArray<RegulatorBinding>;
  readonly capabilitySeeds: ReadonlyArray<string>;
  readonly provenance: ReadonlyArray<Citation>;
  readonly implementationPackage: string | null;
}

export const VerticalProfileDefinitionSchema = z
  .object({
    id: z
      .string()
      .min(4)
      .max(40)
      .regex(/^[a-z][a-z0-9-]*-[a-z]{2}(-[a-z]{2,3})?$/),
    vertical: z.enum(VERTICALS),
    region: z
      .string()
      .min(2)
      .max(8)
      .regex(/^[a-z]{2}(-[a-z]{2,3})?$/),
    displayName: z.string().min(1),
    status: z.enum(PROFILE_STATUSES),
    description: z.string().min(20),
    entities: z.array(VerticalEntityDefinitionSchema).min(1),
    glossary: z.array(GlossaryEntrySchema).default([]),
    regulatorBindings: z.array(RegulatorBindingSchema).min(1),
    capabilitySeeds: z.array(z.string().min(1)).default([]),
    provenance: z.array(CitationSchema).min(1),
    implementationPackage: z.string().min(1).nullable(),
  })
  .refine(
    (d) =>
      (d.status === 'live' && d.implementationPackage !== null) ||
      (d.status !== 'live' && d.implementationPackage === null),
    {
      message:
        'live profiles require implementationPackage; reserved/deprecated profiles forbid it',
      path: ['implementationPackage'],
    },
  )
  .refine((d) => d.id === `${d.vertical}-${d.region}`, {
    message: 'id must equal "{vertical}-{region}"',
    path: ['id'],
  });

// ---------------------------------------------------------------------------
// Workflow contract pieces
// ---------------------------------------------------------------------------

/**
 * JSON-Schema-ish opaque object for an input/output contract.
 * Stored as JSONB on the database. Validation is done by the
 * dispatching package at filing time, not the registry.
 */
export interface WorkflowContractShape {
  readonly fields: ReadonlyArray<{
    readonly key: string;
    readonly kind: EntityAttribute['kind'];
    readonly required: boolean;
    readonly description?: string;
  }>;
}

export const WorkflowContractShapeSchema = z.object({
  fields: z
    .array(
      z.object({
        key: z.string().min(1),
        kind: z.enum([
          'string',
          'number',
          'boolean',
          'date',
          'enum',
          'geo',
          'reference',
        ]),
        required: z.boolean(),
        description: z.string().optional(),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Vertical workflow definition (row of `vertical_workflows`)
// ---------------------------------------------------------------------------

export interface VerticalWorkflowDefinition {
  readonly id: string;
  readonly profileId: string;
  readonly name: string;
  readonly cadence: Cadence;
  readonly regulatorBinding: ReadonlyArray<{
    readonly regulatorId: string;
    readonly filingKind: string;
  }>;
  readonly dueDateRule: string;
  readonly gracePeriodHours: number;
  readonly escalationHours: number;
  readonly inputContract: WorkflowContractShape;
  readonly outputContract: WorkflowContractShape;
  readonly provenance: ReadonlyArray<Citation>;
}

export const VerticalWorkflowDefinitionSchema = z.object({
  id: z
    .string()
    .min(4)
    .max(96)
    .regex(/^[a-z][a-z0-9-]*-[a-z]{2}(-[a-z]{2,3})?\.[a-z][a-z0-9-]*$/),
  profileId: z
    .string()
    .min(4)
    .regex(/^[a-z][a-z0-9-]*-[a-z]{2}(-[a-z]{2,3})?$/),
  name: z.string().min(1),
  cadence: z.enum(CADENCES),
  regulatorBinding: z
    .array(
      z.object({
        regulatorId: z
          .string()
          .min(2)
          .regex(/^[a-z]{2}(-[a-z]{2,3})?-[a-z0-9-]+$/),
        filingKind: z.string().min(1),
      }),
    )
    .min(1),
  dueDateRule: z.string().min(1),
  gracePeriodHours: z.number().int().min(0).max(8760),
  escalationHours: z.number().int().min(0).max(8760),
  inputContract: WorkflowContractShapeSchema,
  outputContract: WorkflowContractShapeSchema,
  provenance: z.array(CitationSchema).min(1),
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type VerticalProfileErrorCode =
  | 'INVALID_INPUT'
  | 'DUPLICATE_ID'
  | 'NOT_FOUND'
  | 'STATUS_VIOLATION'
  | 'WORKFLOW_PROFILE_MISMATCH';

export class VerticalProfileError extends Error {
  public readonly code: VerticalProfileErrorCode;
  constructor(message: string, code: VerticalProfileErrorCode) {
    super(message);
    this.name = 'VerticalProfileError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Registry filter
// ---------------------------------------------------------------------------

export interface RegistryListFilter {
  readonly status?: ProfileStatus;
  readonly vertical?: Vertical;
  readonly region?: string;
}
