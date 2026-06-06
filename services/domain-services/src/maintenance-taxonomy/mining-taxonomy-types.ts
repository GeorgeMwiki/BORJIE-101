/**
 * Mining maintenance-taxonomy service — DTOs, Zod validators, pure mappers.
 *
 * This module adapts the `/api/v1/maintenance-taxonomy` route's
 * category/problem vocabulary onto the mining-domain
 * `equipment_maintenance_taxonomy` model (keyed on `assets.kind`):
 *
 *   route "category"  ↔  mining `equipmentKind`     (excavator, pump, …)
 *   route "problem"   ↔  a taxonomy ENTRY            (a maintenance code
 *                                                     under an equipment
 *                                                     kind, carrying its
 *                                                     nested problem
 *                                                     categories + SLA)
 *
 * Everything here is pure (no I/O); the service composes these with the
 * real Drizzle repository. No hardcoded catalogs — category/problem
 * views are DERIVED from persisted rows.
 */

import { z } from 'zod';
import {
  EQUIPMENT_KINDS,
  PROBLEM_SEVERITIES,
  type EquipmentKind,
  type EquipmentMaintenanceTaxonomyEntry,
  type ProblemCategory,
  type ProblemSeverity,
} from '../equipment-maintenance-taxonomy/index.js';

// ---------------------------------------------------------------------------
// Service-facing error (the route reads `err.code`; `DUPLICATE` → HTTP 409)
// ---------------------------------------------------------------------------

export type MiningTaxonomyErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'UNKNOWN_EQUIPMENT_KIND';

export class MiningTaxonomyError extends Error {
  constructor(
    message: string,
    public readonly code: MiningTaxonomyErrorCode,
  ) {
    super(message);
    this.name = 'MiningTaxonomyError';
  }
}

// ---------------------------------------------------------------------------
// View shapes returned to the route
// ---------------------------------------------------------------------------

/**
 * A maintenance "category" in mining terms = an equipment kind grouping,
 * derived from the taxonomy rows currently visible to the tenant.
 */
export interface MaintenanceCategoryView {
  /** Equipment kind slug — also the `categoryId` used by problem filters. */
  readonly id: EquipmentKind;
  readonly code: EquipmentKind;
  readonly name: string;
  readonly description: string | null;
  /** Count of taxonomy entries (problem codes) under this kind. */
  readonly problemCount: number;
  /** True when at least one tenant-scoped override exists for the kind. */
  readonly hasTenantOverride: boolean;
}

/**
 * A maintenance "problem" in mining terms = a single taxonomy entry
 * (one maintenance code under one equipment kind).
 */
export interface MaintenanceProblemView {
  readonly id: string;
  /** Equipment kind = the route's `categoryId`. */
  readonly categoryId: EquipmentKind;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly defaultSeverity: ProblemSeverity;
  readonly defaultSlaHours: number;
  /** Equipment kinds this problem applies to (mirrors the owning kind). */
  readonly assetTypeScope: readonly EquipmentKind[];
  readonly evidenceRequired: boolean;
  readonly nestedCategories: readonly ProblemCategory[];
  readonly isPlatformDefault: boolean;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input validators (mirror the route's CreateCategory / CreateProblem zod)
// ---------------------------------------------------------------------------

const equipmentKindSchema = z.enum(EQUIPMENT_KINDS);
const severitySchema = z.enum(PROBLEM_SEVERITIES);

/**
 * `code` is the equipment kind itself (a mining category IS a kind). We
 * accept any non-empty slug and validate kind membership in the service
 * so the route can surface a precise `UNKNOWN_EQUIPMENT_KIND`.
 */
export const createCategoryInputSchema = z.object({
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  displayOrder: z.number().int().optional(),
  iconName: z.string().max(80).optional(),
  active: z.boolean().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>;

export const createProblemInputSchema = z.object({
  /** Equipment kind slug (route field name kept as `categoryId`). */
  categoryId: z.string().min(1),
  code: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'must be lowercase slug (a-z, 0-9, _, -)'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  defaultSeverity: severitySchema.optional(),
  defaultSlaHours: z.number().int().nonnegative().optional(),
  assetTypeScope: z.array(z.string()).optional(),
  roomScope: z.array(z.string()).optional(),
  evidenceRequired: z.boolean().optional(),
  suggestedVendorTags: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateProblemInput = z.infer<typeof createProblemInputSchema>;

export interface ProblemFilters {
  readonly categoryId?: string;
  readonly severity?: string;
  readonly assetType?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — kind parsing
// ---------------------------------------------------------------------------

const KIND_SET: ReadonlySet<string> = new Set(EQUIPMENT_KINDS);

export function isEquipmentKind(value: string): value is EquipmentKind {
  return KIND_SET.has(value);
}

/** Throws `UNKNOWN_EQUIPMENT_KIND` for anything outside the enum. */
export function parseEquipmentKind(value: string): EquipmentKind {
  if (isEquipmentKind(value)) return value;
  throw new MiningTaxonomyError(
    `unknown equipment kind "${value}"; expected one of ${EQUIPMENT_KINDS.join(', ')}`,
    'UNKNOWN_EQUIPMENT_KIND',
  );
}

/** Human label for an equipment kind ("drill_rig" → "Drill Rig"). */
export function humanizeKind(kind: EquipmentKind): string {
  return kind
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Pure mappers — entries → category / problem views
// ---------------------------------------------------------------------------

/**
 * Collapse merged taxonomy entries into one category view per equipment
 * kind. Returns a NEW array sorted by kind for stable output.
 */
export function entriesToCategories(
  entries: readonly EquipmentMaintenanceTaxonomyEntry[],
): readonly MaintenanceCategoryView[] {
  const byKind = new Map<EquipmentKind, MaintenanceCategoryView>();
  for (const entry of entries) {
    const prior = byKind.get(entry.equipmentKind);
    const next: MaintenanceCategoryView = {
      id: entry.equipmentKind,
      code: entry.equipmentKind,
      name: humanizeKind(entry.equipmentKind),
      description: prior?.description ?? entry.description ?? null,
      problemCount: (prior?.problemCount ?? 0) + 1,
      hasTenantOverride:
        (prior?.hasTenantOverride ?? false) || !entry.isPlatformDefault,
    };
    byKind.set(entry.equipmentKind, next);
  }
  return Array.from(byKind.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function primaryNested(
  entry: EquipmentMaintenanceTaxonomyEntry,
): ProblemCategory | null {
  return entry.problemCategories[0] ?? null;
}

/** Map one taxonomy entry to a problem view. Pure. */
export function entryToProblem(
  entry: EquipmentMaintenanceTaxonomyEntry,
): MaintenanceProblemView {
  const primary = primaryNested(entry);
  return {
    id: entry.id,
    categoryId: entry.equipmentKind,
    code: entry.code,
    name: entry.name,
    description: entry.description,
    defaultSeverity: primary?.defaultSeverity ?? 'medium',
    defaultSlaHours: entry.slaHours,
    assetTypeScope: [entry.equipmentKind],
    evidenceRequired: primary?.evidenceRequired ?? true,
    nestedCategories: entry.problemCategories,
    isPlatformDefault: entry.isPlatformDefault,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Apply route filters to problem views. `categoryId`/`assetType` both
 * match the owning equipment kind; `severity` matches when the default
 * OR any nested category carries that severity. Returns a NEW array.
 */
export function filterProblems(
  problems: readonly MaintenanceProblemView[],
  filters: ProblemFilters,
): readonly MaintenanceProblemView[] {
  const kindFilter = filters.categoryId ?? filters.assetType;
  const severity = filters.severity;
  return problems.filter((p) => {
    if (kindFilter && p.categoryId !== kindFilter) return false;
    if (severity) {
      const matches =
        p.defaultSeverity === severity ||
        p.nestedCategories.some((c) => c.defaultSeverity === severity);
      if (!matches) return false;
    }
    return true;
  });
}
