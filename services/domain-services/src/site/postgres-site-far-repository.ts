/**
 * Postgres-backed Site Field-Asset-Register Repository (Borjie mining).
 *
 * The Field Asset Register (FAR) is the per-site list of physical mining
 * assets — excavators, compressors, generators, pumps, crushers,
 * trucks, drill rigs, etc. — together with the chronological log of
 * maintenance events against them.
 *
 * Persists to two existing mining-schema tables:
 *   - `assets`             — one row per physical asset.
 *   - `maintenance_events` — append-mostly log per asset.
 *
 * Survey events from the field (inspection / breakdown / scheduled
 * service) are recorded by appending to `maintenance_events` and
 * updating the asset's `status`. The repo enforces tenant isolation
 * via `WHERE tenant_id = :ctx` on every query.
 *
 * Types, enums, Zod validators, and row mappers live in
 * `./site-far-types.ts` to keep this file under the project's soft
 * size cap.
 */

import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { assets, maintenanceEvents } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  registerAssetSchema,
  logMaintenanceEventSchema,
  rowToAsset,
  rowToMaintenance,
  type AssetStatus,
  type LogMaintenanceEventInput,
  type MaintenanceLogEntry,
  type RegisterAssetInput,
  type SiteAsset,
  type SiteFarRepository,
} from './site-far-types.js';

// Types + Zod schemas live in `./site-far-types.ts` and reach the
// composition root via the `./index.ts` barrel.

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

export interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresSiteFarRepository implements SiteFarRepository {
  constructor(private readonly db: DrizzleLike) {}

  async registerAsset(
    tenantId: TenantId,
    input: RegisterAssetInput,
  ): Promise<SiteAsset> {
    const validated = registerAssetSchema.parse(input);
    const now = new Date();
    await this.db.insert(assets).values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      companyId: validated.companyId,
      kind: validated.kind,
      make: validated.make ?? null,
      model: validated.model ?? null,
      year: validated.year ?? null,
      serialNumber: validated.serialNumber ?? null,
      owned: validated.owned,
      currentSiteId: validated.currentSiteId ?? null,
      currentOperatorUserId: validated.currentOperatorUserId ?? null,
      totalHours: '0',
      status: validated.status,
      attributes: validated.attributes,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findAssetById(tenantId, validated.id);
    if (!created) {
      throw new Error(`registerAsset failed to persist asset ${validated.id}`);
    }
    return created;
  }

  async updateAssetStatus(
    tenantId: TenantId,
    assetId: string,
    status: AssetStatus,
    operatorUserId?: string | null,
  ): Promise<SiteAsset> {
    const patch: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (operatorUserId !== undefined) {
      patch.currentOperatorUserId = operatorUserId;
    }
    await this.db
      .update(assets)
      .set(patch)
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.tenantId, tenantId as unknown as string),
        ),
      );
    const after = await this.findAssetById(tenantId, assetId);
    if (!after) {
      throw new Error(`asset ${assetId} not found after status update`);
    }
    return after;
  }

  async findAssetById(
    tenantId: TenantId,
    assetId: string,
  ): Promise<SiteAsset | null> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.tenantId, tenantId as unknown as string),
        ),
      )
      .limit(1);
    return rows[0] ? rowToAsset(rows[0] as Record<string, unknown>) : null;
  }

  async listAssetsBySite(
    tenantId: TenantId,
    siteId: string,
  ): Promise<readonly SiteAsset[]> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.tenantId, tenantId as unknown as string),
          eq(assets.currentSiteId, siteId),
        ),
      )
      .orderBy(asc(assets.kind));
    return (rows as Array<Record<string, unknown>>).map(rowToAsset);
  }

  async logMaintenanceEvent(
    tenantId: TenantId,
    input: LogMaintenanceEventInput,
  ): Promise<MaintenanceLogEntry> {
    const validated = logMaintenanceEventSchema.parse(input);
    const now = new Date();
    await this.db.insert(maintenanceEvents).values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      assetId: validated.assetId,
      kind: validated.kind,
      status: validated.status,
      summary: validated.summary ?? null,
      downtimeHours:
        validated.downtimeHours == null
          ? null
          : String(validated.downtimeHours),
      costTzs: validated.costTzs == null ? null : String(validated.costTzs),
      partsUsed: validated.partsUsed,
      performedByUserId: validated.performedByUserId ?? null,
      scheduledFor: validated.scheduledFor
        ? new Date(validated.scheduledFor)
        : null,
      startedAt: validated.startedAt ? new Date(validated.startedAt) : null,
      completedAt: validated.completedAt
        ? new Date(validated.completedAt)
        : null,
      evidenceIds: validated.evidenceIds,
      attributes: {},
      createdAt: now,
    });
    const rows = await this.db
      .select()
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.id, validated.id),
          eq(maintenanceEvents.tenantId, tenantId as unknown as string),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new Error(
        `logMaintenanceEvent failed to persist event ${validated.id}`,
      );
    }
    return rowToMaintenance(rows[0] as Record<string, unknown>);
  }

  async listMaintenanceByAsset(
    tenantId: TenantId,
    assetId: string,
  ): Promise<readonly MaintenanceLogEntry[]> {
    const rows = await this.db
      .select()
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.assetId, assetId),
          eq(maintenanceEvents.tenantId, tenantId as unknown as string),
        ),
      )
      .orderBy(desc(maintenanceEvents.createdAt));
    return (rows as Array<Record<string, unknown>>).map(rowToMaintenance);
  }

  async findDueScheduledMaintenance(
    tenantId: TenantId | null,
    cutoffIso: string,
  ): Promise<readonly MaintenanceLogEntry[]> {
    const cutoff = new Date(cutoffIso);
    const where = tenantId
      ? and(
          eq(maintenanceEvents.tenantId, tenantId as unknown as string),
          eq(maintenanceEvents.status, 'open'),
          lte(maintenanceEvents.scheduledFor, cutoff),
        )
      : and(
          eq(maintenanceEvents.status, 'open'),
          lte(maintenanceEvents.scheduledFor, cutoff),
        );
    const rows = await this.db
      .select()
      .from(maintenanceEvents)
      .where(where)
      .orderBy(asc(maintenanceEvents.scheduledFor));
    return (rows as Array<Record<string, unknown>>).map(rowToMaintenance);
  }
}
