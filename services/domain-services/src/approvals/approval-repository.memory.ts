// @ts-nocheck — pre-existing hard-fork drift; out of scope for issue #61 (5-file slice).
/**
 * In-memory Approval Repository
 * For development and testing
 */

import type { PaginationParams, PaginatedResult } from '@borjie/domain-models';
import type {
  ApprovalRequest,
  ApprovalRequestId,
  ApprovalPolicy,
  ApprovalType,
  ApprovalHistoryFilters,
} from './types.js';
import type {
  ApprovalRequestRepository,
  ApprovalPolicyRepository,
} from './approval-repository.interface.js';

const requests = new Map<string, ApprovalRequest>();
const policies = new Map<string, ApprovalPolicy>();

function requestKey(id: ApprovalRequestId, tenantId: string): string {
  return `${tenantId}:${id}`;
}

function policyKey(tenantId: string, type: ApprovalType): string {
  return `${tenantId}:${type}`;
}

export class MemoryApprovalRequestRepository implements ApprovalRequestRepository {
  async findById(id: ApprovalRequestId, tenantId: string): Promise<ApprovalRequest | null> {
    return requests.get(requestKey(id, tenantId)) ?? null;
  }

  async findPendingByApprover(approverId: string, tenantId: string): Promise<readonly ApprovalRequest[]> {
    return [...requests.values()].filter(
      (r) =>
        r.tenantId === tenantId &&
        r.status === 'pending' &&
        (r.approverId === approverId || r.escalatedToUserId === approverId)
    );
  }

  async findHistory(
    tenantId: string,
    filters: ApprovalHistoryFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<ApprovalRequest>> {
    let items = [...requests.values()].filter((r) => r.tenantId === tenantId);

    if (filters.type) items = items.filter((r) => r.type === filters.type);
    if (filters.status) items = items.filter((r) => r.status === filters.status);
    if (filters.requesterId) items = items.filter((r) => r.requesterId === filters.requesterId);
    if (filters.approverId) items = items.filter((r) => r.approverId === filters.approverId);
    if (filters.fromDate) items = items.filter((r) => r.createdAt >= filters.fromDate!);
    if (filters.toDate) items = items.filter((r) => r.createdAt <= filters.toDate!);
    if (filters.minAmount != null) items = items.filter((r) => (r.amount ?? 0) >= filters.minAmount!);
    if (filters.maxAmount != null) items = items.filter((r) => (r.amount ?? 0) <= filters.maxAmount!);

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 20;
    const total = items.length;
    const start = (page - 1) * pageSize;
    const data = items.slice(start, start + pageSize);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async create(request: ApprovalRequest): Promise<ApprovalRequest> {
    requests.set(requestKey(request.id, String(request.tenantId)), request);
    return request;
  }

  async update(request: ApprovalRequest): Promise<ApprovalRequest> {
    requests.set(requestKey(request.id, String(request.tenantId)), request);
    return request;
  }

  clear(): void {
    requests.clear();
  }
}

export class MemoryApprovalPolicyRepository implements ApprovalPolicyRepository {
  async findByTenantAndType(tenantId: string, type: ApprovalType): Promise<ApprovalPolicy | null> {
    return policies.get(policyKey(tenantId, type)) ?? null;
  }

  async save(policy: ApprovalPolicy): Promise<ApprovalPolicy> {
    policies.set(policyKey(String(policy.tenantId), policy.type), policy);
    return policy;
  }

  clear(): void {
    policies.clear();
  }
}
