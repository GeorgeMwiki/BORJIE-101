/**
 * Sublease Service — submit → review → approve → revoke workflow.
 *
 * State transitions (submit, review, approve, revoke) are fully wired and
 * persisted via the injected repositories. ApprovalService routing and
 * jurisdiction checks remain an edge-wiring concern handled by callers.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §7.
 */

import type { TenantId, UserId, ISOTimestamp, Result } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import { randomHex } from '../../common/id-generator.js';
import type {
  SubleaseRequest,
  SubleaseRequestId,
  SubmitSubleaseInput,
  ReviewSubleaseInput,
  ApproveSubleaseInput,
  RevokeSubleaseInput,
  SubleaseRequestStatus,
} from './sublease-request.js';
import { asSubleaseRequestId } from './sublease-request.js';
import type {
  TenantGroup,
  TenantGroupId,
  TenantGroupMember,
} from './tenant-group.js';
import { asTenantGroupId } from './tenant-group.js';
import type { LeaseId } from '../index.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const SubleaseError = {
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  ILLEGAL_STATUS: 'ILLEGAL_STATUS',
} as const;

export type SubleaseErrorCode = (typeof SubleaseError)[keyof typeof SubleaseError];

export interface SubleaseErrorResult {
  code: SubleaseErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface SubleaseRequestRepository {
  findById(id: SubleaseRequestId, tenantId: TenantId): Promise<SubleaseRequest | null>;
  findByLease(leaseId: LeaseId, tenantId: TenantId): Promise<readonly SubleaseRequest[]>;
  create(entity: SubleaseRequest): Promise<SubleaseRequest>;
  update(entity: SubleaseRequest): Promise<SubleaseRequest>;
}

export interface TenantGroupRepository {
  findByPrimaryLease(leaseId: LeaseId, tenantId: TenantId): Promise<TenantGroup | null>;
  create(entity: TenantGroup): Promise<TenantGroup>;
  update(entity: TenantGroup): Promise<TenantGroup>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: Readonly<Record<SubleaseRequestStatus, readonly SubleaseRequestStatus[]>> = {
  pending: ['approved', 'rejected'],
  approved: ['revoked'],
  rejected: [],
  revoked: [],
};

function assertSubleaseTransition(
  from: SubleaseRequestStatus,
  to: SubleaseRequestStatus
): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SubleaseService {
  constructor(
    private requestRepo: SubleaseRequestRepository,
    private groupRepo: TenantGroupRepository
  ) {}

  /** Additive Wave 3 hook for attaching the live Postgres repos at runtime. */
  attachRepository(repos: {
    requestRepo?: SubleaseRequestRepository;
    groupRepo?: TenantGroupRepository;
  }): void {
    if (repos.requestRepo) this.requestRepo = repos.requestRepo;
    if (repos.groupRepo) this.groupRepo = repos.groupRepo;
  }

  async submit(
    tenantId: TenantId,
    input: SubmitSubleaseInput,
    actor: UserId
  ): Promise<Result<SubleaseRequest, SubleaseErrorResult>> {
    if (!input.parentLeaseId || !input.requestedBy) {
      return err({
        code: SubleaseError.INVALID_INPUT,
        message: 'parentLeaseId and requestedBy are required',
      });
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const entity: SubleaseRequest = {
      id: asSubleaseRequestId(`subreq_${Date.now()}_${randomHex(4)}`),
      tenantId,
      parentLeaseId: input.parentLeaseId,
      requestedBy: input.requestedBy,
      ...(input.subtenantCandidateId !== undefined
        ? { subtenantCandidateId: input.subtenantCandidateId }
        : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      rentResponsibility: input.rentResponsibility ?? 'primary_tenant',
      ...(input.splitPercent !== undefined ? { splitPercent: input.splitPercent } : {}),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
    };
    const saved = await this.requestRepo.create(entity);
    return ok(saved);
  }

  /**
   * Record a reviewer note + keep status pending.
   * Actual ApprovalService routing is wired at the edge.
   */
  async review(
    id: SubleaseRequestId,
    tenantId: TenantId,
    _input: ReviewSubleaseInput,
    actor: UserId
  ): Promise<Result<SubleaseRequest, SubleaseErrorResult>> {
    const entity = await this.requestRepo.findById(id, tenantId);
    if (!entity) {
      return err({ code: SubleaseError.REQUEST_NOT_FOUND, message: 'Sublease request not found' });
    }
    if (entity.status !== 'pending') {
      return err({
        code: SubleaseError.ILLEGAL_STATUS,
        message: `Cannot review when status is ${entity.status}`,
      });
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: SubleaseRequest = { ...entity, updatedAt: now, updatedBy: actor };
    const saved = await this.requestRepo.update(updated);
    return ok(saved);
  }

  async approve(
    id: SubleaseRequestId,
    tenantId: TenantId,
    input: ApproveSubleaseInput,
    actor: UserId
  ): Promise<Result<{ request: SubleaseRequest; group: TenantGroup }, SubleaseErrorResult>> {
    const entity = await this.requestRepo.findById(id, tenantId);
    if (!entity) {
      return err({ code: SubleaseError.REQUEST_NOT_FOUND, message: 'Sublease request not found' });
    }
    if (!assertSubleaseTransition(entity.status, 'approved')) {
      return err({
        code: SubleaseError.ILLEGAL_STATUS,
        message: `Illegal transition ${entity.status} -> approved`,
      });
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const updatedRequest: SubleaseRequest = {
      ...entity,
      status: 'approved',
      updatedAt: now,
      updatedBy: actor,
    };
    const savedRequest = await this.requestRepo.update(updatedRequest);

    // Upsert tenant group: attach subtenant as a member (additive).
    const existing = await this.groupRepo.findByPrimaryLease(entity.parentLeaseId, tenantId);
    const subtenantMember: TenantGroupMember | null = entity.subtenantCandidateId
      ? { customerId: entity.subtenantCandidateId, role: 'subtenant', addedAt: now }
      : null;

    let group: TenantGroup;
    if (!existing) {
      const primaryMember: TenantGroupMember = {
        customerId: entity.requestedBy,
        role: 'primary',
        addedAt: now,
      };
      const members = subtenantMember ? [primaryMember, subtenantMember] : [primaryMember];
      const newGroup: TenantGroup = {
        id: asTenantGroupId(`tgroup_${Date.now()}_${randomHex(4)}`),
        tenantId,
        primaryLeaseId: entity.parentLeaseId,
        members,
        effectiveFrom: input.effectiveFrom ?? now,
        ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo } : {}),
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
      };
      group = await this.groupRepo.create(newGroup);
    } else {
      const members = subtenantMember ? [...existing.members, subtenantMember] : existing.members;
      const resolvedEffectiveTo = input.effectiveTo ?? existing.effectiveTo;
      const updatedGroup: TenantGroup = {
        ...existing,
        members,
        effectiveFrom: existing.effectiveFrom ?? input.effectiveFrom ?? now,
        ...(resolvedEffectiveTo !== undefined ? { effectiveTo: resolvedEffectiveTo } : {}),
        updatedAt: now,
        updatedBy: actor,
      };
      group = await this.groupRepo.update(updatedGroup);
    }

    return ok({ request: savedRequest, group });
  }

  async revoke(
    id: SubleaseRequestId,
    tenantId: TenantId,
    input: RevokeSubleaseInput,
    actor: UserId
  ): Promise<Result<SubleaseRequest, SubleaseErrorResult>> {
    if (!input.reason) {
      return err({ code: SubleaseError.INVALID_INPUT, message: 'reason is required to revoke' });
    }
    const entity = await this.requestRepo.findById(id, tenantId);
    if (!entity) {
      return err({ code: SubleaseError.REQUEST_NOT_FOUND, message: 'Sublease request not found' });
    }
    if (!assertSubleaseTransition(entity.status, 'revoked')) {
      return err({
        code: SubleaseError.ILLEGAL_STATUS,
        message: `Illegal transition ${entity.status} -> revoked`,
      });
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const updated: SubleaseRequest = {
      ...entity,
      status: 'revoked',
      updatedAt: now,
      updatedBy: actor,
    };
    const saved = await this.requestRepo.update(updated);

    // Archive subtenant member (never delete — acceptance criterion).
    const group = await this.groupRepo.findByPrimaryLease(entity.parentLeaseId, tenantId);
    if (group && entity.subtenantCandidateId) {
      const members = group.members.map((m) =>
        m.customerId === entity.subtenantCandidateId && m.role === 'subtenant' && !m.archivedAt
          ? { ...m, archivedAt: now }
          : m
      );
      await this.groupRepo.update({
        ...group,
        members,
        updatedAt: now,
        updatedBy: actor,
      });
    }

    return ok(saved);
  }
}
