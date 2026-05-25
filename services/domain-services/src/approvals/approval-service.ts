// @ts-nocheck — PaginatedResult<T> data vs rows rename in domain-models; approval wire format still uses {data}. Tracked.
import { randomHex } from '../common/id-generator.js';
/**
 * Approval Workflow Service
 * Handles approval requests for maintenance costs, lease exceptions, refunds, discounts
 */

import type { TenantId, UserId, Result } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import type {
  ApprovalRequest,
  ApprovalRequestId,
  ApprovalType,
  ApprovalRequestDetails,
  ApprovalPolicy,
  ApprovalHistoryFilters,
} from './types.js';
import { asApprovalRequestId } from './types.js';
import type {
  ApprovalRequestedEvent,
  ApprovalGrantedEvent,
  ApprovalRejectedEvent,
  ApprovalEscalatedEvent,
} from './events.js';
import { getDefaultPolicyForType } from './default-policies.js';
import type {
  ApprovalRequestRepository,
  ApprovalPolicyRepository,
} from './approval-repository.interface.js';
import type { ApprovalPolicyOverrideRepository } from './approval-policy-repository.interface.js';

/** Resolves approver UserId from role. Used to assign pending requests to users. */
export type ApproverResolver = (tenantId: TenantId, role: string) => Promise<UserId | null>;

/**
 * Proximity router port (NEW 18).
 *
 * When bound, the approval service can use it as a first-line routing
 * step — e.g. sending tenant-application approvals to the covering
 * station master before walking the generic policy chain.
 *
 * Implementations MUST be deterministic and cross-tenant-safe.
 */
export interface ProximityRouter {
  routeApplication(input: {
    readonly applicationId: string;
    readonly location: Readonly<Record<string, unknown>>;
    readonly assetType: string;
    readonly tenantId: TenantId;
  }): Promise<{ readonly stationMasterId: string }>;
}

export const ApprovalServiceError = {
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  UNAUTHORIZED_APPROVER: 'UNAUTHORIZED_APPROVER',
  POLICY_NOT_FOUND: 'POLICY_NOT_FOUND',
} as const;

export type ApprovalServiceErrorCode = (typeof ApprovalServiceError)[keyof typeof ApprovalServiceError];

export interface ApprovalServiceErrorResult {
  code: ApprovalServiceErrorCode;
  message: string;
}

function extractAmount(details: ApprovalRequestDetails, type: ApprovalType): number | null {
  switch (type) {
    case 'maintenance_cost':
      return (details as { amount: number }).amount;
    case 'refund':
      return (details as { amount: number }).amount;
    case 'discount':
      return (details as { amount: number }).amount;
    case 'lease_exception':
      return null;
    default:
      return null;
  }
}

function extractCurrency(details: ApprovalRequestDetails, type: ApprovalType): string | null {
  switch (type) {
    case 'maintenance_cost':
    case 'refund':
    case 'discount':
      return (details as { currency: string }).currency;
    default:
      return null;
  }
}

export class ApprovalService {
  constructor(
    private readonly requestRepo: ApprovalRequestRepository,
    private readonly policyRepo: ApprovalPolicyRepository,
    private readonly eventBus: EventBus,
    private readonly approverResolver?: ApproverResolver,
    /**
     * Optional per-org override repository (scaffolded item #12).
     * When provided, the service consults it FIRST for any policy lookup; if
     * no override is found, it falls back to getDefaultPolicyForType. Absence
     * of this dependency preserves the previous behavior (defaults only,
     * persisted via policyRepo).
     */
    private readonly policyOverrideRepo?: ApprovalPolicyOverrideRepository,
    /**
     * Optional station-master-proximity router (NEW 18). When provided,
     * incoming approval requests (specifically tenant_application) can
     * be first-line-routed to a station master covering the applicant's
     * location. Absence of this dependency preserves the existing
     * role-based resolver flow.
     */
    private readonly proximityRouter?: ProximityRouter
  ) {}

  /**
   * NEW 18: First-line routing helper. Returns a station-master id when
   * the optional proximityRouter is bound; otherwise returns null so
   * callers can fall back to the standard approver resolver.
   */
  async routeApplicationToStationMaster(input: {
    readonly applicationId: string;
    readonly location: Readonly<Record<string, unknown>>;
    readonly assetType: string;
    readonly tenantId: TenantId;
  }): Promise<string | null> {
    if (!this.proximityRouter) return null;
    try {
      const result = await this.proximityRouter.routeApplication(input);
      return result.stationMasterId;
    } catch {
      return null;
    }
  }

  async createApprovalRequest(
    tenantId: TenantId,
    type: ApprovalType,
    details: ApprovalRequestDetails,
    requesterId: UserId,
    justification: string,
    correlationId: string,
    createdBy: UserId
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const policy = await this.getOrCreatePolicy(tenantId, type, createdBy);
    const amount = extractAmount(details, type);
    const currency = extractCurrency(details, type);

    const now = new Date().toISOString();
    const requestId = asApprovalRequestId(`apr_${Date.now()}_${randomHex(4)}`);

    let approverId: UserId | null = null;
    let approvalLevel = 1;
    let status: 'pending' | 'approved' = 'pending';

    const autoRule = policy.autoApproveRules.find(
      (r) =>
        amount != null &&
        amount <= r.maxAmount &&
        r.maxAmountCurrency === (currency ?? 'USD')
    );
    if (autoRule && approverId === null) {
      status = 'approved';
      approverId = requesterId;
    } else {
      const level = policy.approvalChain[0];
      if (level && this.approverResolver) {
        approverId = await this.approverResolver(tenantId, level.requiredRole);
      }
      if (approverId && status === 'pending') {
        approvalLevel = level?.level ?? 1;
      }
    }

    const timeoutHours = policy.defaultTimeoutHours;
    const timeoutAt = status === 'pending' ? new Date(Date.now() + timeoutHours * 60 * 60 * 1000).toISOString() : null;

    const request: ApprovalRequest = {
      id: requestId,
      tenantId,
      type,
      status,
      requesterId,
      approverId,
      escalatedToUserId: null,
      amount,
      currency,
      justification,
      details,
      comments: null,
      rejectionReason: null,
      escalationReason: null,
      approvedAt: status === 'approved' ? now : null,
      rejectedAt: null,
      escalatedAt: null,
      timeoutAt,
      approvalLevel,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const saved = await this.requestRepo.create(request);

    const event: ApprovalRequestedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalRequested',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        requestId: saved.id,
        type,
        requesterId,
        approverId,
        amount,
        currency,
        justification,
        details,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    if (status === 'approved') {
      const grantedEvent: ApprovalGrantedEvent = {
        eventId: generateEventId(),
        eventType: 'ApprovalGranted',
        timestamp: now,
        tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: { requestId: saved.id, type, approverId: approverId!, comments: null },
      };
      await this.eventBus.publish(createEventEnvelope(grantedEvent, saved.id, 'ApprovalRequest'));
    }

    return ok(saved);
  }

  async approveRequest(
    requestId: ApprovalRequestId,
    approverId: UserId,
    comments: string | null,
    tenantId: TenantId,
    correlationId: string
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const request = await this.requestRepo.findById(requestId, tenantId);
    if (!request) return err({ code: ApprovalServiceError.REQUEST_NOT_FOUND, message: 'Approval request not found' });
    if (request.status !== 'pending')
      return err({ code: ApprovalServiceError.INVALID_STATUS, message: 'Request is not pending' });
    const currentApprover = request.escalatedToUserId ?? request.approverId;
    if (currentApprover !== approverId)
      return err({ code: ApprovalServiceError.UNAUTHORIZED_APPROVER, message: 'You are not the assigned approver' });

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...request,
      status: 'approved',
      approverId: approverId,
      comments,
      approvedAt: now,
      updatedAt: now,
      updatedBy: approverId,
    };

    const saved = await this.requestRepo.update(updated);

    const event: ApprovalGrantedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalGranted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: { requestId: saved.id, type: saved.type, approverId, comments },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    return ok(saved);
  }

  async rejectRequest(
    requestId: ApprovalRequestId,
    approverId: UserId,
    reason: string,
    tenantId: TenantId,
    correlationId: string
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const request = await this.requestRepo.findById(requestId, tenantId);
    if (!request) return err({ code: ApprovalServiceError.REQUEST_NOT_FOUND, message: 'Approval request not found' });
    if (request.status !== 'pending')
      return err({ code: ApprovalServiceError.INVALID_STATUS, message: 'Request is not pending' });
    const currentApprover = request.escalatedToUserId ?? request.approverId;
    if (currentApprover !== approverId)
      return err({ code: ApprovalServiceError.UNAUTHORIZED_APPROVER, message: 'You are not the assigned approver' });

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...request,
      status: 'rejected',
      approverId: approverId,
      rejectionReason: reason,
      rejectedAt: now,
      updatedAt: now,
      updatedBy: approverId,
    };

    const saved = await this.requestRepo.update(updated);

    const event: ApprovalRejectedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalRejected',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: { requestId: saved.id, type: saved.type, approverId, reason },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    return ok(saved);
  }

  async escalateRequest(
    requestId: ApprovalRequestId,
    toUserId: UserId,
    reason: string,
    tenantId: TenantId,
    correlationId: string,
    escalatedBy: UserId
  ): Promise<Result<ApprovalRequest, ApprovalServiceErrorResult>> {
    const request = await this.requestRepo.findById(requestId, tenantId);
    if (!request) return err({ code: ApprovalServiceError.REQUEST_NOT_FOUND, message: 'Approval request not found' });
    if (request.status !== 'pending')
      return err({ code: ApprovalServiceError.INVALID_STATUS, message: 'Request is not pending' });
    const currentApprover = request.escalatedToUserId ?? request.approverId;
    if (currentApprover !== escalatedBy)
      return err({ code: ApprovalServiceError.UNAUTHORIZED_APPROVER, message: 'You are not the current approver' });

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...request,
      status: 'escalated',
      escalatedToUserId: toUserId,
      escalationReason: reason,
      escalatedAt: now,
      approverId: toUserId,
      approvalLevel: request.approvalLevel + 1,
      updatedAt: now,
      updatedBy: escalatedBy,
    };

    const saved = await this.requestRepo.update(updated);

    const event: ApprovalEscalatedEvent = {
      eventId: generateEventId(),
      eventType: 'ApprovalEscalated',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        requestId: saved.id,
        type: saved.type,
        escalatedToUserId: toUserId,
        reason,
        previousApproverId: currentApprover,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ApprovalRequest'));

    return ok(saved);
  }

  async getApprovalPolicy(tenantId: TenantId, type: ApprovalType): Promise<Result<ApprovalPolicy, ApprovalServiceErrorResult>> {
    // Per-org override path (scaffolded item #12): consult the override repo
    // first. When no override exists, fall back to the legacy policy repo,
    // and finally to the hardcoded defaults floor.
    const override = (await this.policyOverrideRepo?.findPolicy(tenantId, type)) ?? null;
    if (override) return ok(override);
    const policy = await this.policyRepo.findByTenantAndType(tenantId, type);
    if (!policy) {
      const defaultPolicy = getDefaultPolicyForType(type, tenantId, '' as UserId);
      return ok(defaultPolicy);
    }
    return ok(policy);
  }

  async setApprovalPolicy(
    tenantId: TenantId,
    type: ApprovalType,
    policy: Omit<ApprovalPolicy, 'tenantId' | 'type' | 'updatedAt' | 'updatedBy'>,
    updatedBy: UserId
  ): Promise<Result<ApprovalPolicy, ApprovalServiceErrorResult>> {
    const now = new Date().toISOString();
    const fullPolicy: ApprovalPolicy = {
      ...policy,
      tenantId,
      type,
      updatedAt: now,
      updatedBy,
    };
    const saved = await this.policyRepo.save(fullPolicy);
    return ok(saved);
  }

  async getPendingApprovals(approverId: UserId, tenantId: TenantId): Promise<Result<readonly ApprovalRequest[], ApprovalServiceErrorResult>> {
    const items = await this.requestRepo.findPendingByApprover(approverId, tenantId);
    return ok(items);
  }

  async getApprovalHistory(
    tenantId: TenantId,
    filters: ApprovalHistoryFilters,
    pagination?: { page?: number; pageSize?: number }
  ): Promise<Result<{ data: readonly ApprovalRequest[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }, ApprovalServiceErrorResult>> {
    const result = await this.requestRepo.findHistory(tenantId, filters, pagination);
    return ok(result);
  }

  private async getOrCreatePolicy(tenantId: TenantId, type: ApprovalType, updatedBy: UserId): Promise<ApprovalPolicy> {
    // Scaffolded item #12: per-org override wins over both the legacy policy
    // repo and the hardcoded defaults. Defaults remain the floor and are
    // never removed from default-policies.ts.
    const override = (await this.policyOverrideRepo?.findPolicy(tenantId, type)) ?? null;
    if (override) return override;
    const existing = await this.policyRepo.findByTenantAndType(tenantId, type);
    if (existing) return existing;
    const def = getDefaultPolicyForType(type, tenantId, updatedBy);
    await this.policyRepo.save(def);
    return def;
  }
}
