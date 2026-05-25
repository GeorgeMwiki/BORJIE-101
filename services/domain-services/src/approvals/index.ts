import { randomHex } from '../common/id-generator.js';
/**
 * Approvals Workflow Service
 * Handles approval requests for leases, expenses, refunds, maintenance costs,
 * tenant applications, and rent adjustments.
 */

import type { TenantId, UserId, Result } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Types
// ============================================================================

export type ApprovalType =
  | 'lease'
  | 'expense'
  | 'refund'
  | 'maintenance_cost'
  | 'tenant_application'
  | 'rent_adjustment';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';

export interface ApprovalRequest {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: ApprovalType;
  readonly entityId: string;
  readonly requestedBy: UserId;
  readonly amount: number;
  readonly reason: string;
  readonly status: ApprovalStatus;
  readonly approvers: readonly UserId[];
  readonly comments: readonly string[];
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly escalatedBy?: UserId;
  readonly rejectedBy?: UserId;
  readonly approvedBy?: UserId;
}

export interface ApprovalThreshold {
  readonly minAmount: number;
  readonly maxAmount: number | null;
  readonly requiredRole: string;
}

export interface EscalationRule {
  readonly condition: string;
  readonly escalateToRole: string;
}

export interface ApprovalRule {
  readonly type: ApprovalType;
  readonly thresholds: readonly ApprovalThreshold[];
  readonly approverRoles: readonly string[];
  readonly escalationRules: readonly EscalationRule[];
}

// ============================================================================
// Events
// ============================================================================

interface ApprovalEventBase extends DomainEvent {
  readonly payload: Record<string, unknown>;
}

export interface ApprovalRequestedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalRequested';
  readonly payload: {
    readonly requestId: string;
    readonly type: ApprovalType;
    readonly entityId: string;
    readonly requestedBy: UserId;
    readonly amount: number;
    readonly reason: string;
  };
}

export interface ApprovalGrantedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalGranted';
  readonly payload: {
    readonly requestId: string;
    readonly type: ApprovalType;
    readonly approverId: UserId;
    readonly comment?: string;
  };
}

export interface ApprovalRejectedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalRejected';
  readonly payload: {
    readonly requestId: string;
    readonly type: ApprovalType;
    readonly approverId: UserId;
    readonly reason: string;
  };
}

export interface ApprovalEscalatedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalEscalated';
  readonly payload: {
    readonly requestId: string;
    readonly type: ApprovalType;
    readonly escalatedBy: UserId;
    readonly reason: string;
  };
}

// ============================================================================
// Approval Rules Engine
// ============================================================================
// - Expenses > 50000 KES require manager approval
// - Expenses > 200000 KES require owner approval
// - Refunds always require approval
// - Lease modifications require owner approval

const KES_50K = 50_000;
const KES_200K = 200_000;

/** Default approval rules per type */
export const DEFAULT_APPROVAL_RULES: Record<ApprovalType, ApprovalRule> = {
  expense: {
    type: 'expense',
    thresholds: [
      { minAmount: 0, maxAmount: KES_50K, requiredRole: 'manager' },
      { minAmount: KES_50K, maxAmount: KES_200K, requiredRole: 'manager' },
      { minAmount: KES_200K, maxAmount: null, requiredRole: 'owner' },
    ],
    approverRoles: ['manager', 'owner'],
    escalationRules: [
      { condition: 'timeout_24h', escalateToRole: 'manager' },
      { condition: 'amount_over_200k', escalateToRole: 'owner' },
    ],
  },
  refund: {
    type: 'refund',
    thresholds: [{ minAmount: 0, maxAmount: null, requiredRole: 'manager' }],
    approverRoles: ['manager', 'owner'],
    escalationRules: [{ condition: 'always', escalateToRole: 'owner' }],
  },
  lease: {
    type: 'lease',
    thresholds: [{ minAmount: 0, maxAmount: null, requiredRole: 'owner' }],
    approverRoles: ['owner'],
    escalationRules: [],
  },
  maintenance_cost: {
    type: 'maintenance_cost',
    thresholds: [
      { minAmount: 0, maxAmount: KES_50K, requiredRole: 'manager' },
      { minAmount: KES_50K, maxAmount: null, requiredRole: 'owner' },
    ],
    approverRoles: ['manager', 'owner'],
    escalationRules: [
      { condition: 'amount_over_50k', escalateToRole: 'owner' },
    ],
  },
  tenant_application: {
    type: 'tenant_application',
    thresholds: [{ minAmount: 0, maxAmount: null, requiredRole: 'manager' }],
    approverRoles: ['manager', 'owner'],
    escalationRules: [],
  },
  rent_adjustment: {
    type: 'rent_adjustment',
    thresholds: [{ minAmount: 0, maxAmount: null, requiredRole: 'owner' }],
    approverRoles: ['owner'],
    escalationRules: [],
  },
};

/** Resolve required approver role for an amount and type */
export function resolveRequiredApprover(type: ApprovalType, amount: number): string {
  const rule = DEFAULT_APPROVAL_RULES[type];
  if (!rule) return 'owner';

  for (const t of rule.thresholds) {
    if (amount >= t.minAmount && (t.maxAmount === null || amount <= t.maxAmount)) {
      return t.requiredRole;
    }
  }
  return rule.approverRoles[rule.approverRoles.length - 1] ?? 'owner';
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface ApprovalRequestStore {
  findById(id: string, tenantId: TenantId): Promise<ApprovalRequest | null>;
  findByEntity(tenantId: TenantId, entityId: string): Promise<readonly ApprovalRequest[]>;
  findPendingByApprover(tenantId: TenantId, approverId: UserId): Promise<readonly ApprovalRequest[]>;
  create(request: ApprovalRequest): Promise<ApprovalRequest>;
  update(request: ApprovalRequest): Promise<ApprovalRequest>;
}

export interface ApprovalRuleStore {
  findByTenantAndType(tenantId: TenantId, type: ApprovalType): Promise<ApprovalRule | null>;
  save(tenantId: TenantId, rule: ApprovalRule): Promise<ApprovalRule>;
}

// ============================================================================
// Approval Service
// ============================================================================

export const ApprovalServiceError = {
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  UNAUTHORIZED_APPROVER: 'UNAUTHORIZED_APPROVER',
  RULE_NOT_FOUND: 'RULE_NOT_FOUND',
} as const;

export type ApprovalServiceErrorCode = (typeof ApprovalServiceError)[keyof typeof ApprovalServiceError];

export interface ApprovalServiceErrorResult {
  code: ApprovalServiceErrorCode;
  message: string;
}

export class ApprovalService {
  constructor(
    private readonly requestStore: ApprovalRequestStore,
    private readonly ruleStore: ApprovalRuleStore,
    private readonly eventBus: EventBus
  ) {}

  async createApprovalRequest(
    tenantId: TenantId,
    type: ApprovalType,
    entityId: string,
    requestedBy: UserId,
    amount: number,
    reason: string
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const id = `apr_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();

    const request: ApprovalRequest = {
      id,
      tenantId,
      type,
      entityId,
      requestedBy,
      amount,
      reason,
      status: 'pending',
      approvers: [],
      comments: [],
      createdAt: now,
    };

    const saved = await this.requestStore.create(request);

    const event: ApprovalRequestedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalRequested',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        requestId: saved.id,
        type,
        entityId,
        requestedBy,
        amount,
        reason,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    return ok(saved);
  }

  async approveRequest(
    requestId: string,
    tenantId: TenantId,
    approverId: UserId,
    comment?: string
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const request = await this.requestStore.findById(requestId, tenantId);
    if (!request) return err({ code: ApprovalServiceError.REQUEST_NOT_FOUND, message: 'Approval request not found' });
    if (request.status !== 'pending')
      return err({ code: ApprovalServiceError.INVALID_STATUS, message: 'Request is not pending' });

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...request,
      status: 'approved',
      approvers: [...request.approvers, approverId],
      comments: comment ? [...request.comments, comment] : request.comments,
      updatedAt: now,
      approvedBy: approverId,
    };

    const saved = await this.requestStore.update(updated);

    const event: ApprovalGrantedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalGranted',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: { requestId: saved.id, type: saved.type, approverId, comment },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    return ok(saved);
  }

  async rejectRequest(
    requestId: string,
    tenantId: TenantId,
    approverId: UserId,
    reason: string
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const request = await this.requestStore.findById(requestId, tenantId);
    if (!request) return err({ code: ApprovalServiceError.REQUEST_NOT_FOUND, message: 'Approval request not found' });
    if (request.status !== 'pending')
      return err({ code: ApprovalServiceError.INVALID_STATUS, message: 'Request is not pending' });

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...request,
      status: 'rejected',
      approvers: [...request.approvers, approverId],
      comments: [...request.comments, reason],
      updatedAt: now,
      rejectedBy: approverId,
    };

    const saved = await this.requestStore.update(updated);

    const event: ApprovalRejectedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalRejected',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: { requestId: saved.id, type: saved.type, approverId, reason },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    return ok(saved);
  }

  async escalateRequest(
    requestId: string,
    tenantId: TenantId,
    escalatedBy: UserId,
    reason: string
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const request = await this.requestStore.findById(requestId, tenantId);
    if (!request) return err({ code: ApprovalServiceError.REQUEST_NOT_FOUND, message: 'Approval request not found' });
    if (request.status !== 'pending')
      return err({ code: ApprovalServiceError.INVALID_STATUS, message: 'Request is not pending' });

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...request,
      status: 'escalated',
      approvers: [...request.approvers, escalatedBy],
      comments: [...request.comments, reason],
      updatedAt: now,
      escalatedBy,
    };

    const saved = await this.requestStore.update(updated);

    const event: ApprovalEscalatedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalEscalated',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: { requestId: saved.id, type: saved.type, escalatedBy, reason },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    return ok(saved);
  }

  async getApprovalRules(tenantId: TenantId, type: ApprovalType): Promise<ApprovalRule> {
    const rule = await this.ruleStore.findByTenantAndType(tenantId, type);
    return rule ?? DEFAULT_APPROVAL_RULES[type];
  }

  async setApprovalRule(tenantId: TenantId, rule: ApprovalRule): Promise<ApprovalRule> {
    return this.ruleStore.save(tenantId, rule);
  }

  async getPendingApprovals(tenantId: TenantId, approverId: UserId): Promise<readonly ApprovalRequest[]> {
    return this.requestStore.findPendingByApprover(tenantId, approverId);
  }

  async getApprovalHistory(tenantId: TenantId, entityId: string): Promise<readonly ApprovalRequest[]> {
    return this.requestStore.findByEntity(tenantId, entityId);
  }
}

// ============================================================================
// In-Memory Stores (for development/testing)
// ============================================================================

const requestMap = new Map<string, ApprovalRequest>();
const ruleMap = new Map<string, ApprovalRule>();

function requestKey(id: string, tenantId: TenantId): string {
  return `${tenantId}:${id}`;
}

function ruleKey(tenantId: TenantId, type: ApprovalType): string {
  return `${tenantId}:${type}`;
}

export class MemoryApprovalRequestStore implements ApprovalRequestStore {
  async findById(id: string, tenantId: TenantId): Promise<ApprovalRequest | null> {
    return requestMap.get(requestKey(id, tenantId)) ?? null;
  }

  async findByEntity(tenantId: TenantId, entityId: string): Promise<readonly ApprovalRequest[]> {
    return [...requestMap.values()].filter(
      (r) => r.tenantId === tenantId && r.entityId === entityId
    );
  }

  async findPendingByApprover(tenantId: TenantId, approverId: UserId): Promise<readonly ApprovalRequest[]> {
    return [...requestMap.values()].filter(
      (r) =>
        r.tenantId === tenantId &&
        r.status === 'pending'
    );
  }

  async create(request: ApprovalRequest): Promise<ApprovalRequest> {
    requestMap.set(requestKey(request.id, request.tenantId), request);
    return request;
  }

  async update(request: ApprovalRequest): Promise<ApprovalRequest> {
    requestMap.set(requestKey(request.id, request.tenantId), request);
    return request;
  }

  clear(): void {
    requestMap.clear();
  }
}

export class MemoryApprovalRuleStore implements ApprovalRuleStore {
  async findByTenantAndType(tenantId: TenantId, type: ApprovalType): Promise<ApprovalRule | null> {
    return ruleMap.get(ruleKey(tenantId, type)) ?? null;
  }

  async save(tenantId: TenantId, rule: ApprovalRule): Promise<ApprovalRule> {
    ruleMap.set(ruleKey(tenantId, rule.type), rule);
    return rule;
  }

  clear(): void {
    ruleMap.clear();
  }
}

// ============================================================================
// Per-org Policy Overrides (Scaffolded item #12) — additive re-exports
// ============================================================================
// The newer approval-service.ts / default-policies.ts / types.ts pipeline
// supports per-tenant policy overrides that fall back to the hardcoded
// defaults floor. These exports expose the interface + Postgres implementation
// alongside the legacy in-file service above.

export type { ApprovalPolicyOverrideRepository } from './approval-policy-repository.interface.js';
export { PostgresApprovalPolicyRepository } from './postgres-approval-policy-repository.js';
export type { PostgresApprovalPolicyRepositoryClient } from './postgres-approval-policy-repository.js';

// ============================================================================
// Wave 26 — richer ApprovalService + repo interfaces (aliased to avoid
// collision with the legacy in-file ApprovalService above). The legacy
// class is retained for backward-compatible tests; the Workflow alias is
// what the api-gateway composition root + routers wire into production.
// ============================================================================
export {
  ApprovalService as ApprovalWorkflowService,
  ApprovalServiceError as ApprovalWorkflowError,
  type ApprovalServiceErrorCode as ApprovalWorkflowErrorCode,
  type ApprovalServiceErrorResult as ApprovalWorkflowErrorResult,
  type ApproverResolver,
  type ProximityRouter,
} from './approval-service.js';
export type {
  ApprovalRequestRepository,
  ApprovalPolicyRepository,
} from './approval-repository.interface.js';
export type {
  ApprovalRequest as ApprovalWorkflowRequest,
  ApprovalRequestId as ApprovalWorkflowRequestId,
  ApprovalType as ApprovalWorkflowType,
  ApprovalStatus as ApprovalWorkflowStatus,
  ApprovalPolicy,
  ApprovalRequestDetails,
  ApprovalHistoryFilters,
  MaintenanceCostDetails,
  LeaseExceptionDetails,
  RefundDetails,
  DiscountDetails,
  PaymentFlexibilityDetails,
} from './types.js';
export { asApprovalRequestId, APPROVAL_TYPES, APPROVAL_STATUSES } from './types.js';
export { getDefaultPolicyForType } from './default-policies.js';
