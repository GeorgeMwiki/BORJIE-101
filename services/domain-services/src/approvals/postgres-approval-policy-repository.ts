/**
 * Postgres-backed Approval Policy Repository
 *
 * Implements ApprovalPolicyOverrideRepository using Drizzle ORM against the
 * `approval_policies` table (migration 0018). Row-level tenant isolation is
 * enforced in every query via WHERE tenant_id = :ctx. The composite primary
 * key (tenant_id, type) is used by the UPSERT (onConflictDoUpdate) path.
 *
 * Defaults in default-policies.ts remain the fallback floor — this repo only
 * stores overrides, and absence of a row means "use the default".
 */

import { and, eq } from 'drizzle-orm';
import { approvalPolicies } from '@borjie/database';
import type { TenantId, UserId } from '@borjie/domain-models';
import type { ApprovalPolicy, ApprovalType } from './types.js';
import type { ApprovalPolicyOverrideRepository } from './approval-policy-repository.interface.js';

/** Minimal Drizzle client shape this repo needs (avoids hard coupling). */
export interface PostgresApprovalPolicyRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  delete?: (...args: unknown[]) => any;
}

export class PostgresApprovalPolicyRepository
  implements ApprovalPolicyOverrideRepository
{
  constructor(private readonly db: PostgresApprovalPolicyRepositoryClient) {}

  async findPolicy(
    tenantId: TenantId,
    type: ApprovalType
  ): Promise<ApprovalPolicy | null> {
    const rows = await this.db
      .select()
      .from(approvalPolicies)
      .where(
        and(
          eq(approvalPolicies.tenantId, tenantId as unknown as string),
          eq(approvalPolicies.type, type)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return rowToPolicy(row);
  }

  async upsertPolicy(
    tenantId: TenantId,
    type: ApprovalType,
    policy: ApprovalPolicy,
    actor: UserId
  ): Promise<void> {
    const now = new Date();
    // The policy object the caller hands us may or may not already carry
    // tenantId/type/updatedAt/updatedBy — we normalize both the row and the
    // stored JSON blob so the DB is the source of truth.
    const normalized: ApprovalPolicy = {
      ...policy,
      tenantId,
      type,
      updatedAt: now.toISOString(),
      updatedBy: actor,
    };
    await this.db
      .insert(approvalPolicies)
      .values({
        tenantId: tenantId as unknown as string,
        type,
        policyJson: normalized,
        updatedAt: now,
        updatedBy: actor as unknown as string,
      })
      .onConflictDoUpdate({
        target: [approvalPolicies.tenantId, approvalPolicies.type],
        set: {
          policyJson: normalized,
          updatedAt: now,
          updatedBy: actor as unknown as string,
        },
      });
  }

  async listPolicies(tenantId: TenantId): Promise<readonly ApprovalPolicy[]> {
    const rows = await this.db
      .select()
      .from(approvalPolicies)
      .where(eq(approvalPolicies.tenantId, tenantId as unknown as string));
    return rows.map(rowToPolicy);
  }
}

function rowToPolicy(row: {
  tenantId: string;
  type: string;
  policyJson: unknown;
  updatedAt: Date | string | null;
  updatedBy: string | null;
}): ApprovalPolicy {
  const json = (row.policyJson ?? {}) as Partial<ApprovalPolicy>;
  const updatedAt =
    row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : (row.updatedAt ?? new Date().toISOString());
  return {
    tenantId: row.tenantId as unknown as TenantId,
    type: row.type as ApprovalType,
    thresholds: json.thresholds ?? [],
    autoApproveRules: json.autoApproveRules ?? [],
    approvalChain: json.approvalChain ?? [],
    defaultTimeoutHours: json.defaultTimeoutHours ?? 48,
    autoEscalateToRole: json.autoEscalateToRole ?? null,
    updatedAt: (json.updatedAt ?? updatedAt) as ApprovalPolicy['updatedAt'],
    updatedBy: (row.updatedBy ?? json.updatedBy ?? '') as unknown as UserId,
  };
}
