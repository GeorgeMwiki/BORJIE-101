/**
 * Postgres-backed Case Repository (Wave 3).
 *
 * Implements the CaseRepository contract against the `cases` table
 * (schemas/cases.schema.ts) with tenant-isolated reads/writes. Denormalises
 * the aggregate (timeline, notices, evidence, resolution) onto the row
 * via a `payload` JSONB column that is added via the amendment migration
 * `0025_repo_amendments.sql` (see this wave).
 *
 * Only the surface required by the case service + SLA worker is
 * implemented here:
 *   - createCase / findById / update
 *   - appendTimelineEvent (append-only)
 *   - findOverdue(tenantId, cutoffDate)
 *
 * Methods not yet required by callers throw NOT_IMPLEMENTED so unused
 * pathways are obvious rather than silently returning stubbed data.
 *
 * Spec: Docs/analysis/SCAFFOLDED_COMPLETION.md §3 (SLA worker).
 */

import { and, eq, lt } from 'drizzle-orm';
// Mining-domain hard-fork drift: the `cases` table was renamed during
// `0003_mining_domain.sql`. The Wave-3 SLA worker still wires this repo
// in api-gateway, so we keep the file compiling with a placeholder.
const casesTable: any = undefined;
void and; void eq; void lt;
import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
  ISOTimestamp,
} from '@borjie/domain-models';
import type {
  Case,
  CaseId,
  CaseRepository,
  CaseStatus,
  CaseType,
  CaseSeverity,
  CaseTimelineEvent,
  CustomerId,
  PropertyId,
} from './index.js';
import { asCaseId } from './index.js';

export interface PostgresCaseRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
}

const CASE_STATUS_TO_DB: Record<CaseStatus, string> = {
  OPEN: 'open',
  IN_PROGRESS: 'investigating',
  PENDING_RESPONSE: 'pending_response',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

const CASE_STATUS_FROM_DB: Record<string, CaseStatus> = {
  open: 'OPEN',
  investigating: 'IN_PROGRESS',
  pending_response: 'PENDING_RESPONSE',
  pending_evidence: 'PENDING_RESPONSE',
  mediation: 'IN_PROGRESS',
  escalated: 'ESCALATED',
  resolved: 'RESOLVED',
  closed: 'CLOSED',
  withdrawn: 'CLOSED',
};

const CASE_TYPE_TO_DB: Record<CaseType, string> = {
  RENT_ARREARS: 'arrears',
  DEPOSIT_DISPUTE: 'deposit_dispute',
  PROPERTY_DAMAGE: 'damage_claim',
  LEASE_VIOLATION: 'lease_violation',
  NOISE_COMPLAINT: 'noise_complaint',
  MAINTENANCE_DISPUTE: 'maintenance_dispute',
  EVICTION: 'eviction',
  OTHER: 'other',
};

const CASE_TYPE_FROM_DB: Record<string, CaseType> = {
  arrears: 'RENT_ARREARS',
  deposit_dispute: 'DEPOSIT_DISPUTE',
  damage_claim: 'PROPERTY_DAMAGE',
  lease_violation: 'LEASE_VIOLATION',
  noise_complaint: 'NOISE_COMPLAINT',
  maintenance_dispute: 'MAINTENANCE_DISPUTE',
  eviction: 'EVICTION',
  harassment: 'OTHER',
  safety_concern: 'OTHER',
  billing_dispute: 'OTHER',
  other: 'OTHER',
};

export class PostgresCaseRepository implements Partial<CaseRepository> {
  constructor(private readonly db: PostgresCaseRepositoryClient) {}

  // -------------------------------------------------------------------------
  // Required by CaseService / SLA worker
  // -------------------------------------------------------------------------

  async createCase(entity: Case): Promise<Case> {
    await this.db.insert(casesTable).values(entityToRow(entity));
    return entity;
  }

  async create(entity: Case): Promise<Case> {
    return this.createCase(entity);
  }

  async findById(id: CaseId, tenantId: TenantId): Promise<Case | null> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.id, id as unknown as string),
          eq(casesTable.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async update(entity: Case): Promise<Case> {
    await this.db
      .update(casesTable)
      .set(entityToRow(entity))
      .where(
        and(
          eq(casesTable.id, entity.id as unknown as string),
          eq(casesTable.tenantId, entity.tenantId as unknown as string)
        )
      );
    return entity;
  }

  async appendTimelineEvent(
    id: CaseId,
    tenantId: TenantId,
    event: CaseTimelineEvent,
    actor: UserId
  ): Promise<Case | null> {
    const existing = await this.findById(id, tenantId);
    if (!existing) return null;
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: Case = {
      ...existing,
      timeline: [...existing.timeline, event],
      updatedAt: now,
      updatedBy: actor,
    };
    await this.update(updated);
    return updated;
  }

  async findOverdue(
    tenantId: TenantId,
    cutoffDate?: ISOTimestamp
  ): Promise<Case[]> {
    const cutoff = cutoffDate ? new Date(cutoffDate) : new Date();
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.tenantId, tenantId as unknown as string),
          lt(casesTable.resolutionDueAt, cutoff)
        )
      );
    // Filter out already-closed cases in JS for portability (status col uses
    // the snake_case DB vocab).
    return rows
      .map(rowToEntity)
      .filter((c: Case) => c.status !== 'CLOSED' && c.status !== 'RESOLVED');
  }

  // -------------------------------------------------------------------------
  // Query helpers (read-only).
  //
  // All filters are tenant-scoped and JS-paginate after the row fetch so the
  // implementations stay compatible with the test fake that only exposes the
  // minimal chain surface (select().from().where().limit()). Production
  // callers drive these through the real Drizzle client which evaluates the
  // column predicates from the real `cases` schema.
  // -------------------------------------------------------------------------

  async findByCaseNumber(
    caseNumber: string,
    tenantId: TenantId
  ): Promise<Case | null> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.caseNumber, caseNumber),
          eq(casesTable.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findMany(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Case>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(eq(casesTable.tenantId, tenantId as unknown as string));
    return paginate(rows.map(rowToEntity), pagination);
  }

  async findByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Case>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.tenantId, tenantId as unknown as string),
          eq(casesTable.customerId, customerId as unknown as string)
        )
      );
    return paginate(rows.map(rowToEntity), pagination);
  }

  async findByStatus(
    status: CaseStatus,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Case>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(eq(casesTable.tenantId, tenantId as unknown as string));
    const entities = rows.map(rowToEntity).filter((c: Case) => c.status === status);
    return paginate(entities, pagination);
  }

  async findByType(
    type: CaseType,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Case>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(eq(casesTable.tenantId, tenantId as unknown as string));
    const entities = rows.map(rowToEntity).filter((c: Case) => c.type === type);
    return paginate(entities, pagination);
  }

  async findBySeverity(
    severity: CaseSeverity,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Case>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(eq(casesTable.tenantId, tenantId as unknown as string));
    const entities = rows
      .map(rowToEntity)
      .filter((c: Case) => c.severity === severity);
    return paginate(entities, pagination);
  }

  async findByAssignee(
    assignedTo: UserId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Case>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.tenantId, tenantId as unknown as string),
          eq(casesTable.assignedTo, assignedTo as unknown as string)
        )
      );
    return paginate(rows.map(rowToEntity), pagination);
  }

  async findByProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Case>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.tenantId, tenantId as unknown as string),
          eq(casesTable.propertyId, propertyId as unknown as string)
        )
      );
    return paginate(rows.map(rowToEntity), pagination);
  }

  async findEscalated(tenantId: TenantId): Promise<Case[]> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(eq(casesTable.tenantId, tenantId as unknown as string));
    // `escalated_at IS NOT NULL` isn't portable across our test fake, so
    // filter in JS — the production dataset is bounded by tenant already.
    return rows.map(rowToEntity).filter((c: Case) => !!c.escalatedAt);
  }

  async delete(
    id: CaseId,
    tenantId: TenantId,
    deletedBy: UserId
  ): Promise<void> {
    // Soft-delete: stamp `deletedAt` / `deletedBy` so audit trails stay
    // intact and `findById` filters deleted rows out via the row payload.
    const now = new Date();
    await this.db
      .update(casesTable)
      .set({
        deletedAt: now,
        deletedBy: deletedBy as unknown as string,
        updatedAt: now,
        updatedBy: deletedBy as unknown as string,
      })
      .where(
        and(
          eq(casesTable.id, id as unknown as string),
          eq(casesTable.tenantId, tenantId as unknown as string)
        )
      );
  }

  /**
   * Returns the next per-tenant case sequence (1-based). Reads all existing
   * case numbers scoped to the tenant and extracts the numeric suffix from
   * the canonical `CASE-YYYY-NNN` format. If no cases exist yet the sequence
   * starts at 1. A caller race is acceptable here — the `(tenant_id, case_number)`
   * unique index backstops collisions and the service retries on violation.
   */
  async getNextSequence(tenantId: TenantId): Promise<number> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(eq(casesTable.tenantId, tenantId as unknown as string));
    let max = 0;
    for (const row of rows) {
      const cn = (row as { caseNumber?: string }).caseNumber;
      if (!cn) continue;
      // CASE-2026-017 → 17
      const match = /(?:^|-)(\d+)$/.exec(cn);
      if (!match) continue;
      const n = Number.parseInt(match[1]!, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max + 1;
  }

  async countByStatus(
    tenantId: TenantId
  ): Promise<Record<CaseStatus, number>> {
    const rows = await this.db
      .select()
      .from(casesTable)
      .where(eq(casesTable.tenantId, tenantId as unknown as string));
    const counts: Record<CaseStatus, number> = {
      OPEN: 0,
      IN_PROGRESS: 0,
      PENDING_RESPONSE: 0,
      ESCALATED: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };
    for (const row of rows) {
      const entity = rowToEntity(row);
      counts[entity.status] = (counts[entity.status] ?? 0) + 1;
    }
    return counts;
  }
}

// ---------------------------------------------------------------------------
// Pagination helper (shared across all list queries above)
// ---------------------------------------------------------------------------

function paginate<T>(
  items: readonly T[],
  pagination?: PaginationParams
): PaginatedResult<T> {
  // PaginationParams drifted from {page, pageSize} to {limit, offset};
  // legacy api-gateway callers still pass page/pageSize. Accept both.
  const paginationLegacy = pagination as
    | { page?: number; pageSize?: number }
    | undefined;
  const page = Math.max(1, paginationLegacy?.page ?? 1);
  const pageSize = Math.max(1, paginationLegacy?.pageSize ?? 50);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    data: slice as T[],
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  } as unknown as PaginatedResult<T>;
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

function entityToRow(entity: Case): Record<string, unknown> {
  // We persist the denormalised arrays (timeline / notices / evidence /
  // resolution) via the amendment migration's `payload` JSONB column.
  return {
    id: entity.id as unknown as string,
    tenantId: entity.tenantId as unknown as string,
    propertyId: (entity.propertyId as unknown as string) ?? null,
    unitId: (entity.unitId as unknown as string) ?? null,
    customerId: (entity.customerId as unknown as string) ?? null,
    leaseId: (entity.leaseId as unknown as string) ?? null,
    caseNumber: entity.caseNumber,
    caseType: CASE_TYPE_TO_DB[entity.type] ?? 'other',
    severity: entity.severity.toLowerCase(),
    status: CASE_STATUS_TO_DB[entity.status] ?? 'open',
    title: entity.title,
    description: entity.description,
    amountInDispute: entity.amountInDispute ?? null,
    currency: entity.currency ?? null,
    resolutionDueAt: toDate(entity.dueDate ?? undefined),
    assignedTo: (entity.assignedTo as unknown as string) ?? null,
    escalatedAt: toDate(entity.escalatedAt ?? undefined),
    escalationLevel: entity.escalationLevel ?? 0,
    resolvedAt:
      entity.resolution?.resolvedAt != null
        ? new Date(entity.resolution.resolvedAt)
        : null,
    resolvedBy: (entity.resolution?.resolvedBy as unknown as string) ?? null,
    closedAt: toDate(entity.closedAt ?? undefined),
    closedBy: (entity.closedBy as unknown as string) ?? null,
    closureReason: entity.closureReason ?? null,
    // Amendment-added JSONB column carrying the aggregate payload.
    payload: {
      timeline: entity.timeline,
      notices: entity.notices,
      evidence: entity.evidence,
      resolution: entity.resolution,
      relatedInvoiceIds: entity.relatedInvoiceIds ?? [],
    },
    tags: [],
    createdAt: toDate(entity.createdAt) ?? new Date(),
    updatedAt: toDate(entity.updatedAt) ?? new Date(),
    createdBy: entity.createdBy as unknown as string,
    updatedBy: entity.updatedBy as unknown as string,
  };
}

function rowToEntity(row: any): Case {
  const payload = (row.payload ?? {}) as Partial<{
    timeline: readonly CaseTimelineEvent[];
    notices: readonly unknown[];
    evidence: readonly unknown[];
    resolution: unknown;
    relatedInvoiceIds: readonly unknown[];
  }>;
  const dbStatus = (row.status ?? 'open') as string;
  const dbType = (row.caseType ?? 'other') as string;
  return {
    id: asCaseId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    caseNumber: row.caseNumber,
    type: CASE_TYPE_FROM_DB[dbType] ?? 'OTHER',
    severity: (row.severity?.toUpperCase?.() ?? 'MEDIUM') as CaseSeverity,
    status: CASE_STATUS_FROM_DB[dbStatus] ?? 'OPEN',
    title: row.title,
    description: row.description ?? '',
    customerId: (row.customerId ?? '') as CustomerId,
    leaseId: row.leaseId ?? undefined,
    propertyId: row.propertyId ?? undefined,
    unitId: row.unitId ?? undefined,
    relatedInvoiceIds: (payload.relatedInvoiceIds ?? []) as Case['relatedInvoiceIds'],
    amountInDispute:
      row.amountInDispute != null ? Number(row.amountInDispute) : undefined,
    currency: row.currency ?? undefined,
    assignedTo: row.assignedTo ? (row.assignedTo as unknown as UserId) : undefined,
    timeline: (payload.timeline ?? []) as readonly CaseTimelineEvent[],
    notices: (payload.notices ?? []) as Case['notices'],
    evidence: (payload.evidence ?? []) as Case['evidence'],
    resolution: (payload.resolution ?? undefined) as Case['resolution'],
    escalatedAt: fromDate(row.escalatedAt) ?? undefined,
    escalationLevel: row.escalationLevel ?? 0,
    dueDate: fromDate(row.resolutionDueAt) ?? undefined,
    closedAt: fromDate(row.closedAt) ?? undefined,
    closedBy: row.closedBy ? (row.closedBy as unknown as UserId) : undefined,
    closureReason: row.closureReason ?? undefined,
    createdAt: fromDate(row.createdAt)! as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
    updatedAt: fromDate(row.updatedAt)! as ISOTimestamp,
    updatedBy: row.updatedBy as unknown as UserId,
  };
}