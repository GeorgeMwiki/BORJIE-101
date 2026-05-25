/**
 * Approval Repository Interface
 * Data access for approval requests and policies
 */

import type { TenantId, UserId } from '@borjie/domain-models';
import type { PaginationParams, PaginatedResult } from '@borjie/domain-models';
import type {
  ApprovalRequest,
  ApprovalRequestId,
  ApprovalPolicy,
  ApprovalType,
  ApprovalHistoryFilters,
} from './types.js';

export interface ApprovalRequestRepository {
  findById(id: ApprovalRequestId, tenantId: TenantId): Promise<ApprovalRequest | null>;
  findPendingByApprover(approverId: UserId, tenantId: TenantId): Promise<readonly ApprovalRequest[]>;
  findHistory(tenantId: TenantId, filters: ApprovalHistoryFilters, pagination?: PaginationParams): Promise<PaginatedResult<ApprovalRequest>>;
  create(request: ApprovalRequest): Promise<ApprovalRequest>;
  update(request: ApprovalRequest): Promise<ApprovalRequest>;
}

export interface ApprovalPolicyRepository {
  findByTenantAndType(tenantId: TenantId, type: ApprovalType): Promise<ApprovalPolicy | null>;
  save(policy: ApprovalPolicy): Promise<ApprovalPolicy>;
}
