/**
 * Equipment maintenance taxonomy — types, Zod validators, defaults.
 *
 * Per-equipment-kind problem catalog. Rows with `tenantId === null` are
 * platform defaults visible to every tenant; tenant-scoped rows are
 * overrides keyed by (tenantId, equipmentKind, code).
 */

import { z } from 'zod';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Enums (mirror the mining-domain `assets.kind`)
// ---------------------------------------------------------------------------

export const EQUIPMENT_KINDS = [
  'excavator',
  'compressor',
  'generator',
  'pump',
  'crusher',
  'truck',
  'vehicle',
  'drill_rig',
  'tool',
  'ppe',
] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const PROBLEM_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
  'emergency',
] as const;
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface ProblemCategory {
  readonly code: string;
  readonly name: string;
  readonly defaultSeverity: ProblemSeverity;
  readonly evidenceRequired: boolean;
}

export interface EquipmentMaintenanceTaxonomyEntry {
  readonly id: string;
  /** NULL = platform default. */
  readonly tenantId: TenantId | null;
  readonly equipmentKind: EquipmentKind;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly problemCategories: readonly ProblemCategory[];
  readonly slaHours: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isPlatformDefault: boolean;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const problemCategorySchema = z.object({
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  defaultSeverity: z.enum(PROBLEM_SEVERITIES),
  evidenceRequired: z.boolean().default(true),
});

export const upsertTaxonomySchema = z.object({
  id: z.string().min(1),
  equipmentKind: z.enum(EQUIPMENT_KINDS),
  code: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'must be lowercase slug (a-z, 0-9, _, -)'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  problemCategories: z.array(problemCategorySchema).default([]),
  slaHours: z.number().int().positive().default(72),
});
export type UpsertTaxonomyInput = z.infer<typeof upsertTaxonomySchema>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface EquipmentMaintenanceTaxonomyRepository {
  /** Returns rows where tenant_id IS NULL OR tenant_id = :tenantId. */
  listForTenant(
    tenantId: TenantId,
    equipmentKind?: EquipmentKind,
  ): Promise<readonly EquipmentMaintenanceTaxonomyEntry[]>;
  findByCode(
    tenantId: TenantId,
    equipmentKind: EquipmentKind,
    code: string,
  ): Promise<EquipmentMaintenanceTaxonomyEntry | null>;
  upsert(
    tenantId: TenantId,
    input: UpsertTaxonomyInput,
  ): Promise<EquipmentMaintenanceTaxonomyEntry>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EquipmentMaintenanceTaxonomyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'DUPLICATE_CODE'
      | 'TENANT_MISMATCH',
  ) {
    super(message);
    this.name = 'EquipmentMaintenanceTaxonomyError';
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Merge platform-default + tenant-override rows. When the same
 * (equipmentKind, code) pair exists at both levels, the tenant-scoped
 * row wins. Returns a NEW array.
 */
export function mergeTenantOverrides(
  rows: readonly EquipmentMaintenanceTaxonomyEntry[],
): readonly EquipmentMaintenanceTaxonomyEntry[] {
  const byKey = new Map<string, EquipmentMaintenanceTaxonomyEntry>();
  // Platform defaults first; tenant rows last so they overwrite.
  for (const r of rows) {
    if (r.tenantId === null) byKey.set(`${r.equipmentKind}:${r.code}`, r);
  }
  for (const r of rows) {
    if (r.tenantId !== null) byKey.set(`${r.equipmentKind}:${r.code}`, r);
  }
  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d ?? new Date().toISOString());
}

export function rowToEntry(
  row: Record<string, unknown>,
): EquipmentMaintenanceTaxonomyEntry {
  const kindRaw = String(row.equipmentKind ?? 'tool');
  const equipmentKind: EquipmentKind = (EQUIPMENT_KINDS as readonly string[]).includes(
    kindRaw,
  )
    ? (kindRaw as EquipmentKind)
    : 'tool';
  const tenantId = (row.tenantId as string | null) ?? null;
  const categoriesRaw = Array.isArray(row.problemCategories)
    ? row.problemCategories
    : [];
  const problemCategories: ProblemCategory[] = (
    categoriesRaw as ReadonlyArray<Record<string, unknown>>
  ).flatMap((c) => {
    const parsed = problemCategorySchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    id: String(row.id),
    tenantId: tenantId === null ? null : (tenantId as TenantId),
    equipmentKind,
    code: String(row.code),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    problemCategories,
    slaHours: Number(row.slaHours ?? 72),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    isPlatformDefault: tenantId === null,
  };
}
