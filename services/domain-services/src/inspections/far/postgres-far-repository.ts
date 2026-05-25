/**
 * Postgres-backed FAR Repository (Wave 3).
 *
 * Implements FarRepository against the asset-components / FAR tables
 * (migration 0019_far_asset_components):
 *   - asset_components
 *   - far_assignments
 *   - condition_check_events
 *
 * Check events are append-only. Assignments are updatable (status +
 * nextCheckDueAt bumps); components are updatable via update/create.
 * Tenant isolation is enforced in every query.
 *
 * Spec: NEW 16.
 */

import { and, eq, lte } from 'drizzle-orm';
import {
  assetComponents,
  farAssignments,
  conditionCheckEvents,
} from '@borjie/database';
import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  ISOTimestamp,
} from '@borjie/domain-models';
import type {
  AssetComponent,
  AssetComponentId,
  AssetComponentStatus,
  AssetComponentCondition,
  FarAssignment,
  FarAssignmentId,
  FarAssignmentStatus,
  FarCheckFrequency,
  ConditionCheckEvent,
  ConditionCheckEventId,
  ConditionCheckOutcome,
  FarRepository,
  NotifyRecipient,
} from './types.js';
import {
  asAssetComponentId,
  asFarAssignmentId,
  asConditionCheckEventId,
} from './types.js';

export interface PostgresFarRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
}

export class PostgresFarRepository implements FarRepository {
  constructor(private readonly db: PostgresFarRepositoryClient) {}

  async findComponentById(
    id: AssetComponentId,
    tenantId: TenantId
  ): Promise<AssetComponent | null> {
    const rows = await this.db
      .select()
      .from(assetComponents)
      .where(
        and(
          eq(assetComponents.id, id as unknown as string),
          eq(assetComponents.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    return rows[0] ? rowToComponent(rows[0]) : null;
  }

  async findAssignmentById(
    id: FarAssignmentId,
    tenantId: TenantId
  ): Promise<FarAssignment | null> {
    const rows = await this.db
      .select()
      .from(farAssignments)
      .where(
        and(
          eq(farAssignments.id, id as unknown as string),
          eq(farAssignments.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    return rows[0] ? rowToAssignment(rows[0]) : null;
  }

  async createComponent(input: AssetComponent): Promise<AssetComponent> {
    await this.db.insert(assetComponents).values(componentToRow(input));
    return input;
  }

  async createAssignment(input: FarAssignment): Promise<FarAssignment> {
    await this.db.insert(farAssignments).values(assignmentToRow(input));
    return input;
  }

  async updateAssignment(input: FarAssignment): Promise<FarAssignment> {
    await this.db
      .update(farAssignments)
      .set(assignmentToRow(input))
      .where(
        and(
          eq(farAssignments.id, input.id as unknown as string),
          eq(farAssignments.tenantId, input.tenantId as unknown as string)
        )
      );
    return input;
  }

  async createCheckEvent(input: ConditionCheckEvent): Promise<ConditionCheckEvent> {
    await this.db.insert(conditionCheckEvents).values(eventToRow(input));
    return input;
  }

  async findDueAssignments(
    tenantId: TenantId | null,
    now: ISOTimestamp
  ): Promise<readonly FarAssignment[]> {
    const cutoff = new Date(now);
    const where = tenantId
      ? and(
          eq(farAssignments.tenantId, tenantId as unknown as string),
          eq(farAssignments.status, 'active'),
          lte(farAssignments.nextCheckDueAt, cutoff)
        )
      : and(
          eq(farAssignments.status, 'active'),
          lte(farAssignments.nextCheckDueAt, cutoff)
        );
    const rows = await this.db.select().from(farAssignments).where(where);
    return rows.map(rowToAssignment);
  }

  async findScheduledChecks(
    tenantId: TenantId,
    componentId?: AssetComponentId
  ): Promise<readonly ConditionCheckEvent[]> {
    const where = componentId
      ? and(
          eq(conditionCheckEvents.tenantId, tenantId as unknown as string),
          eq(conditionCheckEvents.componentId, componentId as unknown as string)
        )
      : eq(conditionCheckEvents.tenantId, tenantId as unknown as string);
    const rows = await this.db.select().from(conditionCheckEvents).where(where);
    return rows.map(rowToEvent);
  }

  // -------------------------------------------------------------------------
  // Amendment operation (Wave 3) — scheduler-friendly alias.
  // -------------------------------------------------------------------------

  async findDue(
    tenantId: TenantId,
    currentTime: ISOTimestamp
  ): Promise<readonly FarAssignment[]> {
    return this.findDueAssignments(tenantId, currentTime);
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toDate(v: ISOTimestamp | null | undefined): Date | null {
  if (!v) return null;
  return typeof v === 'string' ? new Date(v) : v;
}

function fromDate(v: Date | string | null | undefined): ISOTimestamp | null {
  if (!v) return null;
  return (v instanceof Date ? v.toISOString() : v) as ISOTimestamp;
}

function componentToRow(c: AssetComponent): Record<string, unknown> {
  return {
    id: c.id as unknown as string,
    tenantId: c.tenantId as unknown as string,
    propertyId: c.propertyId as unknown as string,
    unitId: (c.unitId as unknown as string) ?? null,
    code: c.code,
    name: c.name,
    category: c.category,
    manufacturer: c.manufacturer,
    modelNumber: c.modelNumber,
    serialNumber: c.serialNumber,
    installedAt: toDate(c.installedAt ?? undefined),
    expectedLifespanMonths: c.expectedLifespanMonths ?? null,
    status: c.status,
    currentCondition: c.currentCondition,
    metadata: c.metadata ?? {},
    createdAt: toDate(c.createdAt) ?? new Date(),
    updatedAt: toDate(c.updatedAt) ?? new Date(),
    createdBy: c.createdBy as unknown as string,
    updatedBy: c.updatedBy as unknown as string,
  };
}

function rowToComponent(row: any): AssetComponent {
  return {
    id: asAssetComponentId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    propertyId: row.propertyId as unknown as PropertyId,
    unitId: row.unitId ? (row.unitId as unknown as UnitId) : null,
    code: row.code,
    name: row.name,
    category: row.category ?? null,
    manufacturer: row.manufacturer ?? null,
    modelNumber: row.modelNumber ?? null,
    serialNumber: row.serialNumber ?? null,
    installedAt: fromDate(row.installedAt),
    expectedLifespanMonths:
      row.expectedLifespanMonths != null ? Number(row.expectedLifespanMonths) : null,
    status: (row.status ?? 'active') as AssetComponentStatus,
    currentCondition: (row.currentCondition ?? 'good') as AssetComponentCondition,
    metadata: (row.metadata ?? {}) as Readonly<Record<string, unknown>>,
    createdAt: fromDate(row.createdAt)! as ISOTimestamp,
    updatedAt: fromDate(row.updatedAt)! as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
    updatedBy: row.updatedBy as unknown as UserId,
  };
}

function assignmentToRow(a: FarAssignment): Record<string, unknown> {
  return {
    id: a.id as unknown as string,
    tenantId: a.tenantId as unknown as string,
    componentId: a.componentId as unknown as string,
    assignedTo: (a.assignedTo as unknown as string) ?? null,
    frequency: a.frequency,
    status: a.status,
    triggerRules: a.triggerRules ?? {},
    firstCheckDueAt: toDate(a.firstCheckDueAt ?? undefined),
    nextCheckDueAt: toDate(a.nextCheckDueAt ?? undefined),
    lastCheckedAt: toDate(a.lastCheckedAt ?? undefined),
    notifyRecipients: a.notifyRecipients ?? [],
    createdAt: toDate(a.createdAt) ?? new Date(),
    updatedAt: toDate(a.updatedAt) ?? new Date(),
    createdBy: a.createdBy as unknown as string,
    updatedBy: a.updatedBy as unknown as string,
  };
}

function rowToAssignment(row: any): FarAssignment {
  return {
    id: asFarAssignmentId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    componentId: asAssetComponentId(row.componentId),
    assignedTo: row.assignedTo ? (row.assignedTo as unknown as UserId) : null,
    frequency: (row.frequency ?? 'monthly') as FarCheckFrequency,
    status: (row.status ?? 'active') as FarAssignmentStatus,
    triggerRules: (row.triggerRules ?? {}) as Readonly<Record<string, unknown>>,
    firstCheckDueAt: fromDate(row.firstCheckDueAt),
    nextCheckDueAt: fromDate(row.nextCheckDueAt),
    lastCheckedAt: fromDate(row.lastCheckedAt),
    notifyRecipients: Array.isArray(row.notifyRecipients)
      ? (row.notifyRecipients as readonly NotifyRecipient[])
      : [],
    createdAt: fromDate(row.createdAt)! as ISOTimestamp,
    updatedAt: fromDate(row.updatedAt)! as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
    updatedBy: row.updatedBy as unknown as UserId,
  };
}

function eventToRow(e: ConditionCheckEvent): Record<string, unknown> {
  return {
    id: e.id as unknown as string,
    tenantId: e.tenantId as unknown as string,
    farAssignmentId: e.farAssignmentId as unknown as string,
    componentId: e.componentId as unknown as string,
    performedBy: (e.performedBy as unknown as string) ?? null,
    dueAt: toDate(e.dueAt ?? undefined),
    performedAt: toDate(e.performedAt ?? undefined),
    outcome: e.outcome,
    conditionAfter: e.conditionAfter,
    notes: e.notes,
    photos: e.photos ?? [],
    measurements: e.measurements ?? {},
    notificationsLog: e.notificationsLog ?? [],
    createdAt: toDate(e.createdAt) ?? new Date(),
    updatedAt: toDate(e.updatedAt) ?? new Date(),
  };
}

function rowToEvent(row: any): ConditionCheckEvent {
  return {
    id: asConditionCheckEventId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    farAssignmentId: asFarAssignmentId(row.farAssignmentId),
    componentId: asAssetComponentId(row.componentId),
    performedBy: row.performedBy ? (row.performedBy as unknown as UserId) : null,
    dueAt: fromDate(row.dueAt),
    performedAt: fromDate(row.performedAt),
    outcome: (row.outcome ?? 'skipped') as ConditionCheckOutcome,
    conditionAfter: (row.conditionAfter ?? null) as AssetComponentCondition | null,
    notes: row.notes ?? null,
    photos: Array.isArray(row.photos) ? row.photos : [],
    measurements: (row.measurements ?? {}) as Readonly<Record<string, unknown>>,
    notificationsLog: Array.isArray(row.notificationsLog) ? row.notificationsLog : [],
    createdAt: fromDate(row.createdAt)! as ISOTimestamp,
    updatedAt: fromDate(row.updatedAt)! as ISOTimestamp,
  };
}
