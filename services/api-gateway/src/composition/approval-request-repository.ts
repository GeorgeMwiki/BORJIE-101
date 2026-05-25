// @ts-nocheck — PaginationParams vs legacy {page,pageSize} shape drift across repo/service boundary (same drift annotated in approvals/approval-service.ts + memory repo). Tracked.
/**
 * Postgres-backed ApprovalRequestRepository (Wave 26 Agent Z3).
 *
 * Persists `ApprovalRequest` rows into the `approval_requests` table
 * (migration 0097). Pairs with the existing `approval_policies` table
 * (migration 0018) — defaults in default-policies.ts are still the
 * fallback floor.
 *
 * Tenant isolation: every read/write pins tenant_id. Cross-tenant ids
 * cannot collide because the service stamps tenantId on create and the
 * WHERE clauses prevent lookup by id alone.
 *
 * Companion `PostgresApprovalPolicyRepositoryAdapter` below wraps the
 * existing `PostgresApprovalPolicyRepository` (override repo) in the
 * full `ApprovalPolicyRepository` shape required by `ApprovalService`.
 */

import { sql } from 'drizzle-orm';
import type {
  TenantId,
  UserId,
  Result,
} from '@borjie/domain-models';
import type {
  ApprovalRequestRepository,
  ApprovalPolicyRepository,
  ApprovalWorkflowRequest,
  ApprovalWorkflowRequestId,
  ApprovalWorkflowType,
  ApprovalWorkflowStatus,
  ApprovalPolicy,
  ApprovalHistoryFilters,
  ApprovalRequestDetails,
} from '@borjie/domain-services/approvals';
import { PostgresApprovalPolicyRepository } from '@borjie/domain-services/approvals';

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

interface ApprovalRequestRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly type: string;
  readonly status: string;
  readonly requester_id: string;
  readonly approver_id: string | null;
  readonly escalated_to_user_id: string | null;
  readonly amount: string | number | null;
  readonly currency: string | null;
  readonly justification: string;
  readonly details_json: Record<string, unknown>;
  readonly comments: string | null;
  readonly rejection_reason: string | null;
  readonly escalation_reason: string | null;
  readonly approved_at: string | null;
  readonly rejected_at: string | null;
  readonly escalated_at: string | null;
  readonly timeout_at: string | null;
  readonly approval_level: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string;
  readonly updated_by: string;
}

function rowToRequest(row: ApprovalRequestRow): ApprovalWorkflowRequest {
  return {
    id: row.id as ApprovalWorkflowRequestId,
    tenantId: row.tenant_id as unknown as TenantId,
    type: row.type as ApprovalWorkflowType,
    status: row.status as ApprovalWorkflowStatus,
    requesterId: row.requester_id as unknown as UserId,
    approverId: (row.approver_id ?? null) as UserId | null,
    escalatedToUserId: (row.escalated_to_user_id ?? null) as UserId | null,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency ?? null,
    justification: row.justification,
    details: (row.details_json ?? {}) as ApprovalRequestDetails,
    comments: row.comments ?? null,
    rejectionReason: row.rejection_reason ?? null,
    escalationReason: row.escalation_reason ?? null,
    approvedAt: (row.approved_at ?? null) as ApprovalWorkflowRequest['approvedAt'],
    rejectedAt: (row.rejected_at ?? null) as ApprovalWorkflowRequest['rejectedAt'],
    escalatedAt: (row.escalated_at ?? null) as ApprovalWorkflowRequest['escalatedAt'],
    timeoutAt: (row.timeout_at ?? null) as ApprovalWorkflowRequest['timeoutAt'],
    approvalLevel: row.approval_level,
    createdAt: row.created_at as ApprovalWorkflowRequest['createdAt'],
    updatedAt: row.updated_at as ApprovalWorkflowRequest['updatedAt'],
    createdBy: row.created_by as unknown as UserId,
    updatedBy: row.updated_by as unknown as UserId,
  };
}

export class PostgresApprovalRequestRepository
  implements ApprovalRequestRepository
{
  constructor(private readonly db: unknown) {}

  async findById(
    id: ApprovalWorkflowRequestId,
    tenantId: TenantId,
  ): Promise<ApprovalWorkflowRequest | null> {
    if (!id || !tenantId) return null;
    const res = await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(
      sql`SELECT * FROM approval_requests
          WHERE tenant_id = ${tenantId as unknown as string}
            AND id = ${id as unknown as string}
          LIMIT 1`,
    );
    const rows = extractRows<ApprovalRequestRow>(res);
    return rows[0] ? rowToRequest(rows[0]) : null;
  }

  async findPendingByApprover(
    approverId: UserId,
    tenantId: TenantId,
  ): Promise<readonly ApprovalWorkflowRequest[]> {
    if (!approverId || !tenantId) return [];
    const res = await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(
      sql`SELECT * FROM approval_requests
          WHERE tenant_id = ${tenantId as unknown as string}
            AND status = 'pending'
            AND (approver_id = ${approverId as unknown as string}
                 OR escalated_to_user_id = ${approverId as unknown as string})
          ORDER BY created_at DESC
          LIMIT 200`,
    );
    const rows = extractRows<ApprovalRequestRow>(res);
    return rows.map(rowToRequest);
  }

  async findHistory(
    tenantId: TenantId,
    filters: ApprovalHistoryFilters,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<{
    data: readonly ApprovalWorkflowRequest[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = pagination?.page ?? 1;
    const pageSize = Math.min(pagination?.pageSize ?? 20, 100);
    const offset = (page - 1) * pageSize;

    // Build filter chunks defensively — each chunk is a prepared sql`` with
    // bind vars, so literal injection is impossible.
    const chunks: unknown[] = [
      sql`SELECT * FROM approval_requests WHERE tenant_id = ${tenantId as unknown as string}`,
    ];
    const countChunks: unknown[] = [
      sql`SELECT COUNT(*)::int AS count FROM approval_requests WHERE tenant_id = ${tenantId as unknown as string}`,
    ];
    const applyFilter = (chunk: unknown): void => {
      chunks.push(chunk);
      countChunks.push(chunk);
    };
    if (filters.type)
      applyFilter(sql` AND type = ${filters.type}`);
    if (filters.status)
      applyFilter(sql` AND status = ${filters.status}`);
    if (filters.requesterId)
      applyFilter(
        sql` AND requester_id = ${filters.requesterId as unknown as string}`,
      );
    if (filters.approverId)
      applyFilter(
        sql` AND approver_id = ${filters.approverId as unknown as string}`,
      );
    if (filters.fromDate)
      applyFilter(sql` AND created_at >= ${filters.fromDate}`);
    if (filters.toDate)
      applyFilter(sql` AND created_at <= ${filters.toDate}`);
    if (filters.minAmount != null)
      applyFilter(sql` AND amount >= ${filters.minAmount}`);
    if (filters.maxAmount != null)
      applyFilter(sql` AND amount <= ${filters.maxAmount}`);

    chunks.push(
      sql` ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
    );

    const exec = async (fragments: unknown[]): Promise<unknown> =>
      (this.db as { execute: (q: unknown) => Promise<unknown> }).execute(
        (sql as unknown as {
          join: (parts: unknown[]) => unknown;
        }).join(fragments),
      );

    const [listRes, countRes] = await Promise.all([
      exec(chunks),
      exec(countChunks),
    ]);
    const rows = extractRows<ApprovalRequestRow>(listRes);
    const countRows = extractRows<{ count: number }>(countRes);
    const total = Number(countRows[0]?.count ?? rows.length);
    return {
      data: rows.map(rowToRequest),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async create(
    request: ApprovalWorkflowRequest,
  ): Promise<ApprovalWorkflowRequest> {
    await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(
      sql`INSERT INTO approval_requests (
            id, tenant_id, type, status, requester_id, approver_id,
            escalated_to_user_id, amount, currency, justification, details_json,
            comments, rejection_reason, escalation_reason,
            approved_at, rejected_at, escalated_at, timeout_at,
            approval_level, created_at, updated_at, created_by, updated_by
          ) VALUES (
            ${request.id as unknown as string},
            ${request.tenantId as unknown as string},
            ${request.type},
            ${request.status},
            ${request.requesterId as unknown as string},
            ${request.approverId as unknown as string | null},
            ${request.escalatedToUserId as unknown as string | null},
            ${request.amount},
            ${request.currency},
            ${request.justification},
            ${JSON.stringify(request.details)}::jsonb,
            ${request.comments},
            ${request.rejectionReason},
            ${request.escalationReason},
            ${request.approvedAt},
            ${request.rejectedAt},
            ${request.escalatedAt},
            ${request.timeoutAt},
            ${request.approvalLevel},
            ${request.createdAt},
            ${request.updatedAt},
            ${request.createdBy as unknown as string},
            ${request.updatedBy as unknown as string}
          )`,
    );
    return request;
  }

  async update(
    request: ApprovalWorkflowRequest,
  ): Promise<ApprovalWorkflowRequest> {
    await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(
      sql`UPDATE approval_requests SET
            status = ${request.status},
            approver_id = ${request.approverId as unknown as string | null},
            escalated_to_user_id = ${request.escalatedToUserId as unknown as string | null},
            comments = ${request.comments},
            rejection_reason = ${request.rejectionReason},
            escalation_reason = ${request.escalationReason},
            approved_at = ${request.approvedAt},
            rejected_at = ${request.rejectedAt},
            escalated_at = ${request.escalatedAt},
            approval_level = ${request.approvalLevel},
            updated_at = ${request.updatedAt},
            updated_by = ${request.updatedBy as unknown as string}
          WHERE tenant_id = ${request.tenantId as unknown as string}
            AND id = ${request.id as unknown as string}`,
    );
    return request;
  }
}

/**
 * Adapter: wraps the existing override-only `PostgresApprovalPolicyRepository`
 * in the full `ApprovalPolicyRepository` shape expected by ApprovalService.
 * When no override row exists, `findByTenantAndType` returns null so the
 * service falls through to `getDefaultPolicyForType` in default-policies.ts.
 */
export class PostgresApprovalPolicyRepositoryAdapter
  implements ApprovalPolicyRepository
{
  private readonly inner: PostgresApprovalPolicyRepository;

  constructor(db: unknown) {
    // PostgresApprovalPolicyRepository expects a drizzle client with
    // .select / .insert methods (used internally by its override path).
    this.inner = new PostgresApprovalPolicyRepository(
      db as Parameters<typeof PostgresApprovalPolicyRepository.prototype.constructor>[0],
    );
  }

  async findByTenantAndType(
    tenantId: TenantId,
    type: ApprovalWorkflowType,
  ): Promise<ApprovalPolicy | null> {
    return this.inner.findPolicy(tenantId, type as never);
  }

  async save(policy: ApprovalPolicy): Promise<ApprovalPolicy> {
    await this.inner.upsertPolicy(
      policy.tenantId,
      policy.type as never,
      policy,
      policy.updatedBy,
    );
    return policy;
  }
}
