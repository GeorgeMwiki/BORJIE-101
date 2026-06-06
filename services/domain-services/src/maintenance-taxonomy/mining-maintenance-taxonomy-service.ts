/**
 * Mining Equipment Maintenance Taxonomy Service (Borjie mining).
 *
 * Wires the `/api/v1/maintenance-taxonomy` route to the REAL mining
 * repository (`DrizzleEquipmentMaintenanceTaxonomyRepository`, persisting
 * to `equipment_maintenance_taxonomy`). It replaces the retired
 * property-domain service: there are no stubs and no canned data — every
 * response is derived from rows the repo reads back over Drizzle.
 *
 * Domain mapping (see `mining-taxonomy-types.ts`):
 *   route "category" → mining equipment kind (excavator, pump, drill_rig…)
 *   route "problem"  → a taxonomy ENTRY (a maintenance code under a kind)
 *
 * Tenant isolation: the repo binds `app.current_tenant_id` and merges
 * platform defaults (tenant_id NULL) with per-tenant overrides. The
 * service passes the branded `tenantId` straight through and NEVER
 * double-filters in app code.
 */

import type { TenantId } from '@borjie/domain-models';
import { prefixedId } from '../common/id-generator.js';
import type {
  EquipmentKind,
  EquipmentMaintenanceTaxonomyEntry,
  EquipmentMaintenanceTaxonomyRepository,
  ProblemCategory,
  UpsertTaxonomyInput,
} from '../equipment-maintenance-taxonomy/index.js';
import {
  createCategoryInputSchema,
  createProblemInputSchema,
  entriesToCategories,
  entryToProblem,
  filterProblems,
  humanizeKind,
  MiningTaxonomyError,
  parseEquipmentKind,
  type CreateCategoryInput,
  type CreateProblemInput,
  type MaintenanceCategoryView,
  type MaintenanceProblemView,
  type ProblemFilters,
} from './mining-taxonomy-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Code marking the baseline entry that materializes a kind grouping. */
const CATEGORY_ANCHOR_CODE = 'general';
const DEFAULT_SLA_HOURS = 72;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MiningMaintenanceTaxonomyService {
  constructor(
    private readonly repo: EquipmentMaintenanceTaxonomyRepository,
  ) {}

  /**
   * Merged category list = the distinct equipment kinds present in the
   * tenant's visible taxonomy (platform defaults + overrides), each with
   * a real problem (entry) count. Derived from DB rows, never hardcoded.
   */
  async listCategories(
    tenantId: string,
  ): Promise<readonly MaintenanceCategoryView[]> {
    const entries = await this.repo.listForTenant(this.tenant(tenantId));
    return entriesToCategories(entries);
  }

  /**
   * Ensure an equipment-kind grouping exists for the tenant by upserting
   * a baseline anchor entry. In mining a "category" IS an equipment kind,
   * so creation validates kind membership and persists the grouping via
   * the real repo. Throws `DUPLICATE` if the tenant already has a
   * tenant-scoped anchor for that kind.
   */
  async createCategory(
    tenantId: string,
    input: CreateCategoryInput,
    _actorId: string,
  ): Promise<MaintenanceCategoryView> {
    const parsed = createCategoryInputSchema.parse(input);
    const branded = this.tenant(tenantId);
    const kind = parseEquipmentKind(parsed.code);

    const existing = await this.repo.findByCode(
      branded,
      kind,
      CATEGORY_ANCHOR_CODE,
    );
    if (existing && !existing.isPlatformDefault) {
      throw new MiningTaxonomyError(
        `maintenance category "${kind}" already exists for this tenant`,
        'DUPLICATE',
      );
    }

    const upsertInput: UpsertTaxonomyInput = {
      id: prefixedId('emtx'),
      equipmentKind: kind,
      code: CATEGORY_ANCHOR_CODE,
      name: parsed.name,
      description: parsed.description ?? null,
      problemCategories: [],
      slaHours: DEFAULT_SLA_HOURS,
    };
    const saved = await this.repo.upsert(branded, upsertInput);
    return this.toCategoryView(saved);
  }

  /**
   * Merged problem list with optional `categoryId` / `severity` /
   * `assetType` filters. Each taxonomy entry becomes one problem view.
   */
  async listProblems(
    tenantId: string,
    filters: ProblemFilters = {},
  ): Promise<readonly MaintenanceProblemView[]> {
    const branded = this.tenant(tenantId);
    const kindHint = filters.categoryId ?? filters.assetType;
    const entries = await this.repo.listForTenant(
      branded,
      this.optionalKind(kindHint),
    );
    const problems = entries.map(entryToProblem);
    return filterProblems(problems, filters);
  }

  /** Problems under one equipment kind (the route's `categoryId`). */
  async listProblemsByCategory(
    tenantId: string,
    categoryId: string,
  ): Promise<readonly MaintenanceProblemView[]> {
    const branded = this.tenant(tenantId);
    const kind = parseEquipmentKind(categoryId);
    const entries = await this.repo.listForTenant(branded, kind);
    return entries.map(entryToProblem);
  }

  /**
   * Persist a tenant-scoped maintenance problem (a taxonomy entry) under
   * the given equipment kind. The route's severity / evidence / SLA
   * fields fold into the entry's nested problem-category + `slaHours`.
   * Throws `DUPLICATE` when the tenant already owns that code.
   */
  async createProblem(
    tenantId: string,
    input: CreateProblemInput,
    _actorId: string,
  ): Promise<MaintenanceProblemView> {
    const parsed = createProblemInputSchema.parse(input);
    const branded = this.tenant(tenantId);
    const kind = parseEquipmentKind(parsed.categoryId);

    const existing = await this.repo.findByCode(branded, kind, parsed.code);
    if (existing && !existing.isPlatformDefault) {
      throw new MiningTaxonomyError(
        `maintenance problem "${parsed.code}" already exists under "${kind}"`,
        'DUPLICATE',
      );
    }

    const upsertInput: UpsertTaxonomyInput = {
      id: prefixedId('emtx'),
      equipmentKind: kind,
      code: parsed.code,
      name: parsed.name,
      description: parsed.description ?? null,
      problemCategories: [this.toNestedCategory(parsed)],
      slaHours:
        parsed.defaultSlaHours && parsed.defaultSlaHours > 0
          ? parsed.defaultSlaHours
          : DEFAULT_SLA_HOURS,
    };
    const saved = await this.repo.upsert(branded, upsertInput);
    return entryToProblem(saved);
  }

  // -------------------------------------------------------------------------
  // Private — pure adapters (no I/O)
  // -------------------------------------------------------------------------

  private toNestedCategory(parsed: CreateProblemInput): ProblemCategory {
    return {
      code: parsed.code,
      name: parsed.name,
      defaultSeverity: parsed.defaultSeverity ?? 'medium',
      evidenceRequired: parsed.evidenceRequired ?? true,
    };
  }

  private toCategoryView(
    entry: EquipmentMaintenanceTaxonomyEntry,
  ): MaintenanceCategoryView {
    return {
      id: entry.equipmentKind,
      code: entry.equipmentKind,
      name: entry.name || humanizeKind(entry.equipmentKind),
      description: entry.description,
      problemCount: 1,
      hasTenantOverride: !entry.isPlatformDefault,
    };
  }

  private optionalKind(value: string | undefined): EquipmentKind | undefined {
    if (value === undefined) return undefined;
    return parseEquipmentKind(value);
  }

  private tenant(tenantId: string): TenantId {
    if (tenantId.length === 0) {
      throw new MiningTaxonomyError('tenantId is required', 'VALIDATION');
    }
    return tenantId as unknown as TenantId;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct the mining maintenance-taxonomy service from the real
 * Drizzle repository. Used by the api-gateway composition root.
 */
export function createMiningMaintenanceTaxonomyService(
  repo: EquipmentMaintenanceTaxonomyRepository,
): MiningMaintenanceTaxonomyService {
  return new MiningMaintenanceTaxonomyService(repo);
}
