/**
 * Postgres-backed Damage Deduction Repository (Wave 3).
 *
 * Implements DamageDeductionRepository + additional repo operations
 * (updateStatus, appendTurn, setEvidenceBundleId, listOpen) against the
 * `damage_deduction_cases` table (migration 0017).
 *
 * Tenant isolation is enforced in every query via WHERE tenant_id = :ctx.
 * Negotiation turns are appended (never mutated in place) so the JSON
 * turn array is effectively append-only.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §8.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { damageDeductionCases } from './damage-deduction.schema.js';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type {
  DamageDeductionCase,
  DamageDeductionCaseId,
  DamageDeductionStatus,
  EvidenceBundleId,
  NegotiationTurn,
} from './damage-deduction-case.js';
import { asDamageDeductionCaseId } from './damage-deduction-case.js';
import type { DamageDeductionRepository } from './damage-deduction-service.js';

// ---------------------------------------------------------------------------
// Drizzle client contract
// ---------------------------------------------------------------------------

export interface PostgresDamageDeductionRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresDamageDeductionRepository
  implements DamageDeductionRepository
{
  constructor(private readonly db: PostgresDamageDeductionRepositoryClient) {}

  async findById(
    id: DamageDeductionCaseId,
    tenantId: TenantId
  ): Promise<DamageDeductionCase | null> {
    const rows = await this.db
      .select()
      .from(damageDeductionCases)
      .where(
        and(
          eq(damageDeductionCases.id, id as unknown as string),
          eq(damageDeductionCases.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return rowToEntity(row);
  }

  async create(entity: DamageDeductionCase): Promise<DamageDeductionCase> {
    await this.db.insert(damageDeductionCases).values(entityToRow(entity));
    return entity;
  }

  async update(entity: DamageDeductionCase): Promise<DamageDeductionCase> {
    await this.db
      .update(damageDeductionCases)
      .set(entityToRow(entity))
      .where(
        and(
          eq(damageDeductionCases.id, entity.id as unknown as string),
          eq(damageDeductionCases.tenantId, entity.tenantId as unknown as string)
        )
      );
    return entity;
  }

  // -------------------------------------------------------------------------
  // Repo-only amendment surface (wave 3)
  // -------------------------------------------------------------------------

  async updateStatus(
    id: DamageDeductionCaseId,
    tenantId: TenantId,
    status: DamageDeductionStatus,
    actor: UserId
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(damageDeductionCases)
      .set({
        status,
        updatedAt: now,
        updatedBy: actor as unknown as string,
      })
      .where(
        and(
          eq(damageDeductionCases.id, id as unknown as string),
          eq(damageDeductionCases.tenantId, tenantId as unknown as string)
        )
      );
  }

  /**
   * Append-only turn log. Read-modify-write inside a single statement via
   * drizzle's `sql` would be preferable; we use read-then-write at the repo
   * layer to keep the abstraction portable. Callers guard concurrency via
   * the surrounding service optimistic check.
   */
  async appendTurn(
    id: DamageDeductionCaseId,
    tenantId: TenantId,
    turn: NegotiationTurn
  ): Promise<void> {
    const existing = await this.findById(id, tenantId);
    if (!existing) return;
    const now = new Date();
    const nextTurns = [...existing.aiMediatorTurns, turn];
    await this.db
      .update(damageDeductionCases)
      .set({
        aiMediatorTurns: nextTurns,
        updatedAt: now,
      })
      .where(
        and(
          eq(damageDeductionCases.id, id as unknown as string),
          eq(damageDeductionCases.tenantId, tenantId as unknown as string)
        )
      );
  }

  async setEvidenceBundleId(
    id: DamageDeductionCaseId,
    tenantId: TenantId,
    bundleId: EvidenceBundleId,
    actor: UserId
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(damageDeductionCases)
      .set({
        evidenceBundleId: bundleId as unknown as string,
        updatedAt: now,
        updatedBy: actor as unknown as string,
      })
      .where(
        and(
          eq(damageDeductionCases.id, id as unknown as string),
          eq(damageDeductionCases.tenantId, tenantId as unknown as string)
        )
      );
  }

  async listOpen(tenantId: TenantId): Promise<readonly DamageDeductionCase[]> {
    const openStatuses: DamageDeductionStatus[] = [
      'claim_filed',
      'tenant_responded',
      'negotiating',
      'escalated',
    ];
    const rows = await this.db
      .select()
      .from(damageDeductionCases)
      .where(
        and(
          eq(damageDeductionCases.tenantId, tenantId as unknown as string),
          inArray(damageDeductionCases.status, openStatuses)
        )
      );
    return rows.map(rowToEntity);
  }
}

// ---------------------------------------------------------------------------
// Row <-> Entity mapping
// ---------------------------------------------------------------------------

function entityToRow(entity: DamageDeductionCase): Record<string, unknown> {
  const createdAt =
    typeof entity.createdAt === 'string' ? new Date(entity.createdAt) : entity.createdAt;
  const updatedAt =
    typeof entity.updatedAt === 'string' ? new Date(entity.updatedAt) : entity.updatedAt;
  return {
    id: entity.id as unknown as string,
    tenantId: entity.tenantId as unknown as string,
    leaseId: (entity.leaseId as unknown as string) ?? null,
    caseId: (entity.caseId as unknown as string) ?? null,
    moveOutInspectionId: (entity.moveOutInspectionId as unknown as string) ?? null,
    claimedDeductionMinor: entity.claimedDeductionMinor,
    proposedDeductionMinor: entity.proposedDeductionMinor ?? null,
    tenantCounterProposalMinor: entity.tenantCounterProposalMinor ?? null,
    currency: entity.currency,
    status: entity.status,
    evidenceBundleId: (entity.evidenceBundleId as unknown as string) ?? null,
    aiMediatorTurns: entity.aiMediatorTurns,
    createdAt,
    updatedAt,
    createdBy: entity.createdBy as unknown as string,
    updatedBy: entity.updatedBy as unknown as string,
  };
}

type DamageDeductionRow = typeof damageDeductionCases.$inferSelect;

function rowToEntity(row: DamageDeductionRow): DamageDeductionCase {
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  const updatedAt =
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt;
  return {
    id: asDamageDeductionCaseId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    leaseId: (row.leaseId ?? undefined) as DamageDeductionCase['leaseId'],
    caseId: (row.caseId ?? undefined) as DamageDeductionCase['caseId'],
    moveOutInspectionId: (row.moveOutInspectionId ?? undefined) as DamageDeductionCase['moveOutInspectionId'],
    claimedDeductionMinor: Number(row.claimedDeductionMinor ?? 0),
    proposedDeductionMinor:
      row.proposedDeductionMinor != null ? Number(row.proposedDeductionMinor) : undefined,
    tenantCounterProposalMinor:
      row.tenantCounterProposalMinor != null
        ? Number(row.tenantCounterProposalMinor)
        : undefined,
    // Currency is persisted in the row by `create` (caller-provided
    // from region-config); we don't substitute a TZS default.
    currency: row.currency ?? '',
    status: (row.status ?? 'claim_filed') as DamageDeductionStatus,
    evidenceBundleId: (row.evidenceBundleId ?? undefined) as DamageDeductionCase['evidenceBundleId'],
    aiMediatorTurns: Array.isArray(row.aiMediatorTurns) ? row.aiMediatorTurns : [],
    createdAt: createdAt as ISOTimestamp,
    updatedAt: updatedAt as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
    updatedBy: row.updatedBy as unknown as UserId,
  };
}
