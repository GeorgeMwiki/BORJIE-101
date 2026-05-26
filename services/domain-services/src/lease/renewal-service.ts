/**
 * Lease Renewal Service
 *
 * Explicit renewal lifecycle on top of the existing `LeaseService`.
 * Handles five transitions:
 *
 *   1. openRenewalWindow  — moves lease to `window_opened` and emits
 *                           `RenewalWindowOpened`.
 *   2. proposeRenewal     — records proposed rent and emits
 *                           `RenewalProposed`.
 *   3. acceptRenewal      — creates a NEW lease row (immutable old lease
 *                           retained for audit) and emits `RenewalAccepted`.
 *   4. declineRenewal     — marks old lease `declined` and emits
 *                           `RenewalDeclined`.
 *   5. terminate          — terminates lease outside of renewal path and
 *                           emits `LeaseTerminatedByRenewal`.
 *
 * The service is transport-agnostic and depends only on a repository + event
 * bus. It does not mutate the old lease on accept — instead a linked new
 * lease row is inserted and `renewedToLeaseId` is stamped on the old.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import { randomHex } from '../common/id-generator.js';

// ---------------------------------------------------------------------------
// Domain model (deliberately narrow — we don't re-import the Lease aggregate
// to avoid cross-module drift in the lease barrel).
// ---------------------------------------------------------------------------

export type LeaseRenewalStatus =
  | 'not_started'
  | 'window_opened'
  | 'proposed'
  | 'accepted'
  | 'declined'
  | 'terminated'
  | 'expired';

export interface RenewalLeaseSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly leaseNumber: string;
  readonly propertyId: string;
  readonly unitId: string;
  readonly customerId: string;
  readonly startDate: ISOTimestamp;
  readonly endDate: ISOTimestamp | null;
  readonly rentAmount: number;
  readonly rentCurrency: string;
  readonly renewalStatus: LeaseRenewalStatus;
  readonly renewalWindowOpenedAt: ISOTimestamp | null;
  readonly renewalProposedAt: ISOTimestamp | null;
  readonly renewalProposedRent: number | null;
  readonly renewalDecidedAt: ISOTimestamp | null;
  readonly renewalDecisionBy: UserId | null;
  readonly terminationDate: ISOTimestamp | null;
  readonly terminationReasonNotes: string | null;
}

export interface RenewalRepository {
  findById(id: string, tenantId: TenantId): Promise<RenewalLeaseSnapshot | null>;
  update(lease: RenewalLeaseSnapshot): Promise<RenewalLeaseSnapshot>;
  createRenewedLease(params: {
    fromLeaseId: string;
    tenantId: TenantId;
    newLeaseId: string;
    newLeaseNumber: string;
    startDate: ISOTimestamp;
    endDate: ISOTimestamp;
    rentAmount: number;
    rentCurrency: string;
    createdBy: UserId;
  }): Promise<RenewalLeaseSnapshot>;
  nextLeaseSequence(tenantId: TenantId): Promise<number>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const RenewalServiceError = {
  LEASE_NOT_FOUND: 'LEASE_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type RenewalServiceErrorCode =
  (typeof RenewalServiceError)[keyof typeof RenewalServiceError];

export interface RenewalServiceErrorResult {
  code: RenewalServiceErrorCode;
  message: string;
}

function err<T>(
  code: RenewalServiceErrorCode,
  message: string,
): Result<T, RenewalServiceErrorResult> {
  return {
    success: false,
    ok: false,
    error: { code, message },
  } as Result<T, RenewalServiceErrorResult>;
}

function ok<T>(value: T): Result<T, RenewalServiceErrorResult> {
  return {
    success: true,
    ok: true,
    data: value,
    value,
  } as Result<T, RenewalServiceErrorResult>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface RenewalEventBase extends DomainEvent {
  readonly tenantId: TenantId;
}

export interface RenewalWindowOpenedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalWindowOpened';
  readonly payload: {
    readonly leaseId: string;
    readonly leaseNumber: string;
    readonly customerId: string;
    readonly endDate: ISOTimestamp | null;
    readonly openedBy: UserId;
  };
}

export interface RenewalProposedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalProposed';
  readonly payload: {
    readonly leaseId: string;
    readonly proposedRent: number;
    readonly proposedBy: UserId;
  };
}

export interface RenewalAcceptedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalAccepted';
  readonly payload: {
    readonly previousLeaseId: string;
    readonly newLeaseId: string;
    readonly acceptedBy: UserId;
  };
}

export interface RenewalDeclinedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalDeclined';
  readonly payload: {
    readonly leaseId: string;
    readonly declinedBy: UserId;
    readonly reason: string | null;
  };
}

export interface LeaseTerminatedByRenewalEvent extends RenewalEventBase {
  readonly eventType: 'LeaseTerminatedByRenewal';
  readonly payload: {
    readonly leaseId: string;
    readonly terminationDate: ISOTimestamp;
    readonly reason: string;
    readonly terminatedBy: UserId;
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ProposeRenewalInput {
  readonly proposedRent: number;
  readonly proposedBy: UserId;
}

export interface AcceptRenewalInput {
  readonly newEndDate: ISOTimestamp;
  readonly acceptedBy: UserId;
}

export interface DeclineRenewalInput {
  readonly declinedBy: UserId;
  readonly reason?: string;
}

export interface TerminateInput {
  readonly terminationDate: ISOTimestamp;
  readonly reason: string;
  readonly terminatedBy: UserId;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Valid forward transitions. Reverse transitions are disallowed — once a
 * lease is accepted/declined/terminated it is immutable.
 */
const ALLOWED_TRANSITIONS: Record<LeaseRenewalStatus, LeaseRenewalStatus[]> = {
  not_started: ['window_opened', 'terminated'],
  window_opened: ['proposed', 'declined', 'terminated', 'expired'],
  proposed: ['accepted', 'declined', 'terminated', 'expired'],
  accepted: [],
  declined: [],
  terminated: [],
  expired: [],
};

export class RenewalService {
  constructor(
    private readonly repo: RenewalRepository,
    private readonly eventBus: EventBus,
  ) {}

  async openRenewalWindow(
    leaseId: string,
    tenantId: TenantId,
    openedBy: UserId,
    correlationId: string,
  ): Promise<Result<RenewalLeaseSnapshot, RenewalServiceErrorResult>> {
    const lease = await this.repo.findById(leaseId, tenantId);
    if (!lease) {
      return err('LEASE_NOT_FOUND', 'Lease not found');
    }
    if (!this.canTransition(lease.renewalStatus, 'window_opened')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot open renewal window from ${lease.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalLeaseSnapshot = {
      ...lease,
      renewalStatus: 'window_opened',
      renewalWindowOpenedAt: now,
    };
    const saved = await this.repo.update(updated);

    const event: RenewalWindowOpenedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalWindowOpened',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId: saved.id,
        leaseNumber: saved.leaseNumber,
        customerId: saved.customerId,
        endDate: saved.endDate,
        openedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Lease'));
    return ok(saved);
  }

  async proposeRenewal(
    leaseId: string,
    tenantId: TenantId,
    input: ProposeRenewalInput,
    correlationId: string,
  ): Promise<Result<RenewalLeaseSnapshot, RenewalServiceErrorResult>> {
    if (input.proposedRent <= 0) {
      return err('INVALID_INPUT', 'proposedRent must be positive');
    }
    const lease = await this.repo.findById(leaseId, tenantId);
    if (!lease) return err('LEASE_NOT_FOUND', 'Lease not found');
    if (!this.canTransition(lease.renewalStatus, 'proposed')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot propose renewal from ${lease.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalLeaseSnapshot = {
      ...lease,
      renewalStatus: 'proposed',
      renewalProposedAt: now,
      renewalProposedRent: input.proposedRent,
    };
    const saved = await this.repo.update(updated);
    const event: RenewalProposedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalProposed',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId: saved.id,
        proposedRent: input.proposedRent,
        proposedBy: input.proposedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Lease'));
    return ok(saved);
  }

  async acceptRenewal(
    leaseId: string,
    tenantId: TenantId,
    input: AcceptRenewalInput,
    correlationId: string,
  ): Promise<Result<RenewalLeaseSnapshot, RenewalServiceErrorResult>> {
    const lease = await this.repo.findById(leaseId, tenantId);
    if (!lease) return err('LEASE_NOT_FOUND', 'Lease not found');
    if (!this.canTransition(lease.renewalStatus, 'accepted')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot accept renewal from ${lease.renewalStatus}`,
      );
    }
    if (lease.renewalProposedRent == null) {
      return err(
        'INVALID_INPUT',
        'Cannot accept renewal without a proposal',
      );
    }

    const now = new Date().toISOString() as ISOTimestamp;
    // Stamp decision on the OLD lease (immutable from here)
    const oldLeaseUpdate: RenewalLeaseSnapshot = {
      ...lease,
      renewalStatus: 'accepted',
      renewalDecidedAt: now,
      renewalDecisionBy: input.acceptedBy,
    };
    await this.repo.update(oldLeaseUpdate);

    const sequence = await this.repo.nextLeaseSequence(tenantId);
    const newLeaseId = `lease_${Date.now()}_${randomHex(4)}`;
    const newLeaseNumber = `L-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`;

    const newLease = await this.repo.createRenewedLease({
      fromLeaseId: lease.id,
      tenantId,
      newLeaseId,
      newLeaseNumber,
      startDate: (lease.endDate ?? now) as ISOTimestamp,
      endDate: input.newEndDate,
      rentAmount: lease.renewalProposedRent,
      rentCurrency: lease.rentCurrency,
      createdBy: input.acceptedBy,
    });

    const event: RenewalAcceptedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalAccepted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        previousLeaseId: lease.id,
        newLeaseId: newLease.id,
        acceptedBy: input.acceptedBy,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, newLease.id, 'Lease'),
    );
    return ok(newLease);
  }

  async declineRenewal(
    leaseId: string,
    tenantId: TenantId,
    input: DeclineRenewalInput,
    correlationId: string,
  ): Promise<Result<RenewalLeaseSnapshot, RenewalServiceErrorResult>> {
    const lease = await this.repo.findById(leaseId, tenantId);
    if (!lease) return err('LEASE_NOT_FOUND', 'Lease not found');
    if (!this.canTransition(lease.renewalStatus, 'declined')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot decline renewal from ${lease.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalLeaseSnapshot = {
      ...lease,
      renewalStatus: 'declined',
      renewalDecidedAt: now,
      renewalDecisionBy: input.declinedBy,
      terminationReasonNotes: input.reason ?? lease.terminationReasonNotes,
    };
    const saved = await this.repo.update(updated);
    const event: RenewalDeclinedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalDeclined',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId: saved.id,
        declinedBy: input.declinedBy,
        reason: input.reason ?? null,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Lease'));
    return ok(saved);
  }

  async terminate(
    leaseId: string,
    tenantId: TenantId,
    input: TerminateInput,
    correlationId: string,
  ): Promise<Result<RenewalLeaseSnapshot, RenewalServiceErrorResult>> {
    const lease = await this.repo.findById(leaseId, tenantId);
    if (!lease) return err('LEASE_NOT_FOUND', 'Lease not found');
    if (!this.canTransition(lease.renewalStatus, 'terminated')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot terminate from ${lease.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalLeaseSnapshot = {
      ...lease,
      renewalStatus: 'terminated',
      renewalDecidedAt: now,
      renewalDecisionBy: input.terminatedBy,
      terminationDate: input.terminationDate,
      terminationReasonNotes: input.reason,
    };
    const saved = await this.repo.update(updated);
    const event: LeaseTerminatedByRenewalEvent = {
      eventId: generateEventId(),
      eventType: 'LeaseTerminatedByRenewal',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId: saved.id,
        terminationDate: input.terminationDate,
        reason: input.reason,
        terminatedBy: input.terminatedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Lease'));
    return ok(saved);
  }

  private canTransition(
    from: LeaseRenewalStatus,
    to: LeaseRenewalStatus,
  ): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }
}
