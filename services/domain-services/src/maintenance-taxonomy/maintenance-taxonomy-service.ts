/**
 * Maintenance Taxonomy Service (Wave 8, S7 gap closure)
 *
 * Exposes the curated maintenance problem catalog with per-tenant overrides.
 *
 * Merge semantics (critical):
 *   Rows where tenant_id IS NULL are platform defaults, visible to every org.
 *   Rows where tenant_id = :tenantId are org-specific overrides. When the
 *   same `code` exists at both levels, the tenant-scoped row wins.
 *
 * All mutations (createCategory, createProblem) write rows scoped to the
 * caller's tenantId. Platform defaults are never mutated through this
 * service — they are seeded out-of-band via
 * `seedMaintenanceTaxonomyPlatformDefaults`.
 *
 * Pure/functional design — every output is a NEW object; no input is mutated.
 */
import { randomUUID } from 'crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  maintenanceProblemCategories,
  maintenanceProblems,
} from '@borjie/database';

// ---------------------------------------------------------------------------
// Public domain types
// ---------------------------------------------------------------------------

export type MaintenanceSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'emergency';

export const MAINTENANCE_SEVERITIES: readonly MaintenanceSeverity[] = [
  'low',
  'medium',
  'high',
  'critical',
  'emergency',
];

export interface MaintenanceCategory {
  readonly id: string;
  readonly tenantId: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly displayOrder: number;
  readonly iconName: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** True if this row is a platform default (tenantId IS NULL). */
  readonly isPlatformDefault: boolean;
}

export interface MaintenanceProblem {
  readonly id: string;
  readonly tenantId: string | null;
  readonly categoryId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly defaultSeverity: MaintenanceSeverity;
  readonly defaultSlaHours: number;
  readonly assetTypeScope: readonly string[];
  readonly roomScope: readonly string[];
  readonly evidenceRequired: boolean;
  readonly suggestedVendorTags: readonly string[];
  readonly active: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** True if this row is a platform default (tenantId IS NULL). */
  readonly isPlatformDefault: boolean;
}

export interface ListProblemsFilters {
  readonly categoryId?: string;
  readonly categoryCode?: string;
  readonly severity?: MaintenanceSeverity;
  readonly assetType?: string;
}

export interface CreateCategoryInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly displayOrder?: number;
  readonly iconName?: string;
  readonly active?: boolean;
}

export interface CreateProblemInput {
  readonly categoryId: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly defaultSeverity: MaintenanceSeverity;
  readonly defaultSlaHours: number;
  readonly assetTypeScope?: readonly string[];
  readonly roomScope?: readonly string[];
  readonly evidenceRequired?: boolean;
  readonly suggestedVendorTags?: readonly string[];
  readonly active?: boolean;
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MaintenanceTaxonomyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'VALIDATION'
      | 'DUPLICATE_CODE'
      | 'CATEGORY_NOT_FOUND'
      | 'TENANT_MISMATCH',
  ) {
    super(message);
    this.name = 'MaintenanceTaxonomyError';
  }
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/**
 * Storage-agnostic repository port. The Drizzle-backed implementation below
 * is the default; tests may inject an in-memory fake.
 */
export interface MaintenanceTaxonomyRepository {
  /** Returns rows where tenant_id IS NULL OR tenant_id = :tenantId. */
  listCategoriesForTenant(
    tenantId: string,
  ): Promise<readonly MaintenanceCategory[]>;

  /** Returns rows where tenant_id IS NULL OR tenant_id = :tenantId. */
  listProblemsForTenant(
    tenantId: string,
  ): Promise<readonly MaintenanceProblem[]>;

  findCategoryById(id: string): Promise<MaintenanceCategory | null>;

  insertCategory(
    row: MaintenanceCategory,
  ): Promise<MaintenanceCategory>;

  insertProblem(row: MaintenanceProblem): Promise<MaintenanceProblem>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface MaintenanceTaxonomyServiceDeps {
  readonly repo: MaintenanceTaxonomyRepository;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export interface MaintenanceTaxonomyService {
  listCategories(tenantId: string): Promise<readonly MaintenanceCategory[]>;
  listProblems(
    tenantId: string,
    filters?: ListProblemsFilters,
  ): Promise<readonly MaintenanceProblem[]>;
  listProblemsByCategory(
    tenantId: string,
    categoryId: string,
  ): Promise<readonly MaintenanceProblem[]>;
  createCategory(
    tenantId: string,
    input: CreateCategoryInput,
    userId: string,
  ): Promise<MaintenanceCategory>;
  createProblem(
    tenantId: string,
    input: CreateProblemInput,
    userId: string,
  ): Promise<MaintenanceProblem>;
}

/**
 * Merge platform defaults with tenant overrides. When two rows share the
 * same `code`, the tenant-scoped one wins. Returns a NEW array.
 */
function mergeByCode<T extends { code: string; tenantId: string | null }>(
  rows: readonly T[],
): readonly T[] {
  const byCode = new Map<string, T>();
  // First pass: platform defaults (tenantId IS NULL). Tenant rows go in last
  // so they overwrite. This guarantees tenant-override wins regardless of
  // input ordering from the repo.
  for (const row of rows) {
    if (row.tenantId === null) {
      byCode.set(row.code, row);
    }
  }
  for (const row of rows) {
    if (row.tenantId !== null) {
      byCode.set(row.code, row);
    }
  }
  return Array.from(byCode.values());
}

export function createMaintenanceTaxonomyService(
  deps: MaintenanceTaxonomyServiceDeps,
): MaintenanceTaxonomyService {
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => randomUUID());

  function validateTenantId(tenantId: string): void {
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new MaintenanceTaxonomyError(
        'tenantId is required',
        'VALIDATION',
      );
    }
  }

  function validateSeverity(s: unknown): asserts s is MaintenanceSeverity {
    if (!MAINTENANCE_SEVERITIES.includes(s as MaintenanceSeverity)) {
      throw new MaintenanceTaxonomyError(
        `invalid severity "${String(s)}"; must be one of ${MAINTENANCE_SEVERITIES.join(', ')}`,
        'VALIDATION',
      );
    }
  }

  function validateCode(code: unknown, field: string): asserts code is string {
    if (
      typeof code !== 'string' ||
      code.trim() === '' ||
      !/^[a-z0-9][a-z0-9_-]*$/.test(code)
    ) {
      throw new MaintenanceTaxonomyError(
        `invalid ${field}: must be lowercase slug (a-z, 0-9, _, -)`,
        'VALIDATION',
      );
    }
  }

  return {
    async listCategories(tenantId) {
      validateTenantId(tenantId);
      const rows = await deps.repo.listCategoriesForTenant(tenantId);
      const merged = mergeByCode(rows);
      // Deterministic order: displayOrder then name.
      return [...merged]
        .filter((r) => r.active)
        .sort((a, b) => {
          if (a.displayOrder !== b.displayOrder) {
            return a.displayOrder - b.displayOrder;
          }
          return a.name.localeCompare(b.name);
        });
    },

    async listProblems(tenantId, filters) {
      validateTenantId(tenantId);
      const [rawProblems, rawCategories] = await Promise.all([
        deps.repo.listProblemsForTenant(tenantId),
        deps.repo.listCategoriesForTenant(tenantId),
      ]);

      const mergedProblems = mergeByCode(rawProblems);
      const mergedCategories = mergeByCode(rawCategories);

      // Build a set of effective category IDs: if a tenant category
      // overrides a platform default, we still want to accept problems
      // whose categoryId points at EITHER the platform default id or the
      // tenant-override id (callers may reference either).
      const validCategoryIds = new Set(mergedCategories.map((c) => c.id));
      // Platform default category ids that were overridden must still be
      // accepted as valid references from platform-default problems.
      for (const c of rawCategories) {
        if (c.tenantId === null) {
          validCategoryIds.add(c.id);
        }
      }

      let out = mergedProblems.filter((p) => p.active);

      if (filters?.categoryId) {
        out = out.filter((p) => p.categoryId === filters.categoryId);
      }
      if (filters?.categoryCode) {
        const cat = mergedCategories.find(
          (c) => c.code === filters.categoryCode,
        );
        if (!cat) return [];
        // Accept problems that reference either the merged category id OR
        // (when the tenant overrode a platform default) the original
        // platform-default id — platform-default problems keep their old
        // categoryId even when a tenant overrides the category.
        const platformDefault = rawCategories.find(
          (c) => c.tenantId === null && c.code === filters.categoryCode,
        );
        const acceptableIds = new Set<string>([cat.id]);
        if (platformDefault) acceptableIds.add(platformDefault.id);
        out = out.filter((p) => acceptableIds.has(p.categoryId));
      }
      if (filters?.severity) {
        out = out.filter((p) => p.defaultSeverity === filters.severity);
      }
      if (filters?.assetType) {
        const needle = filters.assetType;
        out = out.filter(
          (p) =>
            p.assetTypeScope.length === 0 || // empty = applies everywhere
            p.assetTypeScope.includes(needle),
        );
      }

      return [...out].sort((a, b) => a.name.localeCompare(b.name));
    },

    async listProblemsByCategory(tenantId, categoryId) {
      validateTenantId(tenantId);
      return this.listProblems(tenantId, { categoryId });
    },

    async createCategory(tenantId, input, userId) {
      validateTenantId(tenantId);
      if (!userId || typeof userId !== 'string' || userId.trim() === '') {
        throw new MaintenanceTaxonomyError(
          'userId is required',
          'VALIDATION',
        );
      }
      validateCode(input.code, 'code');
      if (!input.name || input.name.trim() === '') {
        throw new MaintenanceTaxonomyError(
          'name is required',
          'VALIDATION',
        );
      }

      const nowIso = now().toISOString();
      const row: MaintenanceCategory = {
        id: genId(),
        tenantId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        displayOrder: input.displayOrder ?? 100,
        iconName: input.iconName ?? null,
        active: input.active ?? true,
        createdAt: nowIso,
        updatedAt: nowIso,
        isPlatformDefault: false,
      };
      return deps.repo.insertCategory(row);
    },

    async createProblem(tenantId, input, userId) {
      validateTenantId(tenantId);
      if (!userId || typeof userId !== 'string' || userId.trim() === '') {
        throw new MaintenanceTaxonomyError(
          'userId is required',
          'VALIDATION',
        );
      }
      validateCode(input.code, 'code');
      if (!input.name || input.name.trim() === '') {
        throw new MaintenanceTaxonomyError(
          'name is required',
          'VALIDATION',
        );
      }
      validateSeverity(input.defaultSeverity);
      if (
        !Number.isInteger(input.defaultSlaHours) ||
        input.defaultSlaHours <= 0
      ) {
        throw new MaintenanceTaxonomyError(
          'defaultSlaHours must be a positive integer',
          'VALIDATION',
        );
      }

      // Category must exist (either tenant-scoped or platform default).
      const cat = await deps.repo.findCategoryById(input.categoryId);
      if (!cat) {
        throw new MaintenanceTaxonomyError(
          `category ${input.categoryId} not found`,
          'CATEGORY_NOT_FOUND',
        );
      }
      if (cat.tenantId !== null && cat.tenantId !== tenantId) {
        throw new MaintenanceTaxonomyError(
          'category belongs to a different tenant',
          'TENANT_MISMATCH',
        );
      }

      const nowIso = now().toISOString();
      const row: MaintenanceProblem = {
        id: genId(),
        tenantId,
        categoryId: input.categoryId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        defaultSeverity: input.defaultSeverity,
        defaultSlaHours: input.defaultSlaHours,
        assetTypeScope: input.assetTypeScope
          ? [...input.assetTypeScope]
          : [],
        roomScope: input.roomScope ? [...input.roomScope] : [],
        evidenceRequired: input.evidenceRequired ?? true,
        suggestedVendorTags: input.suggestedVendorTags
          ? [...input.suggestedVendorTags]
          : [],
        active: input.active ?? true,
        metadata: input.metadata ? { ...input.metadata } : {},
        createdAt: nowIso,
        updatedAt: nowIso,
        isPlatformDefault: false,
      };
      return deps.repo.insertProblem(row);
    },
  };
}

// ---------------------------------------------------------------------------
// Drizzle-backed repository
// ---------------------------------------------------------------------------

export interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  [k: string]: any;
}

export class DrizzleMaintenanceTaxonomyRepository
  implements MaintenanceTaxonomyRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async listCategoriesForTenant(
    tenantId: string,
  ): Promise<readonly MaintenanceCategory[]> {
    const rows = await this.db
      .select()
      .from(maintenanceProblemCategories)
      .where(
        or(
          isNull(maintenanceProblemCategories.tenantId),
          eq(maintenanceProblemCategories.tenantId, tenantId),
        ),
      );
    return (rows as Record<string, unknown>[]).map(rowToCategory);
  }

  async listProblemsForTenant(
    tenantId: string,
  ): Promise<readonly MaintenanceProblem[]> {
    const rows = await this.db
      .select()
      .from(maintenanceProblems)
      .where(
        or(
          isNull(maintenanceProblems.tenantId),
          eq(maintenanceProblems.tenantId, tenantId),
        ),
      );
    return (rows as Record<string, unknown>[]).map(rowToProblem);
  }

  async findCategoryById(
    id: string,
  ): Promise<MaintenanceCategory | null> {
    const rows = await this.db
      .select()
      .from(maintenanceProblemCategories)
      .where(eq(maintenanceProblemCategories.id, id))
      .limit(1);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToCategory(row) : null;
  }

  async insertCategory(
    row: MaintenanceCategory,
  ): Promise<MaintenanceCategory> {
    await this.db
      .insert(maintenanceProblemCategories)
      .values(categoryToRow(row));
    return row;
  }

  async insertProblem(row: MaintenanceProblem): Promise<MaintenanceProblem> {
    await this.db.insert(maintenanceProblems).values(problemToRow(row));
    return row;
  }
}

// ---------------------------------------------------------------------------
// Row <-> Entity mapping
// ---------------------------------------------------------------------------

function categoryToRow(c: MaintenanceCategory): Record<string, unknown> {
  return {
    id: c.id,
    tenantId: c.tenantId,
    code: c.code,
    name: c.name,
    description: c.description,
    displayOrder: c.displayOrder,
    iconName: c.iconName,
    active: c.active,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
  };
}

function rowToCategory(row: Record<string, unknown>): MaintenanceCategory {
  const tenantId = (row.tenantId as string | null) ?? null;
  return {
    id: row.id as string,
    tenantId,
    code: row.code as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    displayOrder: (row.displayOrder as number) ?? 100,
    iconName: (row.iconName as string | null) ?? null,
    active: Boolean(row.active),
    createdAt: toIso(row.createdAt as Date | string),
    updatedAt: toIso(row.updatedAt as Date | string),
    isPlatformDefault: tenantId === null,
  };
}

function problemToRow(p: MaintenanceProblem): Record<string, unknown> {
  return {
    id: p.id,
    tenantId: p.tenantId,
    categoryId: p.categoryId,
    code: p.code,
    name: p.name,
    description: p.description,
    defaultSeverity: p.defaultSeverity,
    defaultSlaHours: p.defaultSlaHours,
    assetTypeScope: [...p.assetTypeScope],
    roomScope: [...p.roomScope],
    evidenceRequired: p.evidenceRequired,
    suggestedVendorTags: [...p.suggestedVendorTags],
    active: p.active,
    metadata: p.metadata,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  };
}

function rowToProblem(row: Record<string, unknown>): MaintenanceProblem {
  const tenantId = (row.tenantId as string | null) ?? null;
  return {
    id: row.id as string,
    tenantId,
    categoryId: row.categoryId as string,
    code: row.code as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    defaultSeverity: (row.defaultSeverity as MaintenanceSeverity) ?? 'medium',
    defaultSlaHours: (row.defaultSlaHours as number) ?? 72,
    assetTypeScope: Array.isArray(row.assetTypeScope)
      ? (row.assetTypeScope as string[])
      : [],
    roomScope: Array.isArray(row.roomScope) ? (row.roomScope as string[]) : [],
    evidenceRequired: Boolean(row.evidenceRequired),
    suggestedVendorTags: Array.isArray(row.suggestedVendorTags)
      ? (row.suggestedVendorTags as string[])
      : [],
    active: Boolean(row.active),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: toIso(row.createdAt as Date | string),
    updatedAt: toIso(row.updatedAt as Date | string),
    isPlatformDefault: tenantId === null,
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

// Prevent "unused import" complaints when drizzle conditions are narrowed
// away by @ts-nocheck.
void and;
