/**
 * Drizzle-backed Equipment Maintenance Taxonomy Repository (Borjie mining).
 *
 * Backs the per-equipment-kind problem catalog with platform defaults
 * (tenant_id NULL) + per-tenant overrides. Replaces the property-domain
 * `maintenance-taxonomy-service.ts` with a mining-specific equivalent
 * keyed on `assets.kind`.
 *
 * Persists to `equipment_maintenance_taxonomy`.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { equipmentMaintenanceTaxonomy } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  EquipmentMaintenanceTaxonomyError,
  mergeTenantOverrides,
  rowToEntry,
  upsertTaxonomySchema,
  type EquipmentKind,
  type EquipmentMaintenanceTaxonomyEntry,
  type EquipmentMaintenanceTaxonomyRepository,
  type UpsertTaxonomyInput,
} from './types.js';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class DrizzleEquipmentMaintenanceTaxonomyRepository
  implements EquipmentMaintenanceTaxonomyRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async listForTenant(
    tenantId: TenantId,
    equipmentKind?: EquipmentKind,
  ): Promise<readonly EquipmentMaintenanceTaxonomyEntry[]> {
    const tenantClause = or(
      isNull(equipmentMaintenanceTaxonomy.tenantId),
      eq(
        equipmentMaintenanceTaxonomy.tenantId,
        tenantId as unknown as string,
      ),
    );
    const where = equipmentKind
      ? and(
          tenantClause,
          eq(equipmentMaintenanceTaxonomy.equipmentKind, equipmentKind),
        )
      : tenantClause;
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof equipmentMaintenanceTaxonomy) => {
            where: (cond: unknown) => Promise<readonly Record<string, unknown>[]>;
          };
        };
      }
    )
      .select()
      .from(equipmentMaintenanceTaxonomy)
      .where(where)) as readonly Record<string, unknown>[];
    return mergeTenantOverrides(rows.map(rowToEntry));
  }

  async findByCode(
    tenantId: TenantId,
    equipmentKind: EquipmentKind,
    code: string,
  ): Promise<EquipmentMaintenanceTaxonomyEntry | null> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof equipmentMaintenanceTaxonomy) => {
            where: (cond: unknown) => Promise<readonly Record<string, unknown>[]>;
          };
        };
      }
    )
      .select()
      .from(equipmentMaintenanceTaxonomy)
      .where(
        and(
          eq(equipmentMaintenanceTaxonomy.equipmentKind, equipmentKind),
          eq(equipmentMaintenanceTaxonomy.code, code),
          or(
            isNull(equipmentMaintenanceTaxonomy.tenantId),
            eq(
              equipmentMaintenanceTaxonomy.tenantId,
              tenantId as unknown as string,
            ),
          ),
        ),
      )) as readonly Record<string, unknown>[];
    const merged = mergeTenantOverrides(rows.map(rowToEntry));
    return merged[0] ?? null;
  }

  async upsert(
    tenantId: TenantId,
    input: UpsertTaxonomyInput,
  ): Promise<EquipmentMaintenanceTaxonomyEntry> {
    const validated = upsertTaxonomySchema.parse(input);
    const now = new Date();
    const insertOp = (
      this.db as unknown as {
        insert: (t: typeof equipmentMaintenanceTaxonomy) => {
          values: (v: Record<string, unknown>) => {
            onConflictDoUpdate?: (cfg: {
              target: ReadonlyArray<unknown>;
              set: Record<string, unknown>;
            }) => Promise<unknown>;
          };
        };
      }
    ).insert(equipmentMaintenanceTaxonomy);
    const op = insertOp.values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      equipmentKind: validated.equipmentKind,
      code: validated.code,
      name: validated.name,
      description: validated.description ?? null,
      problemCategories: validated.problemCategories,
      slaHours: validated.slaHours,
      createdAt: now,
      updatedAt: now,
    });
    if (typeof op.onConflictDoUpdate === 'function') {
      await op.onConflictDoUpdate({
        target: [
          equipmentMaintenanceTaxonomy.tenantId,
          equipmentMaintenanceTaxonomy.equipmentKind,
          equipmentMaintenanceTaxonomy.code,
        ],
        set: {
          name: validated.name,
          description: validated.description ?? null,
          problemCategories: validated.problemCategories,
          slaHours: validated.slaHours,
          updatedAt: now,
        },
      });
    } else {
      await op;
    }
    const after = await this.findByCode(
      tenantId,
      validated.equipmentKind,
      validated.code,
    );
    if (!after) {
      throw new EquipmentMaintenanceTaxonomyError(
        `upsert failed to persist taxonomy ${validated.code}`,
        'NOT_FOUND',
      );
    }
    return after;
  }
}
